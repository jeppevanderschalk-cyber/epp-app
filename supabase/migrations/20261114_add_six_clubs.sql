begin;
insert into public.clubs(code,naam,actief) values
('dehelm','SV De Helm',true),
('flevoschutters','S.V. de Flevoschutters',true),
('devrijheidheiloo','S.V. De Vrijheid Heiloo',true),
('hpsv','S.V. HPSV',true),
('devrijheidheemskerk','S.V. De Vrijheid Heemskerk',true),
('dsvmarine','S.V. DSV Marine',true)
on conflict(code) do update set naam=excluded.naam,actief=excluded.actief;
commit;
