"use client";
import { useRows } from "./api";

export type Department = { id: string; name: string; code: string | null; parent_id: string | null; head_employee_id: string | null; cost_center_id: string | null };
export type Branch = { id: string; name: string; code: string | null; city: string | null; address: string | null; latitude: number | null; longitude: number | null; geofence_radius_m: number; is_active: boolean; legal_entity_id: string | null };
export type Grade = { id: string; code: string; name: string; band_min: number; band_mid: number; band_max: number; sort_order: number };
export type Shift = { id: string; name: string; start_time: string; end_time: string; grace_minutes: number; break_minutes: number; half_day_minutes: number; working_days: number[]; is_night: boolean; color: string };
export type LeaveType = { id: string; code: string; name: string; days_per_year: number; accrual: string; carry_forward_max: number; is_paid: boolean; requires_document_after_days: number | null; max_consecutive_days: number | null; min_service_days: number; allow_half_day: boolean; encashable: boolean; gender_restriction: string | null; count_weekly_offs: boolean; color: string; is_active: boolean };
export type EmployeeLite = { id: string; full_name: string; employee_code: string; job_title: string | null; department_id: string | null; branch_id: string | null; manager_id: string | null; status: string; photo_url: string | null; user_id: string | null; work_email: string | null; employment_type: string; joining_date: string; grade_id: string | null; shift_id: string | null; gender: string | null; phone: string | null; skills: string[] };

export const useDepartments = () => useRows<Department[]>(["departments"], (sb) => sb.from("departments").select("*").order("name"));
export const useBranches = () => useRows<Branch[]>(["branches"], (sb) => sb.from("branches").select("*").order("name"));
export const useGrades = () => useRows<Grade[]>(["grades"], (sb) => sb.from("grades").select("*").order("sort_order"));
export const useShifts = () => useRows<Shift[]>(["shifts"], (sb) => sb.from("shifts").select("*").order("start_time"));
export const useLeaveTypes = () => useRows<LeaveType[]>(["leave_types"], (sb) => sb.from("leave_types").select("*").order("code"));
export const useEmployees = () => useRows<EmployeeLite[]>(["employees"], (sb) =>
  sb.from("employees").select("id, full_name, employee_code, job_title, department_id, branch_id, manager_id, status, photo_url, user_id, work_email, employment_type, joining_date, grade_id, shift_id, gender, phone, skills").order("full_name"));

/** Map helpers: id → record. */
export function byId<T extends { id: string }>(rows?: T[]) {
  const m = new Map<string, T>();
  (rows ?? []).forEach((r) => m.set(r.id, r));
  return m;
}
