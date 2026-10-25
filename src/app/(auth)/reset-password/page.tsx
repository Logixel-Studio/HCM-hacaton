"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/api";
import { AuthField, PasswordStrength } from "../auth-ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Use at least 8 characters");
    if (password !== confirm) return toast.error("Passwords do not match");
    setBusy(true);
    const { error } = await supabase().auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(/session/i.test(error.message) ? "This reset link has expired. Request a new one." : friendlyError(error));
    toast.success("Password updated");
    router.replace("/dashboard");
  }
  return (
    <>
      <div className="brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white"><ShieldCheck className="h-6 w-6" /></div>
      <h1 className="mt-5 font-display text-3xl font-bold text-ink">Choose a new password</h1>
      <p className="mt-2 text-ink-soft">You'll stay signed in on this device.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div><AuthField label="New password" type="password" icon="password" value={password} onChange={setPassword} autoFocus autoComplete="new-password" /><PasswordStrength value={password} /></div>
        <AuthField label="Confirm password" type="password" icon="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <Button type="submit" size="lg" className="h-12 w-full rounded-2xl" loading={busy}>Update password</Button>
      </form>
    </>
  );
}
