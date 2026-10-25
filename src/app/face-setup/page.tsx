"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Camera, CheckCircle2, Glasses, Lightbulb, Lock, LogOut, RotateCcw, ScanFace, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui";
import { Loading } from "@/components/common";
import { FaceScanner, type FaceResult } from "@/components/face-capture";
import { useAttendanceRules } from "@/components/clock-card";
import { rpc, uploadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Stage = "intro" | "scan" | "review" | "saving" | "done";
const STAGES: { key: Stage; label: string }[] = [
  { key: "intro", label: "Get ready" }, { key: "scan", label: "Scan" }, { key: "review", label: "Confirm" }, { key: "done", label: "Done" },
];

/**
 * First-login Face ID enrollment. Employees whose attendance needs Face ID land here after
 * accepting an invite or signing up, and must finish before using the app.
 */
export default function FaceSetupPage() {
  const { session, ctx, loading, signOut } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: rules, isLoading: rulesLoading } = useAttendanceRules();
  const [stage, setStage] = useState<Stage>("intro");
  const [result, setResult] = useState<FaceResult | null>(null);
  const [scanKey, setScanKey] = useState(0);
  const employee = ctx?.employee;
  const required = !!rules?.require_face;
  const firstName = (employee?.full_name ?? ctx?.full_name ?? "").split(" ")[0];

  useEffect(() => {
    if (loading || !isConfigured) return;
    if (!session) router.replace("/login");
    else if (ctx && !employee) router.replace("/dashboard");
  }, [loading, session, ctx, employee, router]);

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.photoUrl); }, [result]);

  async function save() {
    if (!result || !employee || !ctx?.tenant) return;
    setStage("saving");
    try {
      const path = await uploadFile("attendance-selfies", ctx.tenant.id, employee.id, new File([result.photo], "face-id.jpg", { type: "image/jpeg" }));
      await rpc("enroll_face", { p_employee: employee.id, p_descriptor: result.descriptor, p_photo_path: path, p_samples: result.samples });
      await qc.invalidateQueries({ queryKey: ["attendance"] });
      setStage("done");
    } catch (e) {
      toast.error((e as Error).message);
      setStage("review");
    }
  }

  function retake() { if (result) URL.revokeObjectURL(result.photoUrl); setResult(null); setScanKey((k) => k + 1); setStage("scan"); }

  if (loading || rulesLoading || !session || !ctx) return <Loading className="h-screen" label="Loading" />;
  const already = rules?.face_enrolled && stage !== "done";
  const blocked = rules && !rules.allow_self_enrollment && !rules.face_enrolled;
  const activeIdx = STAGES.findIndex((s) => s.key === (stage === "saving" ? "review" : stage));

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas">
      <div className="brand-gradient pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full opacity-[0.12] blur-3xl" />
      <div className="brand-gradient pointer-events-none absolute -bottom-48 -right-40 h-[30rem] w-[30rem] rounded-full opacity-[0.10] blur-3xl" />

      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <button onClick={async () => { await signOut(); router.replace("/login"); }} className="flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-ink-soft hover:bg-surface-muted hover:text-ink">
          <LogOut className="h-4 w-4" />Sign out
        </button>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        {!already && !blocked && (
          <ol className="mx-auto mb-8 flex max-w-md items-center">
            {STAGES.map((s, i) => (
              <li key={s.key} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition",
                    i < activeIdx ? "bg-emerald-500 text-white" : i === activeIdx ? "brand-gradient text-white shadow-md" : "bg-surface-muted text-ink-soft")}>
                    {i < activeIdx ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className={cn("text-[11px] font-medium", i <= activeIdx ? "text-ink" : "text-ink-soft")}>{s.label}</span>
                </div>
                {i < STAGES.length - 1 && <div className={cn("mx-2 mb-5 h-0.5 flex-1 rounded-full", i < activeIdx ? "bg-emerald-500" : "bg-line")} />}
              </li>
            ))}
          </ol>
        )}

        <div className="mx-auto max-w-4xl overflow-hidden rounded-[2rem] border border-line bg-surface shadow-pop">
          {already ? (
            <Done title="Face ID is already set up" text="You can clock in with your face from the dashboard. If your look has changed a lot, ask HR to reset it." onGo={() => router.replace("/dashboard")} />
          ) : blocked ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-50 text-amber-600"><Lock className="h-8 w-8" /></span>
              <h1 className="mt-5 font-display text-2xl font-bold text-ink">HR will set up your Face ID</h1>
              <p className="mt-2 max-w-md text-sm text-ink-soft">Your company registers faces at the HR desk. Visit HR once with your phone or laptop; after that you can clock in with your face.</p>
              <Button className="mt-6" variant="secondary" onClick={() => router.replace("/dashboard")}>Go to dashboard</Button>
            </div>
          ) : stage === "intro" ? (
            <div className="grid md:grid-cols-2">
              <div className="brand-gradient relative flex flex-col justify-between overflow-hidden p-8 text-white md:p-10">
                <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10" />
                <div className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-white/10" />
                <div className="relative">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur"><Sparkles className="h-3.5 w-3.5" />One-time setup · about 30 seconds</span>
                  <h1 className="mt-5 font-display text-3xl font-bold leading-tight md:text-4xl">{firstName ? `Welcome, ${firstName}!` : "Welcome!"}<br />Let&apos;s set up your Face ID</h1>
                  <p className="mt-3 max-w-sm text-sm text-white/85">{ctx.tenant?.name ?? "Your company"} uses Face ID so that only you can mark your attendance. Clocking in becomes one tap and a quick look at the camera.</p>
                </div>
                <div className="relative mt-10 flex justify-center">
                  <div className="relative flex h-44 w-36 items-center justify-center rounded-[50%] border-4 border-dashed border-white/60">
                    <ScanFace className="h-16 w-16 text-white/90" />
                    <span className="absolute -right-3 top-6 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400 shadow-lg"><ShieldCheck className="h-5 w-5" /></span>
                  </div>
                </div>
              </div>
              <div className="p-8 md:p-10">
                <h2 className="font-semibold text-ink">For a perfect scan</h2>
                <ul className="mt-4 space-y-3">
                  {[
                    { i: Lightbulb, t: "Face a light", d: "Light in front of you, not behind you." },
                    { i: Glasses, t: "Remove mask, cap and sunglasses", d: "Normal glasses are fine." },
                    { i: Smartphone, t: "Hold the camera at eye level", d: "About an arm's length away." },
                    { i: ScanFace, t: "Follow the prompts", d: "Look straight, turn your head both ways, then blink." },
                  ].map(({ i: I, t, d }) => (
                    <li key={t} className="flex gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><I className="h-[18px] w-[18px]" /></span>
                      <div><p className="text-sm font-medium text-ink">{t}</p><p className="text-xs text-ink-soft">{d}</p></div>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 flex gap-3 rounded-2xl bg-surface-muted p-4">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />
                  <p className="text-xs leading-relaxed text-ink-soft">Your face is turned into a set of numbers on this device. Only those numbers and one reference photo are stored, visible to you and HR, and used only for attendance.</p>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button size="lg" onClick={() => setStage("scan")}><Camera className="h-4 w-4" />Start face scan</Button>
                  {!required && <Button variant="ghost" onClick={() => router.replace("/dashboard")}>Maybe later</Button>}
                </div>
                {required && <p className="mt-3 text-xs text-ink-soft">Your company requires Face ID for attendance, so this step is needed before you continue.</p>}
              </div>
            </div>
          ) : stage === "scan" ? (
            <div className="px-5 py-8 md:px-10">
              <div className="mb-6 text-center">
                <h1 className="font-display text-2xl font-bold text-ink">Scan your face</h1>
                <p className="mt-1 text-sm text-ink-soft">Keep your face inside the oval and follow the prompt.</p>
              </div>
              <FaceScanner key={scanKey} mode="enroll" onDone={(r) => { setResult(r); setStage("review"); }} onCancel={() => setStage("intro")} />
            </div>
          ) : stage === "review" || stage === "saving" ? (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <h1 className="font-display text-2xl font-bold text-ink">Looking good?</h1>
              <p className="mt-1 text-sm text-ink-soft">This photo will be your Face ID reference. HR sees it when checking attendance.</p>
              <div className="relative mt-6">
                <div className="brand-gradient absolute -inset-1.5 rounded-[2.2rem] opacity-70 blur-sm" />
                {result && <img src={result.photoUrl} alt="Your Face ID photo" className="relative aspect-[3/4] w-60 rounded-[2rem] object-cover shadow-pop" />}
                <span className="absolute -bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white shadow-md">
                  <ShieldCheck className="h-3.5 w-3.5" />Live check passed
                </span>
              </div>
              <div className="mt-8 flex flex-wrap justify-center gap-2 text-xs text-ink-soft">
                <span className="rounded-full bg-surface-muted px-3 py-1">{result?.samples ?? 0} face samples</span>
                {result?.checks.includes("turn_both") && <span className="rounded-full bg-surface-muted px-3 py-1">Head turn ✓</span>}
                {result?.checks.includes("blink") && <span className="rounded-full bg-surface-muted px-3 py-1">Blink ✓</span>}
              </div>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <Button variant="secondary" onClick={retake} disabled={stage === "saving"}><RotateCcw className="h-4 w-4" />Retake</Button>
                <Button size="lg" onClick={save} loading={stage === "saving"}><CheckCircle2 className="h-4 w-4" />Use this photo</Button>
              </div>
            </div>
          ) : (
            <Done title="Face ID is ready!" text="From now on, tap Clock in on your dashboard and look at the camera. It takes about five seconds." onGo={() => router.replace("/dashboard")} />
          )}
        </div>
      </main>
    </div>
  );
}

function Done({ title, text, onGo }: { title: string; text: string; onGo: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center" data-testid="face-setup-done">
      <span className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/30" />
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg"><CheckCircle2 className="h-10 w-10" /></span>
      </span>
      <h1 className="mt-6 font-display text-2xl font-bold text-ink">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-ink-soft">{text}</p>
      <Button size="lg" className="mt-7" onClick={onGo}>Go to dashboard<ArrowRight className="h-4 w-4" /></Button>
    </div>
  );
}

