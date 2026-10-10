begin;
-- The national administration login must never become a participant profile.
create or replace function public.epp_no_head_shooter() returns trigger
language plpgsql set search_path=public as $$
begin
  if exists(select 1 from app_accounts where id=new.linked_user_id
    and club_code='eppnationaal' and username='hoofdbeheer') then
    raise exception 'hoofdbeheer_is_geen_schutter';
  end if;
  return new;
end $$;
create trigger epp_no_head_shooter before insert or update of linked_user_id
on public.shooters for each row execute function public.epp_no_head_shooter();
commit;
