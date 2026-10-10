begin;
do $$
declare snap jsonb;tbl text;restored jsonb;
begin
  select snapshot into snap from platform_backups order by created_at desc limit 1;
  if snap is null then raise exception 'backup_ontbreekt';end if;
  foreach tbl in array array['app_accounts','shooters','memberships','results','epp_matches','epp_signups','epp_signup_disciplines','epp_match_planners','epp_match_slots','epp_teams','epp_team_members','training_entities','shooter_qualifications'] loop
    if jsonb_typeof(snap->tbl) is distinct from 'array' then raise exception 'backup_tabel_ontbreekt:%',tbl;end if;
    execute format('create temporary table restored_%I (like public.%I including defaults) on commit drop',tbl,tbl);
    execute format('insert into restored_%I select * from jsonb_populate_recordset(null::public.%I,$1)',tbl,tbl) using snap->tbl;
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from restored_%I t',tbl) into restored;
    if restored is distinct from (select coalesce(jsonb_agg(value order by value::text),'[]') from jsonb_array_elements(snap->tbl)) then raise exception 'herstel_inhoud_verschilt:%',tbl;end if;
  end loop;
end $$;
rollback;
