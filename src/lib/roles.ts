/** The 14 system roles from the product brief (§2). Must match enum public.app_role. */
export type Role =
  | "platform_super_admin" | "company_owner" | "company_admin" | "hr_director" | "hr_manager" | "hr_executive"
  | "payroll_officer" | "finance_controller" | "recruiter" | "hiring_manager" | "line_manager" | "employee"
  | "candidate" | "auditor";

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  platform_super_admin: { label: "Platform Super Admin", description: "Tenants, plans and global templates" },
  company_owner: { label: "Company Owner", description: "Owns the account, billing and every setting" },
  company_admin: { label: "Company Admin", description: "Company setup, policies, security and roles" },
  hr_director: { label: "HR Director", description: "All people data, analytics and approvals" },
  hr_manager: { label: "HR Manager", description: "People operations within assigned scope" },
  hr_executive: { label: "HR Executive", description: "Employee data, documents, attendance and tickets" },
  payroll_officer: { label: "Payroll Officer", description: "Salary structures, payroll runs, bank files and loans" },
  finance_controller: { label: "Finance Controller", description: "Approves payroll and expenses, views cost" },
  recruiter: { label: "Recruiter", description: "Requisitions, candidates and offers" },
  hiring_manager: { label: "Hiring Manager", description: "Reviews candidates and scorecards for own roles" },
  line_manager: { label: "Line Manager", description: "Team attendance, leave, goals and approvals" },
  employee: { label: "Employee", description: "Full self-service" },
  candidate: { label: "Candidate", description: "Own applications and offers" },
  auditor: { label: "Auditor", description: "Read-only payroll, audit log and compliance" },
};

/** Roles a company can grant from User Management (platform admin and candidate are not granted here). */
export const GRANTABLE_ROLES: Role[] = [
  "company_owner", "company_admin", "hr_director", "hr_manager", "hr_executive", "payroll_officer",
  "finance_controller", "recruiter", "hiring_manager", "line_manager", "employee", "auditor",
];

const has = (r: Role | null | undefined, list: Role[]) => !!r && list.includes(r);

/** Same role groups as the SQL helper functions, so the UI never shows what the server would refuse. */
export const can = {
  tenantAdmin: (r?: Role | null) => has(r, ["company_owner", "company_admin"]),
  hrLead: (r?: Role | null) => has(r, ["company_owner", "company_admin", "hr_director", "hr_manager"]),
  hrStaff: (r?: Role | null) => has(r, ["company_owner", "company_admin", "hr_director", "hr_manager", "hr_executive"]),
  viewPay: (r?: Role | null) => has(r, ["company_owner", "company_admin", "hr_director", "hr_manager", "payroll_officer", "finance_controller", "auditor"]),
  runPayroll: (r?: Role | null) => has(r, ["company_owner", "company_admin", "hr_director", "payroll_officer"]),
  finance: (r?: Role | null) => has(r, ["company_owner", "company_admin", "finance_controller"]),
  recruiting: (r?: Role | null) => has(r, ["company_owner", "company_admin", "hr_director", "hr_manager", "recruiter"]),
  auditor: (r?: Role | null) => has(r, ["auditor"]),
  analytics: (r?: Role | null) => has(r, ["company_owner", "company_admin", "hr_director", "hr_manager", "hr_executive", "finance_controller", "auditor"]),
  writeCompSalary: (r?: Role | null) => has(r, ["company_owner", "company_admin", "hr_director", "hr_manager", "payroll_officer"]),
};
