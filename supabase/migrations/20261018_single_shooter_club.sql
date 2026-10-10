begin;
alter table public.shooters add column home_club_id uuid references public.clubs(id);
do $$begin
  if exists(select 1 from memberships group by shooter_id having count(distinct club_id)>1) then raise exception 'bestaande_dubbele_verenigingen_eerst_oplossen';end if;
end $$;
update public.shooters s set home_club_id=(select m.club_id from memberships m where m.shooter_id=s.id order by m.valid_from limit 1);
create unique index epp_one_personal_account on public.app_accounts(username) where active and username like 'lid.%';
create unique index epp_one_profile_per_account on public.shooters(linked_user_id) where linked_user_id is not null;

create function public.epp_account_one_club() returns trigger language plpgsql set search_path=public as $$
begin
  if new.active and new.username like 'lid.%' then
    perform pg_advisory_xact_lock(hashtextextended(new.username,0));
    if exists(select 1 from app_accounts where active and username=new.username and id<>new.id) then raise exception 'persoonlijk_account_bestaat_al';end if;
  end if;
  if exists(select 1 from shooters s join clubs c on c.id=s.home_club_id where s.linked_user_id=new.id and c.code<>new.club_code) then raise exception 'schutter_vereniging_vast';end if;
  return new;
end $$;
create trigger epp_account_one_club before insert or update of club_code,username,active on public.app_accounts for each row execute function public.epp_account_one_club();

create function public.epp_shooter_one_club() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and old.home_club_id is not null and new.home_club_id is distinct from old.home_club_id then raise exception 'schutter_vereniging_vast';end if;
  if new.linked_user_id is not null and new.home_club_id is not null and exists(select 1 from app_accounts a join clubs c on c.code=a.club_code where a.id=new.linked_user_id and c.id<>new.home_club_id) then raise exception 'schutter_vereniging_vast';end if;
  return new;
end $$;
create trigger epp_shooter_one_club before insert or update of home_club_id,linked_user_id on public.shooters for each row execute function public.epp_shooter_one_club();

create function public.epp_membership_one_club() returns trigger language plpgsql set search_path=public as $$
declare s shooters;
begin
  select * into s from shooters where id=new.shooter_id for update;
  if s.home_club_id is not null and s.home_club_id<>new.club_id then raise exception 'schutter_vereniging_vast';end if;
  if s.linked_user_id is not null and exists(select 1 from app_accounts a join clubs c on c.code=a.club_code where a.id=s.linked_user_id and c.id<>new.club_id) then raise exception 'schutter_vereniging_vast';end if;
  if s.home_club_id is null then update shooters set home_club_id=new.club_id where id=s.id;end if;
  return new;
end $$;
create trigger epp_membership_one_club before insert or update of shooter_id,club_id on public.memberships for each row execute function public.epp_membership_one_club();

create function public.epp_result_own_club() returns trigger language plpgsql set search_path=public as $$
declare cid uuid;
begin
  select home_club_id into cid from shooters where id=new.shooter_id;
  if cid is null or new.represented_club_id is distinct from cid then raise exception 'alleen_eigen_vereniging';end if;
  return new;
end $$;
create trigger epp_result_own_club before insert or update of shooter_id,represented_club_id on public.results for each row execute function public.epp_result_own_club();
commit;
