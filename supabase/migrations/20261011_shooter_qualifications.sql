begin;
create table public.shooter_qualifications (
  id uuid primary key default gen_random_uuid(),
  shooter_id uuid not null references public.shooters(id) on delete restrict,
  division_id uuid not null references public.divisions(id) on delete restrict,
  qualification_year integer not null check (qualification_year between 1980 and 2200),
  title text check (title in ('Marksman','Expert','Master')),
  average_score numeric check (average_score between 0 and 250),
  source text not null check (length(trim(source))>=3),
  active boolean not null default true,
  revision integer not null default 1,
  confirmed_by uuid not null references public.app_accounts(id),
  confirmed_at timestamptz not null default now(),
  unique (shooter_id,division_id,qualification_year),
  check (not active or title is not null),
  check (average_score is null or title is null or average_score>=case title when 'Master' then 228 when 'Expert' then 215 else 191 end)
);
create table public.qualification_audit (
  id uuid primary key default gen_random_uuid(),
  qualification_id uuid not null references public.shooter_qualifications(id) on delete restrict,
  actor_id uuid not null references public.app_accounts(id),
  before jsonb,
  after jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.shooter_qualifications enable row level security;
alter table public.qualification_audit enable row level security;
revoke all on public.shooter_qualifications,public.qualification_audit from anon,authenticated;
grant all on public.shooter_qualifications,public.qualification_audit to service_role;

create function public.epp_set_qualification(p_actor uuid,p_club uuid,p_shooter uuid,p_division uuid,p_year integer,p_title text,p_source text,p_average numeric default null,p_expected integer default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old shooter_qualifications; saved shooter_qualifications; label text;
begin
  if not exists(select 1 from app_accounts a join clubs c on c.code=a.club_code where a.id=p_actor and c.id=p_club and a.active and a.role='trainer' and a.is_admin) then raise exception 'geen_beheerrechten'; end if;
  if not exists(select 1 from memberships where shooter_id=p_shooter and club_id=p_club) then raise exception 'schutter_niet_van_vereniging'; end if;
  if not exists(select 1 from divisions where id=p_division and naam in ('EPP pistool','Open')) then raise exception 'ongeldige_discipline'; end if;
  if p_year is null or p_year<1980 or p_year>extract(year from current_date) then raise exception 'ongeldig_kwalificatiejaar'; end if;
  label:=nullif(trim(p_title),'');
  if label is not null and label not in ('Marksman','Expert','Master') then raise exception 'ongeldige_kwalificatie'; end if;
  if length(trim(coalesce(p_source,'')))<3 then raise exception 'kwalificatiebron_verplicht'; end if;
  if p_average is not null and (p_average<0 or p_average>250 or (label is not null and p_average<case label when 'Master' then 228 when 'Expert' then 215 else 191 end)) then raise exception 'kwalificatiegemiddelde_te_laag'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_shooter::text||p_division::text||p_year::text,0));
  select * into old from shooter_qualifications where shooter_id=p_shooter and division_id=p_division and qualification_year=p_year for update;
  if coalesce(old.revision,0)<>p_expected then
    if old.title is not distinct from label and old.source=trim(p_source) and old.average_score is not distinct from p_average and old.active=(label is not null) then return to_jsonb(old); end if;
    raise exception 'kwalificatie_conflict';
  end if;
  insert into shooter_qualifications(shooter_id,division_id,qualification_year,title,average_score,source,active,revision,confirmed_by)
  values(p_shooter,p_division,p_year,label,p_average,trim(p_source),label is not null,coalesce(old.revision,0)+1,p_actor)
  on conflict(shooter_id,division_id,qualification_year) do update set title=excluded.title,average_score=excluded.average_score,source=excluded.source,active=excluded.active,revision=excluded.revision,confirmed_by=p_actor,confirmed_at=now()
  returning * into saved;
  insert into qualification_audit(qualification_id,actor_id,before,after) values(saved.id,p_actor,case when old.id is null then null else to_jsonb(old) end,to_jsonb(saved));
  return to_jsonb(saved);
end $$;
revoke all on function public.epp_set_qualification(uuid,uuid,uuid,uuid,integer,text,text,numeric,integer) from public,anon,authenticated;
grant execute on function public.epp_set_qualification(uuid,uuid,uuid,uuid,integer,text,text,numeric,integer) to service_role;

-- Include the new records in future snapshots without changing existing backups.
create function public.epp_backup_qualifications() returns trigger language plpgsql set search_path=public,extensions as $$
begin
  new.snapshot:=new.snapshot||jsonb_build_object(
    'shooter_qualifications',(select coalesce(jsonb_agg(q),'[]') from shooter_qualifications q),
    'qualification_audit',(select coalesce(jsonb_agg(q),'[]') from qualification_audit q));
  new.checksum:=encode(digest(new.snapshot::text,'sha256'),'hex');
  return new;
end $$;
create trigger epp_backup_qualifications before insert on public.platform_backups for each row execute function public.epp_backup_qualifications();
commit;
