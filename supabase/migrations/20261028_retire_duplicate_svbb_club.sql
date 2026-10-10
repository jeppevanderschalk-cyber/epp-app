-- SV Beemte Broekland is the same association as SVBB.
-- Keep the inactive row for historical references; do not delete results.
begin;
update public.clubs set actief=false where code='beemtebroekland';
commit;
