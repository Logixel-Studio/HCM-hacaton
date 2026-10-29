"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";
import {
  ArrowRight, BadgeCheck, Bot, Briefcase, CalendarCheck2, CalendarDays, Check, ChevronDown, Clock, FileText, Fingerprint, GraduationCap, Heart, LayoutDashboard,
  LifeBuoy, Lock, MapPin, Menu, Receipt, ScanFace, ShieldCheck, Sparkles, Target, UserPlus, Users, Wallet, Workflow, X, BarChart3, FolderOpen, ScrollText,
} from "lucide-react";
import { Logo } from "@/components/brand";
import { useAuth } from "@/lib/auth";
import { CopilotMock, DashboardMock, FacePhone, FloatCard, GeoCard, Payslip } from "./mocks";

gsap.registerPlugin(ScrollTrigger, useGSAP);

let lenis: Lenis | null = null;
function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { offset: -72, duration: 1.2 });
  else el.scrollIntoView({ behavior: "smooth" });
}

/* ── Auth-aware calls to action ─────────────────────────────────────────── */
function useCta() {
  const { session, ctx, loading } = useAuth();
  const signedIn = !!session;
  const href = ctx?.tenant || ctx?.is_platform_admin ? "/dashboard" : "/onboarding";
  const label = ctx?.tenant || ctx?.is_platform_admin ? "Open dashboard" : "Finish company setup";
  return { loading, signedIn, href, label, name: (ctx?.employee?.full_name ?? ctx?.full_name ?? ctx?.email ?? "").split(" ")[0] };
}
function HeaderCta({ onNav }: { onNav?: () => void }) {
  const c = useCta();
  if (c.loading) return <div className="h-10 w-40 animate-pulse rounded-full bg-white/10" />;
  if (c.signedIn) return (
    <Link href={c.href} onClick={onNav} className="lp-btn group inline-flex h-10 items-center gap-2 rounded-full bg-white pl-1.5 pr-4 text-sm font-semibold text-slate-900">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-xs font-bold text-white">{(c.name || "U")[0].toUpperCase()}</span>
      {c.label}<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
    </Link>
  );
  return (
    <div className="flex items-center gap-2">
      <Link href="/login" onClick={onNav} className="inline-flex h-10 items-center rounded-full px-4 text-sm font-medium text-slate-300 transition hover:text-white">Sign in</Link>
      <Link href="/signup" onClick={onNav} className="lp-btn group inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-slate-900">Get started<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></Link>
    </div>
  );
}
function HeroCta() {
  const c = useCta();
  return (
    <div className="lp-hero-cta mt-9 flex flex-wrap items-center justify-center gap-3 [animation:fade-up_.9s_.9s_cubic-bezier(.16,1,.3,1)_both]">
      {c.signedIn ? (
        <Link href={c.href} className="lp-btn group inline-flex h-13 items-center gap-2 rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-violet-500 px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_10px_40px_-10px_rgba(56,189,248,.7)]">
          {c.name ? `Welcome back, ${c.name} — ` : ""}{c.label}<ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
        </Link>
      ) : (
        <Link href="/signup" className="lp-btn group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-violet-500 px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_10px_40px_-10px_rgba(56,189,248,.7)]">
          Register your company free<ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
        </Link>
      )}
      <button onClick={() => scrollToId("platform")} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 text-[15px] font-medium text-white backdrop-blur transition hover:bg-white/10">See how it works<ChevronDown className="h-4 w-4" /></button>
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────────────────────── */
const NAV = [["platform", "Platform"], ["attendance", "Face ID & GPS"], ["payroll", "Payroll"], ["ai", "AI Copilot"], ["security", "Security"], ["faq", "FAQ"]] as const;
function Header() {
  const [scrolled, setScrolled] = useState(false), [hidden, setHidden] = useState(false), [open, setOpen] = useState(false), [active, setActive] = useState("");
  useEffect(() => {
    let last = 0;
    const on = () => {
      const y = window.scrollY;
      setScrolled(y > 24);
      setHidden(y > 500 && y > last + 4);
      if (y < last - 4) setHidden(false);
      last = y;
      let cur = "";
      for (const [id] of NAV) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < 160) cur = id; }
      setActive(cur);
    };
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${hidden && !open ? "-translate-y-full" : ""}`}>
      <div className={`mx-auto mt-3 flex max-w-6xl items-center gap-4 rounded-full px-3 py-2 transition-all duration-500 sm:px-4 ${scrolled || open ? "mx-3 border border-white/10 bg-[#070b16]/75 shadow-[0_10px_40px_-15px_rgba(0,0,0,.6)] backdrop-blur-xl sm:mx-auto" : "border border-transparent"}`}>
        <Link href="/" className="shrink-0 pl-1" aria-label="HCM Master Suite home"><Logo light /></Link>
        <nav className="mx-auto hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map(([id, l]) => (
            <button key={id} onClick={() => scrollToId(id)} className={`relative cursor-pointer rounded-full px-3.5 py-2 text-sm transition ${active === id ? "text-white" : "text-slate-400 hover:text-white"}`}>
              {active === id && <span className="absolute inset-0 -z-10 rounded-full bg-white/10" />}{l}
            </button>
          ))}
        </nav>
        <div className="ml-auto hidden lg:block"><HeaderCta /></div>
        <button onClick={() => setOpen((o) => !o)} className="ml-auto flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-white lg:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
      </div>
      {open && (
        <div className="mx-3 mt-2 rounded-3xl border border-white/10 bg-[#070b16]/95 p-4 backdrop-blur-xl lg:hidden">
          <nav className="grid gap-1" aria-label="Mobile">{NAV.map(([id, l]) => <button key={id} onClick={() => { setOpen(false); setTimeout(() => scrollToId(id), 50); }} className="cursor-pointer rounded-2xl px-4 py-3 text-left text-[15px] text-slate-200 hover:bg-white/5">{l}</button>)}</nav>
          <div className="mt-3 border-t border-white/10 pt-3"><HeaderCta onNav={() => setOpen(false)} /></div>
        </div>
      )}
    </header>
  );
}

/* ── Data ───────────────────────────────────────────────────────────────── */
const MODULES = [
  { i: Users, l: "Core HR" }, { i: Clock, l: "Attendance" }, { i: CalendarDays, l: "Leave" }, { i: Wallet, l: "Payroll" }, { i: Receipt, l: "Expenses & loans" },
  { i: Briefcase, l: "Recruitment" }, { i: Workflow, l: "On & offboarding" }, { i: Target, l: "Performance" }, { i: GraduationCap, l: "Learning" },
  { i: Heart, l: "Engagement" }, { i: LifeBuoy, l: "Helpdesk" }, { i: FolderOpen, l: "Documents" }, { i: BarChart3, l: "Analytics" }, { i: Bot, l: "AI Copilot" },
  { i: ShieldCheck, l: "Roles & access" }, { i: ScrollText, l: "Audit log" },
];
const JOURNEY = [
  { n: "01", t: "Hire", d: "Requisition → careers page → explainable match scores → interviews with scorecards → offer → one-click hire.", i: Briefcase, c: "from-sky-500/30" },
  { n: "02", t: "Onboard", d: "A checklist with tasks for HR, IT, Admin, Finance, the manager and a buddy — created the moment someone is hired.", i: UserPlus, c: "from-violet-500/30" },
  { n: "03", t: "Clock in", d: "GPS geofence, field or remote rules, and a 5-second Face ID check. Late, overtime and corrections handled.", i: ScanFace, c: "from-emerald-500/30" },
  { n: "04", t: "Time off", d: "Policy-as-data leave: accrual, proration, sandwich rule, half days and manager → HR routing.", i: CalendarCheck2, c: "from-amber-500/30" },
  { n: "05", t: "Get paid", d: "FY 2025-26 slabs, EOBI, PF, loans and overtime. Maker-checker approval, bank file, explained payslips.", i: Wallet, c: "from-rose-500/30" },
  { n: "06", t: "Grow", d: "OKR goals, review cycles, feedback, courses, certificates and anonymous eNPS pulse surveys.", i: Target, c: "from-cyan-500/30" },
];
const ROLES = ["Platform Super Admin", "Company Owner", "Company Admin", "HR Director", "HR Manager", "HR Executive", "Payroll Officer", "Finance Controller", "Recruiter", "Hiring Manager", "Line Manager", "Employee", "Candidate", "Auditor"];
const FAQS: [string, string][] = [
  ["Who is HCM Master Suite for?", "Companies in Pakistan from 10 to a few thousand people that want HR, attendance, leave, payroll and talent in one place instead of spreadsheets and WhatsApp groups."],
  ["How does Face ID attendance work?", "On clock-in the employee looks at the camera, turns their head and blinks. The browser turns the face into 128 numbers and the server compares them with the enrolled face. A printed photo can’t pass the head-turn check, and every punch keeps a selfie for HR."],
  ["Is payroll correct for Pakistan?", "Yes. It ships with the FY 2025-26 salaried tax slabs, EOBI and provident fund rules, stored as data so they can be updated. Every payslip line shows its formula, and payroll needs HR approval and then Finance approval by a different person."],
  ["Can employees see each other’s salaries?", "No. Salaries are visible only to the employee and the pay roles. HR executives and line managers can’t see them. This is enforced by the database itself (row-level security), not just hidden in the screen."],
  ["What can the AI copilot see?", "Exactly what the person asking can see. An owner gets company-wide answers, a manager about their team, an employee about themselves. Chats are private to each person."],
  ["How do employees join?", "HR adds them and ticks ‘Invite to the app’. They get an email from your company’s domain, set a password, register their face if required, and they are in."],
  ["Does it work on phones?", "Yes. It is a responsive web app — clock in with the phone camera and GPS, apply for leave and download payslips from any browser."],
];

/* ── Page ───────────────────────────────────────────────────────────────── */
export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const [role, setRole] = useState<"owner" | "manager" | "employee">("owner");

  // Smooth scrolling, synced with ScrollTrigger.
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    lenis = new Lenis({ duration: 1.15, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => lenis?.raf(t * 1000);
    gsap.ticker.add(tick); gsap.ticker.lagSmoothing(0);
    return () => { gsap.ticker.remove(tick); lenis?.destroy(); lenis = null; };
  }, []);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add({ motion: "(prefers-reduced-motion: no-preference)", desktop: "(min-width: 1024px)" }, (c) => {
      const { motion, desktop } = c.conditions as { motion: boolean; desktop: boolean };
      if (!motion) return;

      // Scroll progress bar
      gsap.to(".lp-progress", { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });

      // Hero entrance
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.from(".lp-eyebrow", { y: 20, opacity: 0, duration: 0.9 })
        .from(".lp-word", { yPercent: 115, rotate: 4, opacity: 0, duration: 1.1, stagger: 0.06 }, "-=0.6")
        .from(".lp-sub", { y: 24, opacity: 0, duration: 1 }, "-=0.8")
        .from(".lp-trust > *", { y: 12, opacity: 0, duration: 0.7, stagger: 0.04 }, "-=0.7")
        .from(".lp-stage", { y: 120, opacity: 0, rotateX: 28, duration: 1.6 }, "-=1")
        .from(".lp-float", { scale: 0.6, opacity: 0, duration: 1, stagger: 0.12, ease: "back.out(1.6)" }, "-=1")
        .from(".lp-bar", { scaleY: 0, duration: 0.9, stagger: 0.04, ease: "power3.out" }, "-=1.2");

      // Floating cards drift forever; the stage flattens as you scroll.
      gsap.utils.toArray<HTMLElement>(".lp-float").forEach((el, i) => gsap.to(el, { y: i % 2 ? 14 : -14, x: i % 3 ? 6 : -6, duration: 3 + i * 0.5, repeat: -1, yoyo: true, ease: "sine.inOut" }));
      gsap.to(".lp-stage", { rotateX: 0, scale: 1.04, ease: "none", scrollTrigger: { trigger: ".lp-hero", start: "top top", end: "bottom top", scrub: true } });
      gsap.to(".lp-aurora-a", { xPercent: 20, yPercent: 10, duration: 14, repeat: -1, yoyo: true, ease: "sine.inOut" });
      gsap.to(".lp-aurora-b", { xPercent: -25, yPercent: -10, duration: 18, repeat: -1, yoyo: true, ease: "sine.inOut" });

      // Mouse parallax on the hero visual.
      const hero = document.querySelector<HTMLElement>(".lp-hero");
      const qx = gsap.quickTo(".lp-stage-wrap", "rotateY", { duration: 0.8, ease: "power3" }), qy = gsap.quickTo(".lp-stage-wrap", "rotateX", { duration: 0.8, ease: "power3" });
      const gx = gsap.quickTo(".lp-glow", "x", { duration: 0.6 }), gy = gsap.quickTo(".lp-glow", "y", { duration: 0.6 });
      const move = (e: MouseEvent) => { const r = hero!.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5; qx(px * 6); qy(-py * 4); gx(e.clientX - r.left - 300); gy(e.clientY - r.top - 300); };
      hero?.addEventListener("mousemove", move);

      // Statement: words light up as you scroll.
      gsap.to(".lp-sword", { opacity: 1, stagger: 0.05, ease: "none", scrollTrigger: { trigger: ".lp-statement", start: "top 75%", end: "bottom 45%", scrub: true } });

      // Generic reveals
      gsap.utils.toArray<HTMLElement>(".lp-reveal").forEach((el) => gsap.from(el, { y: 50, opacity: 0, duration: 1.1, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 85%" } }));
      gsap.utils.toArray<HTMLElement>(".lp-stagger").forEach((el) => gsap.from(el.children, { y: 30, opacity: 0, duration: 0.9, stagger: 0.07, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 85%" } }));

      // Orbit rings spin; module labels counter-rotate to stay upright.
      gsap.to(".lp-orbit-1", { rotate: 360, duration: 60, repeat: -1, ease: "none" });
      gsap.to(".lp-orbit-1 .lp-chip", { rotate: -360, duration: 60, repeat: -1, ease: "none" });
      gsap.to(".lp-orbit-2", { rotate: -360, duration: 90, repeat: -1, ease: "none" });
      gsap.to(".lp-orbit-2 .lp-chip", { rotate: 360, duration: 90, repeat: -1, ease: "none" });
      gsap.from(".lp-orbit-wrap", { scale: 0.6, opacity: 0, duration: 1.6, ease: "expo.out", scrollTrigger: { trigger: ".lp-orbit-wrap", start: "top 80%" } });

      // Face ID + GPS: pinned, scroll-driven story on desktop; plays on enter on phones.
      const fx = gsap.timeline({ defaults: { ease: "none" } });
      fx.to(".fx-scan", { y: 190, duration: 1, repeat: 1, yoyo: true })
        .to(".fx-ring", { strokeDashoffset: 70, duration: 1 }, 0)
        .to(".fx-chip-0", { backgroundColor: "rgba(52,211,153,.25)", color: "#6ee7b7", duration: 0.2 }, 0.8)
        .to(".fx-step-0", { opacity: 0.35, duration: 0.2 }, 1).to(".fx-step-1", { opacity: 1, duration: 0.2 }, 1)
        .to(".fx-features", { x: 14, duration: 0.5 }, 1).to(".fx-features", { x: -14, duration: 0.6 }, 1.5).to(".fx-features", { x: 0, duration: 0.4 }, 2.1)
        .to(".fx-ring", { strokeDashoffset: 35, duration: 1.4 }, 1)
        .to(".fx-chip-1", { backgroundColor: "rgba(52,211,153,.25)", color: "#6ee7b7", duration: 0.2 }, 2.3)
        .to(".fx-step-1", { opacity: 0.35, duration: 0.2 }, 2.5).to(".fx-step-2", { opacity: 1, duration: 0.2 }, 2.5)
        .to(".fx-eye", { scaleY: 0.1, transformOrigin: "center", duration: 0.15 }, 2.7).to(".fx-eye", { scaleY: 1, duration: 0.15 }, 2.9)
        .to(".fx-ring", { strokeDashoffset: 0, duration: 0.8 }, 2.6)
        .to(".fx-chip-2", { backgroundColor: "rgba(52,211,153,.25)", color: "#6ee7b7", duration: 0.2 }, 3.1)
        .to(".fx-step-2", { opacity: 0.35, duration: 0.2 }, 3.3).to(".fx-step-3", { opacity: 1, duration: 0.2 }, 3.3)
        .to(".fx-done", { opacity: 1, duration: 0.4 }, 3.4)
        .from(".geo-pin", { y: -80, opacity: 0, duration: 0.6, ease: "bounce.out" }, 3.3)
        .fromTo(".geo-dist", { textContent: 412 }, { textContent: 38, snap: { textContent: 1 }, duration: 0.6 }, 3.3);
      if (desktop) ScrollTrigger.create({ trigger: ".fx-section", start: "top top", end: "+=2200", pin: true, scrub: 1, animation: fx, anticipatePin: 1 });
      else ScrollTrigger.create({ trigger: ".fx-section", start: "top 60%", animation: fx.duration(6).timeScale(1).paused(true), onEnter: () => fx.play() });
      gsap.to(".geo-pulse", { scale: 1.6, opacity: 0, duration: 2.2, repeat: -1, ease: "power1.out" });

      // Horizontal journey (desktop): vertical scroll moves the track sideways.
      if (desktop) {
        const track = document.querySelector<HTMLElement>(".lp-track");
        if (track) {
          const dist = () => track.scrollWidth - window.innerWidth + 96;
          gsap.to(track, { x: () => -dist(), ease: "none", scrollTrigger: { trigger: ".lp-journey", start: "top top", end: () => `+=${dist()}`, pin: true, scrub: 1, invalidateOnRefresh: true } });
        }
      }

      // Payroll: approval path draws itself, nodes light up, payslip counts up.
      gsap.fromTo(".pay-path", { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "none", scrollTrigger: { trigger: ".pay-flow", start: "top 75%", end: "bottom 55%", scrub: true } });
      gsap.utils.toArray<HTMLElement>(".pay-node").forEach((n, i) => gsap.from(n, { scale: 0.4, opacity: 0.2, duration: 0.6, ease: "back.out(2)", scrollTrigger: { trigger: ".pay-flow", start: `top+=${i * 60} 70%` } }));
      const count = (sel: string, to: number) => gsap.fromTo(sel, { textContent: 0 }, { textContent: to, duration: 1.6, ease: "power2.out", snap: { textContent: 1 }, scrollTrigger: { trigger: ".pay-slip", start: "top 75%" }, onUpdate() { document.querySelectorAll<HTMLElement>(sel).forEach((el) => { el.textContent = Number(el.textContent).toLocaleString("en-US"); }); } });
      count(".pay-gross", 135000); count(".pay-net", 116424); count(".pay-tax", 3459);
      gsap.from(".pay-slip", { y: 80, rotate: 4, opacity: 0, duration: 1.2, ease: "expo.out", scrollTrigger: { trigger: ".pay-slip", start: "top 85%" } });

      // Roles fly in from everywhere and settle into place.
      gsap.from(".lp-role", { x: () => gsap.utils.random(-400, 400), y: () => gsap.utils.random(-200, 200), rotate: () => gsap.utils.random(-40, 40), opacity: 0, ease: "none", stagger: 0.02, scrollTrigger: { trigger: ".lp-roles", start: "top 85%", end: "center 55%", scrub: 1 } });

      // Counters
      gsap.utils.toArray<HTMLElement>(".lp-count").forEach((el) => gsap.fromTo(el, { textContent: 0 }, { textContent: Number(el.dataset.to), duration: 1.8, ease: "power2.out", snap: { textContent: 1 }, scrollTrigger: { trigger: el, start: "top 90%" } }));

      // Final CTA orbit + footer wordmark
      gsap.to(".lp-cta-orbit", { rotate: 360, duration: 40, repeat: -1, ease: "none" });
      gsap.from(".lp-wordmark span", { yPercent: 100, opacity: 0, duration: 1.2, stagger: 0.04, ease: "expo.out", scrollTrigger: { trigger: ".lp-wordmark", start: "top 95%" } });

      return () => hero?.removeEventListener("mousemove", move);
    });
  }, { scope: root });

  // Copilot typing replays when the role changes.
  useGSAP(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tl = gsap.timeline({ scrollTrigger: { trigger: ".lp-ai", start: "top 70%" } });
    tl.from(".cp-q", { x: 40, opacity: 0, duration: 0.5, ease: "power3.out" })
      .fromTo(".cp-typing", { opacity: 0 }, { opacity: 1, duration: 0.2 }).to(".cp-typing", { opacity: 0, duration: 0.2, delay: 0.7 })
      .from(".cp-a", { y: 16, opacity: 0, duration: 0.5, stagger: 0.18, ease: "power3.out" });
  }, { scope: root, dependencies: [role], revertOnUpdate: true });

  const words = "Run your entire workforce from one calm screen.".split(" ");
  const statement = "Spreadsheets, WhatsApp groups and paper registers quietly cost your team hours every week. HCM Master Suite puts people, time, pay and talent on one source of truth — with AI that knows your company and respects every role.".split(" ");

  return (
    <div ref={root} className="lp relative min-h-screen overflow-x-clip bg-[#05070d] text-white antialiased selection:bg-sky-400/30">
      <div className="lp-progress fixed inset-x-0 top-0 z-[60] h-[2px] origin-left scale-x-0 bg-gradient-to-r from-sky-400 via-violet-400 to-emerald-300" />
      <Header />

      {/* ── Hero ── */}
      <section className="lp-hero relative overflow-hidden pt-36 sm:pt-44">
        <div className="pointer-events-none absolute inset-0">
          <div className="lp-aurora-a absolute -left-40 -top-40 h-[42rem] w-[42rem] rounded-full bg-sky-500/25 blur-[120px]" />
          <div className="lp-aurora-b absolute -right-40 top-20 h-[38rem] w-[38rem] rounded-full bg-violet-600/25 blur-[120px]" />
          <div className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgba(148,163,184,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.08)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
          <div className="lp-glow absolute left-0 top-0 h-[600px] w-[600px] rounded-full bg-sky-400/10 blur-[100px]" />
        </div>
        <div className="relative mx-auto max-w-6xl px-5 text-center">
          <button onClick={() => scrollToId("attendance")} className="lp-eyebrow mx-auto inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-1.5 pr-4 text-[13px] text-slate-300 backdrop-blur transition hover:border-white/20">
            <span className="rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 px-2.5 py-0.5 text-[11px] font-semibold text-slate-950">New</span>Face ID + GPS attendance is live<ArrowRight className="h-3.5 w-3.5" />
          </button>
          <h1 className="mx-auto mt-7 max-w-4xl font-display text-[2.6rem] font-bold leading-[1.04] tracking-[-0.035em] sm:text-6xl lg:text-[5.2rem]">
            {words.map((w, i) => (
              <span key={i} className="inline-block overflow-hidden pb-2 align-bottom">
                <span className={`lp-word inline-block ${w.startsWith("calm") ? "font-serif-accent bg-gradient-to-r from-sky-300 via-violet-300 to-emerald-200 bg-clip-text pr-2 font-normal italic text-transparent" : ""}`}>{w}&nbsp;</span>
              </span>
            ))}
          </h1>
          <p className="lp-sub mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-slate-400 sm:text-lg">
            HR, attendance with Face ID, leave, Pakistan-ready payroll, hiring, performance and an AI copilot — one platform where every person sees exactly what their role allows.
          </p>
          <HeroCta />
          <div className="lp-trust mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-slate-500">
            {["FY 2025-26 tax slabs", "EOBI & PF built in", "14 roles", "Row-level security", "Free AI copilot"].map((t) => <span key={t} className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-400" />{t}</span>)}
          </div>
        </div>
        <div className="relative mx-auto mt-16 max-w-6xl px-5 pb-24 [perspective:1600px]">
          <div className="lp-stage-wrap [transform-style:preserve-3d]">
            <div className="lp-stage relative [transform-origin:50%_0%] [transform:rotateX(14deg)]">
              <DashboardMock />
              <FloatCard icon={ScanFace} title="Face verified · 96%" text="Clocked in at Head Office · 38 m" tone="bg-emerald-400/15 text-emerald-300" className="-left-6 top-16 hidden md:flex" />
              <FloatCard icon={Wallet} title="Payroll approved" text="Finance · October · 248 employees" tone="bg-violet-400/15 text-violet-300" className="-right-8 top-36 hidden md:flex" />
              <FloatCard icon={CalendarCheck2} title="Leave approved" text="Ayesha · 2 days casual" tone="bg-sky-400/15 text-sky-300" className="-bottom-6 left-[12%] hidden sm:flex" />
              <FloatCard icon={Sparkles} title="“Who is late today?”" text="AI: 4 people, mostly Warehouse" tone="bg-amber-400/15 text-amber-300" className="-bottom-8 right-[10%] hidden lg:flex" />
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#05070d] to-transparent" />
        </div>
      </section>

      {/* ── Modules ribbon ── */}
      <section aria-label="Modules" className="relative border-y border-white/[0.06] py-6">
        <div className="lp-marquee flex w-max gap-3">
          {[...MODULES, ...MODULES].map((m, i) => (
            <span key={i} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/[0.07] bg-white/[0.03] px-4 py-2 text-sm text-slate-300"><m.i className="h-4 w-4 text-sky-300" />{m.l}</span>
          ))}
        </div>
      </section>

      {/* ── Statement ── */}
      <section className="lp-statement mx-auto max-w-5xl px-5 py-28 sm:py-36">
        <p className="font-display text-[1.9rem] font-semibold leading-[1.25] tracking-tight sm:text-5xl">
          {statement.map((w, i) => <span key={i} className={`lp-sword opacity-[0.16] ${/source|truth|AI|role\./.test(w) ? "text-sky-300" : ""}`}>{w} </span>)}
        </p>
      </section>

      {/* ── Platform orbit ── */}
      <section id="platform" className="relative mx-auto max-w-6xl scroll-mt-24 px-5 py-20">
        <div className="grid items-center gap-16 lg:grid-cols-[1fr_1.1fr]">
          <div className="lp-reveal">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-300">One platform</p>
            <h2 className="mt-4 font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Sixteen modules.<br /><span className="font-serif-accent font-normal italic text-slate-300">One</span> source of truth.</h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-400">Every module shares the same people, roles and approvals, so a hire flows into onboarding, attendance, leave and payroll without a single re-typed field.</p>
            <ul className="lp-stagger mt-8 space-y-4">
              {[["People & time", "Directory, org chart, documents, GPS + Face ID attendance, shifts, leave."], ["Money", "Payroll with maker-checker, payslips with formulas, expenses, loans, final settlement."], ["Talent", "Hiring pipeline, onboarding, goals, reviews, learning and engagement."], ["Control", "14 roles, scopes by branch or department, audit log, AI that respects it all."]].map(([t, d]) => (
                <li key={t} className="flex gap-4"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gradient-to-r from-sky-400 to-violet-400 shadow-[0_0_12px_2px_rgba(56,189,248,.5)]" /><div><p className="font-semibold text-white">{t}</p><p className="text-[15px] text-slate-400">{d}</p></div></li>
              ))}
            </ul>
          </div>
          <div className="lp-orbit-wrap relative mx-auto aspect-square w-full max-w-[520px]">
            <div className="absolute inset-[30%] rounded-full bg-sky-500/20 blur-3xl" />
            <div className="absolute inset-[18%] rounded-full border border-white/[0.07]" />
            <div className="absolute inset-0 rounded-full border border-dashed border-white/[0.08]" />
            <div className="absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[2rem] bg-gradient-to-br from-sky-400 to-violet-600 shadow-[0_0_80px_10px_rgba(56,189,248,.35)]"><LayoutDashboard className="h-12 w-12 text-white" /></div>
            {[{ cls: "lp-orbit-1 inset-[18%]", items: MODULES.slice(0, 5) }, { cls: "lp-orbit-2 inset-0", items: MODULES.slice(5) }].map((o, oi) => (
              <div key={oi} className={`${o.cls} absolute`}>
                {o.items.map((m, i) => {
                  const a = (i / o.items.length) * Math.PI * 2;
                  return (
                    <div key={m.l} className="absolute" style={{ left: `${50 + 50 * Math.cos(a)}%`, top: `${50 + 50 * Math.sin(a)}%`, transform: "translate(-50%,-50%)" }}>
                      <div className="lp-chip flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-[#0b1120]/90 px-3 py-1.5 text-xs text-slate-200 shadow-lg backdrop-blur"><m.i className="h-3.5 w-3.5 text-sky-300" />{m.l}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Face ID + GPS (pinned story) ── */}
      <section id="attendance" className="fx-section relative scroll-mt-0 overflow-hidden py-20 lg:flex lg:h-screen lg:items-center lg:py-0">
        <div className="pointer-events-none absolute right-0 top-1/4 h-[30rem] w-[30rem] rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 lg:grid-cols-[1fr_auto_1fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">Attendance you can trust</p>
            <h2 className="mt-4 font-display text-4xl font-bold leading-tight tracking-tight lg:text-[2.75rem]">Face ID and GPS, in five seconds.</h2>
            <ol className="mt-8 space-y-5">
              {[["Look straight", "The camera finds one face and checks light, distance and position."], ["Turn your head", "A printed photo or a picture on a screen can’t turn — so it can’t pass."], ["Blink", "A natural blink confirms a live person."], ["Matched on the server", "128 numbers compared with the enrolled face, inside the office geofence."]].map(([t, d], i) => (
                <li key={t} className={`fx-step-${i} flex gap-4 transition ${i === 0 ? "opacity-100" : "opacity-35"}`}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 font-display text-sm font-semibold">{i + 1}</span>
                  <div><p className="font-semibold text-white">{t}</p><p className="text-[15px] text-slate-400">{d}</p></div>
                </li>
              ))}
            </ol>
          </div>
          <FacePhone />
          <div className="space-y-4">
            <GeoCard />
            <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-400">
              {[[MapPin, "Office geofence"], [Fingerprint, "Selfie on every punch"], [ShieldCheck, "Punch log for HR"]].map(([I, l]) => { const Icon = I as typeof MapPin; return <div key={l as string} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-2 py-3"><Icon className="mx-auto mb-1.5 h-4 w-4 text-emerald-300" />{l as string}</div>; })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Journey (horizontal) ── */}
      <section className="lp-journey relative overflow-hidden py-20 lg:flex lg:h-screen lg:flex-col lg:justify-center lg:py-0">
        <div className="mx-auto mb-10 w-full max-w-6xl px-5">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-300">The employee journey</p>
          <h2 className="mt-4 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">From first interview to final settlement.</h2>
        </div>
        <div className="lp-track flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-4 no-scrollbar lg:overflow-visible lg:pl-[max(1.25rem,calc((100vw-72rem)/2+1.25rem))]">
          {JOURNEY.map((j) => (
            <article key={j.n} className={`group relative flex h-[380px] w-[82vw] max-w-[420px] shrink-0 snap-center flex-col justify-between overflow-hidden rounded-[2rem] border border-white/[0.08] bg-gradient-to-br ${j.c} to-transparent p-8 sm:w-[420px]`}>
              <span className="pointer-events-none absolute -right-6 -top-10 font-display text-[11rem] font-bold leading-none text-white/[0.04]">{j.n}</span>
              <j.i className="h-12 w-12 text-white/90" strokeWidth={1.4} />
              <div>
                <p className="font-display text-sm text-slate-400">{j.n}</p>
                <h3 className="mt-1 font-display text-3xl font-bold">{j.t}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-slate-300">{j.d}</p>
              </div>
            </article>
          ))}
          <div className="w-1 shrink-0 lg:w-24" />
        </div>
      </section>

      {/* ── Payroll ── */}
      <section id="payroll" className="relative mx-auto max-w-6xl scroll-mt-24 px-5 py-24">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <p className="lp-reveal text-sm font-semibold uppercase tracking-[0.2em] text-violet-300">Payroll for Pakistan</p>
            <h2 className="lp-reveal mt-4 font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Four eyes on every rupee.</h2>
            <p className="lp-reveal mt-5 text-lg leading-relaxed text-slate-400">Salaried tax slabs, EOBI, provident fund, loans, overtime and absences are calculated for you. Then payroll moves through a maker-checker path no single person can skip.</p>
            <svg viewBox="0 0 420 120" className="pay-flow mt-10 w-full max-w-lg" aria-label="Calculate, HR approves, Finance approves, Finalize">
              <path className="pay-path" d="M30 60 H390" stroke="url(#pg)" strokeWidth="3" fill="none" pathLength={1} strokeDasharray="1" strokeLinecap="round" />
              <defs><linearGradient id="pg" x1="0" x2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#a78bfa" /></linearGradient></defs>
              {[["Calculate", 30], ["HR approves", 150], ["Finance approves", 270], ["Finalize", 390]].map(([l, x], i) => (
                <g key={l as string} className="pay-node" style={{ transformOrigin: `${x}px 60px` }}>
                  <circle cx={x as number} cy="60" r="16" fill="#0b1120" stroke={i === 3 ? "#34d399" : "#38bdf8"} strokeWidth="2.5" />
                  <text x={x as number} y="65" textAnchor="middle" fontSize="13" fill="white" fontWeight="700">{i + 1}</text>
                  <text x={x as number} y="102" textAnchor="middle" fontSize="12" fill="#94a3b8">{l as string}</text>
                </g>
              ))}
            </svg>
            <ul className="lp-stagger mt-8 grid gap-3 sm:grid-cols-2">
              {["Bank transfer CSV", "Payslip formula on every line", "Pre-payroll exception checks", "Final settlement & gratuity"].map((t) => <li key={t} className="flex items-center gap-2 text-[15px] text-slate-300"><BadgeCheck className="h-4 w-4 text-emerald-400" />{t}</li>)}
            </ul>
          </div>
          <div className="pay-slip relative mx-auto w-full max-w-md">
            <div className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-violet-500/30 to-sky-500/20 blur-2xl" />
            <div className="relative"><Payslip /></div>
          </div>
        </div>
      </section>

      {/* ── AI copilot ── */}
      <section id="ai" className="lp-ai relative scroll-mt-24 overflow-hidden py-24">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[30rem] w-[50rem] -translate-x-1/2 rounded-full bg-violet-600/15 blur-[140px]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 lg:grid-cols-2">
          <div className="order-2 lg:order-1"><CopilotMock key={role} role={role} /></div>
          <div className="order-1 lg:order-2">
            <p className="lp-reveal text-sm font-semibold uppercase tracking-[0.2em] text-violet-300">AI copilot</p>
            <h2 className="lp-reveal mt-4 font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Ask anything.<br /><span className="font-serif-accent font-normal italic text-slate-300">Only</span> see what you should.</h2>
            <p className="lp-reveal mt-5 text-lg leading-relaxed text-slate-400">Every answer is looked up with the asker’s own permissions. Owners get the whole company, managers their team, employees themselves — in English, Urdu or Roman Urdu.</p>
            <div className="mt-7 inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1" role="tablist" aria-label="Ask as">
              {(["owner", "manager", "employee"] as const).map((r) => (
                <button key={r} role="tab" aria-selected={role === r} onClick={() => setRole(r)} className={`cursor-pointer rounded-full px-4 py-2 text-sm font-medium capitalize transition ${role === r ? "bg-white text-slate-900" : "text-slate-400 hover:text-white"}`}>Ask as {r}</button>
              ))}
            </div>
            <ul className="lp-stagger mt-8 space-y-3 text-[15px] text-slate-300">
              {["Remembers the conversation for follow-up questions", "Copy, regenerate, like / dislike, edit and history", "Free models: Groq first, OpenRouter as backup", "Chats are private — not even the owner can read them"].map((t) => <li key={t} className="flex items-center gap-2"><Check className="h-4 w-4 text-violet-300" />{t}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Security & roles ── */}
      <section id="security" className="relative mx-auto max-w-6xl scroll-mt-24 px-5 py-24 text-center">
        <p className="lp-reveal text-sm font-semibold uppercase tracking-[0.2em] text-sky-300">Security by design</p>
        <h2 className="lp-reveal mx-auto mt-4 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">14 roles. Enforced by the database, not the screen.</h2>
        <div className="lp-roles relative mx-auto mt-14 flex max-w-4xl flex-wrap justify-center gap-2.5">
          {ROLES.map((r, i) => <span key={r} className={`lp-role rounded-full border px-4 py-2 text-sm ${i === 1 || i === 4 || i === 11 ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-white/10 bg-white/[0.03] text-slate-300"}`}>{r}</span>)}
        </div>
        <div className="lp-stagger mx-auto mt-16 grid max-w-5xl gap-px overflow-hidden rounded-[2rem] border border-white/[0.07] bg-white/[0.07] text-left sm:grid-cols-2 lg:grid-cols-4">
          {[[Lock, "Row-level security", "Every table checks who is asking. Salaries stay with the employee and pay roles."], [ShieldCheck, "Maker-checker", "Payroll, settlements and offers need a second person to approve."], [ScrollText, "Immutable audit log", "Every change, who made it and when. It can’t be edited."], [Users, "Company isolation", "Each company’s data is sealed off from every other company."]].map(([I, t, d]) => {
            const Icon = I as typeof Lock;
            return <div key={t as string} className="bg-[#05070d] p-7"><Icon className="h-6 w-6 text-sky-300" /><p className="mt-4 font-semibold text-white">{t as string}</p><p className="mt-1.5 text-sm leading-relaxed text-slate-400">{d as string}</p></div>;
          })}
        </div>
      </section>

      {/* ── Numbers ── */}
      <section className="border-y border-white/[0.06] py-16">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-10 px-5 text-center lg:grid-cols-5">
          {[[14, "", "roles with exact permissions"], [16, "", "connected modules"], [169, "", "automated database checks"], [5, " s", "Face ID clock-in"], [0, "", "ads or trackers"]].map(([n, s, l]) => (
            <div key={l as string}><p className="font-display text-5xl font-bold tracking-tight"><span className="lp-count" data-to={n as number}>{n as number}</span>{s as string}</p><p className="mt-2 text-sm text-slate-500">{l as string}</p></div>
          ))}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-5 py-24">
        <h2 className="lp-reveal text-center font-display text-4xl font-bold tracking-tight sm:text-5xl">Questions, answered.</h2>
        <div className="lp-stagger mt-12 divide-y divide-white/[0.07] border-y border-white/[0.07]">
          {FAQS.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-left text-[17px] font-medium text-white">{q}<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 transition group-open:rotate-45"><X className="h-4 w-4 rotate-45" /></span></summary>
              <p className="mt-3 pr-12 text-[15px] leading-relaxed text-slate-400">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative mx-auto max-w-6xl px-5 pb-24">
        <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-gradient-to-br from-sky-600/30 via-violet-700/25 to-[#05070d] px-6 py-20 text-center sm:px-16">
          <div className="lp-cta-orbit pointer-events-none absolute left-1/2 top-1/2 h-[46rem] w-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/10">
            {[Clock, Wallet, ScanFace, Bot, CalendarDays, Users].map((I, i) => { const a = (i / 6) * Math.PI * 2; return <span key={i} className="absolute flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-[#0b1120]" style={{ left: `${50 + 50 * Math.cos(a)}%`, top: `${50 + 50 * Math.sin(a)}%`, transform: "translate(-50%,-50%)" }}><I className="h-5 w-5 text-sky-300" /></span>; })}
          </div>
          <h2 className="relative mx-auto max-w-2xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-6xl">Your company, running itself by Monday.</h2>
          <p className="relative mx-auto mt-5 max-w-xl text-lg text-slate-300">Register with a 6-digit email code, set up your company in two minutes, invite your team.</p>
          <div className="relative"><HeroCta /></div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative border-t border-white/[0.06] pt-16">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo light />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">People, attendance, leave, payroll, talent and AI in one secure platform, built for companies in Pakistan.</p>
          </div>
          {[
            ["Product", [["Platform", "#platform"], ["Face ID & GPS", "#attendance"], ["Payroll", "#payroll"], ["AI Copilot", "#ai"], ["Security", "#security"]]],
            ["Get started", [["Register your company", "/signup"], ["Sign in", "/login"], ["Forgot password", "/forgot-password"], ["Verify a letter", "/verify"]]],
            ["Company", [["FAQ", "#faq"], ["Terms of Service", "/legal/terms"], ["Privacy Policy", "/legal/privacy"]]],
          ].map(([h, links]) => (
            <div key={h as string}>
              <p className="text-sm font-semibold text-white">{h as string}</p>
              <ul className="mt-4 space-y-2.5">{(links as [string, string][]).map(([l, href]) => (
                <li key={l}>{href.startsWith("#") ? <button onClick={() => scrollToId(href.slice(1))} className="cursor-pointer text-sm text-slate-400 transition hover:text-white">{l}</button> : <Link href={href} className="text-sm text-slate-400 transition hover:text-white">{l}</Link>}</li>
              ))}</ul>
            </div>
          ))}
        </div>
        <div className="lp-wordmark mx-auto mt-16 max-w-6xl overflow-hidden px-5">
          <p aria-hidden className="select-none whitespace-nowrap text-center font-display text-[13.5vw] font-bold leading-none tracking-[-0.06em] text-transparent [-webkit-text-stroke:1px_rgba(148,163,184,.18)] lg:text-[10.5rem]">{"HCM SUITE".split("").map((ch, i) => <span key={i} className="inline-block">{ch === " " ? " " : ch}</span>)}</p>
        </div>
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-6 text-xs text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} HCM Master Suite. All rights reserved.</p>
          <p className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />Made in Pakistan · Logixel Technologies</p>
        </div>
      </footer>
    </div>
  );
}
