"use client";
import { useState } from "react";
import { Palette, Shield, User } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Input } from "@/components/ui";
import { PageHeader, SectionCard } from "@/components/common";
import { AccentPicker, ThemeToggle } from "@/components/theme-controls";
import { useAuth } from "@/lib/auth";
import { q } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { ROLE_INFO } from "@/lib/roles";

export default function ProfilePage() {
  const { ctx, refresh } = useAuth();
  const [name, setName] = useState(ctx?.full_name ?? ""); const [pwd, setPwd] = useState(""); const [busy, setBusy] = useState(false);
  return (
    <div>
      <PageHeader icon={User} title="Account & appearance" subtitle={ctx?.email} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Palette} title="Appearance" subtitle="Saved on this device">
          <div className="space-y-5"><div><p className="mb-2 text-sm font-medium text-ink">Theme</p><ThemeToggle /></div><div><p className="mb-2 text-sm font-medium text-ink">Accent colour</p><AccentPicker /></div></div>
        </SectionCard>
        <SectionCard icon={User} title="Profile">
          <div className="space-y-4">
            <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <p className="text-sm text-ink-soft">Role in {ctx?.tenant?.name}: <span className="font-medium text-ink">{ctx?.role ? ROLE_INFO[ctx.role].label : "—"}</span></p>
            <Button onClick={async () => { try { await q((sb) => sb.from("profiles").update({ full_name: name }).eq("id", ctx!.user_id)); await refresh(); toast.success("Saved"); } catch (e) { toast.error((e as Error).message); } }}>Save</Button>
          </div>
        </SectionCard>
        <SectionCard icon={Shield} title="Password">
          <div className="space-y-4">
            <Field label="New password" hint="At least 8 characters"><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" /></Field>
            <Button loading={busy} disabled={pwd.length < 8} onClick={async () => { setBusy(true); const { error } = await supabase().auth.updateUser({ password: pwd }); setBusy(false); if (error) toast.error(error.message); else { toast.success("Password changed"); setPwd(""); } }}>Change password</Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
