const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Display preferences (Settings → General), set by the prefs provider. */
const FP = { hideMoney: false, dateFormat: "long" as "long" | "dmy" | "mdy" | "iso", timeFormat: "12h" as "12h" | "24h" };
export function setFormatPrefs(p: Partial<typeof FP>) { Object.assign(FP, p); }
export const MASK = "PKR ••••••";

export const num = (n: number) => Math.round(n).toLocaleString("en-US");
export const pkr = (n: number) => (FP.hideMoney ? MASK : "PKR " + num(n));
export function pkrCompact(n: number) {
  if (FP.hideMoney) return MASK;
  if (Math.abs(n) >= 1e6) return "PKR " + (n / 1e6).toFixed(2) + "M";
  return "PKR " + (n / 1e3).toFixed(0) + "k";
}
export const shortDate = (d: Date) => `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
const p2 = (n: number) => String(n).padStart(2, "0");
export const longDate = (d: Date) =>
  FP.dateFormat === "dmy" ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`
  : FP.dateFormat === "mdy" ? `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${d.getFullYear()}`
  : FP.dateFormat === "iso" ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  : `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
export const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function timeAgo(d: Date) {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  if (m < 1440) return Math.round(m / 60) + "h ago";
  return Math.round(m / 1440) + "d ago";
}
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export { MON, DOW };

/** Parse a Postgres date (YYYY-MM-DD) as a local date, avoiding timezone shifts. */
export const d = (s?: string | null) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s) : null);
export const fmtDate = (s?: string | null) => { const x = d(s); return x ? longDate(x) : "—"; };
export const fmtShort = (s?: string | null) => { const x = d(s); return x ? `${x.getDate()} ${MON[x.getMonth()]}` : "—"; };
export const fmtTime = (s?: string | null) => (s ? new Date(s).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: FP.timeFormat === "12h" }) : "—");
export const fmtDateTime = (s?: string | null) => (s ? `${fmtShort(s)}, ${fmtTime(s)}` : "—");
export const money = (n?: number | string | null) => (n == null || n === "" ? "—" : pkr(Number(n)));
export const ago = (s?: string | null) => (s ? timeAgo(new Date(s)) : "—");
export const today = () => toISODate(new Date());
export const thisPeriod = () => toISODate(new Date()).slice(0, 7);
export const periodLabel = (p: string) => { const [y, m] = p.split("-"); return `${MON[Number(m) - 1]} ${y}`; };
export const minutes = (m?: number | null) => (m == null ? "—" : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);
export const title = (s?: string | null) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()).replace(/\bhr\b/gi, "HR").replace(/\b(eobi|it|enps|noc)\b/gi, (m) => m.toUpperCase()) : "—");
