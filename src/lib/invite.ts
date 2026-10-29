"use client";
import { supabase } from "./supabase";
import { friendlyError, rpc } from "./api";
import type { Role } from "./roles";

export type InviteResult = { status: "added" | "invited" | "resent"; emailed: boolean; warning?: string; fallback?: boolean };

const redirect = () => `${window.location.origin}/reset-password?invited=1`;

/** 1st choice: our own /api/invite (emails from your Resend domain). Returns null when it is not configured. */
async function callApi(body: Record<string, unknown>): Promise<InviteResult | null> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  let r: Response;
  try { r = await fetch("/api/invite", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); }
  catch { return null; }
  if (r.status === 404 || r.status === 503) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(friendlyError({ message: j.error ?? `Invite failed (${r.status})` }));
  return j as InviteResult;
}

/** 2nd choice: the invite-user Edge Function (Supabase's own email). */
async function callFunction(body: Record<string, unknown>): Promise<InviteResult | null> {
  const { data, error } = await supabase().functions.invoke("invite-user", { body: { ...body, redirect_to: redirect() } });
  if (!error) return data as InviteResult;
  // Function not deployed (404) or unreachable → caller falls back.
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.status === "number" && ctx.status !== 404) {
    let msg = error.message;
    try { msg = (await ctx.json()).error ?? msg; } catch { /* keep message */ }
    throw new Error(friendlyError({ message: msg }));
  }
  return null;
}

/** Invite someone: emails them from your domain (/api/invite), else the invite-user Edge Function, else just saves the invite. */
export async function inviteUser(email: string, role: Role, employeeId?: string | null, fullName?: string | null): Promise<InviteResult> {
  const payload = { email, role, employee_id: employeeId ?? null, full_name: fullName ?? null };
  const res = (await callApi(payload)) ?? (await callFunction(payload));
  if (res) return res;
  const status = await rpc<"added" | "invited">("invite_user", { p_email: email, p_role: role, p_employee: employeeId ?? null });
  return { status, emailed: false, fallback: true };
}

export async function resendInvite(email: string): Promise<InviteResult> {
  const res = (await callApi({ email, resend: true })) ?? (await callFunction({ email, resend: true }));
  if (res) return res;
  const { error } = await supabase().auth.resetPasswordForEmail(email, { redirectTo: redirect() });
  if (error) throw new Error(friendlyError(error));
  return { status: "resent", emailed: true };
}

export function inviteMessage(r: InviteResult) {
  if (r.status === "added") return r.emailed ? "They already had an account, were added to the company and got an email." : "They already had an account and were added to the company. They can sign in now.";
  if (r.status === "resent") return "A new sign-in link was emailed.";
  if (r.emailed) return "Invitation email sent. They join as soon as they set their password.";
  if (r.fallback) return "Invite saved, but no email was sent (the invite-user function is not deployed). Ask them to sign up with this email.";
  return `Invite saved, but the email could not be sent: ${r.warning ?? "unknown error"}. They can still sign up with this email.`;
}
