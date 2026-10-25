"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Briefcase, CalendarClock } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { EmptyState, Loading, StatusBadge } from "@/components/common";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-controls";
import { useAuth } from "@/lib/auth";
import { useRpc } from "@/lib/api";
import { ago, fmtDateTime, title } from "@/lib/format";
import { cn } from "@/lib/utils";

type App = { id: string; company: string; job_title: string; stage: string; applied_at: string; next_interview: string | null; offer_status: string | null };
const STEPS = ["applied", "screening", "assessment", "interview", "offer", "hired"];

/** Candidate portal (brief role 13): own applications, interviews and offers. */
export default function MyApplicationsPage() {
  const { session, loading, ctx, signOut } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!loading && !session) router.replace("/login"); }, [loading, session, router]);
  const { data: apps = [], isLoading } = useRpc<App[]>(["my-applications"], "my_applications", undefined, { enabled: !!session });
  if (loading || !session) return <Loading className="h-screen" />;
  return (
    <div className="min-h-screen bg-canvas">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5"><Logo /><div className="flex gap-2"><ThemeToggle compact />{ctx?.tenant && <Link href="/dashboard"><Button variant="outline" size="sm">Workspace</Button></Link>}<Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button></div></header>
      <main className="mx-auto max-w-4xl px-6 pb-16">
        <h1 className="font-display text-3xl font-bold text-ink">My applications</h1><p className="mt-1 text-ink-soft">{ctx?.email}</p>
        <div className="mt-6 space-y-4">
          {isLoading ? <Loading /> : apps.length === 0 ? <Card><EmptyState icon={Briefcase} title="No applications found" text="Applications made with this email address appear here." /></Card> : apps.map((a) => {
            const idx = STEPS.indexOf(a.stage);
            return (
              <Card key={a.id} className="p-5">
                <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-semibold text-ink">{a.job_title}</p><p className="text-sm text-ink-soft">{a.company} · applied {ago(a.applied_at)}</p></div><StatusBadge status={a.stage} /></div>
                {idx >= 0 && <div className="mt-4 flex gap-1.5">{STEPS.map((s, i) => <div key={s} className="flex-1"><div className={cn("h-1.5 rounded-full", i <= idx ? "bg-brand-500" : "bg-surface-muted")} /><p className="mt-1 hidden text-[11px] text-ink-soft sm:block">{title(s)}</p></div>)}</div>}
                {a.next_interview && <p className="mt-4 flex items-center gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-700"><CalendarClock className="h-4 w-4" />Interview on {fmtDateTime(a.next_interview)}</p>}
                {a.offer_status && <p className="mt-3 text-sm text-ink">Offer: <span className="font-medium">{title(a.offer_status)}</span></p>}
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
