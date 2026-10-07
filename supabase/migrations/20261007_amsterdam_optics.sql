-- Optics confirmed by the app owner for the Amsterdam match, 14 November.
begin;
update public.epp_matches
set offered_disciplines=array_append(offered_disciplines,'optiek'),
    notes=replace(notes,
      'Optiek en PCC zijn nog niet bevestigd; de trainer kan deze disciplines toevoegen na bevestiging door de organisator.',
      'Optiek toegevoegd op aanwijzing van beheer op 7 oktober 2026. PCC is nog niet bevestigd.')
where match_date=date '2026-11-14'
  and organizer='Grote Prijs van Amsterdam - APGS'
  and not ('optiek'=any(offered_disciplines));
commit;
select club_id,organizer,match_date,offered_disciplines
from public.epp_matches
where match_date=date '2026-11-14' and organizer='Grote Prijs van Amsterdam - APGS'
order by club_id;
