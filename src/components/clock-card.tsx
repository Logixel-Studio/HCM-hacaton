"use client";
import { useEffect, useRef, useState } from "react";
import { Fingerprint, Home, LocateFixed, LogIn, LogOut, MapPin, Navigation, ScanFace, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card } from "@/components/ui";
import { StatusBadge } from "@/components/common";
import { FaceCapture, type FaceResult } from "@/components/face-capture";
import { rpc, uploadFile, useRpc } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { getPosition, metres } from "@/lib/face";
import { fmtTime, minutes } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TodayRecord = { clock_in_at: string | null; clock_out_at: string | null; status: string; late_minutes: number; worked_minutes: number; clock_in_distance_m: number | null; work_mode?: string | null; clock_in_face_score?: number | null } | null;
export type ShiftInfo = { name: string; start: string; end: string } | null;
export type AttendanceRules = {
  mode: "office" | "field" | "remote"; require_selfie: boolean; require_face: boolean; face_enrolled: boolean; allow_self_enrollment?: boolean; max_gps_accuracy_m: number;
  locations: { id: string; name: string; latitude: number | null; longitude: number | null; radius_m: number }[];
};

type PunchResult = { ok: boolean; reason?: string; needs_enrollment?: boolean; status?: string; late_minutes?: number; distance_m?: number | null; branch?: string | null; worked_minutes?: number; face_score?: number | null };

export function useAttendanceRules() {
  const { ctx } = useAuth();
  const employeeId = ctx?.employee?.id ?? null;
  return useRpc<AttendanceRules | null>(["attendance", "rules", "mine", employeeId], "my_attendance_rules", undefined, { enabled: !!employeeId });
}

/** Enroll a face (self or by HR). */
export function FaceEnroll({ employeeId, open, onClose, onEnrolled }: { employeeId: string; open: boolean; onClose: () => void; onEnrolled?: () => void }) {
  const { tenantId } = useMe();
  const qc = useQueryClient();
  async function done(r: FaceResult) {
    onClose();
    const t = toast.loading("Saving Face ID…");
    try {
      const path = await uploadFile("attendance-selfies", tenantId!, employeeId, new File([r.photo], "enroll.jpg", { type: "image/jpeg" }));
      await rpc("enroll_face", { p_employee: employeeId, p_descriptor: r.descriptor, p_photo_path: path, p_samples: r.samples });
      toast.success("Face ID is set up", { id: t });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      onEnrolled?.();
    } catch (e) { toast.error((e as Error).message, { id: t }); }
  }
  return <FaceCapture open={open} mode="enroll" onDone={done} onClose={onClose} />;
}

/** Live clock with server-checked clock in / out: GPS geofence, selfie and Face ID per the employee's rules. */
export function ClockCard({ today, shift }: { today: TodayRecord; shift: ShiftInfo }) {
  const { employeeId, tenantId } = useMe();
  const qc = useQueryClient();
  const { data: rules } = useAttendanceRules();
  const [now, setNow] = useState<Date | null>(null);
  const [busy, setBusy] = useState<null | "in" | "out">(null);
  const [face, setFace] = useState<null | "in" | "out">(null);
  const [enroll, setEnroll] = useState(false);
  const [here, setHere] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const pendingPos = useRef<{ lat: number; lng: number; acc: number } | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const mode = rules?.mode ?? "office";
  const needsGps = mode !== "remote";
  const needsCamera = !!(rules?.require_face || rules?.require_selfie);
  const located = (rules?.locations ?? []).filter((l) => l.latitude != null && l.longitude != null);
  const nearest = here && located.length
    ? located.map((l) => ({ ...l, d: Math.round(metres(here.lat, here.lng, l.latitude!, l.longitude!)) })).sort((a, b) => a.d - b.d)[0]
    : null;
  const inside = nearest ? nearest.d <= nearest.radius_m + Math.min(here?.acc ?? 0, 100) : null;

  function openEnroll() {
    if (rules?.allow_self_enrollment === false) { toast.message("Your Face ID is registered by HR. Please visit HR once to set it up."); return; }
    setEnroll(true);
  }

  async function checkLocation() {
    const p = await getPosition();
    if ("error" in p) { toast.error(p.error); return null; }
    setHere(p);
    return p;
  }

  async function submit(kind: "in" | "out", pos: { lat: number; lng: number; acc: number } | null, f: FaceResult | null) {
    setBusy(kind);
    try {
      let photoPath: string | null = null;
      if (f) photoPath = await uploadFile("attendance-selfies", tenantId!, employeeId!, new File([f.photo], `${kind}.jpg`, { type: "image/jpeg" }));
      const args = { p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_accuracy: pos?.acc ?? null, p_face_descriptor: rules?.require_face && f ? f.descriptor : null, p_photo_path: photoPath, p_user_agent: navigator.userAgent };
      const r = kind === "in"
        ? await rpc<PunchResult>("clock_in", { ...args, p_source: /Mobi/.test(navigator.userAgent) ? "mobile" : "web" })
        : await rpc<PunchResult>("clock_out", args);
      if (!r.ok) {
        toast.error(r.reason ?? "Clock " + kind + " was not accepted");
        if (r.needs_enrollment) openEnroll();
        return;
      }
      toast.success(kind === "in"
        ? `Clocked in${r.branch ? ` at ${r.branch}` : ""}${r.status === "late" ? ` · ${r.late_minutes} min late` : ""}${r.face_score != null ? " · face verified" : ""}`
        : `Clocked out · worked ${minutes(r.worked_minutes ?? 0)}`);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  async function start(kind: "in" | "out") {
    if (rules?.require_face && !rules.face_enrolled) { openEnroll(); return; }
    setBusy(kind);
    let pos: { lat: number; lng: number; acc: number } | null = null;
    if (needsGps) {
      pos = await checkLocation();
      if (!pos) { setBusy(null); return; }
      if (mode === "office" && located.length) {
        const n = located.map((l) => ({ ...l, d: Math.round(metres(pos!.lat, pos!.lng, l.latitude!, l.longitude!)) })).sort((a, b) => a.d - b.d)[0];
        if (kind === "in" && n.d > n.radius_m + Math.min(pos.acc, 100)) { toast.error(`You are ${n.d} m from ${n.name}. Move within ${n.radius_m} m to clock in`); setBusy(null); return; }
      }
    }
    setBusy(null);
    if (needsCamera) { pendingPos.current = pos; setFace(kind); return; }
    await submit(kind, pos, null);
  }

  const inAt = today?.clock_in_at;
  const outAt = today?.clock_out_at;
  const running = inAt && !outAt && now ? Math.floor((now.getTime() - new Date(inAt).getTime()) / 60000) : null;
  const ModeIcon = mode === "remote" ? Home : mode === "field" ? Navigation : MapPin;

  return (
    <Card className="relative overflow-hidden p-6">
      <div className="brand-gradient pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-10" />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-ink-soft">{now?.toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "long" })}</p>
          <p className="mt-1 font-display text-4xl font-bold tabular text-ink">{now?.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
          <p className="mt-1 text-sm text-ink-soft">{shift ? `${shift.name} · ${shift.start.slice(0, 5)}–${shift.end.slice(0, 5)}` : "No shift today"}</p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">{needsCamera ? <ScanFace className="h-6 w-6" /> : <Fingerprint className="h-6 w-6" />}</div>
      </div>

      {rules && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <Badge tone="brand"><ModeIcon className="h-3 w-3" />{mode === "office" ? (located.length ? located.map((l) => l.name).join(", ") : "Office (no geofence yet)") : mode === "field" ? "Field · GPS anywhere" : "Remote"}</Badge>
          {rules.require_face && <Badge tone={rules.face_enrolled ? "green" : "amber"}><ShieldCheck className="h-3 w-3" />{rules.face_enrolled ? "Face ID" : "Face ID not set up"}</Badge>}
          {!rules.require_face && rules.require_selfie && <Badge tone="violet">Selfie</Badge>}
        </div>
      )}
      {needsGps && mode === "office" && located.length > 0 && (
        <button onClick={checkLocation} className={cn("mt-3 flex w-full cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs transition",
          inside == null ? "bg-surface-muted text-ink-soft hover:text-ink" : inside ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
          <LocateFixed className="h-4 w-4 shrink-0" />
          {nearest ? `${nearest.d} m from ${nearest.name} · ${inside ? "inside" : "outside"} the ${nearest.radius_m} m zone (±${Math.round(here!.acc)} m GPS)` : "Check my distance from the office"}
        </button>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-surface-muted py-2.5"><p className="text-[11px] text-ink-soft">In</p><p className="text-sm font-semibold text-ink">{fmtTime(inAt)}</p></div>
        <div className="rounded-2xl bg-surface-muted py-2.5"><p className="text-[11px] text-ink-soft">Out</p><p className="text-sm font-semibold text-ink">{fmtTime(outAt)}</p></div>
        <div className="rounded-2xl bg-surface-muted py-2.5"><p className="text-[11px] text-ink-soft">Worked</p><p className="text-sm font-semibold text-ink">{running != null ? minutes(running) : today?.worked_minutes ? minutes(today.worked_minutes) : "—"}</p></div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          {today?.status && <StatusBadge status={today.status} />}
          {today?.clock_in_distance_m != null && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{today.clock_in_distance_m} m</span>}
        </div>
        {rules?.require_face && !rules.face_enrolled ? (
          <Button size="lg" onClick={openEnroll}><ScanFace className="h-4 w-4" />Set up Face ID</Button>
        ) : !inAt ? (
          <Button size="lg" onClick={() => start("in")} loading={busy === "in"}><LogIn className="h-4 w-4" />Clock in</Button>
        ) : !outAt ? (
          <Button size="lg" variant="danger" onClick={() => start("out")} loading={busy === "out"}><LogOut className="h-4 w-4" />Clock out</Button>
        ) : (
          <span className="text-sm font-medium text-emerald-600">Day complete ✓</span>
        )}
      </div>

      <FaceCapture open={!!face} mode="verify" title={face === "out" ? "Face check · clock out" : "Face check · clock in"}
        onClose={() => setFace(null)} onDone={(r) => { const k = face!; setFace(null); submit(k, pendingPos.current, r); }} />
      {employeeId && <FaceEnroll employeeId={employeeId} open={enroll} onClose={() => setEnroll(false)} />}
    </Card>
  );
}
