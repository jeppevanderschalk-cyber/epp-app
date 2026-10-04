// epp-platform: officiële landelijke score-invoer en ranking.
// Alle mutaties lopen server-side: regels, bevoegdheid en auditlog worden hier afgedwongen.
import { corsHeaders, json, serviceClient, checkPassword, isKnownClub } from "../_shared/epp.ts";

const RULE_VERSION = "EPP_PISTOL_250_V1";
const RANKING_VERSION = "BEST_SCORE_V1";
const DIVISION_NAME = "EPP pistool";

type CountedInput = { hits5: number; hits4: number; hits3: number; hits2: number; misses: number; penaltyPoints: number };

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v);
  return null;
}
function cleanText(v: unknown): string {
  return String(v || "").trim().replace(/\s+/g, " ");
}
function currentSeasonName(d = new Date()): string {
  return String(d.getFullYear());
}
function localDateIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function seasonBounds(name: string) {
  return { start: `${name}-01-01`, end: `${name}-12-31` };
}
async function ensureSingle(db: any, table: string, match: Record<string, unknown>, values: Record<string, unknown>) {
  const { data: existing, error: sErr } = await db.from(table).select("*").match(match).limit(1);
  if (sErr) throw sErr;
  if (existing?.[0]) return existing[0];
  const { data, error } = await db.from(table).insert(values).select().single();
  if (error) throw error;
  return data;
}
async function ensureContext(db: any, clubCode: string, clubLabel: string) {
  const club = await ensureSingle(db, "clubs", { code: clubCode }, { code: clubCode, naam: clubLabel || clubCode.toUpperCase(), actief: true });
  const seasonName = currentSeasonName();
  const bounds = seasonBounds(seasonName);
  const season = await ensureSingle(db, "seasons", { naam: seasonName }, { naam: seasonName, start_date: bounds.start, end_date: bounds.end, ranking_version: RANKING_VERSION });
  const division = await ensureSingle(db, "divisions", { naam: DIVISION_NAME }, { naam: DIVISION_NAME, actief: true });
  const rule = await ensureSingle(db, "rule_profiles", { version: RULE_VERSION }, { version: RULE_VERSION, shot_count: 50, max_score: 250, zone_values: [5, 4, 3, 2, 0] });
  const eventName = `Landelijke EPP ${seasonName}`;
  const event = await ensureSingle(db, "events", { organizer_club_id: club.id, naam: eventName }, {
    organizer_club_id: club.id,
    season_id: season.id,
    naam: eventName,
    type: "wedstrijd",
    local_date: localDateIso(),
    rule_profile_id: rule.id,
    ranking_eligible: true,
  });
  const round = await ensureSingle(db, "rounds", { event_id: event.id, label: "Ronde 1" }, { event_id: event.id, label: "Ronde 1" });
  return { club, season, division, rule, event, round };
}
function validateCounted(input: any): { ok: true; counted: CountedInput; grossScore: number; finalScore: number } | { ok: false; error: string } {
  const counted = {
    hits5: asInt(input?.hits5),
    hits4: asInt(input?.hits4),
    hits3: asInt(input?.hits3),
    hits2: asInt(input?.hits2),
    misses: asInt(input?.misses),
    penaltyPoints: asInt(input?.penaltyPoints ?? 0),
  };
  if (Object.values(counted).some((v) => v === null || v < 0)) return { ok: false, error: "alle_aantallen_gehele_getallen" };
  const c = counted as CountedInput;
  const shots = c.hits5 + c.hits4 + c.hits3 + c.hits2 + c.misses;
  if (shots !== 50) return { ok: false, error: "exact_50_schoten_verplicht" };
  const grossScore = c.hits5 * 5 + c.hits4 * 4 + c.hits3 * 3 + c.hits2 * 2;
  const finalScore = grossScore - c.penaltyPoints;
  if (finalScore < 0 || finalScore > 250) return { ok: false, error: "eindscore_buiten_bereik" };
  return { ok: true, counted: c, grossScore, finalScore };
}
async function findOrCreateShooter(db: any, displayName: string, representedClubId: string) {
  const name = cleanText(displayName);
  if (!name) throw new Error("schutter_naam_verplicht");
  const { data: found, error: fErr } = await db.from("shooters").select("*").ilike("display_name", name).limit(1);
  if (fErr) throw fErr;
  let shooter = found?.[0];
  if (!shooter) {
    const { data, error } = await db.from("shooters").insert({ display_name: name }).select().single();
    if (error) throw error;
    shooter = data;
  }
  await db.from("memberships").upsert({ shooter_id: shooter.id, club_id: representedClubId, valid_from: localDateIso() }, { onConflict: "shooter_id,club_id,valid_from", ignoreDuplicates: true });
  return shooter;
}
async function loadRanking(db: any, ctx: any) {
  const { data: events, error: eErr } = await db
    .from("events")
    .select("id")
    .eq("season_id", ctx.season.id)
    .eq("ranking_eligible", true);
  if (eErr) throw eErr;
  const eventIds = (events || []).map((e: any) => e.id);
  if (!eventIds.length) return [];

  const { data: rounds, error: rErr } = await db.from("rounds").select("id,event_id,label").in("event_id", eventIds);
  if (rErr) throw rErr;
  const roundIds = (rounds || []).map((r: any) => r.id);
  if (!roundIds.length) return [];

  const { data: results, error } = await db
    .from("results")
    .select("id, round_id, shooter_id, represented_club_id, final_score, status, confirmed_at, revision")
    .eq("status", "confirmed")
    .eq("division_id", ctx.division.id)
    .in("round_id", roundIds);
  if (error) throw error;
  if (!results?.length) return [];

  const shooterIds = [...new Set(results.map((r: any) => r.shooter_id))];
  const clubIds = [...new Set(results.map((r: any) => r.represented_club_id))];
  const { data: shooters, error: sErr } = await db.from("shooters").select("id,public_id,display_name").in("id", shooterIds);
  if (sErr) throw sErr;
  const { data: clubs, error: cErr } = await db.from("clubs").select("id,code,naam").in("id", clubIds);
  if (cErr) throw cErr;
  const shooterMap = new Map((shooters || []).map((s: any) => [s.id, s]));
  const clubMap = new Map((clubs || []).map((c: any) => [c.id, c]));

  const best = new Map<string, any>();
  for (const row of results || []) {
    const shooter = shooterMap.get(row.shooter_id);
    const key = shooter?.public_id || row.shooter_id;
    const prev = best.get(key);
    if (!prev || Number(row.final_score) > Number(prev.final_score)) best.set(key, row);
  }
  const sorted = Array.from(best.values()).sort((a, b) => {
    const diff = Number(b.final_score) - Number(a.final_score);
    if (diff) return diff;
    const an = shooterMap.get(a.shooter_id)?.display_name || "";
    const bn = shooterMap.get(b.shooter_id)?.display_name || "";
    return String(an).localeCompare(String(bn));
  });
  let lastScore: number | null = null;
  let lastPos = 0;
  return sorted.map((row, idx) => {
    const score = Number(row.final_score);
    const pos = score === lastScore ? lastPos : idx + 1;
    lastScore = score;
    lastPos = pos;
    const shooter = shooterMap.get(row.shooter_id);
    const club = clubMap.get(row.represented_club_id);
    return {
      position: pos,
      publicId: shooter?.public_id,
      name: shooter?.display_name,
      club: club?.naam || club?.code,
      division: ctx.division.naam,
      score,
      confirmedAt: row.confirmed_at,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const { clubId, clubLabel, action } = body || {};
  if (typeof clubId !== "string" || !isKnownClub(clubId)) return json({ ok: false, error: "onbekende_club" }, 403);

  const db = serviceClient();
  try {
    const ctx = await ensureContext(db, clubId, clubLabel || clubId.toUpperCase());

    if (action === "context") {
      const ranking = await loadRanking(db, ctx);
      return json({ ok: true, context: ctx, ranking, updatedAt: new Date().toISOString() });
    }

    if (action === "confirm_result") {
      const password = body.password;
      const authOk = await checkPassword(clubId, String(password || ""), "TRAINER");
      if (!authOk) return json({ ok: false, error: "ongeldig_wachtwoord" }, 401);

      const shooterName = cleanText(body.shooterName);
      if (!shooterName) return json({ ok: false, error: "schutter_naam_verplicht" }, 400);
      const entryMode = body.entryMode === "total" ? "total" : "counted";
      const idempotencyKey = cleanText(body.idempotencyKey) || crypto.randomUUID();
      const shooter = await findOrCreateShooter(db, shooterName, ctx.club.id);

      let row: Record<string, unknown>;
      if (entryMode === "total") {
        const finalScore = asInt(body.finalScore);
        if (finalScore === null || finalScore < 0 || finalScore > 250) return json({ ok: false, error: "eindscore_0_tot_250" }, 400);
        row = { entry_mode: "total", final_score: finalScore, status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by: null,
          hits5: null, hits4: null, hits3: null, hits2: null, misses: null, gross_score: null, penalty_points: null };
      } else {
        const valid = validateCounted(body);
        if (!valid.ok) return json({ ok: false, error: valid.error }, 400);
        row = { entry_mode: "counted", hits5: valid.counted.hits5, hits4: valid.counted.hits4, hits3: valid.counted.hits3, hits2: valid.counted.hits2, misses: valid.counted.misses,
          gross_score: valid.grossScore, penalty_points: valid.counted.penaltyPoints, final_score: valid.finalScore, status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by: null };
      }

      const base = { round_id: ctx.round.id, shooter_id: shooter.id, division_id: ctx.division.id, represented_club_id: ctx.club.id };
      const { data: beforeRows, error: beforeErr } = await db.from("results").select("*").match(base).limit(1);
      if (beforeErr) throw beforeErr;
      const before = beforeRows?.[0] || null;
      const revision = before ? Number(before.revision || 1) + 1 : 1;
      const { data: result, error } = await db.from("results").upsert({ ...base, ...row, revision, idempotency_key: idempotencyKey }, { onConflict: "round_id,shooter_id,division_id" }).select().single();
      if (error) throw error;
      const { error: auditErr } = await db.from("result_audit").insert({ result_id: result.id, action: before ? "corrected_or_reconfirmed" : "confirmed", before, after: result, reason: before ? "Nieuwe bevestiging via app" : "Eerste bevestiging via app" });
      if (auditErr) throw auditErr;
      const ranking = await loadRanking(db, ctx);
      return json({ ok: true, result, shooter, ranking, updatedAt: new Date().toISOString() });
    }

    return json({ ok: false, error: "onbekende_actie" }, 400);
  } catch (e) {
    console.error("epp-platform error", e);
    return json({ ok: false, error: String(e?.message || e || "server_fout") }, 500);
  }
});
