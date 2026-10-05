-- Rebuild upcoming registration entries from the official 2026 calendar.
-- Source: https://europeespraktijkparcours.nl/therapies (checked 2026-10-05).
-- Only add missing entries; preserve existing matches and registrations.
begin;
with clubs(club_id) as (
  values ('svbb'), ('mercurius75'), ('eppnationaal'), ('gast')
), calendar(organizer, location, match_date, organizer_email) as (
  values
    ('Grote Prijs van Amsterdam - APGS',
     'Communicatieweg 4a, 1967 PR Heemskerk',
     date '2026-11-14', 'EPP-APGS@europeespraktijkparcours.nl'),
    ('SV de Korrel - Druten',
     'Gelenberg 8, 6651 KX Druten',
     date '2026-11-21', 'epp-druten@berends.cc')
)
insert into public.epp_matches
  (club_id, organizer, location, match_date, deadline, organizer_email, offered_disciplines, notes)
select c.club_id, m.organizer, m.location, m.match_date,
       (m.match_date - interval '1 month')::date, m.organizer_email,
       array['pistool'],
       'Agenda: https://europeespraktijkparcours.nl/therapies. Gecontroleerd op 5 oktober 2026. Optiek en PCC zijn nog niet bevestigd; de trainer kan deze disciplines toevoegen na bevestiging door de organisator.'
from clubs c cross join calendar m
where not exists (
  select 1 from public.epp_matches existing
  where existing.club_id = c.club_id
    and existing.match_date = m.match_date
);
commit;
