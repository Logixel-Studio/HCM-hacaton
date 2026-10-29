"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { CalendarCheck2, CheckCircle2, MapPin, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { isConfigured } from "@/lib/supabase";
import { Logo } from "@/components/brand";
import { SetupNotice } from "@/components/setup-notice";
import { ThemeToggle } from "@/components/theme-controls";

/** Split-screen auth layout: form on the left, product story on the right. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { session, ctx, loading } = useAuth();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (loading || !session || path.startsWith("/reset-password")) return;
    const start = (ctx?.prefs as { startPage?: string } | undefined)?.startPage;
    router.replace(ctx?.tenant || ctx?.is_platform_admin ? (start && start.startsWith("/") && !start.startsWith("//") ? start : "/dashboard") : "/onboarding");
  }, [session, ctx, loading, router, path]);

  if (!isConfigured) return <SetupNotice />;

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-6 sm:px-10 lg:px-16">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="HCM Master Suite home"><Logo /></Link>
          <ThemeToggle compact />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[420px] animate-fade-up">{children}</div>
        </div>
        <p className="text-center text-xs text-ink-soft lg:text-left">© {new Date().getFullYear()} HCM Master Suite · Your data stays in your own Supabase project</p>
      </div>

      <div className="relative hidden overflow-hidden lg:block">
        <div className="brand-glow absolute inset-0" />
        <div className="grid-dots absolute inset-0 opacity-40" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium ring-1 ring-white/20 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" /> AI-native HR for growing companies
          </div>

          <div className="relative mx-auto w-full max-w-md">
            <div className="animate-float rounded-3xl bg-white/95 p-5 text-slate-900 shadow-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-100 text-sky-700"><Wallet className="h-5 w-5" /></div>
                  <div><p className="text-sm font-semibold">Payroll · October</p><p className="text-xs text-slate-500">148 employees</p></div>
                </div>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Finance approved</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[["Gross", "18.4M"], ["Tax", "1.2M"], ["Net", "16.1M"]].map(([k, v]) => (
                  <div key={k} className="rounded-2xl bg-slate-50 py-2.5"><p className="text-[11px] text-slate-500">{k}</p><p className="font-display text-base font-bold">{v}</p></div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Prepared by payroll · approved by HR · approved by finance
              </div>
            </div>

            <div className="absolute -left-10 top-[115%] w-60 rounded-2xl bg-white/95 p-3.5 text-slate-900 shadow-xl" style={{ animation: "float 7s ease-in-out infinite" }}>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><MapPin className="h-4 w-4" /></div>
                <div><p className="text-sm font-semibold">Clocked in 08:56</p><p className="text-xs text-slate-500">Inside office geofence · 42 m</p></div>
              </div>
            </div>
            <div className="absolute -right-6 top-[150%] w-56 rounded-2xl bg-white/95 p-3.5 text-slate-900 shadow-xl" style={{ animation: "float 8s ease-in-out infinite" }}>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><CalendarCheck2 className="h-4 w-4" /></div>
                <div><p className="text-sm font-semibold">Leave approved</p><p className="text-xs text-slate-500">Casual · 2 days</p></div>
              </div>
            </div>
          </div>

          <div className="mt-40">
            <h2 className="font-display text-3xl font-bold leading-tight">People, attendance, payroll and talent.<br />One secure workspace for every role.</h2>
            <p className="mt-3 max-w-md text-sm text-white/75">From the company owner to the newest employee, everyone sees exactly what their role allows — enforced in the database, not just the screen.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["Owner", "HR Director", "HR Manager", "Payroll", "Finance", "Recruiter", "Line Manager", "Employee", "Auditor"].map((r) => (
                <span key={r} className="rounded-full bg-white/10 px-3 py-1 text-xs ring-1 ring-white/15">{r}</span>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-2 text-xs text-white/70"><ShieldCheck className="h-4 w-4" /> Row-level security · maker-checker payroll · immutable audit log</div>
          </div>
        </div>
      </div>
    </div>
  );
}
