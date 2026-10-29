# HCM Master Suite

A multi-company HR, attendance, payroll and talent platform built from the HCM Master Suite Product Brief. It uses Next.js 15 for the web app and Supabase (Postgres, Auth, Storage, Edge Functions) for the backend.

Every rule the brief calls "server authority" lives in the database. That covers who sees what, payroll maths, maker-checker approvals, leave validation and the geofenced clock-in. The browser can never skip these rules.


## 1. What is inside

### Roles

The 14 roles from brief §2, stored as `public.app_role`:

- Platform Super Admin
- Company Owner
- Company Admin
- HR Director
- HR Manager
- HR Executive
- Payroll Officer
- Finance Controller
- Recruiter
- Hiring Manager
- Line Manager
- Employee
- Candidate
- Auditor

Custom roles can hide modules for a member. Data access always follows the system role and is enforced by row-level security.

### Modules

These match the brief's modules (M0 to M15):

- **Platform and security:** multi-company tenancy, invites, users and roles, ABAC scope by branch or department, time-boxed auditor access, and an immutable audit log.
- **Core HR:** directory, org chart, profiles, effective-dated job and salary history, private data split into its own table, documents vault, assets, and HR letters with public verification.
- **Recruitment:** requisitions with approval, a public careers page, explainable match scores, a kanban pipeline, interviews with scorecards, offers with an over-band approval, and one-click hire.
- **Onboarding and offboarding:** checklists with a task owner (HR, IT, Admin, Manager, Finance, Employee, Buddy), resignation, exit interview, and a final settlement covering salary, leave encashment, gratuity and loan recovery, approved by HR then Finance.
- **Time and attendance:**
  - Server-stamped clock-in and clock-out.
  - GPS rules per employee, assigned by HR in bulk: Office (must be inside one of the allowed branches' geofence), Field (GPS recorded anywhere) or Remote.
  - Face ID with the live camera (see "Face ID" below), selfie proof, and a punch log of every accepted and rejected attempt.
  - Shifts, night shifts, weekly rosters and holidays.
  - Corrections and overtime requests with approval.
  - An attendance board with CSV export.
- **Leave:** policy-as-data leave types, monthly or annual accrual, proration, sandwich rule, documents, half days, manager to HR routing, leave calendar and balance adjustments.
- **Payroll:**
  - Pakistan FY2025-26 salaried slabs, stored as data. Basic, house rent and utilities split, tax-exempt medical, EOBI, provident fund.
  - Overtime, absences, late deductions, loans, bonuses and deductions, and expense reimbursement.
  - Pre-payroll exception checks.
  - Maker-checker: calculate, then HR approval, then Finance approval (by a different person), then finalize.
  - Bank transfer CSV, and published payslips that show a formula on every line.
- **Expenses, travel and loans:** receipts, per-category limits with over-policy flags, manager then finance approval, and loan installments recovered in payroll.
- **Performance:** OKR goals with key results, review cycles (self, manager, calibration) and continuous feedback.
- **Learning:** courses, mandatory assignment, progress, automatic certificates with expiry, and compliance tracking.
- **Engagement:** announcements with acknowledgement, a kudos wall, and anonymous pulse and eNPS surveys. Results are hidden below 5 responses.
- **Helpdesk:** tickets with SLA by priority, internal notes, satisfaction rating and a knowledge base.
- **AI copilot:** a Supabase Edge Function that answers with the user's own permissions and logs every question to `ai_logs`.
- **Analytics:** role dashboards, headcount trend, attrition, hiring funnel, leave, tenure, payroll cost by department and explainable flight-risk signals.

### UI

- A real split-screen login page.
- Sign-up, magic link, Google button, forgot password and reset password.
- A two-step company setup wizard.
- Light, dark and system themes with six accent colours.
- A collapsible sidebar, command search (Ctrl K), notifications and a company switcher.
- Mobile responsive.


## 2. Set up Supabase (fresh project)

1. Create a Supabase project, or use your existing empty one.

2. Open SQL Editor and run `supabase/hcm_full_schema.sql` once. It contains migrations 0001 to 0014 in order, and it is safe to run again. If you prefer the CLI, run `supabase link` and then `supabase db push`, which uses the `supabase/migrations` folder.

   If the project already has a `profiles` table, for example from Supabase's starter template, it is upgraded automatically.

   If the script stops with "Old tables from another schema already exist", your project still has tables from an older app. On a fresh or test project only:
   - run `supabase/00_reset_public_schema.sql` first (it deletes all public tables and data, and keeps auth users and storage files);
   - then run `hcm_full_schema.sql` again.

3. In Authentication → URL Configuration:
   - Set Site URL to your app URL, for example `http://localhost:3000`.
   - Add `http://localhost:3000/**` to the redirect URLs.

4. Optional:
   - Under Authentication → Providers, enable Google to make the Google button work.
   - Turn off "Confirm email" if you want instant sign-up while testing.

5. Storage buckets are created by migration 0012:
   - `hr-documents` (private)
   - `receipts` (private)
   - `cvs` (private, public upload only into open jobs)
   - `avatars` (public)
   - `attendance-selfies` (private, created by migration 0013)

6. Invitation emails (needed so invited employees get an email):
   ```
   supabase functions deploy invite-user
   ```
   Or use Dashboard → Edge Functions → "Deploy a new function", name it `invite-user` and paste `supabase/functions/invite-user/index.ts`.
   - No secret is needed: the function uses the project's built-in service key on the server.
   - Supabase's built-in email sender only delivers to your own team's addresses and only a few emails per hour. For real employees, add your own SMTP under Authentication → Emails → SMTP Settings (Resend, Brevo, Gmail SMTP, etc.).
   - Add `http://localhost:3000/**` (and later your live domain) to Authentication → URL Configuration → Redirect URLs, so the invite link opens the "Set your password" page.

7. AI copilot: add `GROQ_API_KEY` (free, console.groq.com) and optionally `OPENROUTER_API_KEY` (free models, openrouter.ai) to the hosting environment variables. Groq answers first; if it is busy, rate-limited or out of quota, OpenRouter answers instead. No Supabase function is needed (the old `copilot` Edge Function is no longer used).

8. To make yourself platform super admin, run this in the SQL editor:
   ```
   update profiles set is_platform_admin = true where email = 'you@company.com';
   ```


## 3. Run the web app

```
npm install
cp .env.example .env.local     # fill in the values
npm run dev                    # http://localhost:3000
```

To deploy, push to Vercel (or any Node host) and add the same variables under Settings → Environment Variables, then redeploy:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server only — email codes and invitations)
- `RESEND_API_KEY` and `MAIL_FROM` (your verified Resend domain)
- `GROQ_API_KEY`, `OPENROUTER_API_KEY` (AI copilot)

Without the email variables the app still works: sign-up, code sign-in and password reset fall back to Supabase's own emails, and invitations fall back to the `invite-user` Edge Function.


## Own email with OTP codes (Resend)

- Registering a company: name, email, password → a 6-digit code arrives from your domain → the account is created with the email already verified → company setup.
- Sign in with an email code (no password), and reset a forgotten password with a code.
- Invitations are sent from your domain too, with an "Accept invitation" button that opens "Set your password".
- Codes: valid 10 minutes, single use, 5 wrong tries, a new code every 45 seconds, 5 per email and 20 per network address per hour. Only a hash of each code is stored (`email_codes`, server-only).


## Personal settings, guided tips and AI chat

- **Settings (`/account`)** for every user, with search: Profile; General (theme, accent, text size, density, privacy mode that hides every money amount, date and time format); Layout & dashboard (start page, sidebar, animations, keyboard shortcuts, dashboard sections and their order); Notifications (per type, desktop pop-ups, sound, quiet hours); Security (sign-in methods, password, sign out other devices or everywhere, your companies); AI & Copilot (answer style, reply language, things the AI remembers, connection status, delete chats); Guided tips; Privacy & data (where data goes, export everything as JSON, delete AI chats); Activity; Speed check; Help & shortcuts; About & legal. Preferences are saved on the account (`profiles.prefs`), so they follow the person to every device.
- **Guided tips**: the first time someone signs in they get a short welcome tour, and the first time they open each page they get that page's tour. The screen is dimmed and blurred around the highlighted element, with Next, Back, Skip, Auto-play, arrow keys and Esc. Steps adapt to the role. Turn them off or replay any tour in Settings → Guided tips, or from the account menu → "Show me around this page".
- **AI copilot**: streams answers, keeps the conversation for follow-ups, and has history (search, rename, pin, delete), copy, regenerate, like/dislike, edit-and-resend and stop. Every lookup runs with the asker's own session, so row-level security decides what it sees: owners and HR get company data, managers their team, employees only themselves. Chats are private to each person.


## 4. First run

1. Sign up, then create your company. The setup seeds:
   - a head office branch
   - six departments
   - grades G1 to G6
   - two shifts
   - the Pakistan leave policy
   - FY2025-26 tax slabs
   - payroll settings
   - expense limits
   - five letter templates
   - three knowledge base articles
   - your own employee record

2. Add people from People → Add employee. Tick "Invite to the app", or invite them later from Users & roles.

3. Invited people sign up with the same email and join your company automatically, with the role you chose.

4. Set office coordinates in Settings → Organization → Branches (or Attendance → GPS & Face ID rules), using "Use my current location" while standing in the office.

5. In Attendance → GPS & Face ID rules, choose company defaults (turn on "Require Face ID" for everyone, or per employee with "Assign rule").


## Face ID

- Library: `@vladmandic/face-api` (TensorFlow.js, MIT). `npm install` copies the four models it needs into `public/models` (about 12 MB, cached by the browser after the first use).
- Detection runs in a Web Worker (`src/workers/face.worker.ts`), so the page never freezes. It uses the fast Tiny detector and falls back to SSD MobileNet only when Tiny misses. Models load in the background on the dashboard and setup page, and are warmed up before the camera scan starts. Browsers without worker WebGL fall back to the main thread automatically.
- When Face ID is required and the person has no face registered, they are taken to `/face-setup` straight after accepting their invite (or signing up / first login). They cannot use the app until it is done. If the company turns off self-enrollment, HR registers the face from the rules screen instead.
- Setup: look straight (5 samples), turn the head to both sides, blink, then confirm the photo. Clock in or out: look straight, turn once, blink — about 5 seconds.
- The browser only sends a 128-number face descriptor and a selfie. Matching is done in Postgres (`check_punch`), with a strictness that HR sets (0.45 strict, 0.50 normal, 0.55 relaxed). The stored descriptor cannot be read by any user, not even HR.
- Camera and GPS only work on `https://` (or localhost). On phones use Chrome or Safari.
- Limits, said plainly: the head-turn and blink checks stop a printed photo or a still picture on a screen, but they are not certified anti-spoofing; a good video of the person could pass. Every punch keeps a selfie and is logged, so HR can review. Identical twins can match each other.


## 5. How access is enforced

- Every table has `tenant_id`. A trigger fills it from the user's active company, so the browser never chooses it.
- Row-level security is on for every table. The role groups in `0001_foundation.sql` are used by the policies, and the same groups are mirrored in `src/lib/roles.ts`.
- **Salary:** only the employee and the pay roles can see it. HR Executive and Line Manager cannot see salaries (brief §21).
- **Private data:** CNIC, date of birth and bank details sit in `employee_private`. Employees can edit their own contact details, but only HR can change CNIC or bank details.
- **Status changes:** approvals and status changes happen only through SQL functions such as `decide_leave`, `advance_payroll`, `hire_candidate` and `advance_settlement`. These functions check role, scope and maker-checker.
- **Internal helpers:** functions not meant for the browser have execute revoked, for example `leave_balances` and `annual_income_tax`.
- **Survey responses:** these cannot be read directly. Only aggregated results with a minimum of 5 responses are released.


## 6. Tests

`npm run test:db` runs all migrations on an in-memory Postgres (PGlite) with Supabase stand-ins. It then plays a full company scenario as real signed-in users under RLS. That is 169 checks, covering:

- sign-up and invites
- privacy rules
- leave
- geofence, GPS rules and Face ID matching
- payroll maker-checker with the worked example (135,000 gross with PF and an 8,000 loan gives a net of 116,424 and tax of 3,459)
- expenses
- recruitment to hire
- reviews
- surveys
- helpdesk
- final settlement
- tenant isolation


## 7. Not included (needs outside services)

The brief lists some items that depend on third parties. They are not built here:

- native mobile apps (the web app is responsive and can be installed as a PWA later)
- WhatsApp bot
- biometric device (ZKTeco etc.) sync; certified anti-spoof liveness
- FBR/EOBI e-filing APIs
- bank API transfers (a bank CSV is generated instead)
- Slack and Teams apps
- the 12 autonomous AI agents (the copilot and its tool layer are the foundation for them)
- the integrations marketplace
