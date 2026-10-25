"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Briefcase, CheckCircle2, MapPin, Paperclip, Search } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Dialog, Field, Input, Textarea } from "@/components/ui";
import { EmptyState, Loading } from "@/components/common";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-controls";
import { useRpc, rpc, friendlyError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { ago, title } from "@/lib/format";

type Job = { id: string; title: string; department: string | null; location: string | null; employment_type: string; description: string | null; requirements: string | null; posted_at: string };
type Data = { company: { tenant_id: string; name: string; logo_url: string | null } | null; jobs: Job[] };

function Careers() {
  const slug = useSearchParams().get("c") ?? "";
  const { data, isLoading } = useRpc<Data>(["careers", slug], "careers_jobs", { p_slug: slug }, { enabled: !!slug });
  const [term, setTerm] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [f, setF] = useState({ name: "", email: "", phone: "", exp: "", salary: "", summary: "" });
  const [cv, setCv] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const jobs = (data?.jobs ?? []).filter((j) => !term || `${j.title} ${j.department} ${j.location}`.toLowerCase().includes(term.toLowerCase()));

  async function apply() {
    if (!job) return;
    setBusy(true);
    try {
      let path: string | null = null;
      if (cv && data?.company?.tenant_id) {
        path = `${data.company.tenant_id}/${job.id}/${Date.now()}-${cv.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error } = await supabase().storage.from("cvs").upload(path, cv);
        if (error) path = null;
      }
      await rpc("apply_for_job", { p_job: job.id, p_full_name: f.name, p_email: f.email, p_phone: f.phone || null, p_experience: f.exp ? Number(f.exp) : null, p_summary: f.summary || null, p_cv_path: path, p_expected_salary: f.salary ? Number(f.salary) : null });
      setDone(true);
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  }

  if (!slug) return <EmptyState icon={Briefcase} title="Careers page" text="Open the link your employer shared (it ends with ?c=company-name)." />;
  if (isLoading) return <Loading />;
  if (!data?.company) return <EmptyState icon={Briefcase} title="Company not found" />;
  return (
    <>
      <section className="brand-glow relative overflow-hidden rounded-[2rem] px-6 py-14 text-center text-white sm:px-12">
        <div className="grid-dots absolute inset-0 opacity-30" />
        <div className="relative"><p className="text-sm text-white/70">Careers at</p><h1 className="mt-1 font-display text-4xl font-bold sm:text-5xl">{data.company.name}</h1><p className="mt-3 text-white/80">{data.jobs.length} open position{data.jobs.length === 1 ? "" : "s"}</p>
          <div className="relative mx-auto mt-6 max-w-md"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search roles" className="h-12 w-full rounded-full bg-white pl-11 pr-4 text-slate-900 outline-none" /></div></div>
      </section>
      <div className="mt-8 space-y-3">
        {jobs.length === 0 && <EmptyState icon={Briefcase} title="No open roles right now" text="Check back soon." />}
        {jobs.map((j) => (
          <Card key={j.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
            <div className="flex-1"><p className="text-lg font-semibold text-ink">{j.title}</p><p className="mt-1 flex flex-wrap gap-3 text-sm text-ink-soft"><span>{j.department ?? "—"}</span>{j.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{j.location}</span>}<span>{title(j.employment_type)}</span><span>Posted {ago(j.posted_at)}</span></p></div>
            <Button onClick={() => { setJob(j); setDone(false); }}>View & apply</Button>
          </Card>
        ))}
      </div>
      <Dialog open={!!job} onClose={() => setJob(null)} title={job?.title} description={`${data.company.name} · ${job?.location ?? ""}`} className="max-w-2xl">
        {job && (done ? (
          <div className="py-8 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" /><p className="mt-3 text-lg font-semibold text-ink">Application received</p><p className="mt-1 text-sm text-ink-soft">Create an account with {f.email} to track your application.</p><a href="/signup" className="mt-4 inline-block text-sm font-semibold text-brand-600">Create candidate account →</a></div>
        ) : (
          <div className="space-y-4">
            {job.description && <p className="whitespace-pre-wrap text-sm text-ink">{job.description}</p>}
            {job.requirements && <div className="flex flex-wrap gap-1.5">{job.requirements.split(",").map((r) => <span key={r} className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700">{r.trim()}</span>)}</div>}
            <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
              <Field label="Full name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Email *"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
              <Field label="Years of experience"><Input type="number" value={f.exp} onChange={(e) => setF({ ...f, exp: e.target.value })} /></Field>
              <Field label="Expected monthly salary"><Input type="number" value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} /></Field>
              <Field label="CV (PDF)"><label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 text-sm text-ink-soft"><Paperclip className="h-4 w-4" />{cv ? cv.name : "Attach"}<input type="file" accept="application/pdf,.doc,.docx" className="hidden" onChange={(e) => setCv(e.target.files?.[0] ?? null)} /></label></Field>
              <Field label="About you" className="sm:col-span-2" hint="Mention your key skills — they are matched to the role."><Textarea rows={4} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end"><Button onClick={apply} loading={busy} disabled={f.name.trim().length < 2 || !f.email.includes("@")}>Submit application</Button></div>
          </div>
        ))}
      </Dialog>
    </>
  );
}

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5"><Logo /><ThemeToggle compact /></header>
      <main className="mx-auto max-w-5xl px-6 pb-16"><Suspense fallback={<Loading />}><Careers /></Suspense></main>
    </div>
  );
}
