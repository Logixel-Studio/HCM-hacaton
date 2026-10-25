"use client";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "./supabase";

/** Turn Postgres / PostgREST errors into a sentence a user can act on. */
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message || String(e);
  if (/row-level security/i.test(msg)) return "You do not have permission to do that.";
  if (/permission denied/i.test(msg)) return "You do not have permission to do that.";
  if (/duplicate key/i.test(msg)) return "That record already exists.";
  if (/violates foreign key/i.test(msg)) return "This record is linked to other data and cannot be changed that way.";
  if (/violates check constraint/i.test(msg)) return "One of the values is not allowed. Please check the form.";
  if (/schema cache|Could not find the (function|table)/i.test(msg)) return `Database setup not found in project "${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/^https?:\/\//, "").split(".")[0]}". Run supabase/hcm_full_schema.sql in THIS project's SQL editor (check the project ID in .env.local), then run: notify pgrst, 'reload schema';`;
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Cannot reach the server. Check your connection.";
  return msg;
}

/** Call a Postgres function (RPC) and throw a readable error. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

/** Run any PostgREST query builder and throw a readable error. */
export async function q<T = unknown>(build: (sb: SupabaseClient) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await build(supabase());
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

export function useRpc<T = unknown>(key: QueryKey, fn: string, args?: Record<string, unknown>, opts?: { enabled?: boolean }) {
  return useQuery<T>({ queryKey: key, queryFn: () => rpc<T>(fn, args), enabled: opts?.enabled ?? true });
}

export function useRows<T = unknown>(key: QueryKey, build: (sb: SupabaseClient) => PromiseLike<{ data: unknown; error: unknown }>, opts?: { enabled?: boolean }) {
  return useQuery<T>({ queryKey: key, queryFn: () => q<T>(build), enabled: opts?.enabled ?? true });
}

/** A mutation with toasts and cache invalidation. `invalidate` lists query-key prefixes to refresh. */
export function useAction<A = void, R = unknown>(fn: (args: A) => Promise<R>, opts?: { success?: string | ((r: R) => string); invalidate?: string[]; onDone?: (r: R) => void }) {
  const qc = useQueryClient();
  return useMutation<R, Error, A>({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts?.success) toast.success(typeof opts.success === "function" ? opts.success(r) : opts.success);
      (opts?.invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      opts?.onDone?.(r);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
}

/** Upload a file to a private bucket under {tenant}/{folder}/ and return its path. */
export async function uploadFile(bucket: string, tenantId: string, folder: string, file: File) {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${tenantId}/${folder}/${Date.now()}-${safe}`;
  const { error } = await supabase().storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw new Error(friendlyError(error));
  return path;
}

export async function openFile(bucket: string, path: string) {
  const { data, error } = await supabase().storage.from(bucket).createSignedUrl(path, 120);
  if (error) { toast.error(friendlyError(error)); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

export function downloadText(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
