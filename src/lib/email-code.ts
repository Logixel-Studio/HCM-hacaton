"use client";
// Browser side of /api/auth/code (6-digit codes sent from your own email domain).
export type CodePurpose = "signup" | "signin" | "reset";
export type CodeAnswer = { ok: boolean; reason?: string; wait?: number; cooldown?: number; expired?: boolean; exists?: boolean; missing?: boolean; fallback?: boolean; token_hash?: string };

async function call(body: Record<string, unknown>): Promise<CodeAnswer> {
  try {
    const r = await fetch("/api/auth/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 404 && !(r.headers.get("content-type") ?? "").includes("json")) return { ok: false, fallback: true };
    return (await r.json().catch(() => ({ ok: false, reason: "No answer from the server." }))) as CodeAnswer;
  } catch {
    return { ok: false, reason: "No connection. Check your internet and try again." };
  }
}

export const sendCode = (purpose: CodePurpose, email: string) => call({ action: "send", purpose, email: email.trim().toLowerCase() });
export const verifyCode = (purpose: CodePurpose, email: string, code: string, extra: { password?: string; full_name?: string } = {}) =>
  call({ action: "verify", purpose, email: email.trim().toLowerCase(), code, ...extra });
