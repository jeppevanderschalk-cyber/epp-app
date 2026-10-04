export function randomSalt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join("");
}

export async function passwordHash(password: string, salt: string, iterations = 600000): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bytes = new Uint8Array(salt.match(/.{2}/g)!.map(pair => parseInt(pair, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: bytes, iterations, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyTrainerPassword(db: any, club: string, password: string) {
  const { data: row, error } = await db.from("trainer_credentials").select("*").eq("club_code", club).maybeSingle();
  // Existing clubs keep their configured password until central credentials are provisioned.
  if (error && ["42P01", "PGRST205"].includes(error.code)) return { configured: false, valid: false, row: null };
  if (error) throw error;
  if (!row) return { configured: false, valid: false, row: null };
  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) return { configured: true, valid: false, row: null };
  const hash = await passwordHash(password, row.password_salt, row.iterations);
  let difference = hash.length ^ row.password_hash.length;
  for (let i = 0; i < hash.length; i++) difference |= hash.charCodeAt(i) ^ row.password_hash.charCodeAt(i);
  if (difference !== 0) {
    const { error: failed } = await db.rpc("epp_record_failed_trainer_login", { p_club: club });
    if (failed) throw failed;
    return { configured: true, valid: false, row: null };
  }
  return { configured: true, valid: true, row };
}
