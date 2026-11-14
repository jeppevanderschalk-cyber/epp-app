begin;
insert into public.clubs(code,naam,actief)
values('willemtell','SV Willem-Tell',true)
on conflict(code) do update set naam=excluded.naam,actief=excluded.actief;
commit;
