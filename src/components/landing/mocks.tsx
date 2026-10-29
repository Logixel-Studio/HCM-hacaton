"use client";
// Product visuals for the landing page, drawn in HTML/SVG (no screenshots), so they stay sharp and animatable.
import { BadgeCheck, CalendarDays, Clock3, MapPin, ScanFace, Sparkles, TrendingUp, Users, Wallet } from "lucide-react";

/** Hero: a miniature of the real dashboard. */
export function DashboardMock() {
  const bars = [42, 58, 51, 74, 66, 88, 79, 93, 71, 84, 97, 90];
  const people = [
    { n: "Ayesha Khan", r: "Clocked in · Head Office", t: "09:02", c: "bg-emerald-400" },
    { n: "Bilal Raza", r: "On leave · Casual", t: "—", c: "bg-amber-400" },
    { n: "Sara Ahmed", r: "Clocked in · Face 96%", t: "08:57", c: "bg-emerald-400" },
    { n: "Usman Tariq", r: "Field · GPS 31.52, 74.35", t: "09:15", c: "bg-sky-400" },
  ];
  return (
    <div className="lp-mock relative overflow-hidden rounded-[22px] border border-white/10 bg-[#0b1120]/90 shadow-[0_40px_120px_-30px_rgba(14,165,233,0.45)] backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <div className="ml-3 flex-1 truncate rounded-md bg-white/[0.04] px-3 py-1 text-[11px] text-slate-400">hcm.logixels.com/dashboard</div>
      </div>
      <div className="grid grid-cols-[150px_1fr] max-md:grid-cols-1">
        <aside className="space-y-1 border-r border-white/[0.06] p-3 max-md:hidden">
          {[["Dashboard", true], ["People", false], ["Attendance", false], ["Leave", false], ["Payroll", false], ["Recruitment", false], ["Analytics", false]].map(([l, a]) => (
            <div key={l as string} className={`rounded-lg px-3 py-2 text-[11px] font-medium ${a ? "bg-sky-500/15 text-sky-300" : "text-slate-400"}`}>{l}</div>
          ))}
        </aside>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-4 gap-2.5 max-sm:grid-cols-2">
            {[["Headcount", "248", Users, "+12"], ["Present", "231", Clock3, "93%"], ["On leave", "9", CalendarDays, "today"], ["Payroll", "₨ 38.4M", Wallet, "Oct"]].map(([l, v, I, s]) => {
              const Icon = I as typeof Users;
              return (
                <div key={l as string} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">{l as string}<Icon className="h-3.5 w-3.5 text-sky-300" /></div>
                  <p className="mt-1.5 font-display text-lg font-semibold text-white">{v as string}</p>
                  <p className="text-[10px] text-emerald-300">{s as string}</p>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-[1.4fr_1fr] gap-2.5 max-sm:grid-cols-1">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between text-[10px] text-slate-400">Attendance this month<TrendingUp className="h-3.5 w-3.5 text-emerald-300" /></div>
              <div className="flex h-24 items-end gap-1.5">
                {bars.map((h, i) => <div key={i} className="lp-bar flex-1 origin-bottom rounded-t-[4px] bg-gradient-to-t from-sky-600 to-cyan-300" style={{ height: `${h}%` }} />)}
              </div>
            </div>
            <div className="space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
              <p className="text-[10px] text-slate-400">Live attendance</p>
              {people.map((p) => (
                <div key={p.n} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[9px] font-semibold text-white">{p.n.split(" ").map((x) => x[0]).join("")}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium text-white">{p.n}</p><p className="truncate text-[9px] text-slate-400">{p.r}</p></div>
                  <span className={`h-1.5 w-1.5 rounded-full ${p.c}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small floating cards around the hero mock. */
export function FloatCard({ icon: Icon, title, text, tone, className }: { icon: typeof Users; title: string; text: string; tone: string; className?: string }) {
  return (
    <div className={`lp-float pointer-events-none absolute flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0d1426]/85 px-4 py-3 shadow-2xl backdrop-blur-xl ${className ?? ""}`}>
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon className="h-[18px] w-[18px]" /></span>
      <div><p className="text-[13px] font-semibold text-white">{title}</p><p className="text-[11px] text-slate-400">{text}</p></div>
    </div>
  );
}

/** Face ID section: phone with the oval scanner. Parts are targeted by class names from the scroll timeline. */
export function FacePhone() {
  return (
    <div className="relative mx-auto w-[270px] rounded-[44px] border border-white/15 bg-[#070b16] p-3 shadow-[0_50px_120px_-40px_rgba(56,189,248,0.6)]">
      <div className="absolute left-1/2 top-3 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-black" />
      <div className="relative aspect-[9/17] overflow-hidden rounded-[34px] bg-gradient-to-b from-slate-800 to-slate-950">
        <div className="absolute inset-x-0 top-10 flex justify-center gap-1.5">
          {["Look straight", "Turn", "Blink"].map((s, i) => (
            <span key={s} className={`fx-chip fx-chip-${i} rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-medium text-slate-300`}>{s}</span>
          ))}
        </div>
        <svg viewBox="0 0 200 260" className="absolute inset-x-0 top-20 mx-auto w-[86%]">
          <defs>
            <linearGradient id="fxg" x1="0" x2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#34d399" /></linearGradient>
          </defs>
          {/* head */}
          <g className="fx-head">
            <ellipse cx="100" cy="125" rx="58" ry="74" fill="#1e293b" />
            <g className="fx-features">
              <ellipse className="fx-eye" cx="80" cy="112" rx="7" ry="5" fill="#e2e8f0" />
              <ellipse className="fx-eye" cx="120" cy="112" rx="7" ry="5" fill="#e2e8f0" />
              <path d="M100 118 L95 140 L104 140" stroke="#94a3b8" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              <path d="M86 158 Q100 168 114 158" stroke="#94a3b8" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            </g>
          </g>
          {/* landmark dots */}
          <g className="fx-dots" fill="#7dd3fc">
            {[[70, 100], [90, 98], [110, 98], [130, 100], [100, 128], [92, 142], [108, 142], [86, 160], [114, 160], [100, 168], [62, 130], [138, 130], [100, 70]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.8" />)}
          </g>
          <ellipse cx="100" cy="125" rx="80" ry="102" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" strokeDasharray="8 7" />
          <ellipse className="fx-ring" cx="100" cy="125" rx="88" ry="110" fill="none" stroke="url(#fxg)" strokeWidth="5" strokeLinecap="round" pathLength={100} strokeDasharray="100 100" strokeDashoffset="100" />
          <rect className="fx-scan" x="25" y="30" width="150" height="3" rx="1.5" fill="#38bdf8" opacity="0.8" />
        </svg>
        <div className="fx-done absolute inset-0 flex flex-col items-center justify-center bg-emerald-500/20 opacity-0">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-xl"><BadgeCheck className="h-9 w-9 text-emerald-500" /></div>
          <p className="mt-3 text-sm font-semibold text-white">Clocked in · 09:02</p>
          <p className="text-[11px] text-emerald-200">Face match 96% · Head Office</p>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 px-4 pb-5 pt-10 text-center">
          <p className="fx-hint flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white"><ScanFace className="h-3.5 w-3.5" />Look straight at the camera</p>
        </div>
      </div>
    </div>
  );
}

/** GPS geofence card. */
export function GeoCard() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b1120]/90 p-5 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-white"><MapPin className="h-4 w-4 text-sky-300" />Head Office geofence</p>
        <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">Inside</span>
      </div>
      <div className="relative mt-4 h-44 overflow-hidden rounded-2xl bg-[#0a1628]">
        <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(148,163,184,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.12)_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="absolute left-[18%] top-0 h-full w-3 rotate-12 bg-slate-600/40" />
        <div className="absolute left-0 top-[62%] h-3 w-full -rotate-3 bg-slate-600/40" />
        <div className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-400/60 bg-sky-400/10" />
        <div className="geo-pulse absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-300/50" />
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-300 shadow-[0_0_20px_4px_rgba(56,189,248,.6)]" />
        <div className="geo-pin absolute left-[58%] top-[38%] -translate-x-1/2 -translate-y-full">
          <MapPin className="h-8 w-8 fill-emerald-400 text-emerald-950" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white/[0.04] py-2"><p className="text-[10px] text-slate-400">Distance</p><p className="font-display text-sm font-semibold text-white"><span className="geo-dist">38</span> m</p></div>
        <div className="rounded-xl bg-white/[0.04] py-2"><p className="text-[10px] text-slate-400">Radius</p><p className="font-display text-sm font-semibold text-white">150 m</p></div>
        <div className="rounded-xl bg-white/[0.04] py-2"><p className="text-[10px] text-slate-400">GPS ±</p><p className="font-display text-sm font-semibold text-white">12 m</p></div>
      </div>
    </div>
  );
}

/** Payslip with the worked example from the product's own test suite. */
export function Payslip() {
  const rows: [string, string, string][] = [
    ["Basic salary (60%)", "pay-basic", "81,000"],
    ["House rent (45% of basic)", "pay-hra", "36,450"],
    ["Utilities", "pay-util", "9,450"],
    ["Medical (tax-exempt)", "pay-med", "8,100"],
  ];
  return (
    <div className="relative rounded-3xl border border-white/10 bg-white p-6 text-slate-900 shadow-[0_40px_100px_-30px_rgba(139,92,246,0.5)]">
      <div className="flex items-start justify-between">
        <div><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Payslip · October 2026</p><p className="mt-1 font-display text-lg font-bold">Ahmed Ali</p><p className="text-xs text-slate-500">Supervisor · EMP-0005</p></div>
        <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-600"><BadgeCheck className="h-3.5 w-3.5" />Finalized</span>
      </div>
      <div className="mt-5 space-y-2 text-sm">
        {rows.map(([l, c, v]) => <div key={l} className="flex justify-between"><span className="text-slate-500">{l}</span><span className={`${c} font-medium tabular-nums`}>{v}</span></div>)}
        <div className="flex justify-between border-t border-dashed border-slate-200 pt-2 font-semibold"><span>Gross</span><span className="tabular-nums">₨ <span className="pay-gross">135,000</span></span></div>
        <div className="flex justify-between text-rose-500"><span>Income tax (FY 2025-26 slab)</span><span className="tabular-nums">− <span className="pay-tax">3,459</span></span></div>
        <div className="flex justify-between text-rose-500"><span>Provident fund + EOBI + loan</span><span className="tabular-nums">− 15,117</span></div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-950 px-4 py-3 text-white">
        <span className="text-sm text-slate-300">Net pay</span>
        <span className="font-display text-2xl font-bold tabular-nums">₨ <span className="pay-net">116,424</span></span>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400"><Sparkles className="h-3.5 w-3.5" />Every line shows its formula. Verify the slip with its code.</p>
    </div>
  );
}

/** AI copilot conversation that types itself; the answer changes with the selected role. */
export function CopilotMock({ role }: { role: "owner" | "manager" | "employee" }) {
  const convo = {
    owner: { q: "Who was late this week, and what did October payroll cost?", a: [["Late arrivals this week", "11 people · 19 late days. Most in Warehouse (6)."], ["October payroll", "₨ 38.4M net · ₨ 41.9M employer cost, +2.1% vs September."], ["Worth a look", "Bilal R. was late 4 of 5 days."]] },
    manager: { q: "Who in my team is on leave tomorrow?", a: [["On leave tomorrow", "Ayesha K. (casual, 1 day) and Usman T. (annual, until Friday)."], ["Coverage", "4 of 6 people in on Thursday."], ["Waiting for you", "1 leave request and 2 overtime claims."]] },
    employee: { q: "Kitni casual leaves bachi hain meri?", a: [["Casual leave", "Aap ki 6 casual leaves baqi hain (10 mein se)."], ["Annual leave", "12.5 din available."], ["Tip", "Kehen to main kal ki leave apply kar doon."]] },
  }[role];
  return (
    <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[#0b1120]/90 shadow-[0_40px_120px_-30px_rgba(139,92,246,0.5)] backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-400 to-sky-500"><Sparkles className="h-3.5 w-3.5 text-white" /></span>
        <p className="text-sm font-semibold text-white">AI Copilot</p>
        <span className="ml-auto rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">Sees what a {role} can see</span>
      </div>
      <div className="space-y-4 p-5">
        <div className="cp-q ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-sky-600 px-4 py-2.5 text-sm text-white">{convo.q}</div>
        <div className="cp-typing flex gap-1 pl-1">{[0, 1, 2].map((i) => <i key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-300" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
        <div className="space-y-2">
          {convo.a.map(([t, v]) => (
            <div key={t} className="cp-a rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">{t}</p>
              <p className="mt-0.5 text-sm text-slate-200">{v}</p>
            </div>
          ))}
        </div>
        <div className="cp-a flex items-center gap-3 pl-1 text-[11px] text-slate-500"><span>Copy</span><span>Regenerate</span><span>👍</span><span>👎</span><span className="ml-auto">Groq · gpt-oss-120b</span></div>
      </div>
    </div>
  );
}
