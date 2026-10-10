begin;
update public.clubs set naam='SV Beemte Broekland' where code='svbb';
update public.epp_matches set organizer='SV Beemte Broekland' where club_id='svbb' and organizer='SVBB';
commit;
