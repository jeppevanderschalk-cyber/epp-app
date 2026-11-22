begin;
insert into public.clubs(code,naam,actief)
values('prinshendrikveenendaal','SV Prins Hendrik Veenendaal',true)
on conflict(code) do update set naam=excluded.naam,actief=excluded.actief;
commit;
