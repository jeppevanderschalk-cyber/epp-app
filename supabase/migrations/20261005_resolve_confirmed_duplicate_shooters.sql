begin;
select pg_advisory_xact_lock(hashtextextended('training:svbb',0));
lock table public.shooters,public.memberships,public.training_entities,public.epp_signups,public.results in share row exclusive mode;
select public.epp_capture_backup();

-- The owner confirmed these duplicate names belong to the same two people.
-- Keep IDs with scores; retain empty source records and audit the list removal.
do $$
declare pair record; cid uuid; old_row training_entities; registration record;
begin
  select id into strict cid from clubs where code='svbb';
  for pair in select * from (values
    ('c989e164-bfc2-4ef9-8a28-f02e3ace7d7b'::uuid,'5b1d91c8-9346-48e9-bf27-f1c9cc2f0214'::uuid,'Jeppe'),
    ('3462d310-81e6-4bc9-9fbe-26f2cd4f661d'::uuid,'8ebcbe85-59d5-488c-8405-50c53ceef579'::uuid,'Belinda')
  ) as confirmed(source_id,target_id,name) loop
    if not exists(select 1 from shooters s join memberships m on m.shooter_id=s.id where s.id=pair.target_id and s.display_name=pair.name and m.club_id=cid)
      or not exists(select 1 from shooters where id=pair.source_id and display_name=pair.name and linked_user_id is null)
    then raise exception 'Identiteitscontrole mislukt'; end if;
    if exists(select 1 from results where shooter_id=pair.source_id)
      or exists(select 1 from epp_signups where shooter_id=pair.source_id)
      or exists(select 1 from training_entities where kind<>'shooter' and
        (position(pair.source_id::text in entity_id)>0 or position(pair.source_id::text in coalesce(data::text,''))>0))
    then raise exception 'Leeg duplicaat bevat inmiddels gegevens; handmatige controle nodig'; end if;

    for registration in select r.* from epp_signups r join epp_matches m on m.id=r.match_id
      where r.shooter_id is null and m.club_id='svbb' and lower(trim(r.shooter_name))=lower(pair.name) loop
      if exists(select 1 from epp_signups where match_id=registration.match_id and shooter_id=pair.target_id)
      then raise exception 'Er bestaat al een inschrijving voor dit ID; niets samengevoegd'; end if;
      update epp_signups set shooter_id=pair.target_id,updated_at=now() where id=registration.id;
      insert into training_audit(club_code,kind,entity_id,before_data,after_data)
      values('svbb','signupIdentity',registration.id::text,to_jsonb(registration),
        to_jsonb(registration)||jsonb_build_object('shooter_id',pair.target_id,'reason','Eigenaar bevestigt dubbele persoon'));
    end loop;

    select * into old_row from training_entities where club_code='svbb' and kind='shooter' and entity_id=pair.source_id::text;
    if old_row.data is not null then
      insert into training_audit(club_code,kind,entity_id,before_data,after_data)
      values('svbb','shooter',pair.source_id::text,old_row.data,null);
      update training_entities set data=null,revision=revision+1,updated_at=now()
      where club_code='svbb' and kind='shooter' and entity_id=pair.source_id::text;
    end if;
    delete from memberships where shooter_id=pair.source_id and club_id=cid;
  end loop;
end $$;
commit;
