begin;
create unique index epp_one_named_personal_account on public.app_accounts(lower(regexp_replace(btrim(display_name),'\s+',' ','g')))
  where active and username not in ('beheer','kijker');
create function public.epp_personal_account_identity() returns trigger language plpgsql set search_path=public as $$
declare person_name text:=lower(regexp_replace(btrim(new.display_name),'\s+',' ','g'));
begin
  if new.active and new.username not in ('beheer','kijker') then
    perform pg_advisory_xact_lock(hashtextextended('person:'||person_name,0));
    if exists(select 1 from app_accounts where active and username not in ('beheer','kijker') and id<>new.id and lower(regexp_replace(btrim(display_name),'\s+',' ','g'))=person_name) then raise exception 'persoonlijk_account_bestaat_al';end if;
  end if;
  return new;
end $$;
create trigger epp_personal_account_identity before insert or update of display_name,username,active on public.app_accounts for each row execute function public.epp_personal_account_identity();
commit;
