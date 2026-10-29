"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, Pause, Play, Sparkles, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { can, type Role } from "@/lib/roles";
import type { Ctx as NavCtx } from "@/lib/nav";

/*
 * Guided tips. The first time someone opens the app they get a short welcome tour of the shell, and the first
 * time they open each page they get that page's tour. The rest of the screen is dimmed and blurred and the
 * thing being explained is spotlighted. Next / Back / Skip / Auto-play, arrow keys and Esc all work.
 * Steps whose target is not on screen (another role, mobile layout, empty page) are skipped automatically.
 * Seen tours are saved on the account; Settings → Guided tips turns them off or replays them.
 */
type Who = { role: Role | null; nav: NavCtx };
type Step = { sel?: string; title: string; body: string; show?: (w: Who) => boolean };
type TourDef = { title: string; steps: Step[] };

const hr = (w: Who) => can.hrStaff(w.role);
const pay = (w: Who) => can.viewPay(w.role);
const emp = (w: Who) => w.nav.hasEmployee;

export const TOURS: Record<string, TourDef> = {
  welcome: { title: "Welcome tour", steps: [
    { title: "Welcome to HCM Master Suite", body: "Your company’s people, attendance, leave, payroll and AI in one place. This 40-second tour shows you around. You can skip any time and replay it from Settings → Guided tips." },
    { sel: "[data-tour=sidebar]", title: "Main menu", body: "Every module you have access to. What you see depends on your role, so an employee and an HR manager see different menus." },
    { sel: "[data-tour=menu]", title: "Main menu", body: "Tap here to open every module you have access to. What you see depends on your role." },
    { sel: "[data-tour=company]", title: "Your company", body: "Shows the company you are working in and your role. If you belong to more than one company, switch here." },
    { sel: "[data-tour=search]", title: "Search anything", body: "Find people and pages instantly. Shortcut: Ctrl + K (⌘ K on Mac)." },
    { sel: "[data-tour=notifications]", title: "Notifications", body: "Approvals, leave decisions, payslips and announcements arrive here. Choose which ones you get in Settings → Notifications." },
    { sel: "[data-tour=privacy]", title: "Privacy mode", body: "Sharing your screen? One tap hides every salary and money amount. Tap again to show them." },
    { sel: "[data-tour=ask-ai]", title: "Ask AI", body: "Ask questions in plain English, Urdu or Roman Urdu: “How many leaves do I have?”, “Who is late today?”. It only uses data your role is allowed to see." },
    { sel: "[data-tour=account]", title: "Your account & settings", body: "Profile, appearance, notifications, security, AI preferences and help. You can replay these tips from here any time." },
  ] },
  dashboard: { title: "Dashboard", steps: [
    { title: "Your dashboard", body: "A live summary for your role. Employees see their day, managers see their team, HR and owners see the whole company." },
    { sel: "[data-tour=clock-card]", title: "Clock in and out", body: "Mark attendance here. Depending on your company’s rules it checks your GPS location and a quick Face ID scan.", show: emp },
    { sel: "[data-tour=dash-me]", title: "Your month at a glance", body: "Days present, your latest net pay and leave balances. Tap “Apply leave” to request time off.", show: emp },
    { sel: "[data-tour=dash-team]", title: "Your team today", body: "Who is present, late or on leave right now. Open the team board for details." },
    { sel: "[data-tour=dash-company]", title: "Company overview", body: "Headcount, attendance trend, open positions and attrition, plus things that need attention like expiring documents.", show: hr },
    { sel: "[data-tour=dash-payroll]", title: "Payroll", body: "The latest payroll run and the cost trend. Amounts follow privacy mode.", show: pay },
    { sel: "[data-tour=dash-news]", title: "Announcements", body: "Company news. Some announcements ask you to acknowledge them." },
  ] },
  approvals: { title: "Approvals", steps: [
    { sel: "[data-tour=page-header]", title: "Approvals inbox", body: "Everything waiting for your decision in one list: leave, attendance corrections, overtime, expenses, loans, hiring and payroll." },
    { sel: "[data-tour=tabs]", title: "Filter by type", body: "Narrow the list to one kind of request. The numbers show how many are waiting." },
    { sel: "[data-tour=table]", title: "Approve or reject", body: "Open a request to see the details, then approve or reject with an optional note. The employee is notified straight away." },
  ] },
  people: { title: "People", steps: [
    { sel: "[data-tour=page-header]", title: "People directory", body: "Everyone in the company you are allowed to see, with search and filters." },
    { sel: "[data-tour=page-actions]", title: "Add and import", body: "HR can add an employee here. Ticking “Invite to the app” emails them a sign-in link.", show: hr },
    { sel: "[data-tour=tabs]", title: "Directory or org chart", body: "Switch to the org chart to see who reports to whom." },
    { sel: "[data-tour=table]", title: "Open a profile", body: "Click a person for their job, documents, leave, attendance and (if your role allows) salary history." },
  ] },
  person: { title: "Employee profile", steps: [
    { sel: "[data-tour=page-header]", title: "Employee profile", body: "One page for this person: job details, manager, documents, leave, attendance and history." },
    { sel: "[data-tour=tabs]", title: "Sections", body: "Switch between overview, job and pay history, documents, leave and attendance. Private details and salary only show for roles allowed to see them." },
    { sel: "[data-tour=page-actions]", title: "Actions", body: "Edit details, issue letters, invite them to the app or start offboarding, depending on your role." },
  ] },
  attendance: { title: "Attendance", steps: [
    { sel: "[data-tour=page-header]", title: "Attendance", body: "Clock in and out, see your history, and request corrections or overtime." },
    { sel: "[data-tour=clock-card]", title: "Clock in with GPS and Face ID", body: "Your company decides the rule: office geofence, field GPS or remote, with or without Face ID. The card shows which rule applies to you.", show: emp },
    { sel: "[data-tour=tabs]", title: "Views", body: "HR sees GPS & Face ID rules, the punch log, the attendance board and shift roster. Employees see their own records and requests." },
    { sel: "[data-tour=page-actions]", title: "Requests", body: "Forgot to clock out or worked late? Request a correction or overtime here; your manager approves it." },
  ] },
  leave: { title: "Leave", steps: [
    { sel: "[data-tour=page-header]", title: "Leave", body: "Apply for leave, see balances and track approvals." },
    { sel: "[data-tour=page-actions]", title: "Apply for leave", body: "Pick the type and dates. Weekends, holidays and half days are counted for you, and your manager is notified." },
    { sel: "[data-tour=tabs]", title: "Requests and calendar", body: "Filter by status, and managers or HR can see the team calendar to plan cover." },
  ] },
  payroll: { title: "Payroll", steps: [
    { sel: "[data-tour=page-header]", title: "Payroll", body: "Run monthly payroll with Pakistan tax slabs, EOBI, provident fund, loans and overtime calculated for you." },
    { sel: "[data-tour=page-actions]", title: "Start a run", body: "Calculate, check exceptions, then send for approval. HR approves, then Finance (a different person), then you finalize and publish payslips." },
    { sel: "[data-tour=tabs]", title: "Run steps", body: "Follow each run through Calculated → HR approved → Finance approved → Finalized." },
    { sel: "[data-tour=table]", title: "Every payslip line explained", body: "Open an employee to see each line with its formula. Export the bank transfer file when finalized." },
  ] },
  payslips: { title: "My payslips", steps: [
    { sel: "[data-tour=page-header]", title: "Your payslips", body: "Every published payslip, with each line explained. Download or print any month." },
  ] },
  expenses: { title: "Expenses & loans", steps: [
    { sel: "[data-tour=page-header]", title: "Expenses & loans", body: "Claim expenses with a receipt photo, and request loans or salary advances." },
    { sel: "[data-tour=page-actions]", title: "New claim", body: "Over-policy amounts are flagged automatically. Approved claims are paid with the next payroll." },
    { sel: "[data-tour=tabs]", title: "Track status", body: "Pending → manager approved → approved → reimbursed." },
  ] },
  recruitment: { title: "Recruitment", steps: [
    { sel: "[data-tour=page-header]", title: "Recruitment", body: "Open positions, a public careers page and a candidate pipeline with explainable match scores." },
    { sel: "[data-tour=page-actions]", title: "New requisition", body: "Request a hire; once approved it can be published on your careers page." },
    { sel: "[data-tour=tabs]", title: "Pipeline and requisitions", body: "Drag candidates through stages, schedule interviews, collect scorecards and send offers. Hire in one click." },
  ] },
  lifecycle: { title: "On & offboarding", steps: [
    { sel: "[data-tour=page-header]", title: "On & offboarding", body: "Checklists for new joiners and leavers, with tasks for HR, IT, Admin, Finance and the manager." },
    { sel: "[data-tour=tabs]", title: "Checklists and separations", body: "Track resignations, exit interviews and the final settlement (salary, leave encashment, gratuity, loans)." },
  ] },
  performance: { title: "Performance", steps: [
    { sel: "[data-tour=page-header]", title: "Performance", body: "Goals with key results, review cycles and continuous feedback." },
    { sel: "[data-tour=tabs]", title: "Goals, reviews, feedback", body: "Set and update your goals, complete self and manager reviews, and give feedback any time." },
    { sel: "[data-tour=page-actions]", title: "New goal", body: "Add a goal with measurable key results; progress updates as you check them in." },
  ] },
  learning: { title: "Learning", steps: [
    { sel: "[data-tour=page-header]", title: "Learning", body: "Courses, mandatory training and certificates in one place." },
    { sel: "[data-tour=tabs]", title: "Your courses and compliance", body: "Finish assigned courses; HR tracks completion and expiring certifications." },
  ] },
  engagement: { title: "Engagement", steps: [
    { sel: "[data-tour=page-header]", title: "Engagement", body: "Announcements, a kudos wall and anonymous pulse surveys." },
    { sel: "[data-tour=tabs]", title: "Share and recognise", body: "Give kudos to a colleague or answer a survey. Survey results stay anonymous and only show with 5 or more answers." },
  ] },
  helpdesk: { title: "Helpdesk", steps: [
    { sel: "[data-tour=page-header]", title: "HR helpdesk", body: "Ask HR anything with a ticket, or find the answer in the knowledge base." },
    { sel: "[data-tour=page-actions]", title: "New ticket", body: "Pick a category and priority; you’ll see the response time (SLA) and get notified on replies." },
    { sel: "[data-tour=tabs]", title: "Tickets and knowledge base", body: "Track your tickets. HR works the queue from here." },
  ] },
  documents: { title: "Documents & assets", steps: [
    { sel: "[data-tour=page-header]", title: "Documents & assets", body: "Your documents vault, company assets and HR letters with a public verification code." },
    { sel: "[data-tour=tabs]", title: "Views", body: "See your documents, expiring documents (HR) and issued letters." },
  ] },
  analytics: { title: "People analytics", steps: [
    { sel: "[data-tour=page-header]", title: "People analytics", body: "Headcount, hires and exits, attrition, tenure, leave and payroll cost by department, plus explainable flight-risk signals." },
    { sel: "[data-tour=tabs]", title: "Change the view", body: "Switch between headcount, hires and exits trends." },
  ] },
  users: { title: "Users & roles", steps: [
    { sel: "[data-tour=page-header]", title: "Users & roles", body: "Who can sign in, with which of the 14 roles, and in which scope." },
    { sel: "[data-tour=page-actions]", title: "Invite a user", body: "Invite by email with a role. They get an email from your domain to set their password." },
    { sel: "[data-tour=tabs]", title: "Members, invites, custom roles", body: "Change roles, resend invites, and create custom roles that hide modules for some people." },
  ] },
  audit: { title: "Audit log", steps: [
    { sel: "[data-tour=page-header]", title: "Audit log", body: "Every change, who made it and when. It cannot be edited or deleted." },
    { sel: "[data-tour=table]", title: "Inspect a change", body: "Open a row to see exactly which fields changed, before and after." },
  ] },
  settings: { title: "Company settings", steps: [
    { sel: "[data-tour=page-header]", title: "Company settings", body: "Set up your company once: profile, branches with GPS, departments, grades, leave policy, payroll rules and more." },
    { sel: "[data-tour=tabs]", title: "Sections", body: "Each tab is one part of your setup. Changes apply to everyone in the company." },
  ] },
  account: { title: "Your settings", steps: [
    { sel: "[data-tour=account-card]", title: "Your settings", body: "Personal settings that follow you on every device: appearance, notifications, security, AI and more." },
    { sel: "[data-tour=account-search]", title: "Find any setting", body: "Type to jump straight to a setting." },
    { sel: "[data-tour=account-tips]", title: "Guided tips", body: "Turn these tips off, or replay them for any page, here." },
  ] },
};

export function tourKeyFor(path: string): string | null {
  if (path === "/dashboard") return "dashboard";
  if (/^\/people\/[^/]+$/.test(path)) return "person";
  if (path === "/account") return "account";
  const k = path.split("/")[1];
  return k && TOURS[k] && path === `/${k}` ? k : null;
}

const SEEN = "hcm-tours-seen";
const localSeen = () => { try { return new Set<string>(JSON.parse(sessionStorage.getItem(SEEN) ?? "[]")); } catch { return new Set<string>(); } };
const markLocal = (keys: string[]) => { try { const s = localSeen(); keys.forEach((k) => s.add(k)); sessionStorage.setItem(SEEN, JSON.stringify([...s])); } catch { /* private mode */ } };

/** Replay the tour of the current page (or a given tour) from anywhere. */
export function startTour(key?: string) { window.dispatchEvent(new CustomEvent("hcm:tour", { detail: key })); }

function find(sel?: string): HTMLElement | null {
  if (!sel) return null;
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}
const blocked = () => !!document.querySelector("[data-copilot], [role=dialog][aria-modal=true]:not([data-tour-card])");

export function Tour() {
  const path = usePathname();
  const { ctx, navCtx } = useAuth();
  const { prefs, setPref } = usePrefs();
  const [run, setRun] = useState<{ key: string; steps: Step[]; chain?: string } | null>(null);
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vw, setVw] = useState(1280), [vh, setVh] = useState(800);
  const cardRef = useRef<HTMLDivElement>(null);
  const who: Who = { role: ctx?.role ?? null, nav: navCtx };
  const seen = (k: string) => !!prefs.tours[k] || !!prefs.tours.all || localSeen().has(k);

  const build = useCallback((key: string) => (TOURS[key]?.steps ?? []).filter((s) => (!s.show || s.show(who)) && (!s.sel || find(s.sel))), [who.role, navCtx]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback((key: string, force = false) => {
    if (!force && (prefs.toursOff || seen(key))) return false;
    if (blocked()) return false;
    const steps = build(key);
    if (!steps.length) return false;
    const page = tourKeyFor(location.pathname);
    setRun({ key, steps, chain: key === "welcome" && page && !seen(page) && !prefs.toursOff ? page : undefined });
    setI(0); setAuto(false);
    return true;
  }, [prefs.toursOff, prefs.tours, build]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start: welcome tour on the first visit, then each page's tour the first time it is opened.
  useEffect(() => {
    if (!ctx?.tenant || run) return;
    let tries = 0, alive = true;
    const go = () => {
      if (!alive) return;
      const page = tourKeyFor(path);
      const key = !seen("welcome") ? "welcome" : page;
      if (!key) return;
      // Wait until the page has rendered the things the tour points at.
      const ready = !TOURS[key].steps.some((s) => s.sel) || TOURS[key].steps.some((s) => s.sel && find(s.sel));
      if ((!ready || blocked()) && tries++ < 12) { setTimeout(go, 400); return; }
      start(key);
    };
    const t = setTimeout(go, 900);
    return () => { alive = false; clearTimeout(t); };
  }, [path, ctx?.tenant, prefs.toursOff]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: Event) => { const k = (e as CustomEvent<string | undefined>).detail ?? tourKeyFor(location.pathname) ?? "welcome"; start(k, true); };
    window.addEventListener("hcm:tour", h);
    return () => window.removeEventListener("hcm:tour", h);
  }, [start]);

  const step = run?.steps[i];
  const measure = useCallback(() => {
    setVw(window.innerWidth); setVh(window.innerHeight);
    const el = find(step?.sel);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    if (!step) return;
    const el = find(step.sel);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 60) el.scrollIntoView({ block: r.height > window.innerHeight * 0.6 ? "start" : "center", behavior: document.documentElement.classList.contains("reduce-motion") ? "auto" : "smooth" });
    }
    measure();
    const t1 = setTimeout(measure, 250), t2 = setTimeout(measure, 600);
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step, measure]);
  useEffect(() => { if (run) cardRef.current?.focus({ preventScroll: true }); }, [run, i]);

  const finish = useCallback((all = false) => {
    if (!run) return;
    const keys = all ? Object.keys(TOURS) : [run.key];
    markLocal(keys);
    const next = !all ? run.chain : undefined;
    setRun(null); setAuto(false);
    if (all) setPref("toursOff", true).catch(() => undefined);
    else setPref(`tours.${run.key}`, true).catch(() => undefined);
    if (next) setTimeout(() => start(next), 450);
  }, [run, setPref, start]);

  const nextStep = useCallback(() => { if (!run) return; if (i + 1 < run.steps.length) setI(i + 1); else finish(); }, [run, i, finish]);

  // Auto-play: moves on every 6 seconds.
  useEffect(() => {
    if (!run || !auto) return;
    const t = setTimeout(nextStep, 6000);
    return () => clearTimeout(t);
  }, [run, auto, i, nextStep]);

  useEffect(() => {
    if (!run) return;
    const kd = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); nextStep(); }
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, [run, finish, nextStep]);

  if (!run || !step || typeof document === "undefined") return null;
  const last = i === run.steps.length - 1, pad = 8;
  const w = Math.min(360, vw - 24);
  const r = rect;
  let pos: React.CSSProperties, place: "below" | "above" | "right" | "center" = "center";
  if (!r) pos = { left: (vw - w) / 2, top: "50%", transform: "translateY(-50%)", width: w };
  else {
    const below = vh - r.bottom, above = r.top, right = vw - r.right;
    if (r.height > vh * 0.55 && right > w + 40) { place = "right"; pos = { left: r.right + pad + 14, top: Math.min(Math.max(16, r.top), vh - 260), width: w }; }
    else {
      const left = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2));
      if (below >= 240 || below >= above) { place = "below"; pos = { left, top: Math.min(r.bottom + pad + 14, vh - 250), width: w }; }
      else { place = "above"; pos = { left, bottom: Math.min(vh - r.top + pad + 14, vh - 90), width: w }; }
    }
  }
  const hole = r ? { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), w: r.width + pad * 2, h: r.height + pad * 2 } : null;
  const panel = "fixed bg-slate-950/50 backdrop-blur-[3px] transition-all duration-300";
  const arrowLeft = r && (place === "below" || place === "above") ? Math.max(18, Math.min(w - 18, r.left + r.width / 2 - (pos.left as number))) : 0;

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="presentation" data-testid="tour">
      {hole ? (
        <>
          <div className={panel} style={{ left: 0, top: 0, width: "100%", height: hole.y }} />
          <div className={panel} style={{ left: 0, top: hole.y + hole.h, width: "100%", bottom: 0 }} />
          <div className={panel} style={{ left: 0, top: hole.y, width: hole.x, height: hole.h }} />
          <div className={panel} style={{ left: hole.x + hole.w, top: hole.y, right: 0, height: hole.h }} />
          <div className="pointer-events-none fixed rounded-2xl ring-2 ring-brand-400 ring-offset-2 ring-offset-transparent transition-all duration-300" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h, boxShadow: "0 0 0 6px color-mix(in oklab, var(--brand-400) 25%, transparent)" }}>
            <span className="absolute inset-0 animate-ping rounded-2xl ring-2 ring-brand-400/40" style={{ animationDuration: "2.4s" }} />
          </div>
        </>
      ) : <div className={`${panel} inset-0`} />}

      <div ref={cardRef} key={`${run.key}-${i}`} tabIndex={-1} role="dialog" aria-modal="true" data-tour-card aria-labelledby="tour-title" aria-describedby="tour-body"
        className="fixed rounded-3xl border border-white/10 bg-surface p-5 shadow-[0_30px_80px_-20px_rgba(2,6,23,.55)] outline-none animate-fade-up" style={pos}>
        {r && place === "below" && <span className="absolute -top-2 h-4 w-4 rotate-45 rounded-sm border-l border-t border-white/10 bg-surface" style={{ left: arrowLeft - 8 }} />}
        {r && place === "above" && <span className="absolute -bottom-2 h-4 w-4 rotate-45 rounded-sm border-b border-r border-white/10 bg-surface" style={{ left: arrowLeft - 8 }} />}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"><Sparkles className="h-3 w-3" />{TOURS[run.key]?.title} · {i + 1} of {run.steps.length}</span>
          <button onClick={() => finish()} className="cursor-pointer rounded-lg p-1 text-ink-soft transition hover:bg-surface-muted hover:text-ink" aria-label="Skip tour"><X className="h-4 w-4" /></button>
        </div>
        <h3 id="tour-title" className="mt-3 font-display text-lg font-bold text-ink">{step.title}</h3>
        <p id="tour-body" className="mt-1.5 text-sm leading-relaxed text-ink-soft">{step.body}</p>
        {auto && <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-muted"><div key={i} className="h-full rounded-full bg-brand-500" style={{ animation: "tour-progress 6s linear forwards" }} /></div>}
        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>{run.steps.map((_, j) => <i key={j} className={`h-1.5 rounded-full transition-all ${j === i ? "w-5 bg-brand-500" : j < i ? "w-1.5 bg-brand-300" : "w-1.5 bg-line"}`} />)}</div>
          <button onClick={() => setAuto((a) => !a)} className="cursor-pointer rounded-xl p-2 text-ink-soft transition hover:bg-surface-muted hover:text-ink" aria-label={auto ? "Pause auto-play" : "Auto-play"} title={auto ? "Pause" : "Auto-play"}>{auto ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
          {i > 0 && <button onClick={() => setI(i - 1)} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-xl px-3 text-sm font-medium text-ink-soft transition hover:bg-surface-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Back</button>}
          <button onClick={nextStep} className="brand-gradient inline-flex h-9 cursor-pointer items-center gap-1 rounded-xl px-4 text-sm font-semibold text-white shadow-sm">{last ? "Got it" : "Next"}{!last && <ArrowRight className="h-4 w-4" />}</button>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <button onClick={() => finish()} className="cursor-pointer font-medium text-ink-soft hover:text-ink">Skip</button>
          {i === 0 && <button onClick={() => finish(true)} className="cursor-pointer text-ink-soft hover:text-ink">Turn off all tips</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
