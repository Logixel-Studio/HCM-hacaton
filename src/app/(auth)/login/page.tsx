"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/api";
import { AuthField, Divider, GoogleButton } from "../auth-ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "password") {
        const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        toast.success("Welcome back");
      } else {
        const { error } = await supabase().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin + "/dashboard", shouldCreateUser: false } });
        if (error) throw error;
        setSent(true);
      }
    } catch (err) {
      const m = friendlyError(err);
      toast.error(/invalid login/i.test(m) ? "Email or password is incorrect" : /not confirmed/i.test(m) ? "Please confirm your email first — check your inbox" : m);
    } finally { setBusy(false); }
  }

  async function google() {
    const { error } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/dashboard" } });
    if (error) toast.error(/not enabled/i.test(error.message) ? "Google sign-in is not enabled for this workspace yet" : friendlyError(error));
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="brand-gradient mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white"><Wand2 className="h-7 w-7" /></div>
        <h1 className="mt-5 font-display text-3xl font-bold text-ink">Check your inbox</h1>
        <p className="mt-2 text-ink-soft">We sent a sign-in link to <span className="font-medium text-ink">{email}</span>. It expires in one hour.</p>
        <Button variant="ghost" className="mt-6" onClick={() => setSent(false)}>Use a different email</Button>
      </div>
    );
  }

  return (
    <>
      <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">Welcome back</h1>
      <p className="mt-2 text-ink-soft">Sign in to your company workspace.</p>

      <div className="mt-8"><GoogleButton onClick={google} /></div>
      <Divider label="or with email" />

      <form onSubmit={submit} className="space-y-4">
        <AuthField label="Work email" type="email" icon="email" value={email} onChange={setEmail} placeholder="you@company.com" autoComplete="email" autoFocus />
        {mode === "password" && (
          <AuthField label="Password" type="password" icon="password" value={password} onChange={setPassword} placeholder="Your password" autoComplete="current-password"
            right={<Link href="/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">Forgot password?</Link>} />
        )}
        <Button type="submit" size="lg" className="h-12 w-full rounded-2xl" loading={busy}>
          {mode === "password" ? "Sign in" : "Email me a sign-in link"} {!busy && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <button onClick={() => setMode(mode === "password" ? "magic" : "password")} className="mt-4 w-full cursor-pointer text-center text-sm font-medium text-ink-soft hover:text-ink">
        {mode === "password" ? "Sign in with a magic link instead" : "Sign in with a password instead"}
      </button>

      <p className="mt-8 text-center text-sm text-ink-soft">
        New to HCM Master Suite? <Link href="/signup" className="font-semibold text-brand-600 hover:text-brand-700">Create your company</Link>
      </p>
      <p className="mt-2 text-center text-xs text-ink-soft">Invited by your company? Sign up with the same email to join automatically.</p>
    </>
  );
}
