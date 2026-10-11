begin;
-- Head training may include an existing registered shooter from another club.
-- Do not add a national association membership as a side effect.
do $$
declare original text;definition text;
begin
 select pg_get_functiondef('public.epp_training_apply(text,uuid,jsonb)'::regprocedure) into original;
 definition:=replace(original,
  'elsif not exists(select 1 from memberships where shooter_id=(op->>''id'')::uuid and club_id=cid) then',
  'elsif not exists(select 1 from memberships where shooter_id=(op->>''id'')::uuid and club_id=cid) and not exists(select 1 from app_accounts where id=p_actor and is_platform_admin) then');
 definition:=replace(definition,
  'insert into memberships(shooter_id,club_id) values((op->>''id'')::uuid,cid) on conflict do nothing;',
  'if not exists(select 1 from app_accounts where id=p_actor and is_platform_admin) then insert into memberships(shooter_id,club_id) values((op->>''id'')::uuid,cid) on conflict do nothing;end if;');
 if definition=original then raise exception 'hoofdbeheer_training_filter_niet_toegepast';end if;
 execute definition;
end $$;
commit;
