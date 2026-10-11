begin;
create table public.epp_personal_training_entities (
 account_id uuid not null references app_accounts(id) on delete cascade,
 kind text not null,entity_id text not null,data jsonb,revision bigint not null default 1,
 updated_by uuid not null references app_accounts(id),updated_at timestamptz not null default now(),
 primary key(account_id,kind,entity_id)
);
create table public.epp_personal_training_audit (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references app_accounts(id) on delete cascade,
 kind text not null,entity_id text not null,actor_id uuid not null references app_accounts(id),
 before_data jsonb,after_data jsonb,created_at timestamptz not null default now()
);
alter table public.epp_personal_training_entities enable row level security;
alter table public.epp_personal_training_audit enable row level security;
revoke all on public.epp_personal_training_entities,public.epp_personal_training_audit from public,anon,authenticated;
grant all on public.epp_personal_training_entities,public.epp_personal_training_audit to service_role;
create or replace function public.epp_personal_training_apply(p_club text,p_actor uuid,p_ops jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare op jsonb; old public.epp_personal_training_entities; expected jsonb; wanted jsonb; sid uuid;
begin
  if not exists(select 1 from app_accounts where id=p_actor and club_code=p_club and active and role='schutter' and username<>'kijker' and membership_approved and deleted_at is null) then raise exception 'geen_schrijfrechten'; end if;
  perform pg_advisory_xact_lock(hashtextextended('personal-training:'||p_actor::text,0));
  if jsonb_typeof(p_ops)<>'array' or jsonb_array_length(p_ops)>5000 then raise exception 'ongeldige_bewerking'; end if;
  select id into sid from shooters where linked_user_id=p_actor;
  if sid is null then raise exception 'persoonlijk_schutterprofiel_verplicht';end if;
  for op in select value from jsonb_array_elements(p_ops) loop
    expected:=nullif(op->'expected','null'); wanted:=nullif(op->'value','null');
    select * into old from epp_personal_training_entities where account_id=p_actor and kind=op->>'kind' and entity_id=op->>'id' for update;
    if old.data is not distinct from wanted then continue; end if;
    if old.data is distinct from expected then raise exception 'opslag_conflict:%:%',op->>'kind',op->>'id'; end if;
    if op->>'kind' not in ('round','shot','meta','parcoursBest','stageBest','archive') then raise exception 'alleen_eigen_training';end if;
    if op->>'kind'='meta' and op->>'id' not in ('currentTraining','stageShots') then raise exception 'ongeldige_bewerking';end if;
    if wanted is not null and (
      (op->>'kind' in ('round','shot') and (wanted->>'sid') is distinct from sid::text) or
      (op->>'kind'='parcoursBest' and op->>'id'<>sid::text) or
      (op->>'kind'='stageBest' and split_part(op->>'id',':',2)<>sid::text) or
      (op->>'kind'='archive' and exists(select 1 from jsonb_array_elements(coalesce(wanted->'rounds','[]')) r where (r->>'sid') is distinct from sid::text))
    ) then raise exception 'alleen_eigen_training';end if;
    insert into epp_personal_training_audit(account_id,kind,entity_id,actor_id,before_data,after_data) values(p_actor,op->>'kind',op->>'id',p_actor,old.data,wanted);
    insert into epp_personal_training_entities(account_id,kind,entity_id,data,updated_by)
    values(p_actor,op->>'kind',op->>'id',wanted,p_actor)
    on conflict(account_id,kind,entity_id) do update set data=excluded.data,revision=epp_personal_training_entities.revision+1,updated_by=p_actor,updated_at=now();
  end loop;
  return jsonb_build_object('ok',true,'entities',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',entity_id,'data',data)),'[]') from epp_personal_training_entities where account_id=p_actor));
end $$;

revoke all on function public.epp_personal_training_apply(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.epp_personal_training_apply(text,uuid,jsonb) to service_role;
-- Include personal entries in the existing scheduled database snapshots.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.epp_capture_backup()'::regprocedure) into definition;
 definition:=replace(definition,'  update platform_backups set snapshot=snap',
 $replacement$  snap:=snap||jsonb_build_object('epp_personal_training_entities',(select coalesce(jsonb_agg(t),'[]') from epp_personal_training_entities t),'epp_personal_training_audit',(select coalesce(jsonb_agg(t),'[]') from epp_personal_training_audit t));
  update platform_backups set snapshot=snap$replacement$);
 if position('epp_personal_training_entities' in definition)=0 then raise exception 'backup_koppeling_ontbreekt';end if;
 execute definition;
end $$;
commit;
