do $$
declare member_id uuid; admin_id uuid; other_id uuid; head_id uuid; req_id uuid; job uuid; lease uuid; sid uuid; n integer; denied boolean;
begin
 insert into app_accounts(club_code,username,display_name,role,password_salt,password_hash,membership_approved)
 values('svbb','push.integration.member','Push Lid','schutter',repeat('a',48),repeat('b',64),true) returning id into member_id;
 insert into app_accounts(club_code,username,display_name,role,is_admin,password_salt,password_hash,membership_approved)
 values('svbb','push.integration.admin','Push Beheer','trainer',true,repeat('a',48),repeat('b',64),true) returning id into admin_id;
 insert into app_accounts(club_code,username,display_name,role,is_admin,password_salt,password_hash,membership_approved)
 values('mercurius75','push.integration.other','Push Ander','trainer',true,repeat('a',48),repeat('b',64),true) returning id into other_id;
 insert into app_accounts(club_code,username,display_name,role,is_admin,is_platform_admin,password_salt,password_hash,membership_approved)
 values('eppnationaal','push.integration.head','Push Hoofd','trainer',true,true,repeat('a',48),repeat('b',64),true) returning id into head_id;
 perform epp_register_push_device(admin_id,'https://web.push.apple.com/integration-admin','key','auth');
 perform epp_register_push_device(other_id,'https://fcm.googleapis.com/fcm/send/integration-other','key','auth');
 perform epp_register_push_device(head_id,'https://updates.push.services.mozilla.com/wpush/v2/integration-head','key','auth');
 insert into epp_password_help_requests(account_id) values(member_id) returning id into req_id;
 if (select count(*) from epp_push_jobs where epp_push_jobs.request_id=req_id)<>2 then raise exception 'recipient_scope_failed';end if;
 if exists(select 1 from epp_push_jobs j join epp_push_subscriptions s on s.id=j.subscription_id where j.request_id=req_id and s.account_id=other_id) then raise exception 'cross_club_push';end if;
 perform epp_register_push_device(admin_id,'https://web.push.apple.com/integration-admin','key','auth');
 if (select count(*) from epp_push_jobs where epp_push_jobs.request_id=req_id)<>2 then raise exception 'duplicate_push';end if;
 select count(*) into n from epp_claim_push_jobs(20);if n<>2 then raise exception 'claim_count:%',n;end if;
 select count(*) into n from epp_claim_push_jobs(20);if n<>0 then raise exception 'claimed_twice';end if;
 select j.id,j.lease_token into job,lease from epp_push_jobs j join epp_push_subscriptions s on s.id=j.subscription_id where s.account_id=admin_id;
 perform epp_finish_push_job(job,gen_random_uuid(),true,false,false,null);
 if not exists(select 1 from epp_push_jobs where id=job and status='processing') then raise exception 'wrong_lease_accepted';end if;
 perform epp_finish_push_job(job,lease,false,false,true,'push_http_503');
 if not exists(select 1 from epp_push_jobs where id=job and status='pending' and available_at>now()) then raise exception 'retry_missing';end if;
 update epp_push_jobs set available_at=now() where id=job;perform epp_claim_push_jobs(20);
 select lease_token into lease from epp_push_jobs where id=job;
 perform epp_finish_push_job(job,lease,true,false,false,null);
 if not exists(select 1 from epp_push_jobs where id=job and status='sent' and sent_at is not null) then raise exception 'sent_missing';end if;
 select j.id,j.lease_token,s.id into job,lease,sid from epp_push_jobs j join epp_push_subscriptions s on s.id=j.subscription_id where s.account_id=head_id;
 perform epp_finish_push_job(job,lease,false,true,false,'push_http_410');
 if exists(select 1 from epp_push_subscriptions where id=sid) then raise exception 'expired_device_kept';end if;
 -- Rebinding a physical browser to another account removes old queued messages.
 perform epp_register_push_device(other_id,'https://web.push.apple.com/integration-admin','newkey','newauth');
 if exists(select 1 from epp_push_jobs j join epp_push_subscriptions s on s.id=j.subscription_id where s.endpoint='https://web.push.apple.com/integration-admin') then raise exception 'old_account_jobs_survive';end if;
 perform epp_register_push_device(admin_id,'https://web.push.apple.com/integration-admin','key','auth');
 update epp_password_help_requests set handled_at=now() where id=req_id;
 perform epp_claim_push_jobs(20);
 if exists(select 1 from epp_push_jobs where epp_push_jobs.request_id=req_id and status in ('pending','processing')) then raise exception 'handled_request_not_cancelled';end if;
 perform epp_prepare_push_test(admin_id,'https://web.push.apple.com/integration-admin');
 denied:=false;begin perform epp_prepare_push_test(admin_id,'https://web.push.apple.com/integration-admin');exception when others then if sqlerrm='wacht_even_met_testen' then denied:=true;else raise;end if;end;
 if not denied then raise exception 'test_rate_limit_missing';end if;
 denied:=false;begin perform epp_register_push_device(member_id,'https://web.push.apple.com/integration-member','key','auth');exception when others then if sqlerrm='geen_beheerrechten' then denied:=true;else raise;end if;end;
 if not denied then raise exception 'member_can_subscribe_admin_push';end if;
 if has_table_privilege('anon','epp_push_subscriptions','SELECT') or has_function_privilege('authenticated','epp_claim_push_jobs(integer)','EXECUTE') then raise exception 'push_devices_public';end if;
end $$;
select 'PASS push recipients, deduplication, device rebinding, leases, retry, expiry, handled cancellation, test rate limit and permissions' as result;
rollback;
