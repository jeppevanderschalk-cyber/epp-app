export function memberNames(first: unknown, last: unknown) {
  const clean=(value:unknown)=>typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/gu,' '):'';
  const firstName=clean(first),lastName=clean(last);
  if(!firstName||!lastName||firstName.length>70||lastName.length>70||/[\p{C}]/u.test(firstName+lastName))throw new Error('voornaam_achternaam_verplicht');
  return {firstName,lastName,displayName:firstName+' '+lastName};
}
export async function memberUsername(first: unknown,last: unknown) {
  const names=memberNames(first,last);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(names.displayName.toLocaleLowerCase('nl-NL')));
  return 'lid.'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('').slice(0,40);
}
