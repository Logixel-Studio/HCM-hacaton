"use client";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { DataTable, EmptyState } from "@/components/common";
import { q, useAction, useRows } from "@/lib/api";

export type CrudField = {
  key: string; label: string; type?: "text" | "number" | "date" | "time" | "checkbox" | "select" | "color" | "textarea" | "days";
  options?: { value: string; label: string }[]; hint?: string; required?: boolean; list?: boolean; render?: (v: unknown, row: Record<string, unknown>) => React.ReactNode; full?: boolean; default?: unknown;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Generic list + add/edit/delete for a tenant table. RLS decides what actually saves. */
export function CrudTable({ table, fields, order = "created_at", title, canEdit = true, extra, emptyText, onSaved }: {
  table: string; fields: CrudField[]; order?: string; title: string; canEdit?: boolean; extra?: (row: Record<string, unknown>, set: (r: Record<string, unknown>) => void) => React.ReactNode; emptyText?: string; onSaved?: () => void;
}) {
  const { data: rows = [] } = useRows<Record<string, unknown>[]>([table, "crud"], (sb) => sb.from(table).select("*").order(order));
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const clean = (r: Record<string, unknown>) => Object.fromEntries(fields.map((f) => {
    let v = r[f.key];
    if (f.type === "number") v = v === "" || v == null ? null : Number(v);
    else if (f.type === "checkbox") v = !!v;
    else if (v === "") v = null;
    return [f.key, v];
  }));
  const save = useAction(() => edit!.id ? q((sb) => sb.from(table).update(clean(edit!)).eq("id", edit!.id as string)) : q((sb) => sb.from(table).insert(clean(edit!))),
    { success: `${title} saved`, invalidate: [table], onDone: () => { setEdit(null); onSaved?.(); } });
  const del = useAction((id: string) => q((sb) => sb.from(table).delete().eq("id", id)), { success: "Deleted", invalidate: [table] });
  const blank = () => Object.fromEntries(fields.map((f) => [f.key, f.default ?? (f.type === "checkbox" ? false : f.type === "days" ? [1, 2, 3, 4, 5, 6] : "")]));
  const show = (f: CrudField, v: unknown, row: Record<string, unknown>) => f.render ? f.render(v, row) : f.type === "checkbox" ? (v ? "Yes" : "No") : f.type === "color" ? <span className="inline-block h-4 w-4 rounded-full" style={{ background: String(v) }} /> : f.type === "select" ? f.options?.find((o) => o.value === v)?.label ?? "—" : f.type === "days" ? (v as number[] | null)?.map((d) => DAYS[d]).join(" ") : v == null || v === "" ? "—" : String(v);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between"><p className="font-semibold text-ink">{title}</p>{canEdit && <Button size="sm" onClick={() => setEdit(blank())}><Plus className="h-4 w-4" />Add</Button>}</div>
      <DataTable rows={rows} columns={[
        ...fields.filter((f) => f.list !== false).map((f) => ({ key: f.key, label: f.label, render: (r: Record<string, unknown>) => show(f, r[f.key], r) })),
        ...(canEdit ? [{ key: "_a", label: "", render: (r: Record<string, unknown>) => <div className="flex justify-end gap-1"><button className="cursor-pointer rounded-lg p-1.5 text-ink-soft hover:bg-surface-muted hover:text-ink" onClick={() => setEdit(r)}><Pencil className="h-4 w-4" /></button><button className="cursor-pointer rounded-lg p-1.5 text-ink-soft hover:bg-rose-50 hover:text-rose-600" onClick={() => confirm("Delete this record?") && del.mutate(r.id as string)}><Trash2 className="h-4 w-4" /></button></div> }] : []),
      ]} empty={<EmptyState title={`No ${title.toLowerCase()} yet`} text={emptyText} />} />
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${title.toLowerCase()}` : `Add ${title.toLowerCase()}`} className="max-w-2xl">
        {edit && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <Field key={f.key} label={f.label + (f.required ? " *" : "")} hint={f.hint} className={f.full || f.type === "textarea" || f.type === "days" ? "sm:col-span-2" : undefined}>
                  {f.type === "checkbox" ? <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={!!edit[f.key]} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.checked })} />{f.label}</label>
                    : f.type === "select" ? <Select value={String(edit[f.key] ?? "")} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })}><option value="">—</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                    : f.type === "textarea" ? <Textarea rows={8} value={String(edit[f.key] ?? "")} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} />
                    : f.type === "days" ? <div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => { const on = ((edit[f.key] as number[]) ?? []).includes(i); return <button key={d} type="button" onClick={() => setEdit({ ...edit, [f.key]: on ? (edit[f.key] as number[]).filter((x) => x !== i) : [...((edit[f.key] as number[]) ?? []), i].sort() })} className={`h-9 w-12 cursor-pointer rounded-xl text-sm font-medium ${on ? "brand-gradient text-white" : "bg-surface-muted text-ink-soft"}`}>{d}</button>; })}</div>
                    : <Input type={f.type === "color" ? "color" : f.type ?? "text"} className={f.type === "color" ? "h-10 p-1" : undefined} value={String(edit[f.key] ?? "")} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} />}
                </Field>
              ))}
            </div>
            {extra?.(edit, setEdit)}
            <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={fields.some((f) => f.required && (edit[f.key] == null || edit[f.key] === ""))}>Save</Button></div>
          </>
        )}
      </Dialog>
    </Card>
  );
}
