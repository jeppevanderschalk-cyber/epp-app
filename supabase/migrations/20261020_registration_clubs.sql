-- Sources: europeespraktijkparcours.nl/therapies and /organiserende-verenigingen.
begin;
insert into public.clubs(code,naam)values
  ('apgs','APGS'),('maarheeze','SV Maarheeze'),('beemtebroekland','SV Beemte Broekland'),
  ('politienoordholland','Schietvereniging Politie Noord-Holland'),('hansi','Schietteam HANSI'),
  ('thorheim','SV Thorheim'),('schietteamkl','Schietteam Koninklijke Landmacht'),('dekorrel','SV De Korrel - Druten')
on conflict(code)do nothing;
insert into public.app_accounts(club_code,username,display_name,role,is_admin)
select code,'kijker','Meekijkers '||naam,'schutter',false from clubs where actief and code not in ('gast','eppnationaal')
on conflict(club_code,username)do nothing;
create function public.epp_register_member_at_club(p_actor uuid,p_club text,p_username text,p_first text,p_last text,p_salt text,p_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare a app_accounts;target_viewer uuid;
begin
  select * into a from app_accounts where id=p_actor and active;
  if a.id is null or a.username<>'kijker' or a.role<>'schutter' then raise exception 'registratie_niet_toegestaan';end if;
  select ac.id into target_viewer from app_accounts ac join clubs c on c.code=ac.club_code where ac.club_code=p_club and ac.username='kijker' and ac.role='schutter' and ac.active and c.actief and c.code not in ('gast','eppnationaal');
  if target_viewer is null then raise exception 'vereniging_verplicht';end if;
  return epp_self_register_member(target_viewer,p_username,p_first,p_last,p_salt,p_hash);
end $$;
revoke all on function public.epp_register_member_at_club(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.epp_register_member_at_club(uuid,text,text,text,text,text,text) to service_role;
commit;
