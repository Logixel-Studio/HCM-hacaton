"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/api";
import { AuthField } from "../auth-ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + "/reset-password" });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    setSent(true);
  }
  return (
    <>
      <Link href="/login" className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />Back to sign in</Link>
      <div className="brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white"><KeyRound className="h-6 w-6" /></div>
      <h1 className="mt-5 font-display text-3xl font-bold text-ink">{sent ? "Check your email" : "Reset your password"}</h1>
      <p className="mt-2 text-ink-soft">{sent ? `If an account exists for ${email}, a reset link is on its way.` : "Enter your work email and we'll send you a link to choose a new password."}</p>
      {!sent && (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <AuthField label="Work email" type="email" icon="email" value={email} onChange={setEmail} placeholder="you@company.com" autoFocus />
          <Button type="submit" size="lg" className="h-12 w-full rounded-2xl" loading={busy}>Send reset link</Button>
        </form>
      )}
    </>
  );
}
