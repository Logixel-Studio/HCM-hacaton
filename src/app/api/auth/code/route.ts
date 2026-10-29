import { NextResponse } from "next/server";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { adminClient, clientIp, serviceReady } from "@/lib/server/supabase";
import { mailReady, sendCodeEmail, type CodePurpose } from "@/lib/server/mailer";

/*
 * 6-digit email codes sent by HCM Master Suite's own mailer (your Resend domain), not by Supabase.
 *   signup → confirms the email, then creates the account with the chosen password (email already verified)
 *   signin → password-free sign-in: returns a one-time token the browser exchanges for a Supabase session
 *   reset  → sets a new password
 * Limits: valid 10 minutes, single use, 5 wrong tries per code, a new code every 45 s,
 * 5 codes per email per hour, 20 per network address per hour. Codes are stored only as an HMAC.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL = 10 * 60e3, COOLDOWN = 45, PER_EMAIL_HOUR = 5, PER_IP_HOUR = 20, MAX_TRIES = 5;
const Email = z.string().trim().toLowerCase().email().max(254);
const Purpose = z.enum(["signup", "signin", "reset"]);
const say = (o: object, status = 200) => NextResponse.json(o, { status });
const secret = () => process.env.OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "hcm";
const hash = (email: string, purpose: string, code: string) => createHmac("sha256", secret()).update(`${email}|${purpose}|${code}`).digest("hex");

/** True if this email already has an account (profiles mirrors auth.users). */
async function accountId(admin: ReturnType<typeof adminClient>, email: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("id").ilike("email", email).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function POST(req: Request) {
  if (!serviceReady() || !mailReady()) {
    return say({ ok: false, fallback: true, reason: "Email codes are not set up on this server yet (SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY/SMTP are needed)." }, 503);
  }
  const body = (await req.json().catch(() => ({}))) as { action?: string; purpose?: string; email?: string; code?: string; password?: string; full_name?: string };
  const em = Email.safeParse(body.email);
  if (!em.success) return say({ ok: false, reason: "Check the email address." }, 400);
  const pp = Purpose.safeParse(body.purpose ?? "signup");
  if (!pp.success) return say({ ok: false, reason: "Unknown request." }, 400);
  const email = em.data, purpose: CodePurpose = pp.data, admin = adminClient(), now = Date.now();

  if (body.action === "send") {
    const existing = await accountId(admin, email);
    if (purpose === "signup" && existing) return say({ ok: false, reason: "This email already has an account. Sign in instead.", exists: true }, 409);
    if (purpose !== "signup" && !existing) return say({ ok: false, reason: "No account uses this email. Create one instead.", missing: true }, 404);

    const hourAgo = new Date(now - 3600e3).toISOString(), ip = clientIp(req);
    const [{ data: recent, error: re }, { count: ipCount }] = await Promise.all([
      admin.from("email_codes").select("created_at").eq("email", email).gte("created_at", hourAgo).order("created_at", { ascending: false }).limit(PER_EMAIL_HOUR + 1),
      admin.from("email_codes").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", hourAgo),
    ]);
    if (re) return say({ ok: false, reason: /does not exist|schema cache/i.test(re.message) ? "Run migration 0014 in Supabase to turn on email codes." : "Could not create a code. Try again." }, 500);
    const last = recent?.[0] ? new Date(recent[0].created_at as string).getTime() : 0;
    const wait = Math.ceil(COOLDOWN - (now - last) / 1000);
    if (wait > 0) return say({ ok: false, reason: `Please wait ${wait} seconds before asking for a new code.`, wait }, 429);
    if ((recent?.length ?? 0) >= PER_EMAIL_HOUR || (ipCount ?? 0) >= PER_IP_HOUR) return say({ ok: false, reason: "Too many codes asked for. Try again in an hour, or use the last code we sent." }, 429);

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await admin.from("email_codes").update({ used_at: new Date(now).toISOString() }).eq("email", email).eq("purpose", purpose).is("used_at", null);
    const { error } = await admin.from("email_codes").insert({ email, purpose, code_hash: hash(email, purpose, code), ip, expires_at: new Date(now + TTL).toISOString() });
    if (error) return say({ ok: false, reason: "Could not create a code. Try again." }, 500);
    try { await sendCodeEmail(email, code, purpose); }
    catch (e) { console.error("[mail]", (e as Error).message); return say({ ok: false, reason: "We couldn’t send the email right now. Try again in a minute." }, 502); }
    if (Math.random() < 0.05) void admin.rpc("purge_email_codes");
    return say({ ok: true, cooldown: COOLDOWN });
  }

  if (body.action === "verify") {
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (code.length !== 6) return say({ ok: false, reason: "Type all 6 digits." }, 400);
    const password = String(body.password ?? "");
    if ((purpose === "signup" || purpose === "reset") && password.length < 8) return say({ ok: false, reason: "Use at least 8 characters for your password." }, 400);

    const { data: row } = await admin.from("email_codes").select("id, code_hash, attempts, expires_at").eq("email", email).eq("purpose", purpose).is("used_at", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!row || new Date(row.expires_at as string).getTime() < now) return say({ ok: false, reason: "This code has expired or was already used. Send a new code.", expired: true }, 400);
    if ((row.attempts as number) >= MAX_TRIES) return say({ ok: false, reason: "Too many wrong tries. Send a new code.", expired: true }, 400);
    const a = Buffer.from(hash(email, purpose, code)), b = Buffer.from(row.code_hash as string);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      await admin.from("email_codes").update({ attempts: (row.attempts as number) + 1 }).eq("id", row.id);
      const left = MAX_TRIES - (row.attempts as number) - 1;
      return say({ ok: false, reason: left > 0 ? `That code isn’t right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Send a new code.", expired: left <= 0 }, 400);
    }
    // Single use: claim the code first, so a second request with the same code finds nothing.
    const { data: claimed } = await admin.from("email_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id).is("used_at", null).select("id");
    if (!claimed?.length) return say({ ok: false, reason: "This code was already used. Send a new code.", expired: true }, 400);
    const release = async (reason: string, status = 500) => { await admin.from("email_codes").update({ used_at: null }).eq("id", row.id); return say({ ok: false, reason }, status); };

    if (purpose === "signup") {
      const name = String(body.full_name ?? "").trim().slice(0, 120);
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name || null } });
      if (error) {
        if (/already|exists|registered/i.test(error.message)) return say({ ok: false, reason: "This email already has an account. Sign in instead.", exists: true }, 409);
        if (/password/i.test(error.message)) return release(error.message, 400);
        console.error("[signup]", error.message);
        return release("Could not create your account. Try again.");
      }
      return say({ ok: true });
    }
    if (purpose === "reset") {
      const id = await accountId(admin, email);
      if (!id) return release("No account uses this email.", 404);
      const { error } = await admin.auth.admin.updateUserById(id, { password, email_confirm: true });
      if (error) return release(/password/i.test(error.message) ? error.message : "Could not set the new password. Try again.", 400);
      return say({ ok: true });
    }
    // signin: a one-time token the browser turns into a session (no Supabase email is sent).
    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (le || !link.properties?.hashed_token) return release("Could not sign you in. Try again.");
    return say({ ok: true, token_hash: link.properties.hashed_token });
  }
  return say({ ok: false, reason: "Unknown action" }, 400);
}
