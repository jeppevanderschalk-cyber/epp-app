begin;
do $$
declare head uuid; member uuid; sid uuid; rejected boolean:=false;
begin
  select id into head from app_accounts where club_code='eppnationaal' and username='hoofdbeheer';
  assert head is not null,'separate head account exists';
  begin
    insert into shooters(display_name,linked_user_id)values('Head must not participate',head);
  exception when others then
    if sqlerrm='hoofdbeheer_is_geen_schutter' then rejected:=true;else raise;end if;
  end;
  assert rejected,'national administrator cannot be linked to a new shooter';
  insert into app_accounts(club_code,username,display_name,role)
    values('svbb','lid.'||replace(gen_random_uuid()::text,'-',''),'Separate Head Member Test','schutter')returning id into member;
  insert into platform_users(id,auth_provider_id)values(member,'epp-account:'||member);
  insert into shooters(display_name,linked_user_id)values('Separate Head Member Test',member)returning id into sid;
  rejected:=false;
  begin
    update shooters set linked_user_id=head where id=sid;
  exception when others then
    if sqlerrm in ('hoofdbeheer_is_geen_schutter','schutter_vereniging_vast')then rejected:=true;else raise;end if;
  end;
  assert rejected,'existing shooter cannot be transferred to administrator';
  assert (select linked_user_id=member from shooters where id=sid),'personal shooter profile preserved';
end $$;
rollback;
