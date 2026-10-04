import { corsHeaders, json, serviceClient, isKnownClub } from "../_shared/epp.ts";
import { passwordHash, randomSalt, verifyTrainerPassword } from "../_shared/trainer-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  if (!isKnownClub(body.clubId)) return json({ ok: false, error: "onbekende_club" }, 403);
  if (!["login", "change_password"].includes(body.action)) return json({ ok: false, error: "onbekende_actie" }, 400);
  if (typeof body.password !== "string" || body.password.length > 256) return json({ ok: false, error: "ongeldig_wachtwoord" }, 401);
  if (body.action === "change_password" && (typeof body.newPassword !== "string" || body.newPassword.length < 10 || body.newPassword.length > 256 || body.newPassword === body.password)) {
    return json({ ok: false, error: "nieuw_wachtwoord_ongeldig" }, 400);
  }
  try {
    const db = serviceClient();
    const auth = await verifyTrainerPassword(db, body.clubId, body.password);
    if (!auth.configured) return json({ ok: false, error: "wachtwoordbeheer_niet_actief" }, 503);
    if (!auth.valid) return json({ ok: false, error: "ongeldig_wachtwoord" }, 401);
    const values = body.action === "change_password"
      ? { password_salt: randomSalt(), iterations: 600000, password_hash: "", password_changed_at: new Date().toISOString(), failed_attempts: 0, locked_until: null }
      : { failed_attempts: 0, locked_until: null };
    if ("password_salt" in values) values.password_hash = await passwordHash(body.newPassword, values.password_salt);
    // Match the old hash so concurrent changes cannot overwrite a newer password.
    const { data, error } = await db.from("trainer_credentials").update(values).eq("club_code", body.clubId).eq("password_hash", auth.row.password_hash).select("club_code").maybeSingle();
    if (error) throw error;
    if (!data) return json({ ok: false, error: "wachtwoord_al_gewijzigd" }, 409);
    return json({ ok: true, role: "trainer", clubId: body.clubId });
  } catch {
    return json({ ok: false, error: "wachtwoordbeheer_niet_beschikbaar" }, 503);
  }
});
