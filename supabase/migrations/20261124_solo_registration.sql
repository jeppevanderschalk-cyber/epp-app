begin;
-- The existing guest workspace supplies storage and own-shooter authorization.
-- It represents independent accounts and grants no club management privileges.
do $$
declare definition text;
begin
  if not exists(select 1 from public.clubs where code='gast' and actief) then
    raise exception 'Active guest workspace required for solo registration';
  end if;
  definition:=pg_get_functiondef('public.epp_register_pending_member(uuid,text,text,text,text,text,text,text)'::regprocedure);
  if position('code not in (''gast'',''eppnationaal'')' in definition)=0
     or position('lower(p_email),false,''schutter''' in definition)=0 then
    raise exception 'Unexpected registration function definition';
  end if;
  definition:=replace(definition,'code not in (''gast'',''eppnationaal'')','code <> ''eppnationaal''');
  definition:=replace(definition,'lower(p_email),false,''schutter''','lower(p_email),(p_club=''gast''),''schutter''');
  execute definition;
end $$;
commit;
