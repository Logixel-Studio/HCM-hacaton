"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, MailCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/api";
import { sendCode, verifyCode } from "@/lib/email-code";
import { AuthField, CodeStep, Divider, GoogleButton, PasswordStrength, useCountdown } from "../auth-ui";

/**
 * Register a company: name, email, password → a 6-digit code from our own email domain → account created
 * (email already verified) → company setup. If the server mailer is not configured, falls back to Supabase sign-up.
 */
export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"form" | "code" | "link-sent">("form");
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [wait, setWait] = useCountdown();

  async function supabaseSignup() {
    const { data, error } = await supabase().auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin + "/onboarding" },
    });
    if (error) throw error;
    if (!data.session) setStep("link-sent");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Enter your full name");
    if (password.length < 8) return toast.error("Use at least 8 characters for your password");
    if (!agree) return toast.error("Please accept the terms to continue");
    setBusy(true);
    try {
      const r = await sendCode("signup", email);
      if (r.fallback) { await supabaseSignup(); return; }
      if (!r.ok) {
        if (r.wait) { setWait(r.wait); setStep("code"); }
        return toast.error(r.reason ?? "Could not send the code");
      }
      setWait(r.cooldown ?? 45); setErr(null); setStep("code");
    } catch (error) {
      const m = friendlyError(error);
      toast.error(/already registered/i.test(m) ? "This email already has an account. Sign in instead." : m);
    } finally { setBusy(false); }
  }

  async function verify(code: string) {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await verifyCode("signup", email, code, { password, full_name: name.trim() });
    if (!r.ok) { setBusy(false); setErr(r.reason ?? "That code isn’t right."); setShake((s) => s + 1); if (r.exists) toast.error("This email already has an account. Sign in instead."); return; }
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Email verified. Let’s set up your company");
    // The auth layout sends the new user on to /onboarding.
  }

  async function resend() {
    setBusy(true);
    const r = await sendCode("signup", email);
    setBusy(false);
    if (!r.ok) { if (r.wait) setWait(r.wait); toast.error(r.reason ?? "Could not send the code"); return; }
    setWait(r.cooldown ?? 45); setErr(null); toast.success("A new code is on its way");
  }

  async function google() {
    const { error } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/onboarding" } });
    if (error) toast.error(/not enabled/i.test(error.message) ? "Google sign-in is not enabled for this workspace yet" : friendlyError(error));
  }

  if (step === "code") {
    return (
      <CodeStep email={email} busy={busy} error={err} shake={shake} wait={wait} title="Verify your email" onVerify={verify} onResend={resend} onBack={() => { setStep("form"); setErr(null); }}>
        <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-ink-soft"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />Your company workspace is created right after this step</p>
      </CodeStep>
    );
  }

  if (step === "link-sent") {
    return (
      <div className="text-center">
        <div className="brand-gradient mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white"><MailCheck className="h-7 w-7" /></div>
        <h1 className="mt-5 font-display text-3xl font-bold text-ink">Confirm your email</h1>
        <p className="mt-2 text-ink-soft">We sent a confirmation link to <span className="font-medium text-ink">{email}</span>. Open it to finish setting up your account.</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-brand-600">Back to sign in</Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">Register your company</h1>
      <p className="mt-2 text-ink-soft">Create your account, verify your email with a 6-digit code, and your HR workspace is ready in minutes.</p>

      <div className="mt-8"><GoogleButton onClick={google} /></div>
      <Divider label="or with email" />

      <form onSubmit={submit} className="space-y-4">
        <AuthField label="Full name" icon="name" value={name} onChange={setName} placeholder="Ayesha Khan" autoComplete="name" autoFocus />
        <AuthField label="Work email" type="email" icon="email" value={email} onChange={setEmail} placeholder="you@company.com" autoComplete="email" />
        <div>
          <AuthField label="Password" type="password" icon="password" value={password} onChange={setPassword} placeholder="Create a password" autoComplete="new-password" />
          <PasswordStrength value={password} />
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-soft">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand-600)]" />
          <span>I agree to the <Link href="/legal/terms" className="font-medium text-brand-600">Terms of Service</Link> and <Link href="/legal/privacy" className="font-medium text-brand-600">Privacy Policy</Link>.</span>
        </label>
        <Button type="submit" size="lg" className="h-12 w-full rounded-2xl" loading={busy}>Continue {!busy && <ArrowRight className="h-4 w-4" />}</Button>
      </form>

      <p className="mt-6 text-center text-xs text-ink-soft">Invited by your company? Use the same email you were invited with and you join it automatically.</p>
      <p className="mt-3 text-center text-sm text-ink-soft">Already have an account? <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">Sign in</Link></p>
    </>
  );
}
