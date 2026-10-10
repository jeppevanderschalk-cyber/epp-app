begin;
create function public.epp_register_public_pending_member(p_club text,p_username text,p_first text,p_last text,p_email text,p_salt text,p_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid;
begin
  select id into strict actor from app_accounts where username='hoofdbeheer' and active and is_platform_admin;
  return epp_register_pending_member(actor,p_club,p_username,p_first,p_last,p_email,p_salt,p_hash);
end $$;
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('epp_register_pending_member(uuid,text,text,text,text,text,text,text)'::regprocedure);
  definition:=replace(definition,'active and username=''kijker'' and role=''schutter''','active and ((username=''kijker'' and role=''schutter'') or (username=''hoofdbeheer'' and is_platform_admin))');
  execute definition;
end $$;
revoke all on function epp_register_public_pending_member(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function epp_register_public_pending_member(text,text,text,text,text,text,text) to service_role;
commit;
