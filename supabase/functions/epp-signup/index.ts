// epp-signup: leden melden zich aan voor EPP-wedstrijden.
// Auth: schutterwachtwoord wordt server-side gecontroleerd tegen een Supabase secret
// (EPP_MEMBER_HASH_<CLUB>). Een gedeeld wachtwoord bindt niet aan één specifiek lid
// (bekend, geaccepteerd risico, zie SPEC §5) — de shooter_name wordt door de gebruiker
// zelf gekozen uit de ledenlijst in de app.
import {
  corsHeaders,
  json,
  serviceClient,
  checkPassword,
  isKnownClub,
  validDiscipline,
  validTimeBlock,
  validSpecificTime,
  todayIso,
} from "../_shared/epp.ts";

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
  const authOk = await checkPassword(clubId, password, "MEMBER");
  if (!authOk) return json({ ok: false, error: "ongeldig_wachtwoord" }, 401);

  const db = serviceClient();

  try {
    if (action === "list_matches") {
      const { data, error } = await db
        .from("epp_matches")
        .select("id, organizer, location, match_date, deadline, offered_disciplines, notes")
        .eq("club_id", clubId)
        .order("match_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return json({ ok: true, matches: data });
    }

    if (action === "my_signups") {
      const shooterName = body.shooterName;
      if (typeof shooterName !== "string" || !shooterName.trim()) {
        return json({ ok: false, error: "shooterName_verplicht" }, 400);
      }
      const { data: matches, error: mErr } = await db
        .from("epp_matches")
        .select("id")
        .eq("club_id", clubId);
      if (mErr) throw mErr;
      const matchIds = (matches || []).map((m: any) => m.id);
      if (!matchIds.length) return json({ ok: true, signups: [] });

      const { data, error } = await db
        .from("epp_signups")
        .select("match_id, epp_signup_disciplines(discipline, time_block, specific_time)")
        .eq("shooter_name", shooterName.trim())
        .in("match_id", matchIds);
      if (error) throw error;
      return json({ ok: true, signups: data });
    }

    if (action === "save_signup") {
      const shooterName = String(body.shooterName || "").trim();
      const matchId = body.matchId;
      const disciplines = body.disciplines;
      if (!shooterName) return json({ ok: false, error: "shooterName_verplicht" }, 400);
      if (typeof matchId !== "string") return json({ ok: false, error: "matchId_verplicht" }, 400);
      if (!Array.isArray(disciplines) || disciplines.length === 0) {
        return json({ ok: false, error: "minimaal_een_discipline" }, 400);
      }
      for (const d of disciplines) {
        if (!validDiscipline(d?.discipline) || !validTimeBlock(d?.time_block) || !validSpecificTime(d?.specific_time ?? null)) {
          return json({ ok: false, error: "ongeldige_discipline_invoer" }, 400);
        }
      }
      const names = disciplines.map((d: any) => d.discipline);
      if (new Set(names).size !== names.length) {
        return json({ ok: false, error: "dubbele_discipline" }, 400);
      }

      const { data: match, error: mErr } = await db
        .from("epp_matches")
        .select("id, deadline, offered_disciplines, mail_status")
        .eq("id", matchId)
        .eq("club_id", clubId)
        .single();
      if (mErr) return json({ ok: false, error: "wedstrijd_niet_gevonden" }, 404);

      if (match.deadline && todayIso() > match.deadline) {
        return json({ ok: false, error: "deadline_verstreken" }, 403);
      }
      const offered: string[] = match.offered_disciplines || [];
      if (!names.every((n: string) => offered.includes(n))) {
        return json({ ok: false, error: "discipline_niet_aangeboden" }, 400);
      }

      const { data: signup, error: sErr } = await db
        .from("epp_signups")
        .upsert(
          { match_id: matchId, shooter_name: shooterName, updated_at: new Date().toISOString() },
          { onConflict: "match_id,shooter_name" },
        )
        .select()
        .single();
      if (sErr) throw sErr;

      const { error: delErr } = await db.from("epp_signup_disciplines").delete().eq("signup_id", signup.id);
      if (delErr) throw delErr;

      const rows = disciplines.map((d: any) => ({
        signup_id: signup.id,
        discipline: d.discipline,
        time_block: d.time_block,
        specific_time: d.specific_time ?? null,
      }));
      const { error: insErr } = await db.from("epp_signup_disciplines").insert(rows);
      if (insErr) throw insErr;

      if (match.mail_status === "verstuurd") {
        await db.from("epp_matches").update({ mail_status: "gewijzigd" }).eq("id", matchId);
      }

      return json({ ok: true });
    }

    if (action === "delete_signup") {
      const shooterName = String(body.shooterName || "").trim();
      const matchId = body.matchId;
      if (!shooterName) return json({ ok: false, error: "shooterName_verplicht" }, 400);
      if (typeof matchId !== "string") return json({ ok: false, error: "matchId_verplicht" }, 400);

      const { data: match, error: mErr } = await db
        .from("epp_matches")
        .select("id, deadline, mail_status")
        .eq("id", matchId)
        .eq("club_id", clubId)
        .single();
      if (mErr) return json({ ok: false, error: "wedstrijd_niet_gevonden" }, 404);

      if (match.deadline && todayIso() > match.deadline) {
        return json({ ok: false, error: "deadline_verstreken" }, 403);
      }

      const { error } = await db
        .from("epp_signups")
        .delete()
        .eq("match_id", matchId)
        .eq("shooter_name", shooterName);
      if (error) throw error;

      if (match.mail_status === "verstuurd") {
        await db.from("epp_matches").update({ mail_status: "gewijzigd" }).eq("id", matchId);
      }

      return json({ ok: true });
    }

    return json({ ok: false, error: "onbekende_actie" }, 400);
  } catch (e) {
    console.error("epp-signup error", e);
    return json({ ok: false, error: "server_fout" }, 500);
  }
});
