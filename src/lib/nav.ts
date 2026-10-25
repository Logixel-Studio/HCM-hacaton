import {
  LayoutDashboard, Inbox, Users, Clock, CalendarDays, Wallet, Receipt, Briefcase, Workflow, Target, GraduationCap,
  Heart, LifeBuoy, FolderOpen, BarChart3, ShieldCheck, Settings, ScrollText, Building2, FileText, type LucideIcon,
} from "lucide-react";
import { can, type Role } from "./roles";

export type Ctx = { role: Role | null; hasReports: boolean; hasEmployee: boolean; isPlatformAdmin: boolean; hidden?: string[] };
export type NavItem = { href: string; label: string; icon: LucideIcon; group: "work" | "talent" | "people" | "admin"; show: (c: Ctx) => boolean };

const any = () => true;
const emp = (c: Ctx) => c.hasEmployee;

/** Navigation by role, following brief §21 "Feature access by role". */
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "work", show: any },
  { href: "/approvals", label: "Approvals", icon: Inbox, group: "work", show: (c) => c.hasReports || can.hrStaff(c.role) || can.finance(c.role) || can.runPayroll(c.role) || can.recruiting(c.role) },
  { href: "/people", label: "People", icon: Users, group: "people", show: (c) => c.hasEmployee || can.hrStaff(c.role) || can.auditor(c.role) },
  { href: "/attendance", label: "Attendance", icon: Clock, group: "work", show: (c) => emp(c) || can.hrStaff(c.role) },
  { href: "/leave", label: "Leave", icon: CalendarDays, group: "work", show: (c) => emp(c) || can.hrStaff(c.role) },
  { href: "/payroll", label: "Payroll", icon: Wallet, group: "work", show: (c) => can.viewPay(c.role) },
  { href: "/payslips", label: "My payslips", icon: FileText, group: "work", show: emp },
  { href: "/expenses", label: "Expenses & loans", icon: Receipt, group: "work", show: (c) => emp(c) || can.finance(c.role) },
  { href: "/recruitment", label: "Recruitment", icon: Briefcase, group: "talent", show: (c) => can.recruiting(c.role) || c.role === "hiring_manager" || c.role === "line_manager" || can.auditor(c.role) },
  { href: "/lifecycle", label: "On & offboarding", icon: Workflow, group: "talent", show: (c) => emp(c) || can.hrStaff(c.role) || can.viewPay(c.role) },
  { href: "/performance", label: "Performance", icon: Target, group: "talent", show: (c) => (emp(c) || can.hrLead(c.role)) && c.role !== "finance_controller" },
  { href: "/learning", label: "Learning", icon: GraduationCap, group: "talent", show: (c) => emp(c) || can.hrStaff(c.role) },
  { href: "/engagement", label: "Engagement", icon: Heart, group: "people", show: (c) => emp(c) || can.hrStaff(c.role) },
  { href: "/helpdesk", label: "Helpdesk", icon: LifeBuoy, group: "people", show: (c) => emp(c) || can.hrStaff(c.role) },
  { href: "/documents", label: "Documents & assets", icon: FolderOpen, group: "people", show: (c) => emp(c) || can.hrStaff(c.role) },
  { href: "/analytics", label: "Analytics", icon: BarChart3, group: "admin", show: (c) => can.analytics(c.role) },
  { href: "/users", label: "Users & roles", icon: ShieldCheck, group: "admin", show: (c) => can.hrLead(c.role) || can.auditor(c.role) },
  { href: "/audit", label: "Audit log", icon: ScrollText, group: "admin", show: (c) => can.tenantAdmin(c.role) || can.auditor(c.role) || c.role === "hr_director" },
  { href: "/settings", label: "Settings", icon: Settings, group: "admin", show: (c) => can.hrStaff(c.role) || can.viewPay(c.role) || can.finance(c.role) },
  { href: "/platform", label: "Platform", icon: Building2, group: "admin", show: (c) => c.isPlatformAdmin },
];

export const GROUP_LABEL = { work: "Workspace", talent: "Talent", people: "Employee experience", admin: "Administration" } as const;

/** Custom roles can hide modules (brief §2); the database still enforces data access. */
export const navFor = (c: Ctx) => NAV.filter((n) => n.show(c) && !(c.hidden ?? []).includes(n.href));
