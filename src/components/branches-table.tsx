"use client";
import { LocateFixed } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { CrudTable } from "@/components/crud";
import { useRows } from "@/lib/api";

/** Offices / sites with GPS coordinates and geofence radius. */
export function BranchesTable({ canEdit }: { canEdit: boolean }) {
  const { data: entities = [] } = useRows<{ id: string; name: string }[]>(["legal_entities"], (sb) => sb.from("legal_entities").select("id, name"));
  return (
    <CrudTable table="branches" title="Locations & geofences" order="name" canEdit={canEdit}
      emptyText="Add each office, factory, store or site. Stand at the location and press “Use my current location” to capture its GPS point."
      fields={[
        { key: "name", label: "Name", required: true }, { key: "code", label: "Code" }, { key: "city", label: "City" },
        { key: "address", label: "Address", list: false, full: true },
        { key: "latitude", label: "Latitude", type: "number", list: false }, { key: "longitude", label: "Longitude", type: "number", list: false },
        { key: "geofence_radius_m", label: "Geofence radius (m)", type: "number", default: 150, hint: "Use 100–200 m for offices; 300+ m for large factories",
          render: (v, r) => (r.latitude != null ? `${v} m` : <span className="text-amber-600">No GPS point</span>) },
        { key: "legal_entity_id", label: "Legal entity", type: "select", options: entities.map((x) => ({ value: x.id, label: x.name })), list: false },
        { key: "is_active", label: "Active", type: "checkbox", default: true },
      ]}
      extra={(row, set) => (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigator.geolocation?.getCurrentPosition(
            (p) => { set({ ...row, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) }); toast.success(`Location captured (±${Math.round(p.coords.accuracy)} m)`); },
            () => toast.error("Location permission denied"), { enableHighAccuracy: true, timeout: 15000 })}>
            <LocateFixed className="h-4 w-4" />Use my current location
          </Button>
          {row.latitude != null && row.latitude !== "" && (
            <a className="text-xs font-medium text-brand-600" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`}>Check on Google Maps ↗</a>
          )}
          <span className="text-xs text-ink-soft">Or paste coordinates from Google Maps (right-click the spot → copy the numbers).</span>
        </div>
      )} />
  );
}
