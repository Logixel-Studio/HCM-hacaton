"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type Accent = "sky" | "indigo" | "violet" | "emerald" | "rose" | "amber";
export const ACCENTS: { value: Accent; label: string; swatch: string }[] = [
  { value: "sky", label: "Sky", swatch: "#0284c7" },
  { value: "indigo", label: "Indigo", swatch: "#4f46e5" },
  { value: "violet", label: "Violet", swatch: "#7c3aed" },
  { value: "emerald", label: "Emerald", swatch: "#059669" },
  { value: "rose", label: "Rose", swatch: "#e11d48" },
  { value: "amber", label: "Amber", swatch: "#d97706" },
];

export type ChartColors = { brand: string; brandSoft: string; brandDeep: string; grid: string; axis: string; ink: string; surface: string; line: string };
type ThemeState = { mode: ThemeMode; accent: Accent; resolved: "light" | "dark"; colors: ChartColors; setMode: (m: ThemeMode) => void; setAccent: (a: Accent) => void };
const FALLBACK: ChartColors = { brand: "#0284c7", brandSoft: "#bae6fd", brandDeep: "#075985", grid: "#eef2f6", axis: "#64748b", ink: "#0f172a", surface: "#ffffff", line: "#e6ecf2" };
const ThemeCtx = createContext<ThemeState | null>(null);

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

/** Inline script for <head>: applies the saved theme before first paint so there is no flash. */
export const themeBootScript = `(function(){try{var m=localStorage.getItem('hcm-theme')||'system';var a=localStorage.getItem('hcm-accent')||'sky';var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d)r.classList.add('dark');r.setAttribute('data-accent',a);}catch(e){}})();`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [accent, setAccentState] = useState<Accent>("sky");
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const [colors, setColors] = useState<ChartColors>(FALLBACK);

  useEffect(() => {
    setModeState((read("hcm-theme") as ThemeMode) || "system");
    setAccentState((read("hcm-accent") as Accent) || "sky");
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = mode === "dark" || (mode === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
      setResolved(dark ? "dark" : "light");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);

  useEffect(() => { document.documentElement.setAttribute("data-accent", accent); }, [accent]);

  // Charts (SVG) need real colour values, so read the resolved CSS variables.
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    setColors({
      brand: v("--brand-600") || FALLBACK.brand,
      brandSoft: resolved === "dark" ? v("--brand-800") : v("--brand-200"),
      brandDeep: v("--brand-800"),
      grid: resolved === "dark" ? "#1e2a44" : "#eef2f6",
      axis: v("--ink-soft"),
      ink: v("--ink"),
      surface: v("--surface"),
      line: v("--line"),
    });
  }, [accent, resolved]);

  const setMode = useCallback((m: ThemeMode) => { setModeState(m); write("hcm-theme", m); }, []);
  const setAccent = useCallback((a: Accent) => { setAccentState(a); write("hcm-accent", a); }, []);

  return <ThemeCtx.Provider value={{ mode, accent, resolved, colors, setMode, setAccent }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}
