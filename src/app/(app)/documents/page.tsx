"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BadgeCheck, FileText, FolderOpen, Laptop, Plus, Printer, ShieldCheck, Upload } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, Field, Input, Select, Tabs } from "@/components/ui";
import { DataTable, EmptyState, PageHeader, StatusBadge } from "@/components/common";
import { byId, useEmployees } from "@/lib/lookups";
import { openFile, q, uploadFile, useAction, useRows } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { can } from "@/lib/roles";
import { fmtDate, money, title, today } from "@/lib/format";
import { addDays, toISODate } from "@/lib/format";

type Doc = { id: string; employee_id: string; doc_type: string; title: string; file_path: string; expires_on: string | null; is_verified: boolean; created_at: string };
type Letter = { id: string; employee_id: string; kind: string; body: string; verification_code: string; issued_at: string };
type Asset = { id: string; asset_tag: string; name: string; category: string; serial_no: string | null; purchase_cost: number | null; warranty_until: string | null; status: string; assigned_to: string | null; assigned_at: string | null; condition_notes: string | null };
const DOC_TYPES = ["cnic", "passport", "contract", "offer_letter", "degree", "experience_letter", "medical", "certificate", "policy_ack", "other"];

export default function DocumentsPage() {
  const { role, employeeId, tenantId, ctx } = useMe();
  const hr = can.hrStaff(role);
  const params = useSearchParams();
  const { data: emps = [] } = useEmployees(); const E = byId(emps);
  const { data: docs = [] } = useRows<Doc[]>(["documents"], (sb) => sb.from("employee_documents").select("*").order("created_at", { ascending: false }));
  const { data: letters = [] } = useRows<Letter[]>(["letters"], (sb) => sb.from("issued_letters").select("*").order("issued_at", { ascending: false }));
  const { data: assets = [] } = useRows<Asset[]>(["assets"], (sb) => sb.from("assets").select("*").order("asset_tag"));
  const tabs = useMemo(() => [
    ...(employeeId ? [{ value: "mine", label: "My documents" }] : []),
    ...(hr ? [{ value: "all", label: "All documents" }, { value: "expiring", label: "Expiring" }] : []),
    { value: "letters", label: "Letters" },
    { value: "assets", label: hr ? "Assets" : "My assets" },
  ], [employeeId, hr]);
  const [tab, setTab] = useState(params.get("view") && tabs.some((t) => t.value === params.get("view")) ? params.get("view")! : tabs[0].value);
  const [up, setUp] = useState(false); const [letter, setLetter] = useState<Letter | null>(null); const [asset, setAsset] = useState<Partial<Asset> | null>(null);
  const [f, setF] = useState({ employee_id: employeeId ?? "", doc_type: "cnic", title: "", expires_on: "" }); const [file, setFile] = useState<File | null>(null);
  const upload = useAction(async () => { const emp = f.employee_id || employeeId!; const path = await uploadFile("hr-documents", tenantId!, emp, file!); return q((sb) => sb.from("employee_documents").insert({ employee_id: emp, doc_type: f.doc_type, title: f.title || file!.name, file_path: path, expires_on: f.expires_on || null })); },
    { success: "Document uploaded", invalidate: ["documents"], onDone: () => { setUp(false); setFile(null); } });
  const verify = useAction((id: string) => q((sb) => sb.from("employee_documents").update({ is_verified: true }).eq("id", id)), { success: "Verified", invalidate: ["documents"] });
  const saveAsset = useAction(() => {
    const row = { asset_tag: asset!.asset_tag, name: asset!.name, category: asset!.category ?? "laptop", serial_no: asset!.serial_no || null, purchase_cost: asset!.purchase_cost || null, warranty_until: asset!.warranty_until || null,
      assigned_to: asset!.assigned_to || null, status: asset!.assigned_to ? "assigned" : asset!.status === "assigned" ? "available" : asset!.status ?? "available", assigned_at: asset!.assigned_to ? new Date().toISOString() : null, condition_notes: asset!.condition_notes || null };
    return asset!.id ? q((sb) => sb.from("assets").update(row).eq("id", asset!.id!)) : q((sb) => sb.from("assets").insert(row));
  }, { success: "Asset saved", invalidate: ["assets"], onDone: () => setAsset(null) });

  const soon = toISODate(addDays(new Date(), 30));
  const docCols = (showEmp: boolean) => [
    { key: "t", label: "Document", render: (d: Doc) => <button className="cursor-pointer text-left font-medium text-brand-600" onClick={() => openFile("hr-documents", d.file_path)}>{d.title}</button> },
    ...(showEmp ? [{ key: "e", label: "Employee", render: (d: Doc) => E.get(d.employee_id)?.full_name }] : []),
    { key: "k", label: "Type", render: (d: Doc) => title(d.doc_type) },
    { key: "x", label: "Expires", render: (d: Doc) => d.expires_on ? <span className={d.expires_on < today() ? "text-rose-600" : d.expires_on <= soon ? "text-amber-600" : ""}>{fmtDate(d.expires_on)}</span> : "—" },
    { key: "v", label: "Status", render: (d: Doc) => d.is_verified ? <Badge tone="green" dot>Verified</Badge> : hr ? <Button size="sm" variant="subtle" onClick={(e) => { e.stopPropagation(); verify.mutate(d.id); }}><BadgeCheck className="h-4 w-4" />Verify</Button> : <Badge tone="amber" dot>Pending HR</Badge> },
  ];
  return (
    <div>
      <PageHeader icon={FolderOpen} title="Documents & assets" subtitle="Secure document vault, verifiable HR letters and company asset tracking.">
        {(tab === "mine" || tab === "all") && <Button onClick={() => { setF({ ...f, employee_id: tab === "mine" ? employeeId ?? "" : "" }); setUp(true); }}><Upload className="h-4 w-4" />Upload</Button>}
        {tab === "assets" && hr && <Button onClick={() => setAsset({ category: "laptop", status: "available" })}><Plus className="h-4 w-4" />Add asset</Button>}
      </PageHeader>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />
      {tab === "mine" && <Card className="p-4"><DataTable rows={docs.filter((d) => d.employee_id === employeeId)} columns={docCols(false)} empty={<EmptyState icon={FileText} title="No documents yet" text="Upload your CNIC, degrees and experience letters." />} /></Card>}
      {tab === "all" && <Card className="p-4"><DataTable rows={docs} columns={docCols(true)} empty={<EmptyState title="No documents" />} /></Card>}
      {tab === "expiring" && <Card className="p-4"><DataTable rows={docs.filter((d) => d.expires_on && d.expires_on <= soon).sort((a, b) => (a.expires_on ?? "").localeCompare(b.expires_on ?? ""))} columns={docCols(true)} empty={<EmptyState icon={ShieldCheck} title="Nothing expiring in 30 days" />} /></Card>}
      {tab === "letters" && <Card className="p-4"><DataTable rows={letters} onRowClick={setLetter} columns={[
        { key: "k", label: "Letter", render: (l) => <span className="font-medium">{title(l.kind)}</span> },
        { key: "e", label: "Employee", render: (l) => E.get(l.employee_id)?.full_name },
        { key: "d", label: "Issued", render: (l) => fmtDate(l.issued_at) },
        { key: "c", label: "Verification code", render: (l) => <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{l.verification_code}</code> },
      ]} empty={<EmptyState icon={FileText} title="No letters issued" text={hr ? "Issue letters from an employee's profile." : "Ask HR for a salary certificate or NOC through the helpdesk."} />} /></Card>}
      {tab === "assets" && <Card className="p-4"><DataTable rows={hr ? assets : assets.filter((a) => a.assigned_to === employeeId)} onRowClick={hr ? (a) => setAsset(a) : undefined} columns={[
        { key: "t", label: "Asset", render: (a) => <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-muted"><Laptop className="h-4 w-4 text-ink-soft" /></div><div><p className="font-medium">{a.name}</p><p className="text-xs text-ink-soft">{a.asset_tag} · {title(a.category)}</p></div></div> },
        { key: "a", label: "Assigned to", render: (a) => a.assigned_to ? <span className="flex items-center gap-2"><Avatar name={E.get(a.assigned_to)?.full_name} size="xs" />{E.get(a.assigned_to)?.full_name}</span> : "—" },
        { key: "w", label: "Warranty", render: (a) => fmtDate(a.warranty_until), hideOnMobile: true },
        { key: "c", label: "Cost", render: (a) => money(a.purchase_cost), hideOnMobile: true },
        { key: "s", label: "Status", render: (a) => <StatusBadge status={a.status} /> },
      ]} empty={<EmptyState icon={Laptop} title="No assets" />} /></Card>}

      <Dialog open={up} onClose={() => setUp(false)} title="Upload document">
        <div className="space-y-4">
          {hr && tab === "all" && <Field label="Employee"><Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}><option value="">Select</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>}
          <Field label="Type"><Select value={f.doc_type} onChange={(e) => setF({ ...f, doc_type: e.target.value })}>{DOC_TYPES.map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select></Field>
          <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="CNIC front and back" /></Field>
          <Field label="Expiry date"><Input type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} /></Field>
          <label className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line text-sm text-ink-soft hover:bg-surface-muted"><Upload className="h-5 w-5" />{file ? file.name : "Choose a file (max 10 MB)"}<input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setUp(false)}>Cancel</Button><Button onClick={() => upload.mutate()} disabled={!file || (tab === "all" && !f.employee_id)} loading={upload.isPending}>Upload</Button></div>
        </div>
      </Dialog>
      <Dialog open={!!letter} onClose={() => setLetter(null)} className="max-w-2xl">
        {letter && <>
          <div className="print-area rounded-2xl border border-line p-8"><p className="font-display text-lg font-bold text-ink">{ctx?.tenant?.name}</p><p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-ink">{letter.body}</p>
            <p className="mt-8 text-xs text-ink-soft">Verify this letter at {typeof window !== "undefined" ? window.location.origin : ""}/verify?code={letter.verification_code}</p></div>
          <div className="no-print mt-4 flex justify-end"><Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / save PDF</Button></div>
        </>}
      </Dialog>
      <Dialog open={!!asset} onClose={() => setAsset(null)} title={asset?.id ? "Edit asset" : "New asset"} className="max-w-xl">
        {asset && <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Asset tag"><Input value={asset.asset_tag ?? ""} onChange={(e) => setAsset({ ...asset, asset_tag: e.target.value })} placeholder="LAP-001" /></Field>
          <Field label="Name"><Input value={asset.name ?? ""} onChange={(e) => setAsset({ ...asset, name: e.target.value })} placeholder="Dell Latitude 5440" /></Field>
          <Field label="Category"><Select value={asset.category} onChange={(e) => setAsset({ ...asset, category: e.target.value })}>{["laptop", "phone", "sim", "vehicle", "id_card", "tool", "uniform", "other"].map((c) => <option key={c} value={c}>{title(c)}</option>)}</Select></Field>
          <Field label="Serial no."><Input value={asset.serial_no ?? ""} onChange={(e) => setAsset({ ...asset, serial_no: e.target.value })} /></Field>
          <Field label="Cost"><Input type="number" value={asset.purchase_cost ?? ""} onChange={(e) => setAsset({ ...asset, purchase_cost: Number(e.target.value) })} /></Field>
          <Field label="Warranty until"><Input type="date" value={asset.warranty_until ?? ""} onChange={(e) => setAsset({ ...asset, warranty_until: e.target.value })} /></Field>
          <Field label="Assigned to"><Select value={asset.assigned_to ?? ""} onChange={(e) => setAsset({ ...asset, assigned_to: e.target.value || null })}><option value="">Not assigned</option>{emps.filter((e) => e.status !== "exited").map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
          <Field label="Status"><Select value={asset.status} onChange={(e) => setAsset({ ...asset, status: e.target.value })} disabled={!!asset.assigned_to}>{["available", "assigned", "repair", "lost", "retired"].map((c) => <option key={c} value={c}>{title(c)}</option>)}</Select></Field>
          <Field label="Condition notes" className="sm:col-span-2"><Input value={asset.condition_notes ?? ""} onChange={(e) => setAsset({ ...asset, condition_notes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={() => setAsset(null)}>Cancel</Button><Button onClick={() => saveAsset.mutate()} disabled={!asset.asset_tag || !asset.name} loading={saveAsset.isPending}>Save</Button></div>
        </div>}
      </Dialog>
    </div>
  );
}
