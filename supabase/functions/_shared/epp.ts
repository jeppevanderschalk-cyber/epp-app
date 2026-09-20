// Gedeelde helpers voor epp-admin en epp-signup edge functions.
import { createClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const KNOWN_CLUBS = (Deno.env.get("EPP_KNOWN_CLUBS") || "").split(",").map((s) => s.trim()).filter(Boolean);

export function isKnownClub(clubId: string): boolean {
  return KNOWN_CLUBS.includes(clubId);
}

// role: "TRAINER" | "MEMBER"
export async function checkPassword(clubId: string, password: string, role: "TRAINER" | "MEMBER"): Promise<boolean> {
  if (!isKnownClub(clubId)) return false;
  const secretName = `EPP_${role}_HASH_${clubId.toUpperCase()}`;
  const expected = Deno.env.get(secretName);
  if (!expected) return false;
  const actual = await sha256Hex(String(password || ""));
  return actual === expected;
}

export const DISCIPLINES = ["pistool", "optiek", "pcc"] as const;
export const TIME_BLOCKS = ["ochtend", "middag", "geen_voorkeur"] as const;
const SPECIFIC_TIME_RE = /^(0[9]|1[0-6]):(00|30)$/;

export function validDiscipline(d: unknown): d is typeof DISCIPLINES[number] {
  return typeof d === "string" && (DISCIPLINES as readonly string[]).includes(d);
}
export function validTimeBlock(b: unknown): b is typeof TIME_BLOCKS[number] {
  return typeof b === "string" && (TIME_BLOCKS as readonly string[]).includes(b);
}
export function validSpecificTime(t: unknown): t is string | null {
  if (t === null || t === undefined) return true;
  return typeof t === "string" && SPECIFIC_TIME_RE.test(t);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
