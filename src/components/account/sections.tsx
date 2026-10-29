"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowUp, Bell, Bot, Check, Compass, Download, Gauge, Keyboard, Laptop, LifeBuoy, Loader2, LogOut, Play, Plus, RefreshCw, Trash2, Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Input } from "@/components/ui";
import { AccentPicker, ThemeToggle } from "@/components/theme-controls";
import { KV, Panel, PrefSegment, PrefSelect, PrefSwitch, SettingsHeader, Toggle } from "./ui";
import { APP_VERSION } from "./search-index";
import { TOURS, startTour } from "@/components/tour";
import { useAuth } from "@/lib/auth";
import { DASH_SECTIONS, NOTIF_TYPES, usePrefs } from "@/lib/prefs";
import { navFor } from "@/lib/nav";
import { ROLE_INFO } from "@/lib/roles";
import { q, rpc } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { ago, fmtDate, fmtDateTime, longDate, money } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ── Profile ─────────────────────────────────────────────────────────────── */
export function ProfileSection() {
  const { ctx, refresh } = useAuth();
  const [f, setF] = useState({ full_name: ctx?.full_name ?? "", phone: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { q<{ full_name: string | null; phone: string | null }>((sb) => sb.from("profiles").select("full_name, phone").eq("id", ctx!.user_id).single()).then((p) => setF({ full_name: p.full_name ?? "", phone: p.phone ?? "" })).catch(() => undefined); }, [ctx?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    setBusy(true);
    try { await q((sb) => sb.from("profiles").update({ full_name: f.full_name.trim() || null, phone: f.phone.trim() || null }).eq("id", ctx!.user_id)); await refresh(); toast.success("Profile saved"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <SettingsHeader title="Profile" sub="How you appear across HCM Master Suite" />
      <div className="space-y-4">
        <Panel title="Your details">
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink">Display name</span><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink">Phone</span><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+92 3xx xxxxxxx" /></label>
          <KV rows={[["Email", ctx?.email ?? "—"], ["Company", ctx?.tenant?.name ?? "—"], ["Role", ctx?.role ? ROLE_INFO[ctx.role].label : "—"], ["Employee code", ctx?.employee?.code ?? "No employee record"]]} />
          <Button onClick={save} loading={busy}>Save</Button>
        </Panel>
        {ctx?.employee && <p className="text-sm text-ink-soft">Job title, department, bank and CNIC details are kept on your <Link href={`/people/${ctx.employee.id}`} className="font-medium text-brand-600">employee record</Link>; HR updates the official ones.</p>}
      </div>
    </>
  );
}

/* ── General ─────────────────────────────────────────────────────────────── */
export function GeneralSection() {
  const { prefs, setPref } = usePrefs();
  const { navCtx } = useAuth();
  const pages = navFor(navCtx).filter((n) => !["/platform"].includes(n.href)).map((n) => [n.href, n.label] as [string, string]);
  const sample = new Date();
  const order = prefs.dashboard.order;
  const move = async (k: string, dir: -1 | 1) => {
    const i = order.indexOf(k), j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]];
    try { await setPref("dashboard.order", next); } catch (e) { toast.error((e as Error).message); }
  };
  const toggleHidden = async (k: string, show: boolean) => {
    const h = show ? prefs.dashboard.hidden.filter((x) => x !== k) : [...prefs.dashboard.hidden, k];
    try { await setPref("dashboard.hidden", h); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <>
      <SettingsHeader title="General" sub="Saved to your account, so it follows you to every device" />
      <div className="space-y-4">
        <Panel id="appearance" title="Appearance">
          <div><p className="mb-2 text-sm font-medium text-ink">Theme</p><ThemeToggle /></div>
          <div><p className="mb-2 text-sm font-medium text-ink">Accent colour</p><AccentPicker /></div>
          <PrefSegment k="textSize" label="Text size" value={prefs.textSize} options={[["small", "Small"], ["default", "Default"], ["large", "Large"]]} />
          <PrefSegment k="density" label="Density" value={prefs.density} options={[["comfortable", "Comfortable"], ["compact", "Compact"]]} />
        </Panel>
        <Panel id="privacy" title="Privacy mode" sub="Handy when you share your screen or work in public.">
          <PrefSwitch k="hideMoney" label="Hide money amounts" sub="Salaries, payslips and payroll show as PKR •••••• until you turn this off. Also available from the eye icon at the top." value={prefs.hideMoney} />
          <p className="rounded-2xl bg-surface-muted px-4 py-3 text-sm text-ink-soft">Preview: <span className="font-semibold text-ink">{money(135000)}</span></p>
        </Panel>
        <Panel id="region" title="Date & time">
          <PrefSelect k="dateFormat" label="Date format" value={prefs.dateFormat} options={[["long", "25 Oct 2026"], ["dmy", "25/10/2026"], ["mdy", "10/25/2026"], ["iso", "2026-10-25"]]} hint={`Today shows as ${longDate(sample)}`} />
          <PrefSegment k="timeFormat" label="Time format" value={prefs.timeFormat} options={[["12h", "12-hour (2:30 PM)"], ["24h", "24-hour (14:30)"]]} />
          <p className="text-xs text-ink-soft">Your company’s time zone is {useAuth().ctx?.tenant?.timezone ?? "Asia/Karachi"}; attendance is always recorded in it.</p>
        </Panel>
        <Panel id="layout" title="Layout">
          <PrefSelect k="startPage" label="Open this page after sign-in" value={prefs.startPage} options={pages.length ? pages : [["/dashboard", "Dashboard"]]} />
          <PrefSegment k="sidebar" label="Sidebar" value={prefs.sidebar} options={[["remember", "Remember last"], ["expanded", "Always expanded"], ["collapsed", "Always collapsed"]]} />
          <PrefSegment k="motion" label="Animations" value={prefs.motion} options={[["system", "Follow device"], ["full", "On"], ["reduce", "Reduce motion"]]} />
          <PrefSwitch k="shortcuts" label="Keyboard shortcuts" sub="Ctrl K search, G then D for dashboard, ? for help" value={prefs.shortcuts} />
        </Panel>
        <Panel id="dashboard" title="Dashboard sections" sub="Choose what your dashboard shows, and in which order. Sections your role cannot see never appear.">
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {order.map((k, i) => {
              const s = DASH_SECTIONS.find((x) => x.key === k)!;
              const shown = !prefs.dashboard.hidden.includes(k);
              return (
                <li key={k} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-ink-soft">{i + 1}</span>
                  <span className={cn("flex-1 text-sm", shown ? "text-ink" : "text-ink-soft line-through")}>{s.label}</span>
                  <button onClick={() => move(k, -1)} disabled={i === 0} className="cursor-pointer rounded-lg p-1.5 text-ink-soft hover:text-ink disabled:opacity-30" aria-label={`Move ${s.label} up`}><ArrowUp className="h-4 w-4" /></button>
                  <button onClick={() => move(k, 1)} disabled={i === order.length - 1} className="cursor-pointer rounded-lg p-1.5 text-ink-soft hover:text-ink disabled:opacity-30" aria-label={`Move ${s.label} down`}><ArrowDown className="h-4 w-4" /></button>
                  <Toggle label={`Show ${s.label}`} checked={shown} onChange={(v) => toggleHidden(k, v)} />
                </li>
              );
            })}
          </ul>
          <Button variant="ghost" size="sm" onClick={() => setPref("dashboard", { order: DASH_SECTIONS.map((x) => x.key), hidden: [] })}><RefreshCw className="h-4 w-4" />Reset to default</Button>
        </Panel>
      </div>
    </>
  );
}

/* ── Notifications ───────────────────────────────────────────────────────── */
export function NotificationsSection() {
  const { prefs, setPref } = usePrefs();
  const [perm, setPerm] = useState<string>(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  async function desktop(v: boolean) {
    if (v && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await Notification.requestPermission(); setPerm(p);
      if (p !== "granted") { toast.error("Your browser blocked notifications. Allow them in the address bar, then try again."); return; }
    }
    await setPref("desktop", v);
    if (v) new Notification("Desktop notifications are on", { body: "You’ll see new approvals and updates here when HCM Master Suite is in the background.", icon: "/icon.svg" });
  }
  function beep() { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.08, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.35); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.35); } catch { /* blocked */ } }
  return (
    <>
      <SettingsHeader title="Notifications" sub="Choose what reaches your bell, and how" />
      <div className="space-y-4">
        <Panel title="Notify me about">
          {NOTIF_TYPES.map((n) => <PrefSwitch key={n.key} k={`notif.${n.key}`} label={n.label} sub={n.sub} value={"locked" in n && n.locked ? true : prefs.notif[n.key] !== false} disabled={"locked" in n && n.locked} />)}
          <p className="text-xs text-ink-soft">Muted types are not delivered at all. Your manager and HR still see your requests as usual.</p>
        </Panel>
        <Panel id="channels" title="How you’re told">
          <div className="flex items-center justify-between gap-4">
            <div><p className="flex items-center gap-2 text-sm font-medium text-ink"><Laptop className="h-4 w-4 text-ink-soft" />Desktop notifications</p><p className="text-xs text-ink-soft">{perm === "unsupported" ? "This browser does not support them." : perm === "denied" ? "Blocked by your browser. Allow notifications for this site in the address bar." : "A pop-up from your browser when something new arrives and the app is in the background."}</p></div>
            <Toggle label="Desktop notifications" checked={prefs.desktop && perm === "granted"} disabled={perm === "unsupported"} onChange={(v) => desktop(v).catch((e) => toast.error((e as Error).message))} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div><p className="flex items-center gap-2 text-sm font-medium text-ink"><Volume2 className="h-4 w-4 text-ink-soft" />Sound</p><p className="text-xs text-ink-soft">A short chime for new notifications. <button onClick={beep} className="cursor-pointer font-medium text-brand-600">Play</button></p></div>
            <Toggle label="Sound" checked={prefs.sound} onChange={(v) => setPref("sound", v)} />
          </div>
          <p className="flex items-center gap-2 text-xs text-ink-soft"><Bell className="h-3.5 w-3.5" />The bell at the top always keeps the full list.</p>
        </Panel>
        <Panel id="quiet" title="Quiet hours" sub="No sound or desktop pop-ups during these hours. Notifications still wait in your bell.">
          <PrefSwitch k="quiet.on" label="Quiet hours" value={prefs.quiet.on} />
          <div className="grid grid-cols-2 gap-3">
            {(["from", "to"] as const).map((x) => (
              <label key={x} className="block"><span className="mb-1.5 block text-sm font-medium capitalize text-ink">{x}</span>
                <input type="time" value={prefs.quiet[x]} disabled={!prefs.quiet.on} onChange={(e) => setPref(`quiet.${x}`, e.target.value)} className="h-11 w-full rounded-2xl border border-line bg-surface px-3 text-sm text-ink disabled:opacity-50" /></label>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

/* ── Security ────────────────────────────────────────────────────────────── */
export function SecuritySection() {
  const { ctx, refresh, signOut } = useAuth();
  const router = useRouter();
  const [user, setUser] = useState<{ created_at?: string; last_sign_in_at?: string; email_confirmed_at?: string; identities?: { provider: string }[] } | null>(null);
  const [pwd, setPwd] = useState(""), [pwd2, setPwd2] = useState(""), [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { supabase().auth.getUser().then(({ data }) => setUser(data.user as typeof user)); }, []);
  const providers = [...new Set((user?.identities ?? []).map((i) => i.provider))];
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const device = /iPhone|iPad/.test(ua) ? "iPhone / iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "This device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  async function changePassword() {
    if (pwd.length < 8) return toast.error("Use at least 8 characters");
    if (pwd !== pwd2) return toast.error("The two passwords don’t match");
    setBusy("pwd");
    const { error } = await supabase().auth.updateUser({ password: pwd });
    setBusy(null);
    if (error) return toast.error(error.message);
    setPwd(""); setPwd2(""); toast.success("Password changed");
  }
  async function signOutOthers() {
    setBusy("others");
    const { error } = await supabase().auth.signOut({ scope: "others" });
    setBusy(null);
    if (error) toast.error(error.message); else toast.success("Signed out on every other device");
  }
  async function signOutAll() { setBusy("all"); await supabase().auth.signOut({ scope: "global" }); await signOut(); router.replace("/login"); }
  return (
    <>
      <SettingsHeader title="Security" sub="Keep your account safe" />
      <div className="space-y-4">
        <Panel title="Sign-in">
          <KV rows={[
            ["Email", <span key="e" className="inline-flex items-center gap-2">{ctx?.email}{user?.email_confirmed_at && <Badge tone="green"><Check className="h-3 w-3" />Verified</Badge>}</span>],
            ["Sign-in methods", [providers.includes("email") || !providers.length ? "Password" : null, "Email code", providers.includes("google") ? "Google" : null].filter(Boolean).join(" · ")],
            ["Last sign-in", user?.last_sign_in_at ? fmtDateTime(user.last_sign_in_at) : "—"],
            ["Account created", user?.created_at ? fmtDate(user.created_at) : "—"],
          ]} />
          <p className="text-xs text-ink-soft">You can always sign in with a 6-digit code sent to your email, even without your password.</p>
        </Panel>
        <Panel id="password" title="Change password">
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink">New password</span><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink">Repeat new password</span><Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} autoComplete="new-password" /></label>
          <Button onClick={changePassword} loading={busy === "pwd"} disabled={!pwd}>Change password</Button>
        </Panel>
        <Panel id="devices" title="Devices" sub="Lost a phone or used a shared computer? Sign out everywhere else.">
          <div className="flex items-center gap-3 rounded-2xl bg-surface-muted px-4 py-3"><Laptop className="h-5 w-5 text-ink-soft" /><div className="flex-1"><p className="text-sm font-medium text-ink">{browser} on {device}</p><p className="text-xs text-ink-soft">This device · active now</p></div><Badge tone="green">You</Badge></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={signOutOthers} loading={busy === "others"}>Sign out other devices</Button>
            <Button variant="danger" onClick={signOutAll} loading={busy === "all"}><LogOut className="h-4 w-4" />Sign out everywhere</Button>
          </div>
        </Panel>
        <Panel id="companies" title="Your companies" sub="Companies you belong to and your role in each.">
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {(ctx?.companies ?? []).map((c) => (
              <li key={c.tenant_id} className="flex items-center gap-3 px-4 py-3">
                <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold text-white">{c.name[0]}</span>
                <div className="flex-1"><p className="text-sm font-medium text-ink">{c.name}</p><p className="text-xs text-ink-soft">{ROLE_INFO[c.role]?.label ?? c.role}</p></div>
                {c.tenant_id === ctx?.tenant?.id ? <Badge tone="brand">Current</Badge> : <Button size="sm" variant="ghost" onClick={async () => { await rpc("switch_company", { p_tenant: c.tenant_id }); await refresh(); router.push("/dashboard"); }}>Switch</Button>}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

/* ── AI & Copilot ────────────────────────────────────────────────────────── */
const AI_RULES = [
  "The copilot only sees what your role can see. Every lookup runs with your own permissions, checked by the database.",
  "Owners and HR get answers about the whole company; managers about their team; employees about themselves.",
  "It never invents numbers, names or policies. If data is missing or outside your access, it says so.",
  "It can submit a leave request for you, and only after you confirm the details in the chat. It never approves, pays or deletes anything.",
  "Chats are private to you. Not even your company owner can read them.",
];
export function AiSection() {
  const { prefs, setPref } = usePrefs();
  const [fact, setFact] = useState("");
  const { data: status } = useQuery({ queryKey: ["ai-status"], queryFn: () => fetch("/api/copilot").then((r) => r.json() as Promise<{ ai: boolean; providers: { name: string; models: string[] }[] }>) });
  const { data: count = 0, refetch } = useQuery({ queryKey: ["ai-chats-count"], queryFn: async () => { const { count } = await supabase().from("ai_conversations").select("id", { count: "exact", head: true }); return count ?? 0; } });
  async function addFact() {
    const v = fact.trim(); if (!v) return;
    await setPref("ai.memory", [...prefs.ai.memory, v].slice(-20)); setFact("");
  }
  return (
    <>
      <SettingsHeader title="AI & Copilot" sub="How the AI copilot answers you" />
      <div className="space-y-4">
        <Panel title="Answers">
          <PrefSegment k="ai.style" label="Answer style" value={prefs.ai.style} options={[["concise", "Short & direct"], ["detailed", "Detailed"]]} />
          <PrefSelect k="ai.lang" label="Reply language" value={prefs.ai.lang} options={[["auto", "Same as my question"], ["en", "English"], ["roman", "Roman Urdu"], ["ur", "اردو (Urdu script)"]]} />
          <Button variant="secondary" onClick={() => window.dispatchEvent(new Event("hcm:copilot"))}><Bot className="h-4 w-4" />Open the copilot</Button>
        </Panel>
        <Panel id="memory" title="What the copilot remembers" sub="Short facts added to every chat, like “I manage the Lahore warehouse team” or “Answer with numbers first”.">
          {prefs.ai.memory.length === 0 ? <p className="rounded-2xl bg-surface-muted px-4 py-3 text-sm text-ink-soft">Nothing yet.</p> : (
            <ul className="space-y-2">{prefs.ai.memory.map((m, i) => (
              <li key={i} className="flex items-start gap-3 rounded-2xl bg-surface-muted px-4 py-2.5 text-sm text-ink"><span className="flex-1">{m}</span>
                <button onClick={() => setPref("ai.memory", prefs.ai.memory.filter((_, j) => j !== i))} className="cursor-pointer text-ink-soft hover:text-rose-600" aria-label="Forget this"><Trash2 className="h-4 w-4" /></button></li>
            ))}</ul>
          )}
          <form onSubmit={(e) => { e.preventDefault(); addFact().catch((err) => toast.error((err as Error).message)); }} className="flex gap-2">
            <Input value={fact} onChange={(e) => setFact(e.target.value)} maxLength={200} placeholder="Add something the copilot should remember" />
            <Button type="submit" disabled={!fact.trim()}><Plus className="h-4 w-4" />Add</Button>
          </form>
        </Panel>
        <Panel title="Copilot rules"><ol className="list-decimal space-y-2 pl-5 text-sm text-ink-soft">{AI_RULES.map((r) => <li key={r}>{r}</li>)}</ol></Panel>
        <Panel title="AI connection" action={<Badge tone={status?.ai ? "green" : "amber"}>{status ? (status.ai ? "Connected" : "Not connected") : "Checking…"}</Badge>}>
          {status?.ai ? (
            <ul className="space-y-2">{status.providers.map((p, i) => (
              <li key={p.name} className="flex items-center gap-3 rounded-2xl bg-surface-muted px-4 py-3"><span className={cn("flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white", p.name === "Groq" ? "bg-[#F55036]" : "bg-[#6467F2]")}>{p.name[0]}</span>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink">{p.name} {i === 0 ? <span className="text-xs text-ink-soft">· primary</span> : <span className="text-xs text-ink-soft">· backup</span>}</p><p className="truncate text-xs text-ink-soft">{p.models.join(" → ")}</p></div><Badge tone="green">Free</Badge></li>
            ))}</ul>
          ) : <p className="text-sm text-ink-soft">An admin adds a free <b>GROQ_API_KEY</b> (primary) and optionally <b>OPENROUTER_API_KEY</b> (backup) in the hosting settings. If Groq is busy or out of quota, OpenRouter answers instead.</p>}
          <p className="text-xs text-ink-soft">To answer, the model receives only the records your question needs, already filtered to your role. Your email and password are never sent.</p>
        </Panel>
        <Panel id="history" title="Chat history" sub={`${count} saved chat${count === 1 ? "" : "s"}. Only you can see them.`}>
          <Button variant="danger" disabled={!count} onClick={async () => { if (!confirm("Delete all your AI chats? This cannot be undone.")) return; await supabase().from("ai_conversations").delete().neq("id", "00000000-0000-0000-0000-000000000000"); await refetch(); toast.success("All chats deleted"); }}><Trash2 className="h-4 w-4" />Delete all chats</Button>
        </Panel>
      </div>
    </>
  );
}

/* ── Guided tips ─────────────────────────────────────────────────────────── */
const TOUR_PATH: Record<string, string> = { welcome: "/dashboard", dashboard: "/dashboard", account: "/account" };
export function TipsSection() {
  const { prefs, setPref, clearPref } = usePrefs();
  const { ctx, navCtx } = useAuth();
  const router = useRouter();
  const allowed = new Set(navFor(navCtx).map((n) => n.href));
  const list = Object.entries(TOURS).filter(([k]) => {
    if (k === "person") return !!ctx?.employee;
    const p = TOUR_PATH[k] ?? `/${k}`;
    return k === "welcome" || k === "account" || allowed.has(p);
  });
  function replay(k: string) {
    const p = k === "person" ? `/people/${ctx?.employee?.id}` : TOUR_PATH[k] ?? `/${k}`;
    try { sessionStorage.removeItem("hcm-tours-seen"); } catch { /* ignore */ }
    router.push(p);
    setTimeout(() => startTour(k), 1200);
  }
  return (
    <>
      <SettingsHeader title="Guided tips" sub="Short tours that show what each page does" />
      <div className="space-y-4">
        <Panel title="Tips">
          <div className="flex items-center justify-between gap-4">
            <div><p className="text-sm font-medium text-ink">Show tips on each page</p><p className="text-xs text-ink-soft">The first time you open a page, a short tour points out what matters.</p></div>
            <Toggle label="Show tips" checked={!prefs.toursOff} onChange={(v) => setPref("toursOff", !v)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => replay("welcome")}><Play className="h-4 w-4" />Replay welcome tour</Button>
            <Button variant="secondary" onClick={async () => { await clearPref("tours"); await setPref("toursOff", false); try { sessionStorage.removeItem("hcm-tours-seen"); } catch { /* ignore */ } toast.success("All tips will show again"); }}><RefreshCw className="h-4 w-4" />Show all tips again</Button>
          </div>
        </Panel>
        <Panel title="Tours by page">
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {list.map(([k, t]) => (
              <li key={k} className="flex items-center gap-3 px-4 py-3">
                <Compass className="h-4 w-4 text-ink-soft" />
                <div className="flex-1"><p className="text-sm font-medium text-ink">{t.title}</p><p className="text-xs text-ink-soft">{t.steps.length} steps</p></div>
                {prefs.tours[k] ? <Badge tone="green"><Check className="h-3 w-3" />Seen</Badge> : <Badge>New</Badge>}
                <Button size="sm" variant="ghost" onClick={() => replay(k)}><Play className="h-3.5 w-3.5" />Play</Button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

/* ── Privacy & data ──────────────────────────────────────────────────────── */
export function PrivacySection() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const consent: [string, string, boolean][] = [
    ["Your company’s database (Supabase)", "Stores your HR records, encrypted at rest. Row-level security means each person only reaches what their role allows.", true],
    ["AI providers (Groq, OpenRouter)", "Only when you ask the copilot something: the records needed for that answer, already filtered to your role. Nothing is sent otherwise.", true],
    ["Email (your company’s mail domain via Resend)", "Sign-in codes, invitations and account emails.", true],
    ["Camera and location", "Used only at the moment you clock in, if your company requires Face ID or GPS. Your face becomes 128 numbers on your device; one reference photo is kept.", true],
    ["Advertising and tracking", "None. HCM Master Suite has no ads and no third-party trackers.", false],
  ];
  async function exportData() {
    setBusy(true);
    try {
      const data = await rpc<unknown>("my_data_export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = `hcm-my-data-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
      toast.success("Your data was downloaded");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <SettingsHeader title="Privacy & data" sub="What happens to your information" />
      <div className="space-y-4">
        <Panel title="Where your data goes">
          <ul className="space-y-2">{consent.map(([n, s, on]) => (
            <li key={n} className="flex items-start gap-3 rounded-2xl bg-surface-muted px-4 py-3">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", on ? "bg-emerald-500" : "bg-slate-400")} />
              <div className="flex-1"><p className="text-sm font-medium text-ink">{n}</p><p className="text-xs text-ink-soft">{s}</p></div>
              <Badge tone={on ? "green" : "neutral"}>{on ? "In use" : "Never"}</Badge>
            </li>
          ))}</ul>
        </Panel>
        <Panel id="export" title="Export your data" sub="A copy of your account, employee record, attendance, leave, payslips, expenses, goals and AI chats.">
          <Button onClick={exportData} loading={busy}><Download className="h-4 w-4" />Download as JSON</Button>
        </Panel>
        <Panel title="Delete things">
          <Button variant="secondary" onClick={async () => { if (!confirm("Delete all your AI chats?")) return; await supabase().from("ai_conversations").delete().neq("id", "00000000-0000-0000-0000-000000000000"); qc.invalidateQueries({ queryKey: ["ai-chats-count"] }); toast.success("AI chats deleted"); }}><Trash2 className="h-4 w-4" />Delete my AI chats</Button>
          <p className="text-sm text-ink-soft">Your employment records belong to your employer and are kept as the law requires. To close your account or correct official data, <Link href="/helpdesk" className="font-medium text-brand-600">raise a helpdesk ticket</Link> with HR.</p>
        </Panel>
      </div>
    </>
  );
}

/* ── Activity ────────────────────────────────────────────────────────────── */
const ENTITY: Record<string, string> = { leave_requests: "Leave request", attendance_records: "Attendance", expense_claims: "Expense claim", employees: "Employee", employee_compensation: "Salary", payroll_runs: "Payroll run", payslips: "Payslip", memberships: "Team member", user_invites: "Invitation", goals: "Goal", hr_tickets: "Helpdesk ticket", candidates: "Candidate", job_requisitions: "Job requisition", branches: "Branch", departments: "Department", leave_types: "Leave type", announcements: "Announcement", kudos: "Kudos", documents: "Document" };
export function ActivitySection() {
  const { data = [], isLoading } = useQuery({ queryKey: ["my-activity"], queryFn: () => rpc<{ id: number; action: string; entity: string; entity_id: string | null; created_at: string }[]>("my_activity", { p_limit: 150 }) });
  const verb = (a: string) => ({ insert: "Created", update: "Updated", delete: "Deleted" }[a] ?? a.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
  return (
    <>
      <SettingsHeader title="Activity" sub="Changes you made in this company, newest first" />
      <div className="rounded-3xl border border-line bg-surface shadow-[var(--shadow-card)]">
        {isLoading ? <p className="flex items-center justify-center gap-2 py-12 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>
          : data.length === 0 ? <p className="py-12 text-center text-sm text-ink-soft">Nothing yet. Actions like applying for leave or approving requests show up here.</p>
          : <ul className="divide-y divide-line">{data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-3">
              <span className={cn("h-2 w-2 rounded-full", a.action === "delete" ? "bg-rose-500" : a.action === "insert" ? "bg-emerald-500" : "bg-brand-500")} />
              <p className="flex-1 text-sm text-ink">{verb(a.action)} <span className="text-ink-soft">·</span> {ENTITY[a.entity] ?? a.entity.replace(/_/g, " ")}</p>
              <span className="text-xs text-ink-soft" title={fmtDateTime(a.created_at)}>{ago(a.created_at)}</span>
            </li>
          ))}</ul>}
      </div>
    </>
  );
}

/* ── Speed check ─────────────────────────────────────────────────────────── */
export function SpeedSection() {
  const [res, setRes] = useState<{ db: number[]; api: number[] } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const db: number[] = [], api: number[] = [];
    for (let i = 0; i < 5; i++) {
      let t = performance.now(); await supabase().rpc("my_context"); db.push(Math.round(performance.now() - t));
      t = performance.now(); await fetch("/api/copilot", { cache: "no-store" }).catch(() => null); api.push(Math.round(performance.now() - t));
    }
    setRes({ db, api }); setBusy(false);
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const grade = (ms: number) => (ms < 250 ? ["Fast", "green"] : ms < 700 ? ["Okay", "amber"] : ["Slow", "rose"]) as [string, "green" | "amber" | "rose"];
  return (
    <>
      <SettingsHeader title="Speed check" sub="How quickly this device reaches the app’s servers" />
      <Panel title="Run a check" sub="Five round trips to your company database and to the app server.">
        <Button onClick={run} loading={busy}><Gauge className="h-4 w-4" />{res ? "Run again" : "Start speed check"}</Button>
        {res && (
          <div className="grid gap-3 sm:grid-cols-2">
            {([["Database", res.db], ["App server", res.api]] as const).map(([n, a]) => { const m = med(a as number[]), [g, t] = grade(m); return (
              <div key={n} className="rounded-2xl bg-surface-muted p-4"><div className="flex items-center justify-between"><p className="text-sm text-ink-soft">{n}</p><Badge tone={t}>{g}</Badge></div><p className="mt-1 font-display text-2xl font-bold text-ink">{m} ms</p><p className="text-xs text-ink-soft">median · {(a as number[]).join(", ")} ms</p></div>
            ); })}
          </div>
        )}
        <p className="text-xs text-ink-soft">Slow? Check your internet connection. Pick a Supabase region close to your users (for Pakistan: Mumbai or Singapore).</p>
      </Panel>
    </>
  );
}

/* ── Help ────────────────────────────────────────────────────────────────── */
const FAQ: [string, string][] = [
  ["How do I clock in?", "Open your dashboard or Attendance and tap Clock in. If your company uses GPS or Face ID, allow location and camera when the browser asks."],
  ["Clock in says I am outside the office", "You need to be inside the office radius shown on the card. Turn on precise location, step outside for a better GPS fix, or ask HR to check your attendance rule."],
  ["How do I apply for leave?", "Leave → Apply for leave. Pick the type and dates; weekends and holidays are counted for you. Your manager gets a notification."],
  ["Where are my payslips?", "My payslips in the menu. Every line shows how it was calculated, and each slip can be downloaded."],
  ["I forgot my password", "On the sign-in page choose Email code or Forgot password; we email you a 6-digit code."],
  ["What can the AI copilot see?", "Only what your role can see. It runs every lookup with your own permissions, and your chats are private to you."],
  ["How do I hide salaries while sharing my screen?", "Tap the eye icon at the top, or turn on Privacy mode in Settings → General."],
];
export function HelpSection() {
  const { prefs } = usePrefs();
  const keys: [string, string][] = [["Ctrl / ⌘ + K", "Search people and pages"], ["G then D", "Go to dashboard"], ["G then A", "Go to attendance"], ["G then L", "Go to leave"], ["G then S", "Open settings"], ["?", "Open this help page"], ["Esc", "Close dialogs, the copilot or a tour"], ["← →", "Move through a guided tour"]];
  return (
    <>
      <SettingsHeader title="Help & shortcuts" />
      <div className="space-y-4">
        <Panel title="Quick start">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => startTour()}><Compass className="h-4 w-4" />Tour this app</Button>
            <Button variant="secondary" onClick={() => window.dispatchEvent(new Event("hcm:copilot"))}><Bot className="h-4 w-4" />Ask the AI copilot</Button>
          </div>
        </Panel>
        <Panel title="Common questions">
          <div className="divide-y divide-line rounded-2xl border border-line">{FAQ.map(([qq, a]) => (
            <details key={qq} className="group px-4 py-3"><summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-ink">{qq}<Plus className="h-4 w-4 text-ink-soft transition group-open:rotate-45" /></summary><p className="mt-2 text-sm text-ink-soft">{a}</p></details>
          ))}</div>
        </Panel>
        <Panel id="shortcuts" title="Keyboard shortcuts" sub={prefs.shortcuts ? undefined : "Shortcuts are off. Turn them on in Settings → General → Layout."}>
          <ul className="grid gap-2 sm:grid-cols-2">{keys.map(([kk, l]) => <li key={kk} className="flex items-center justify-between rounded-2xl bg-surface-muted px-4 py-2.5 text-sm"><span className="text-ink-soft">{l}</span><kbd className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-0.5 font-mono text-xs text-ink"><Keyboard className="h-3 w-3" />{kk}</kbd></li>)}</ul>
        </Panel>
        <Panel id="contact" title="Still stuck?">
          <p className="text-sm text-ink-soft">Your HR team answers questions through the helpdesk, usually within the response time shown on your ticket.</p>
          <Link href="/helpdesk" className="inline-flex"><Button variant="secondary"><LifeBuoy className="h-4 w-4" />Open helpdesk</Button></Link>
        </Panel>
      </div>
    </>
  );
}

/* ── About ───────────────────────────────────────────────────────────────── */
export function AboutSection() {
  const { signOut } = useAuth();
  return (
    <>
      <SettingsHeader title="About & legal" />
      <div className="space-y-4">
        <Panel title="HCM Master Suite">
          <KV rows={[["Version", APP_VERSION], ["Modules", "16"], ["Roles", "14"], ["Made for", "Pakistan (FY 2025-26 tax slabs, EOBI, PF)"]]} />
        </Panel>
        <Panel title="Legal">
          <div className="flex flex-wrap gap-2">
            <Link href="/legal/terms"><Button variant="secondary">Terms of Service</Button></Link>
            <Link href="/legal/privacy"><Button variant="secondary">Privacy Policy</Button></Link>
            <Link href="/"><Button variant="ghost">Product website</Button></Link>
          </div>
        </Panel>
        <Button variant="danger" onClick={signOut}><LogOut className="h-4 w-4" />Sign out</Button>
      </div>
    </>
  );
}

export const SECTIONS: Record<string, () => React.ReactNode> = {
  profile: ProfileSection, general: GeneralSection, notifications: NotificationsSection, security: SecuritySection, ai: AiSection,
  tips: TipsSection, privacy: PrivacySection, activity: ActivitySection, speed: SpeedSection, help: HelpSection, about: AboutSection,
};
