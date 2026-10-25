// HCM Master Suite · invite-user (Supabase Edge Function, Deno)
// ─────────────────────────────────────────────────────────────────────────────
// Invites a person by email:
//   1. Runs public.invite_user() AS THE CALLER, so every permission rule in SQL
//      applies (only HR leads / admins, only roles they may grant, seat limit).
//   2. If the person has no account yet, asks Supabase Auth to email them an
//      invitation link (service-role key, server side only). Creating the auth
//      user fires handle_new_user(), which turns the pending invite into a
//      membership right away.
//   3. "resend": emails a fresh "set your password" link to a member who has
//      not signed in yet.
//
// Deploy: supabase functions deploy invite-user
//   (or Dashboard → Edge Functions → Deploy a new function → paste this file)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Please sign in" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const { email, role = "employee", employee_id = null, redirect_to, resend = false, full_name = null } = await req.json();
    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) return json({ error: "Enter a valid email address" }, 400);
    const redirectTo = typeof redirect_to === "string" ? redirect_to : undefined;

    const { data: ctx } = await asCaller.rpc("my_context");
    if (!ctx?.tenant) return json({ error: "No active company" }, 403);
    const company = ctx.tenant.name as string;

    if (resend) {
      // Only HR leads of the same company may resend, and only to their own members.
      if (!["company_owner", "company_admin", "hr_director", "hr_manager"].includes(ctx.role)) return json({ error: "Only HR leads can resend invitations" }, 403);
      const { data: members, error } = await asCaller.rpc("company_members");
      if (error) return json({ error: error.message }, 400);
      if (!(members ?? []).some((m: { email: string }) => m.email?.toLowerCase() === cleanEmail)) return json({ error: "This email is not a member of your company" }, 404);
      const r = await asCaller.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
      if (r.error) return json({ error: r.error.message }, 400);
      return json({ status: "resent", emailed: true });
    }

    // 1) Permission checks + membership/invite in SQL, as the caller
    const { data: status, error: invErr } = await asCaller.rpc("invite_user", { p_email: cleanEmail, p_role: role, p_employee: employee_id });
    if (invErr) return json({ error: invErr.message }, 400);

    // Existing account: already added to the company, no email needed.
    if (status === "added") return json({ status: "added", emailed: false });

    // 2) New person: Supabase Auth sends the invitation email
    const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(cleanEmail, {
      redirectTo,
      data: { full_name, invited_to: company },
    });
    if (mailErr) {
      // The invite row is saved; they can still join by signing up with this email.
      return json({ status: "invited", emailed: false, warning: mailErr.message });
    }
    return json({ status: "invited", emailed: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
