do $$
declare actor uuid; viewer uuid; cid uuid; sid uuid:=gen_random_uuid(); div uuid; open_div uuid; result jsonb; bid uuid; year integer:=extract(year from current_date)-1;
begin
  select id into actor from app_accounts where club_code='svbb' and username='beheer' and active and is_admin;
  select id into viewer from app_accounts where club_code='svbb' and username='kijker';
  select id into cid from clubs where code='svbb';
  if actor is null then raise exception 'Test admin missing'; end if;
  perform epp_register_shooter(actor,sid,'Qualification rollback test');
  insert into divisions(naam) values('EPP pistool') on conflict(naam) do nothing;
  insert into divisions(naam) values('Open') on conflict(naam) do nothing;
  select id into div from divisions where naam='EPP pistool';select id into open_div from divisions where naam='Open';
  begin
    perform epp_set_qualification(viewer,cid,sid,div,year,'Master','Official test source',228,0);raise exception 'FAIL viewer';
  exception when others then if sqlerrm<>'geen_beheerrechten' then raise; end if; end;
  begin
    perform epp_set_qualification(actor,cid,sid,div,year,'Marksman','Official test source',190.999,0);raise exception 'FAIL threshold';
  exception when others then if sqlerrm<>'kwalificatiegemiddelde_te_laag' then raise; end if; end;
  begin
    perform epp_set_qualification(actor,cid,sid,div,year,'Master','',228,0);raise exception 'FAIL source';
  exception when others then if sqlerrm<>'kwalificatiebron_verplicht' then raise; end if; end;
  result:=epp_set_qualification(actor,cid,sid,div,year,'Marksman','Official test source',191,0);
  if result->>'title'<>'Marksman' or result->>'revision'<>'1' then raise exception 'FAIL marksman'; end if;
  perform epp_set_qualification(actor,cid,sid,div,year,'Marksman','Official test source',191,0);
  if (select count(*) from qualification_audit where qualification_id=(result->>'id')::uuid)<>1 then raise exception 'FAIL retry'; end if;
  begin
    perform epp_set_qualification(actor,cid,sid,div,year,'Expert','Official test source',215,0);raise exception 'FAIL conflict';
  exception when others then if sqlerrm<>'kwalificatie_conflict' then raise; end if; end;
  result:=epp_set_qualification(actor,cid,sid,div,year,'Expert','Official test source',215,1);
  result:=epp_set_qualification(actor,cid,sid,div,year,'Master','Official test source',228,2);
  if result->>'title'<>'Master' or result->>'revision'<>'3' then raise exception 'FAIL master'; end if;
  if (select before->>'title' from qualification_audit where qualification_id=(result->>'id')::uuid and after->>'revision'='3')<>'Expert' then raise exception 'FAIL audit'; end if;
  perform epp_set_qualification(actor,cid,sid,open_div,year,'Expert','Official Open test',215,0);
  if (select count(*) from shooter_qualifications where shooter_id=sid and active)<>2 then raise exception 'FAIL division isolation'; end if;
  bid:=epp_capture_backup();
  if not exists(select 1 from platform_backups where id=bid and snapshot?'shooter_qualifications' and snapshot?'qualification_audit' and checksum=encode(extensions.digest(snapshot::text,'sha256'),'hex')) then raise exception 'FAIL qualification backup'; end if;
  result:=epp_set_qualification(actor,cid,sid,div,year,'','Official correction',null,3);
  if (result->>'active')::boolean then raise exception 'FAIL revoke'; end if;
  if has_function_privilege('anon','epp_set_qualification(uuid,uuid,uuid,uuid,integer,text,text,numeric,integer)','EXECUTE') or has_table_privilege('anon','shooter_qualifications','SELECT') then raise exception 'FAIL anonymous permission'; end if;
end $$;
select 'PASS qualification thresholds, admin authorization, source, retry, conflict, audit, separate Open title, backup and revocation' as test;
