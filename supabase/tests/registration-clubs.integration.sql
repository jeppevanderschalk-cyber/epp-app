begin;
do $$
declare actor uuid; member uuid; rejected boolean; target text;
begin
  select id into strict actor from app_accounts where club_code='svbb' and username='kijker';
  member:=epp_register_member_at_club(actor,'apgs','lid.'||repeat('e',40),'Clubkeuze','Registratietest',repeat('b',48),repeat('c',64));
  if not exists(select 1 from app_accounts where id=member and club_code='apgs' and role='schutter' and not is_admin and not is_platform_admin)then raise exception 'target_account_invalid';end if;
  if not exists(select 1 from shooters s join clubs c on c.id=s.home_club_id where s.linked_user_id=member and c.code='apgs')then raise exception 'target_home_club_invalid';end if;
  foreach target in array array['gast','eppnationaal','unknown'] loop
    rejected:=false;
    begin perform epp_register_member_at_club(actor,target,'lid.'||repeat('f',40),'Invalid','Registratietest',repeat('b',48),repeat('c',64));
    exception when others then if sqlerrm='vereniging_verplicht' then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'invalid_club_allowed';end if;
  end loop;
  rejected:=false;
  begin perform epp_register_member_at_club(member,'maarheeze','lid.'||repeat('f',40),'Second','Registratietest',repeat('b',48),repeat('c',64));
  exception when others then if sqlerrm='registratie_niet_toegestaan' then rejected:=true;else raise;end if;end;
  if not rejected then raise exception 'personal_actor_allowed';end if;
end $$;
rollback;
