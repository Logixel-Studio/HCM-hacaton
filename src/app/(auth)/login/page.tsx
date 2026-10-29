"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, KeyRound, Mail, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/api";
import { sendCode, verifyCode } from "@/lib/email-code";
import { cn } from "@/lib/utils";
import { AuthField, CodeStep, Divider, GoogleButton, useCountdown } from "../auth-ui";

/** Sign in with a password, or with a 6-digit code emailed from our own domain (no password needed). */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "code">("password");
  const [step, setStep] = useState<"form" | "code" | "link-sent">("form");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [wait, setWait] = useCountdown();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "password") {
        const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        toast.success("Welcome back");
        return;
      }
      const r = await sendCode("signin", email);
      if (r.fallback) {
        const { error } = await supabase().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin + "/dashboard", shouldCreateUser: false } });
        if (error) throw error;
        setStep("link-sent");
        return;
      }
      if (!r.ok) { if (r.wait) { setWait(r.wait); setStep("code"); } toast.error(r.reason ?? "Could not send the code"); return; }
      setWait(r.cooldown ?? 45); setErr(null); setStep("code");
    } catch (error) {
      const m = friendlyError(error);
      toast.error(/invalid login/i.test(m) ? "Email or password is incorrect" : /not confirmed/i.test(m) ? "Please confirm your email first — check your inbox" : m);
    } finally { setBusy(false); }
  }

  async function verify(code: string) {
    if (busy) return;
    setBusy(true); setErr(null);
    const r = await verifyCode("signin", email, code);
    if (!r.ok || !r.token_hash) { setBusy(false); setErr(r.reason ?? "That code isn’t right."); setShake((s) => s + 1); return; }
    const { error } = await supabase().auth.verifyOtp({ type: "magiclink", token_hash: r.token_hash });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); setShake((s) => s + 1); return; }
    toast.success("Welcome back");
  }

  async function resend() {
    setBusy(true);
    const r = await sendCode("signin", email);
    setBusy(false);
    if (!r.ok) { if (r.wait) setWait(r.wait); toast.error(r.reason ?? "Could not send the code"); return; }
    setWait(r.cooldown ?? 45); setErr(null); toast.success("A new code is on its way");
  }

  async function google() {
    const { error } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/dashboard" } });
    if (error) toast.error(/not enabled/i.test(error.message) ? "Google sign-in is not enabled for this workspace yet" : friendlyError(error));
  }

  if (step === "code") return <CodeStep email={email} busy={busy} error={err} shake={shake} wait={wait} title="Enter your sign-in code" onVerify={verify} onResend={resend} onBack={() => { setStep("form"); setErr(null); }} />;
  if (step === "link-sent") {
    return (
      <div className="text-center">
        <div className="brand-gradient mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white"><Wand2 className="h-7 w-7" /></div>
        <h1 className="mt-5 font-display text-3xl font-bold text-ink">Check your inbox</h1>
        <p className="mt-2 text-ink-soft">We sent a sign-in link to <span className="font-medium text-ink">{email}</span>. It expires in one hour.</p>
        <Button variant="ghost" className="mt-6" onClick={() => setStep("form")}>Use a different email</Button>
      </div>
    );
  }

  return (
    <>
      <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">Welcome back</h1>
      <p className="mt-2 text-ink-soft">Sign in to your company workspace.</p>

      <div className="mt-8"><GoogleButton onClick={google} /></div>
      <Divider label="or with email" />

      <div className="mb-5 grid grid-cols-2 rounded-2xl bg-surface-muted p-1" role="tablist">
        {([["password", "Password", KeyRound], ["code", "Email code", Mail]] as const).map(([k, l, I]) => (
          <button key={k} role="tab" aria-selected={mode === k} type="button" onClick={() => setMode(k)}
            className={cn("inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-medium transition", mode === k ? "bg-surface text-ink shadow-soft" : "text-ink-soft hover:text-ink")}>
            <I className="h-4 w-4" />{l}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <AuthField label="Work email" type="email" icon="email" value={email} onChange={setEmail} placeholder="you@company.com" autoComplete="email" autoFocus />
        {mode === "password" && (
          <AuthField label="Password" type="password" icon="password" value={password} onChange={setPassword} placeholder="Your password" autoComplete="current-password"
            right={<Link href="/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">Forgot password?</Link>} />
        )}
        {mode === "code" && <p className="rounded-2xl bg-surface-muted px-4 py-3 text-sm text-ink-soft">No password needed. We email you a 6-digit code that works for 10 minutes.</p>}
        <Button type="submit" size="lg" className="h-12 w-full rounded-2xl" loading={busy}>
          {mode === "password" ? "Sign in" : "Email me a code"} {!busy && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-ink-soft">
        New to HCM Master Suite? <Link href="/signup" className="font-semibold text-brand-600 hover:text-brand-700">Register your company</Link>
      </p>
      <p className="mt-2 text-center text-xs text-ink-soft">Invited by your company? Open the invitation email, or sign up with the same email to join automatically.</p>
    </>
  );
}
