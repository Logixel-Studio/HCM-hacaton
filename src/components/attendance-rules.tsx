"use client";
import { useMemo, useState } from "react";
import { CheckCircle2, Home, MapPin, Navigation, RotateCcw, ScanFace, Settings2, ShieldCheck, UserCog } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, Field, Input, Select } from "@/components/ui";
import { DataTable, EmptyState, SearchInput, SectionCard } from "@/components/common";
import { BranchesTable } from "@/components/branches-table";
import { FaceEnroll } from "@/components/clock-card";
import { byId, useBranches, useDepartments, useEmployees } from "@/lib/lookups";
import { q, rpc, useAction, useRows, useRpc, openFile } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Rule = { employee_id: string; mode: "office" | "field" | "remote"; allowed_branch_ids: string[]; require_selfie: boolean | null; require_face: boolean | null; notes: string | null; updated_at: string };
type Settings = { tenant_id: string; default_mode: "office" | "field" | "remote"; require_selfie: boolean; require_face: boolean; face_threshold: number; max_gps_accuracy_m: number; allow_self_enrollment: boolean; geofence_on_clock_out: boolean };
type FaceRow = { employee_id: string; enrolled_at: string; photo_path: string | null };

const MODES = [
  { value: "office", label: "Office", icon: MapPin, text: "Must be inside an allowed location's geofence" },
  { value: "field", label: "Field", icon: Navigation, text: "GPS required, any location (sales, drivers, technicians)" },
  { value: "remote", label: "Remote", icon: Home, text: "No location needed (work from home)" },
] as const;
const tri = (v: boolean | null) => (v == null ? "default" : v ? "yes" : "no");
const fromTri = (v: string) => (v === "default" ? null : v === "yes");

function CompanyDefaults() {
  const { role } = useMe();
  const { data: s } = useRows<Settings | null>(["attendance", "settings"], (sb) => sb.from("attendance_settings").select("*").maybeSingle());
  const [f, setF] = useState<Partial<Settings>>({});
  const v = { ...(s ?? {}), ...f } as Settings;
  const save = useAction(() => q((sb) => sb.from("attendance_settings").update(f).eq("tenant_id", s!.tenant_id)), { success: "Attendance defaults saved", invalidate: ["attendance"], onDone: () => setF({}) });
  const edit = can.hrLead(role);
  if (!s) return null;
  return (
    <SectionCard icon={Settings2} title="Company defaults" subtitle="Used for everyone who has no personal rule">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Default mode"><Select disabled={!edit} value={v.default_mode} onChange={(e) => setF({ ...f, default_mode: e.target.value as Settings["default_mode"] })}>{MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></Field>
        <Field label="Face match strictness" hint="Strict reduces false matches; relaxed helps in poor light">
          <Select disabled={!edit} value={String(v.face_threshold)} onChange={(e) => setF({ ...f, face_threshold: Number(e.target.value) })}>
            <option value="0.45">Strict</option><option value="0.5">Normal (recommended)</option><option value="0.55">Relaxed</option>
          </Select>
        </Field>
        <Field label="Max GPS inaccuracy (m)" hint="Clock-ins with a weaker signal are refused in office mode"><Input disabled={!edit} type="number" value={v.max_gps_accuracy_m} onChange={(e) => setF({ ...f, max_gps_accuracy_m: Number(e.target.value) })} /></Field>
      </div>
      <div className="mt-4 grid gap-2 text-sm text-ink sm:grid-cols-2">
        {([["require_face", "Require Face ID for everyone"], ["require_selfie", "Require a selfie with every punch"], ["allow_self_enrollment", "Employees can set up their own Face ID once"], ["geofence_on_clock_out", "Block clock-out outside the geofence (otherwise just flag it)"]] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2"><input type="checkbox" disabled={!edit} checked={!!v[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{label}</label>
        ))}
      </div>
      {edit && <Button className="mt-4" onClick={() => save.mutate()} disabled={!Object.keys(f).length} loading={save.isPending}>Save defaults</Button>}
    </SectionCard>
  );
}

function AssignDialog({ open, onClose, employeeIds, initial }: { open: boolean; onClose: () => void; employeeIds: string[]; initial?: Rule }) {
  const { data: branches = [] } = useBranches();
  const [mode, setMode] = useState<Rule["mode"]>(initial?.mode ?? "office");
  const [locs, setLocs] = useState<string[]>(initial?.allowed_branch_ids ?? []);
  const [face, setFace] = useState(tri(initial?.require_face ?? null));
  const [selfie, setSelfie] = useState(tri(initial?.require_selfie ?? null));
  const save = useAction(() => rpc<number>("set_attendance_rules", { p_employees: employeeIds, p_mode: mode, p_branch_ids: mode === "office" ? locs : [], p_require_selfie: fromTri(selfie), p_require_face: fromTri(face) }),
    { success: (n) => `Rules assigned to ${n} employee${n === 1 ? "" : "s"}`, invalidate: ["attendance"], onDone: onClose });
  return (
    <Dialog open={open} onClose={onClose} title={`Assign attendance rule · ${employeeIds.length} employee${employeeIds.length === 1 ? "" : "s"}`} className="max-w-2xl">
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium text-ink">How do they clock in?</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button key={m.value} onClick={() => setMode(m.value)} className={cn("cursor-pointer rounded-2xl border p-3 text-left transition", mode === m.value ? "border-brand-400 bg-brand-50" : "border-line hover:bg-surface-muted")}>
                <m.icon className={cn("h-5 w-5", mode === m.value ? "text-brand-600" : "text-ink-soft")} />
                <p className="mt-2 text-sm font-semibold text-ink">{m.label}</p><p className="text-xs text-ink-soft">{m.text}</p>
              </button>
            ))}
          </div>
        </div>
        {mode === "office" && (
          <div>
            <p className="mb-1 text-sm font-medium text-ink">Allowed locations</p>
            <p className="mb-2 text-xs text-ink-soft">Pick one or more. Leave empty to use each employee&apos;s own branch.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {branches.filter((b) => b.is_active).map((b) => (
                <label key={b.id} className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border p-3", locs.includes(b.id) ? "border-brand-400 bg-brand-50" : "border-line")}>
                  <input type="checkbox" checked={locs.includes(b.id)} onChange={(e) => setLocs(e.target.checked ? [...locs, b.id] : locs.filter((x) => x !== b.id))} />
                  <span className="min-w-0"><span className="block text-sm font-medium text-ink">{b.name}</span>
                    <span className={cn("block text-xs", b.latitude != null ? "text-ink-soft" : "text-amber-600")}>{b.latitude != null ? `Geofence ${b.geofence_radius_m} m` : "No GPS point yet — add it under Locations"}</span></span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Face ID"><Select value={face} onChange={(e) => setFace(e.target.value)}><option value="default">Company default</option><option value="yes">Required</option><option value="no">Not required</option></Select></Field>
          <Field label="Selfie with each punch" hint="Face ID always includes a selfie"><Select value={selfie} onChange={(e) => setSelfie(e.target.value)}><option value="default">Company default</option><option value="yes">Required</option><option value="no">Not required</option></Select></Field>
        </div>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending}>Assign</Button></div>
      </div>
    </Dialog>
  );
}

export function AttendanceRules() {
  const { role } = useMe();
  const { data: emps = [] } = useEmployees();
  const { data: depts = [] } = useDepartments();
  const { data: branches = [] } = useBranches();
  const { data: rules = [] } = useRows<Rule[]>(["attendance", "rules", "all"], (sb) => sb.from("employee_attendance_rules").select("*"));
  const { data: faces = [] } = useRpc<FaceRow[]>(["attendance", "faces"], "face_status");
  const { data: settings } = useRows<Settings | null>(["attendance", "settings"], (sb) => sb.from("attendance_settings").select("*").maybeSingle());
  const D = byId(depts), B = byId(branches);
  const R = new Map(rules.map((r) => [r.employee_id, r])); const F = new Map(faces.map((f) => [f.employee_id, f]));
  const [sel, setSel] = useState<string[]>([]);
  const [term, setTerm] = useState(""); const [dept, setDept] = useState("");
  const [assign, setAssign] = useState<{ ids: string[]; initial?: Rule } | null>(null);
  const [enrollFor, setEnrollFor] = useState<string | null>(null);
  const reset = useAction((id: string) => rpc("reset_face", { p_employee: id }), { success: "Face ID reset — the employee can set it up again", invalidate: ["attendance"] });
  const list = useMemo(() => emps.filter((e) => e.status !== "exited" && (!dept || e.department_id === dept) && (!term || e.full_name.toLowerCase().includes(term.toLowerCase()))), [emps, dept, term]);
  const all = list.length > 0 && list.every((e) => sel.includes(e.id));
  const hr = can.hrStaff(role);

  return (
    <div className="space-y-4">
      <CompanyDefaults />
      <Card className="p-4">
        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex-1"><p className="font-semibold text-ink">Employee rules & Face ID</p><p className="text-sm text-ink-soft">Select employees and assign how they clock in.</p></div>
          <SearchInput value={term} onChange={setTerm} placeholder="Search" className="lg:w-56" />
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="lg:w-48"><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          {hr && <Button disabled={!sel.length} onClick={() => setAssign({ ids: sel })}><UserCog className="h-4 w-4" />Assign rule{sel.length ? ` (${sel.length})` : ""}</Button>}
        </div>
        <DataTable rows={list} columns={[
          ...(hr ? [{ key: "x", label: <input type="checkbox" checked={all} onChange={(e) => setSel(e.target.checked ? list.map((x) => x.id) : [])} />, render: (e: (typeof list)[number]) => <input type="checkbox" checked={sel.includes(e.id)} onClick={(ev) => ev.stopPropagation()} onChange={(ev) => setSel(ev.target.checked ? [...sel, e.id] : sel.filter((x) => x !== e.id))} />, className: "w-10" }] : []),
          { key: "n", label: "Employee", render: (e) => <span className="flex items-center gap-2"><Avatar name={e.full_name} size="sm" /><span><span className="block font-medium">{e.full_name}</span><span className="block text-xs text-ink-soft">{D.get(e.department_id ?? "")?.name ?? e.job_title}</span></span></span> },
          { key: "m", label: "Mode", render: (e) => { const r = R.get(e.id); const m = r?.mode ?? settings?.default_mode ?? "office"; return <span className="flex flex-col items-start"><Badge tone={m === "office" ? "brand" : m === "field" ? "violet" : "neutral"}>{MODES.find((x) => x.value === m)?.label}</Badge>{!r && <span className="text-[11px] text-ink-soft">company default</span>}</span>; } },
          { key: "l", label: "Locations", render: (e) => { const r = R.get(e.id); const m = r?.mode ?? settings?.default_mode ?? "office"; if (m !== "office") return <span className="text-ink-soft">—</span>;
            const ids = r?.allowed_branch_ids?.length ? r.allowed_branch_ids : e.branch_id ? [e.branch_id] : [];
            return <span className="text-xs">{ids.map((id) => <span key={id} className={cn("mr-1 inline-block", B.get(id)?.latitude == null && "text-amber-600")}>{B.get(id)?.name}{B.get(id)?.latitude == null ? " (no GPS)" : ""}</span>)}{!ids.length && <span className="text-amber-600">No location</span>}</span>; }, hideOnMobile: true },
          { key: "f", label: "Face ID", render: (e) => { const r = R.get(e.id); const req = r?.require_face ?? settings?.require_face ?? false; const f = F.get(e.id);
            return <span className="flex flex-col items-start gap-0.5">{f ? <Badge tone="green" dot>Enrolled</Badge> : <Badge tone={req ? "amber" : "neutral"} dot>{req ? "Not set up" : "Off"}</Badge>}<span className="text-[11px] text-ink-soft">{req ? "required" : "not required"}{f ? ` · ${fmtDate(f.enrolled_at)}` : ""}</span></span>; } },
          ...(hr ? [{ key: "a", label: "", render: (e: (typeof list)[number]) => (
            <div className="flex justify-end gap-1" onClick={(ev) => ev.stopPropagation()}>
              <Button size="sm" variant="ghost" onClick={() => setAssign({ ids: [e.id], initial: R.get(e.id) })}>Edit</Button>
              {F.get(e.id) ? <>
                {F.get(e.id)!.photo_path && <Button size="sm" variant="ghost" onClick={() => openFile("attendance-selfies", F.get(e.id)!.photo_path!)}>Photo</Button>}
                <Button size="sm" variant="ghost" onClick={() => confirm(`Reset Face ID for ${e.full_name}?`) && reset.mutate(e.id)}><RotateCcw className="h-4 w-4" /></Button>
              </> : <Button size="sm" variant="subtle" onClick={() => setEnrollFor(e.id)}><ScanFace className="h-4 w-4" />Enroll</Button>}
            </div>
          ) }] : []),
        ]} empty={<EmptyState title="No employees" />} />
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-soft"><ShieldCheck className="h-3.5 w-3.5" />Face data is stored as numbers that cannot be turned back into a photo, and only the server compares them. “Enroll” uses this device&apos;s camera with the employee present.</p>
      </Card>
      <BranchesTable canEdit={can.hrLead(role)} />
      {assign && <AssignDialog open onClose={() => { setAssign(null); setSel([]); }} employeeIds={assign.ids} initial={assign.initial} />}
      {enrollFor && <FaceEnroll employeeId={enrollFor} open onClose={() => setEnrollFor(null)} />}
      {!branches.some((b) => b.latitude != null) && (
        <div className="flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700"><CheckCircle2 className="h-4 w-4" />No location has a GPS point yet, so office clock-ins are not geofenced. Edit a location below and press “Use my current location”.</div>
      )}
    </div>
  );
}
