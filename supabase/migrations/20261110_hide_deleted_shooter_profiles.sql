begin;
do $$
declare definition text;original text;
begin
 select pg_get_functiondef('public.epp_team_context(uuid,uuid,text)'::regprocedure) into original;
 definition:=replace(original,E'    from shooters s\n  ) t;',E'    from shooters s\n    where not exists(select 1 from app_accounts deleted_account where deleted_account.id=s.linked_user_id and deleted_account.deleted_at is not null)\n  ) t;');
 if definition=original then raise exception 'schutterslijst_filter_niet_toegepast';end if;
 execute definition;
end $$;
commit;
