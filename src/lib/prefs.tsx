"use client";
// Personal preferences: saved on the account (profiles.prefs via set_my_pref) and cached on this device,
// so they apply instantly on every device the person signs in from.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth";
import { supabase } from "./supabase";
import { setFormatPrefs } from "./format";

export const NOTIF_TYPES = [
  { key: "approvals", label: "Approvals", sub: "Requests waiting for your decision. Always on, so work never gets stuck.", locked: true },
  { key: "leave", label: "Leave", sub: "Your leave decisions, and team leave if you approve it" },
  { key: "attendance", label: "Attendance", sub: "Corrections, overtime and missed punches" },
  { key: "payroll", label: "Payroll & payslips", sub: "New payslips and payroll steps" },
  { key: "expenses", label: "Expenses & loans", sub: "Claims and loan decisions" },
  { key: "recruitment", label: "Recruitment", sub: "Requisitions, candidates and offers" },
  { key: "announcements", label: "Announcements & kudos", sub: "Company news and recognition" },
  { key: "helpdesk", label: "Helpdesk", sub: "Replies on your tickets" },
  { key: "growth", label: "Performance & learning", sub: "Reviews, goals, courses and onboarding tasks" },
  { key: "general", label: "Everything else", sub: "Account and other updates" },
] as const;

export const DASH_SECTIONS: { key: string; label: string }[] = [
  { key: "me", label: "My day (clock in, leave, payslip)" },
  { key: "team", label: "My team today" },
  { key: "company", label: "Company overview" },
  { key: "payroll", label: "Payroll" },
  { key: "news", label: "Announcements & birthdays" },
];

export type Prefs = {
  textSize: "small" | "default" | "large";
  density: "comfortable" | "compact";
  hideMoney: boolean;
  motion: "system" | "reduce" | "full";
  sidebar: "remember" | "expanded" | "collapsed";
  startPage: string;
  dateFormat: "long" | "dmy" | "mdy" | "iso";
  timeFormat: "12h" | "24h";
  dashboard: { order: string[]; hidden: string[] };
  notif: Record<string, boolean>;
  desktop: boolean;
  sound: boolean;
  quiet: { on: boolean; from: string; to: string };
  ai: { style: "concise" | "detailed"; lang: "auto" | "en" | "roman" | "ur"; memory: string[] };
  toursOff: boolean;
  tours: Record<string, boolean>;
  shortcuts: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  textSize: "default", density: "comfortable", hideMoney: false, motion: "system", sidebar: "remember", startPage: "/dashboard",
  dateFormat: "long", timeFormat: "12h",
  dashboard: { order: DASH_SECTIONS.map((s) => s.key), hidden: [] },
  notif: {}, desktop: false, sound: false, quiet: { on: false, from: "22:00", to: "07:00" },
  ai: { style: "concise", lang: "auto", memory: [] },
  toursOff: false, tours: {}, shortcuts: true,
};

export function mergePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Prefs>;
  const order = Array.isArray(r.dashboard?.order) ? r.dashboard!.order.filter((k) => DASH_SECTIONS.some((s) => s.key === k)) : [];
  return {
    ...DEFAULT_PREFS, ...r,
    dashboard: { order: [...order, ...DEFAULT_PREFS.dashboard.order.filter((k) => !order.includes(k))], hidden: Array.isArray(r.dashboard?.hidden) ? r.dashboard!.hidden : [] },
    notif: { ...(r.notif ?? {}) },
    quiet: { ...DEFAULT_PREFS.quiet, ...(r.quiet ?? {}) },
    ai: { ...DEFAULT_PREFS.ai, ...(r.ai ?? {}), memory: Array.isArray(r.ai?.memory) ? r.ai!.memory : [] },
    tours: { ...(r.tours ?? {}) },
  };
}

type PrefsState = { prefs: Prefs; setPref: (key: string, value: unknown) => Promise<void>; clearPref: (key: string) => Promise<void>; saving: boolean };
const Ctx = createContext<PrefsState | null>(null);
const CACHE = "hcm-prefs";

function setPath(obj: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = key.split("."), out = structuredClone(obj);
  let cur: Record<string, unknown> = out;
  parts.slice(0, -1).forEach((p) => { if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {}; cur = cur[p] as Record<string, unknown>; });
  cur[parts[parts.length - 1]] = value;
  return out;
}
function delPath(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const parts = key.split("."), out = structuredClone(obj);
  let cur: Record<string, unknown> = out;
  for (const p of parts.slice(0, -1)) { if (typeof cur[p] !== "object" || cur[p] === null) return out; cur = cur[p] as Record<string, unknown>; }
  delete cur[parts[parts.length - 1]];
  return out;
}

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const { ctx } = useAuth();
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  useEffect(() => { try { const c = JSON.parse(localStorage.getItem(CACHE) ?? "null"); if (c && !ctx?.prefs) setRaw(c); } catch { /* storage blocked */ } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  // Server copy wins when it arrives (another device may have changed something).
  useEffect(() => { if (ctx?.prefs) setRaw(ctx.prefs as Record<string, unknown>); }, [ctx?.prefs]);
  useEffect(() => { try { localStorage.setItem(CACHE, JSON.stringify(raw)); } catch { /* storage blocked */ } }, [raw]);

  const prefs = useMemo(() => mergePrefs(raw), [raw]);
  setFormatPrefs({ hideMoney: prefs.hideMoney, dateFormat: prefs.dateFormat, timeFormat: prefs.timeFormat });

  const setPref = useCallback(async (key: string, value: unknown) => {
    const before = raw;
    setRaw((r) => setPath(r, key, value));
    if (!ctx?.user_id) return;
    setSaving(true);
    const { error } = await supabase().rpc("set_my_pref", { p_key: key, p_value: value });
    setSaving(false);
    if (error && !/function .* does not exist|schema cache/i.test(error.message)) { setRaw(before); throw new Error(error.message); }
  }, [raw, ctx?.user_id]);
  const clearPref = useCallback(async (key: string) => {
    setRaw((r) => delPath(r, key));
    if (ctx?.user_id) await supabase().rpc("clear_my_pref", { p_key: key });
  }, [ctx?.user_id]);

  return <Ctx.Provider value={{ prefs, setPref, clearPref, saving }}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePrefs outside PrefsProvider");
  return v;
}

/** Applies text size, density and motion to the whole app. */
export function PrefsEffects() {
  const { prefs } = usePrefs();
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.text = prefs.textSize;
    r.dataset.density = prefs.density;
    const reduce = prefs.motion === "reduce" || (prefs.motion === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    r.classList.toggle("reduce-motion", reduce);
    return () => { delete r.dataset.text; delete r.dataset.density; r.classList.remove("reduce-motion"); };
  }, [prefs.textSize, prefs.density, prefs.motion]);
  return null;
}
