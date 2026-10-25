"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Building2, Check, LogOut, MailQuestion, UserSearch } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { Loading } from "@/components/common";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-controls";
import { useAuth } from "@/lib/auth";
import { rpc } from "@/lib/api";
import { cn } from "@/lib/utils";

const CITIES = ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Multan", "Peshawar", "Quetta", "Sialkot", "Hyderabad", "Other"];
const SIZES = ["1–10", "11–50", "51–200", "201–500", "500+"];

export default function OnboardingPage() {
  const { session, ctx, loading, refresh, signOut } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [company, setCompany] = useState("");
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("Founder & CEO");
  const [city, setCity] = useState("Lahore");
  const [size, setSize] = useState("11–50");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (ctx?.tenant) router.replace("/dashboard");
  }, [loading, session, ctx, router]);

  useEffect(() => { if (ctx?.full_name) setFullName(ctx.full_name); }, [ctx?.full_name]);

  if (loading || !session || ctx?.tenant) return <Loading className="h-screen" />;

  async function create() {
    if (company.trim().length < 2) return toast.error("Enter your company name");
    setBusy(true);
    try {
      await rpc("create_company", { p_name: company.trim(), p_full_name: fullName.trim() || null, p_job_title: jobTitle, p_city: city, p_employee_count: size });
      await refresh();
      toast.success(`${company.trim()} is ready`);
      router.replace("/dashboard");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4" />Sign out</Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-16 pt-6">
        <div className="text-center">
          <p className="text-sm font-medium text-brand-600">Welcome{ctx?.full_name ? `, ${ctx.full_name.split(" ")[0]}` : ""}</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">Let&apos;s set up your workspace</h1>
          <p className="mt-2 text-ink-soft">Signed in as {ctx?.email ?? session?.user.email}</p>
        </div>

        <div className="mx-auto mt-8 flex max-w-xs items-center justify-center gap-2">
          {[1, 2].map((n) => (
            <div key={n} className="flex flex-1 items-center gap-2">
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold", step >= n ? "brand-gradient text-white" : "bg-surface-muted text-ink-soft")}>{step > n ? <Check className="h-4 w-4" /> : n}</div>
              {n === 1 && <div className={cn("h-0.5 flex-1 rounded-full", step > 1 ? "bg-brand-500" : "bg-line")} />}
            </div>
          ))}
        </div>

        <Card className="mt-8 p-6 sm:p-8">
          {step === 1 ? (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><Building2 className="h-5 w-5" /></div>
                <div><h2 className="text-lg font-semibold text-ink">Your company</h2><p className="text-sm text-ink-soft">You will be the Company Owner.</p></div>
              </div>
              <Field label="Company name"><Input autoFocus value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Foods (Pvt) Ltd" className="h-11" /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Head office city"><Select value={city} onChange={(e) => setCity(e.target.value)} className="h-11">{CITIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                <Field label="Employees"><Select value={size} onChange={(e) => setSize(e.target.value)} className="h-11">{SIZES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              </div>
              <div className="flex justify-end"><Button size="lg" onClick={() => company.trim().length >= 2 ? setStep(2) : toast.error("Enter your company name")}>Continue <ArrowRight className="h-4 w-4" /></Button></div>
            </div>
          ) : (
            <div className="space-y-5">
              <div><h2 className="text-lg font-semibold text-ink">About you</h2><p className="text-sm text-ink-soft">We create your employee profile so self-service works from day one.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="h-11" /></Field>
                <Field label="Job title"><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="h-11" /></Field>
              </div>
              <div className="rounded-2xl bg-surface-muted p-4 text-sm text-ink-soft">
                We will set up a head office branch, departments, salary grades, a 9-to-6 shift, Pakistan leave policy, FY2025-26 tax slabs, expense limits and letter templates. You can change all of it later in Settings.
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                <Button size="lg" loading={busy} onClick={create}>Create workspace</Button>
              </div>
            </div>
          )}
        </Card>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <MailQuestion className="h-5 w-5 text-brand-600" />
            <p className="mt-3 font-semibold text-ink">Joining your employer?</p>
            <p className="mt-1 text-sm text-ink-soft">Ask HR to invite <span className="font-medium text-ink">{ctx?.email ?? session?.user.email}</span> from Users &amp; roles, then sign in again. You will join automatically.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={async () => { const c = await refresh(); if (c?.tenant) router.replace("/dashboard"); else toast.message("No invitation found yet for this email"); }}>Check again</Button>
          </Card>
          <Card className="p-5">
            <UserSearch className="h-5 w-5 text-brand-600" />
            <p className="mt-3 font-semibold text-ink">Applied for a job?</p>
            <p className="mt-1 text-sm text-ink-soft">Track your applications, interviews and offers in the candidate portal.</p>
            <Link href="/my-applications" className="mt-3 inline-flex text-sm font-semibold text-brand-600">Open candidate portal →</Link>
          </Card>
        </div>
      </main>
    </div>
  );
}
