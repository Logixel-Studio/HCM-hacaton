"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/api";
import { AuthField, Divider, GoogleButton, PasswordStrength } from "../auth-ui";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Use at least 8 characters for your password");
    if (!agree) return toast.error("Please accept the terms to continue");
    setBusy(true);
    try {
      const { data, error } = await supabase().auth.signUp({
        email: email.trim(), password,
        options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin + "/onboarding" },
      });
      if (error) throw error;
      if (!data.session) setSent(true); // email confirmation is on
    } catch (err) {
      const m = friendlyError(err);
      toast.error(/already registered/i.test(m) ? "This email already has an account. Sign in instead." : m);
    } finally { setBusy(false); }
  }

  async function google() {
    const { error } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/onboarding" } });
    if (error) toast.error(/not enabled/i.test(error.message) ? "Google sign-in is not enabled for this workspace yet" : friendlyError(error));
  }

  if (sent) {
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
      <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">Create your account</h1>
      <p className="mt-2 text-ink-soft">Set up your company in under two minutes. 14-day free trial, no card needed.</p>

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
          I agree to the Terms of Service and Privacy Policy.
        </label>
        <Button type="submit" size="lg" className="h-12 w-full rounded-2xl" loading={busy}>Create account {!busy && <ArrowRight className="h-4 w-4" />}</Button>
      </form>

      <p className="mt-8 text-center text-sm text-ink-soft">Already have an account? <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">Sign in</Link></p>
    </>
  );
}
