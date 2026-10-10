export function matchDates(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 31) throw new Error('ongeldige_wedstrijddagen');
  const dates=value.map(d=>{
    if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw new Error('ongeldige_wedstrijddagen');
    return d;
  });
  if(new Set(dates).size!==dates.length)throw new Error('dubbele_wedstrijddag');
  return dates.sort();
}
