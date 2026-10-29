import { NextResponse } from "next/server";
import { adminClient, bearer, serviceReady, siteUrl, userClient } from "@/lib/server/supabase";
import { mailReady, sendInviteEmail } from "@/lib/server/mailer";

/*
 * Invite someone and email them from your own domain.
 *   1. public.invite_user() runs AS THE CALLER, so every SQL rule applies (who may invite, which roles, seat limit).
 *   2. New person: Supabase creates the account and a one-time "set your password" link (no Supabase email);
 *      our mailer sends it. Creating the account fires handle_new_user(), which turns the invite into a membership.
 *   3. resend: a fresh "set your password" link for a member who has not signed in yet (HR leads only).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const say = (o: object, status = 200) => NextResponse.json(o, { status });
const LEADS = ["company_owner", "company_admin", "hr_director", "hr_manager"];
const label = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) return say({ error: "Please sign in" }, 401);
  if (!serviceReady() || !mailReady()) return say({ error: "Email is not set up on this server", notConfigured: true }, 503);
  const body = (await req.json().catch(() => ({}))) as { email?: string; role?: string; employee_id?: string | null; full_name?: string | null; resend?: boolean };
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say({ error: "Enter a valid email address" }, 400);

  const asCaller = userClient(token), admin = adminClient();
  const { data: ctx } = await asCaller.rpc("my_context");
  if (!ctx?.tenant) return say({ error: "No active company" }, 403);
  const company = ctx.tenant.name as string, inviter = (ctx.full_name as string) || (ctx.email as string);
  const setPassword = `${siteUrl(req)}/reset-password?invited=1`;

  if (body.resend) {
    if (!LEADS.includes(ctx.role)) return say({ error: "Only HR leads can resend invitations" }, 403);
    const { data: members, error } = await asCaller.rpc("company_members");
    if (error) return say({ error: error.message }, 400);
    const m = (members ?? []).find((x: { email: string }) => x.email?.toLowerCase() === email) as { role: string } | undefined;
    if (!m) return say({ error: "This email is not a member of your company" }, 404);
    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: setPassword } });
    if (le || !link.properties?.action_link) return say({ error: le?.message ?? "Could not create a link" }, 400);
    try { await sendInviteEmail(email, { inviter, company, role: label(m.role), url: link.properties.action_link }); }
    catch (e) { return say({ error: `Email could not be sent: ${(e as Error).message}` }, 502); }
    return say({ status: "resent", emailed: true });
  }

  const role = String(body.role ?? "employee");
  const { data: status, error: invErr } = await asCaller.rpc("invite_user", { p_email: email, p_role: role, p_employee: body.employee_id ?? null });
  if (invErr) return say({ error: invErr.message }, 400);

  try {
    if (status === "added") {
      await sendInviteEmail(email, { inviter, company, role: label(role), url: `${siteUrl(req)}/login`, existing: true });
      return say({ status: "added", emailed: true });
    }
    const { data: link, error: le } = await admin.auth.admin.generateLink({
      type: "invite", email, options: { redirectTo: setPassword, data: { full_name: body.full_name ?? null, invited_to: company } },
    });
    if (le || !link.properties?.action_link) return say({ status: "invited", emailed: false, warning: le?.message ?? "Could not create the invitation link" });
    await sendInviteEmail(email, { inviter, company, role: label(role), url: link.properties.action_link });
    return say({ status: "invited", emailed: true });
  } catch (e) {
    return say({ status, emailed: false, warning: (e as Error).message });
  }
}
