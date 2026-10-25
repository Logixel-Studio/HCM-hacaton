"use client";
import { supabase } from "./supabase";
import { friendlyError, rpc } from "./api";
import type { Role } from "./roles";

export type InviteResult = { status: "added" | "invited" | "resent"; emailed: boolean; warning?: string; fallback?: boolean };

const redirect = () => `${window.location.origin}/reset-password?invited=1`;

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

/** Invite someone: emails them through the `invite-user` Edge Function; falls back to a saved invite if it is not deployed. */
export async function inviteUser(email: string, role: Role, employeeId?: string | null, fullName?: string | null): Promise<InviteResult> {
  const res = await callFunction({ email, role, employee_id: employeeId ?? null, full_name: fullName ?? null });
  if (res) return res;
  const status = await rpc<"added" | "invited">("invite_user", { p_email: email, p_role: role, p_employee: employeeId ?? null });
  return { status, emailed: false, fallback: true };
}

export async function resendInvite(email: string): Promise<InviteResult> {
  const res = await callFunction({ email, resend: true });
  if (res) return res;
  const { error } = await supabase().auth.resetPasswordForEmail(email, { redirectTo: redirect() });
  if (error) throw new Error(friendlyError(error));
  return { status: "resent", emailed: true };
}

export function inviteMessage(r: InviteResult) {
  if (r.status === "added") return "They already had an account and were added to the company. They can sign in now.";
  if (r.status === "resent") return "A new sign-in link was emailed.";
  if (r.emailed) return "Invitation email sent. They join as soon as they set their password.";
  if (r.fallback) return "Invite saved, but no email was sent (the invite-user function is not deployed). Ask them to sign up with this email.";
  return `Invite saved, but the email could not be sent: ${r.warning ?? "unknown error"}. They can still sign up with this email.`;
}
