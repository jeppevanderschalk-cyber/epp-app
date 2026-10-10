// epp-platform: officiële landelijke score-invoer en ranking.
// Alle mutaties lopen server-side: regels, bevoegdheid en auditlog worden hier afgedwongen.
import { corsHeaders, json, serviceClient, checkPassword, isKnownClub } from "../_shared/epp.ts";
import { requireAccount } from '../_shared/session.ts';
import { ensureMatchRound } from '../_shared/match-round.ts';
import '../../../score-ranking.js';
const rankingRules = (globalThis as any).EppScoreRanking;

const RULE_VERSION = "EPP_PISTOL_250_V1";
const RANKING_VERSION = "EPP_TIEBREAK_V2";
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
  if (error?.code === '23505') {
    const {data: concurrent,error:retryError}=await db.from(table).select('*').match(match).single();
    if(retryError)throw retryError;
    return concurrent;
  }
  if (error) throw error;
  return data;
}
async function ensureContext(db: any, clubCode: string, clubLabel: string, discipline = 'pistool') {
  if(!['pistool','optiek'].includes(discipline))throw new Error('ongeldige_discipline');
  const club = await ensureSingle(db, "clubs", { code: clubCode }, { code: clubCode, naam: clubLabel || clubCode.toUpperCase(), actief: true });
  const seasonName = currentSeasonName();
  const bounds = seasonBounds(seasonName);
  const season = await ensureSingle(db, "seasons", { naam: seasonName }, { naam: seasonName, start_date: bounds.start, end_date: bounds.end, ranking_version: RANKING_VERSION });
  const divisionName=discipline==='optiek'?'Open':DIVISION_NAME;
  const division = await ensureSingle(db, "divisions", { naam: divisionName }, { naam: divisionName, actief: true });
  const rule = await ensureSingle(db, "rule_profiles", { version: RULE_VERSION }, { version: RULE_VERSION, shot_count: 50, max_score: 250, zone_values: [5, 4, 3, 2, 0] });
  return { club, season, division, rule };
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
async function loadClubShooters(db: any, clubId: string) {
  const shooters = new Map();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("memberships").select("shooter:shooters(id,public_id,display_name)").eq("club_id", clubId).order("id").range(offset, offset + 999);
    if (error) throw error;
    for (const row of data || []) if (row.shooter) shooters.set(row.shooter.id, row.shooter);
    if (!data || data.length < 1000) return [...shooters.values()];
  }
}
async function findOrCreateShooter(db: any, displayName: string, representedClubId: string, selectedId?: string) {
  const name = cleanText(displayName);
  if (!name) throw new Error("schutter_naam_verplicht");
  if (selectedId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedId)) throw new Error("ongeldige_schutter");
    const { data, error } = await db.from("memberships").select("shooter_id").eq("club_id", representedClubId).eq("shooter_id", selectedId).limit(1);
    if (error) throw error;
    if (!data?.length) throw new Error("schutter_niet_gevonden");
  }
  const query = db.from("shooters").select("*");
  const { data: found, error: fErr } = selectedId
    ? await query.eq("id", selectedId).limit(1)
    : { data: [], error: null };
  if (fErr) throw fErr;
  if (selectedId && !found?.length) throw new Error("schutter_niet_gevonden");
  if (!selectedId && found?.length > 1) throw new Error("schutter_naam_niet_uniek");
  let shooter = found?.[0];
  if (!shooter) {
    const { data, error } = await db.from("shooters").insert({ display_name: name }).select().single();
    if (error) throw error;
    shooter = data;
  }
  const {error:membershipError}=await db.from("memberships").upsert({ shooter_id: shooter.id, club_id: representedClubId, valid_from: localDateIso() }, { onConflict: "shooter_id,club_id,valid_from", ignoreDuplicates: true });
  if(membershipError)throw membershipError;
  return shooter;
}
async function loadRanking(db: any, ctx: any, matchId?: string) {
  let qualificationYear=Number(ctx.season.naam);
  let eventQuery = db
    .from("events")
    .select("id")
    .eq("ranking_eligible", true);
  if(matchId){
    const {data:match,error}=await db.from('epp_matches').select('organizer,match_date').eq('id',matchId).single();if(error)throw error;
    qualificationYear=Number(match.match_date.slice(0,4));
    const {data:copies,error:copyError}=await db.from('epp_matches').select('id').eq('organizer',match.organizer).eq('match_date',match.match_date);if(copyError)throw copyError;
    eventQuery=eventQuery.in('registration_match_id',copies.map((m:any)=>m.id));
  }else eventQuery=eventQuery.eq('season_id',ctx.season.id);
  const { data: events, error: eErr } = await eventQuery;
  if (eErr) throw eErr;
  const eventIds = (events || []).map((e: any) => e.id);
  if (!eventIds.length) return [];

  const { data: rounds, error: rErr } = await db.from("rounds").select("id,event_id,label").in("event_id", eventIds);
  if (rErr) throw rErr;
  const roundIds = (rounds || []).map((r: any) => r.id);
  if (!roundIds.length) return [];

  const { data: results, error } = await db
    .from("results")
    .select("id, round_id, shooter_id, represented_club_id, final_score, hits5, rapid_score, rapid_time_ms, total_time_ms, status, confirmed_at, revision")
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
  const {data:qualifications,error:qualificationError}=await db.from('shooter_qualifications').select('shooter_id,title,qualification_year,source,average_score').in('shooter_id',shooterIds).eq('division_id',ctx.division.id).eq('active',true).lte('qualification_year',qualificationYear).order('qualification_year',{ascending:false});
  if(qualificationError)throw qualificationError;
  const qualificationMap=new Map();
  for(const q of qualifications||[])if(!qualificationMap.has(q.shooter_id))qualificationMap.set(q.shooter_id,q);

  const best = new Map<string, any>();
  for (const row of results || []) {
    const shooter = shooterMap.get(row.shooter_id);
    const key = shooter?.public_id || row.shooter_id;
    best.set(key,[...(best.get(key)||[]),row]);
  }
  return rankingRules.rank(Array.from(best.values()).map(rows=>rankingRules.best(rows))).map((row: any) => {
    const score = Number(row.final_score);
    const shooter = shooterMap.get(row.shooter_id);
    const club = clubMap.get(row.represented_club_id);
    return {
      position: row.position,
      qualification: qualificationMap.get(row.shooter_id)||null,
      provisional: row.provisional,
      hits5: row.hits5,
      rapidScore: row.rapid_score,
      rapidTimeMs: row.rapid_time_ms,
      totalTimeMs: row.total_time_ms,
      resultId: row.id,
      matchId: rounds.find((r: any)=>r.id===row.round_id)?.event_id,
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
    const actor=await requireAccount(body,['confirm_result','prepare_match','create_round','register_shooter','set_qualification','get_qualification'].includes(action));
    const ctx = await ensureContext(db, clubId, clubLabel || clubId.toUpperCase(),body.discipline||'pistool');

    if(action==='match_participants'){
      const {data,error}=await db.rpc('epp_match_participants',{p_actor:actor.id,p_match:body.matchId,p_discipline:body.discipline||'pistool'});if(error)throw error;
      return json({ok:true,...data});
    }

    if(action==='list_qualifications'){
      const shooters=await loadClubShooters(db,ctx.club.id);
      if(!shooters.length)return json({ok:true,qualifications:[]});
      const {data,error}=await db.from('shooter_qualifications').select('shooter_id,title,qualification_year,source,average_score').in('shooter_id',shooters.map((s:any)=>s.id)).eq('division_id',ctx.division.id).eq('active',true).lte('qualification_year',Number(ctx.season.naam)).order('qualification_year',{ascending:false});
      if(error)throw error;
      return json({ok:true,qualifications:data});
    }

    if(action==='get_qualification'){
      if(!actor.is_admin)throw new Error('geen_beheerrechten');
      const {data:member,error:memberError}=await db.from('memberships').select('shooter_id').eq('shooter_id',body.shooterId).eq('club_id',ctx.club.id).limit(1);
      if(memberError)throw memberError;if(!member?.length)throw new Error('schutter_niet_van_vereniging');
      const {data,error}=await db.from('shooter_qualifications').select('*').eq('shooter_id',body.shooterId).eq('division_id',ctx.division.id).eq('qualification_year',body.year).maybeSingle();if(error)throw error;
      return json({ok:true,qualification:data});
    }
    if(action==='set_qualification'){
      const {data,error}=await db.rpc('epp_set_qualification',{p_actor:actor.id,p_club:ctx.club.id,p_shooter:body.shooterId,p_division:ctx.division.id,p_year:body.year,p_title:cleanText(body.title),p_source:cleanText(body.source),p_average:body.average==null?null:Number(body.average),p_expected:body.expectedRevision||0});
      if(error)throw error;
      return json({ok:true,qualification:data});
    }

    if (action === "context") {
      const ranking = await loadRanking(db, ctx);
      const {data:events,error:eventError}=await db.from('events').select('id,naam,local_date,registration_match_id,rounds(id,label)').eq('organizer_club_id',ctx.club.id).not('registration_match_id','is',null).order('local_date');if(eventError)throw eventError;
      const {data:matches,error:matchError}=await db.from('epp_matches').select('id,organizer,match_date,offered_disciplines').eq('club_id',clubId).is('archived_at',null).order('match_date');if(matchError)throw matchError;
      const matchRanking=body.matchId?await loadRanking(db,ctx,body.matchId):[];
      return json({ ok: true, context: ctx, ranking, matchRanking, events, matches, updatedAt: new Date().toISOString() });
    }

    if(action==='prepare_match'||action==='create_round')throw new Error('centrale_scoreinvoer_verplicht');

    if(action==='get_result'){
      await requireAccount(body,true);
      const {data:round,error:roundError}=await db.from('rounds').select('id,events!inner(organizer_club_id)').eq('id',body.roundId).eq('events.organizer_club_id',ctx.club.id).single();if(roundError||!round)throw new Error('ongeldige_ronde');
      const {data,error}=await db.from('results').select('*').eq('round_id',body.roundId).eq('shooter_id',body.shooterId).eq('division_id',ctx.division.id).maybeSingle();if(error)throw error;
      return json({ok:true,result:data});
    }

    if (action === "list_shooters") {
      await requireAccount(body,true);
      return json({ ok: true, shooters: await loadClubShooters(db, ctx.club.id) });
    }
    if(action==='register_shooter'){
      const {data,error}=await db.rpc('epp_register_shooter',{p_actor:actor.id,p_id:body.shooterId,p_name:cleanText(body.shooterName)});
      if(error)throw error;
      return json({ok:true,shooter:data});
    }

    if(action==='confirm_result')throw new Error('centrale_scoreinvoer_verplicht');

    return json({ ok: false, error: "onbekende_actie" }, 400);
  } catch (e) {
    console.error("epp-platform error", e);
    const message=String(e?.message || e || 'server_fout');
    return json({ok:false,error:message},message.includes('conflict')?409:['sessie_verlopen','geen_toegang','geen_schrijfrechten'].includes(message)?401:400);
  }
});
