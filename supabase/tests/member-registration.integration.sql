begin;
do $$
declare actor uuid; trainer uuid; account_id uuid; sid uuid; rejected boolean;
begin
  insert into app_accounts(club_code,username,display_name,role)values('gast','kijker','Registratietest kijker','schutter')
    on conflict(club_code,username)do update set active=true returning id into actor;
  select id into trainer from app_accounts where club_code='gast' and username='beheer';
  account_id:=epp_self_register_member(actor,'lid.'||repeat('a',40),'Test','Registratie',repeat('b',48),repeat('c',64));
  if not exists(select 1 from app_accounts where id=account_id and role='schutter' and not is_admin and first_name='Test' and last_name='Registratie')then raise exception 'account_invalid'; end if;
  select id into strict sid from shooters where linked_user_id=account_id;
  if not exists(select 1 from memberships m join clubs c on c.id=m.club_id where m.shooter_id=sid and c.code='gast')then raise exception 'club_invalid'; end if;
  if not exists(select 1 from training_entities where club_code='gast' and kind='shooter' and entity_id=sid::text and data->>'naam'='Test Registratie')then raise exception 'directory_invalid'; end if;
  rejected:=false;
  begin perform epp_self_register_member(actor,'lid.'||repeat('a',40),'Test','Registratie',repeat('b',48),repeat('c',64));
  exception when others then if sqlerrm='naam_al_geregistreerd' then rejected:=true;else raise;end if;end;
  if not rejected then raise exception 'duplicate_allowed';end if;
  rejected:=false;
  begin perform epp_self_register_member(trainer,'lid.'||repeat('d',40),'Test','Trainer',repeat('b',48),repeat('c',64));
  exception when others then if sqlerrm='registratie_niet_toegestaan' then rejected:=true;else raise;end if;end;
  if not rejected then raise exception 'trainer_allowed';end if;
end $$;
rollback;
