// epp-admin: trainer-only beheer van EPP-wedstrijden en groepslijsten.
// Mutations require an active trainer session for this club.
import { corsHeaders, json, serviceClient, isKnownClub, DISCIPLINES } from "../_shared/epp.ts";
import { requireAccount } from '../_shared/session.ts';
import { matchDates } from '../_shared/match-dates.ts';

function isValidDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function validOfferedDisciplines(arr: unknown): arr is string[] {
  return Array.isArray(arr) && arr.length > 0 && arr.every((d) => (DISCIPLINES as readonly string[]).includes(d));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const { clubId, password, action } = body || {};
  if (typeof clubId !== "string" || !isKnownClub(clubId)) {
    return json({ ok: false, error: "onbekende_club" }, 403);
  }
  let actor;
  try { actor=await requireAccount(body,true);if(!actor.is_admin)throw new Error('geen_beheerrechten'); }
  catch(e){return json({ok:false,error:e.message},401);}

  const db = serviceClient();
  const scopeMatches = (query: any) => actor.is_platform_admin ? query : query.eq("club_id", clubId);
  // Legacy events have one registration copy per club. Head management shows its
  // own legacy events plus shared planner events, rather than every club copy.
  const visibleMatches = async (matches: any[]) => {
    if (!actor.is_platform_admin) return matches;
    const {data, error} = await db.from('epp_match_planners').select('match_id');
    if (error) throw error;
    const planned = new Set((data || []).map((p: any) => p.match_id));
    return matches.filter(m => m.club_id === actor.club_code || planned.has(m.id));
  };

  try {
    if(action==='list_archived_matches'){
      const {data,error}=await scopeMatches(db.from('epp_matches').select('id,club_id,organizer,match_date,match_dates,archived_at')).not('archived_at','is',null).order('archived_at',{ascending:false});if(error)throw error;
      return json({ok:true,matches:await visibleMatches(data || [])});
    }
    if (action === "list_matches") {
      const { data: matches, error } = await scopeMatches(db
        .from("epp_matches")
        .select("*"))
        .is('archived_at',null)
        .order("match_date", { ascending: true, nullsFirst: false });
      if (error) throw error;

      const visible = await visibleMatches(matches || []);
      const ids = visible.map((m: any) => m.id);
      let counts: Record<string, { schutters: number; starts: number }> = {};
      if (ids.length) {
        const { data: signups, error: sErr } = await db
          .from("epp_signups")
          .select("id, match_id, epp_signup_disciplines(id)")
          .in("match_id", ids);
        if (sErr) throw sErr;
        for (const s of signups || []) {
          if(!(s as any).epp_signup_disciplines?.length)continue;
          const c = (counts[s.match_id] ||= { schutters: 0, starts: 0 });
          c.schutters += 1;
          c.starts += (s as any).epp_signup_disciplines?.length || 0;
        }
      }
      const withCounts = visible.map((m: any) => ({
        ...m,
        schutters: counts[m.id]?.schutters || 0,
        starts: counts[m.id]?.starts || 0,
      }));
      return json({ ok: true, matches: withCounts });
    }

    if (action === "create_match") {
      const m = body.match || {};
      const dates=m.match_dates!==undefined?matchDates(m.match_dates):m.match_date?matchDates([m.match_date]):[];
      if (typeof m.organizer !== "string" || !m.organizer.trim()) {
        return json({ ok: false, error: "organizer_verplicht" }, 400);
      }
      if (m.match_date != null && !isValidDate(m.match_date)) {
        return json({ ok: false, error: "ongeldige_match_date" }, 400);
      }
      if (m.deadline != null && !isValidDate(m.deadline)) {
        return json({ ok: false, error: "ongeldige_deadline" }, 400);
      }
      const offered = m.offered_disciplines ?? ["pistool", "optiek", "pcc"];
      if (!validOfferedDisciplines(offered)) {
        return json({ ok: false, error: "ongeldige_disciplines" }, 400);
      }
      const { data, error } = await db
        .from("epp_matches")
        .insert({
          club_id: clubId,
          organizer: m.organizer.trim(),
          location: m.location ?? null,
          match_date: dates[0] ?? null,
          match_dates: dates,
          deadline: m.deadline ?? null,
          organizer_email: m.organizer_email ?? null,
          offered_disciplines: offered,
          notes: m.notes ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return json({ ok: true, match: data });
    }

    if (action === "update_match") {
      const id = body.id;
      const m = body.match || {};
      if (typeof id !== "string") return json({ ok: false, error: "id_verplicht" }, 400);

      const patch: Record<string, unknown> = {};
      if(m.match_dates!==undefined){const dates=matchDates(m.match_dates);patch.match_dates=dates;patch.match_date=dates[0];}
      if (m.organizer !== undefined) {
        if (typeof m.organizer !== "string" || !m.organizer.trim()) {
          return json({ ok: false, error: "organizer_verplicht" }, 400);
        }
        patch.organizer = m.organizer.trim();
      }
      if (m.location !== undefined) patch.location = m.location;
      if (m.match_date !== undefined && m.match_dates===undefined) {
        if (m.match_date != null && !isValidDate(m.match_date)) {
          return json({ ok: false, error: "ongeldige_match_date" }, 400);
        }
        patch.match_date = m.match_date;
      }
      if (m.deadline !== undefined) {
        if (m.deadline != null && !isValidDate(m.deadline)) {
          return json({ ok: false, error: "ongeldige_deadline" }, 400);
        }
        patch.deadline = m.deadline;
      }
      if (m.organizer_email !== undefined) patch.organizer_email = m.organizer_email;
      if (m.notes !== undefined) patch.notes = m.notes;
      if (m.offered_disciplines !== undefined) {
        if (!validOfferedDisciplines(m.offered_disciplines)) {
          return json({ ok: false, error: "ongeldige_disciplines" }, 400);
        }
        patch.offered_disciplines = m.offered_disciplines;
      }

      const { data, error } = await scopeMatches(db
        .from("epp_matches")
        .update(patch)
        .eq("id", id))
        .is('archived_at',null)
        .select()
        .single();
      if (error) throw error;
      return json({ ok: true, match: data });
    }

    if (action === "delete_match" || action === "archive_match") {
      const id = body.id;
      if (typeof id !== "string") return json({ ok: false, error: "id_verplicht" }, 400);
      const { error } = await db.rpc('epp_archive_match',{p_actor:actor.id,p_match:id});
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "group_list") {
      const matchId = body.matchId;
      if (typeof matchId !== "string") return json({ ok: false, error: "matchId_verplicht" }, 400);
      const { data: match, error: mErr } = await scopeMatches(db
        .from("epp_matches")
        .select("*")
        .eq("id", matchId))
        .single();
      if (mErr) throw mErr;
      const { data: signups, error: sErr } = await db
        .from("epp_signups")
        .select("id, shooter_id, shooter_name, updated_at, epp_signup_disciplines(discipline, time_block, specific_time, slot:epp_match_slots(starts_at,ends_at))")
        .eq("match_id", matchId)
        .order("shooter_name", { ascending: true });
      if (sErr) throw sErr;
      return json({ ok: true, match, signups:signups.filter((s:any)=>s.epp_signup_disciplines?.length) });
    }

    if(action==='link_signup'){
      const {data:signup,error:signupError}=await db.from('epp_signups').select('id,match:epp_matches!inner(club_id,archived_at)').eq('id',body.signupId).eq('match.club_id',clubId).is('match.archived_at',null).single();
      if(signupError||!signup)throw new Error('inschrijving_niet_gevonden');
      const {data:club,error:clubError}=await db.from('clubs').select('id').eq('code',clubId).single();if(clubError)throw clubError;
      const {data:member,error:memberError}=await db.from('memberships').select('id').eq('club_id',club.id).eq('shooter_id',body.shooterId).limit(1);if(memberError||!member?.length)throw new Error('schutter_niet_van_vereniging');
      const {error}=await db.from('epp_signups').update({shooter_id:body.shooterId,updated_at:new Date().toISOString()}).eq('id',signup.id);if(error)throw error;
      return json({ok:true});
    }

    if (action === "mark_sent") {
      const matchId = body.matchId;
      if (typeof matchId !== "string") return json({ ok: false, error: "matchId_verplicht" }, 400);
      const { data, error } = await db
        .from("epp_matches")
        .update({ mail_status: "verstuurd", mail_sent_at: new Date().toISOString() })
        .eq("id", matchId)
        .eq("club_id", clubId)
        .is("archived_at", null)
        .select()
        .single();
      if (error) throw error;
      return json({ ok: true, match: data });
    }

    return json({ ok: false, error: "onbekende_actie" }, 400);
  } catch (e) {
    console.error("epp-admin error", e);
    return json({ ok: false, error: "server_fout" }, 500);
  }
});
