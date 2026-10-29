"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/api";
import { sendCode, verifyCode } from "@/lib/email-code";
import { AuthField, CodeStep, PasswordStrength, useCountdown } from "../auth-ui";

/** Reset with a 6-digit code from our own email domain; falls back to Supabase's reset link if the mailer is off. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"email" | "code" | "link-sent">("email");
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [wait, setWait] = useCountdown();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await sendCode("reset", email);
    if (r.fallback) {
      const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + "/reset-password" });
      setBusy(false);
      if (error) return toast.error(friendlyError(error));
      return setStep("link-sent");
    }
    setBusy(false);
    if (!r.ok) { if (r.wait) { setWait(r.wait); setStep("code"); } return toast.error(r.reason ?? "Could not send the code"); }
    setWait(r.cooldown ?? 45); setErr(null); setStep("code");
  }

  async function verify(code: string) {
    if (password.length < 8) { setErr("Choose a new password first (at least 8 characters)."); setShake((s) => s + 1); return; }
    setBusy(true); setErr(null);
    const r = await verifyCode("reset", email, code, { password });
    if (!r.ok) { setBusy(false); setErr(r.reason ?? "That code isn’t right."); setShake((s) => s + 1); return; }
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success("Password changed. You are signed in");
  }

  async function resend() {
    setBusy(true);
    const r = await sendCode("reset", email);
    setBusy(false);
    if (!r.ok) { if (r.wait) setWait(r.wait); return toast.error(r.reason ?? "Could not send the code"); }
    setWait(r.cooldown ?? 45); toast.success("A new code is on its way");
  }

  if (step === "code") {
    return (
      <CodeStep email={email} busy={busy} error={err} shake={shake} wait={wait} title="Reset your password" onVerify={verify} onResend={resend} onBack={() => setStep("email")}>
        <div className="mt-6 text-left">
          <AuthField label="New password" type="password" icon="password" value={password} onChange={setPassword} placeholder="At least 8 characters" autoComplete="new-password" />
          <PasswordStrength value={password} />
        </div>
      </CodeStep>
    );
  }
  return (
    <>
      <Link href="/login" className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />Back to sign in</Link>
      <div className="brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white"><KeyRound className="h-6 w-6" /></div>
      <h1 className="mt-5 font-display text-3xl font-bold text-ink">{step === "link-sent" ? "Check your email" : "Reset your password"}</h1>
      <p className="mt-2 text-ink-soft">{step === "link-sent" ? `If an account exists for ${email}, a reset link is on its way.` : "Enter your work email. We’ll send a 6-digit code so you can choose a new password."}</p>
      {step === "email" && (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <AuthField label="Work email" type="email" icon="email" value={email} onChange={setEmail} placeholder="you@company.com" autoFocus />
          <Button type="submit" size="lg" className="h-12 w-full rounded-2xl" loading={busy}>Send code</Button>
        </form>
      )}
    </>
  );
}
