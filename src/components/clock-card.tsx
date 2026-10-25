"use client";
import { useEffect, useState } from "react";
import { Fingerprint, LogIn, LogOut, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button, Card } from "@/components/ui";
import { StatusBadge } from "@/components/common";
import { rpc, useAction } from "@/lib/api";
import { fmtTime, minutes } from "@/lib/format";

export type TodayRecord = { clock_in_at: string | null; clock_out_at: string | null; status: string; late_minutes: number; worked_minutes: number; clock_in_distance_m: number | null } | null;
export type ShiftInfo = { name: string; start: string; end: string } | null;

function getPosition(): Promise<{ lat: number; lng: number; acc: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}

/** Live clock with server-stamped clock in / out and office geofence check. */
export function ClockCard({ today, shift }: { today: TodayRecord; shift: ShiftInfo }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const clockIn = useAction(async () => {
    const pos = await getPosition();
    if (!pos) toast.message("Location unavailable — the office may require it");
    return rpc<{ status: string; late_minutes: number }>("clock_in", { p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_accuracy: pos?.acc ?? null, p_source: /Mobi/.test(navigator.userAgent) ? "mobile" : "web" });
  }, { success: (r) => (r.status === "late" ? `Clocked in · ${r.late_minutes} min late` : "Clocked in · have a great day"), invalidate: ["attendance"] });

  const clockOut = useAction(async () => {
    const pos = await getPosition();
    return rpc<{ worked_minutes: number }>("clock_out", { p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null });
  }, { success: (r) => `Clocked out · worked ${minutes(r.worked_minutes)}`, invalidate: ["attendance"] });

  const inAt = today?.clock_in_at;
  const outAt = today?.clock_out_at;
  const running = inAt && !outAt && now ? Math.floor((now.getTime() - new Date(inAt).getTime()) / 60000) : null;

  return (
    <Card className="relative overflow-hidden p-6">
      <div className="brand-gradient pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-10" />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-ink-soft">{now?.toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "long" })}</p>
          <p className="mt-1 font-display text-4xl font-bold tabular text-ink">{now?.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
          <p className="mt-1 text-sm text-ink-soft">{shift ? `${shift.name} · ${shift.start.slice(0, 5)}–${shift.end.slice(0, 5)}` : "No shift today"}</p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><Fingerprint className="h-6 w-6" /></div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-surface-muted py-2.5"><p className="text-[11px] text-ink-soft">In</p><p className="text-sm font-semibold text-ink">{fmtTime(inAt)}</p></div>
        <div className="rounded-2xl bg-surface-muted py-2.5"><p className="text-[11px] text-ink-soft">Out</p><p className="text-sm font-semibold text-ink">{fmtTime(outAt)}</p></div>
        <div className="rounded-2xl bg-surface-muted py-2.5"><p className="text-[11px] text-ink-soft">Worked</p><p className="text-sm font-semibold text-ink">{running != null ? minutes(running) : today?.worked_minutes ? minutes(today.worked_minutes) : "—"}</p></div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          {today?.status && <StatusBadge status={today.status} />}
          {today?.clock_in_distance_m != null && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{today.clock_in_distance_m} m from office</span>}
        </div>
        {!inAt ? (
          <Button size="lg" onClick={() => clockIn.mutate()} loading={clockIn.isPending}><LogIn className="h-4 w-4" />Clock in</Button>
        ) : !outAt ? (
          <Button size="lg" variant="danger" onClick={() => clockOut.mutate()} loading={clockOut.isPending}><LogOut className="h-4 w-4" />Clock out</Button>
        ) : (
          <span className="text-sm font-medium text-emerald-600">Day complete ✓</span>
        )}
      </div>
    </Card>
  );
}
