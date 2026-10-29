-- HCM Master Suite · 0014 · Personal preferences, own email codes (OTP), AI chat history, activity and data export
-- Run after 0001–0013. Safe to run more than once.

-- ── 1. Personal preferences (Settings hub, guided tips, AI memory) ─────────
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;

-- Set one preference by dotted key, e.g. 'notif.leave' = false, 'tours.dashboard' = true, 'textSize' = "large".
create or replace function public.set_my_pref(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare path text[]; cur jsonb; i int;
begin
  perform public.require(auth.uid() is not null, 'Not signed in');
  perform public.require(p_key ~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_-]+){0,2}$', 'Invalid preference key');
  path := string_to_array(p_key, '.');
  select coalesce(prefs, '{}'::jsonb) into cur from profiles where id = auth.uid();
  cur := coalesce(cur, '{}'::jsonb);
  for i in 1 .. array_length(path, 1) - 1 loop
    if jsonb_typeof(cur #> path[1:i]) is distinct from 'object' then cur := jsonb_set(cur, path[1:i], '{}'::jsonb, true); end if;
  end loop;
  cur := jsonb_set(cur, path, coalesce(p_value, 'null'::jsonb), true);
  perform public.require(length(cur::text) < 20000, 'Preferences are too large');
  update profiles set prefs = cur where id = auth.uid();
  return cur;
end $$;

-- Remove a preference (or a whole group, e.g. 'tours' to replay every guided tip).
create or replace function public.clear_my_pref(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur jsonb;
begin
  perform public.require(p_key ~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_-]+){0,2}$', 'Invalid preference key');
  update profiles set prefs = coalesce(prefs, '{}'::jsonb) #- string_to_array(p_key, '.') where id = auth.uid() returning prefs into cur;
  return coalesce(cur, '{}'::jsonb);
end $$;

-- my_context now also returns prefs.
create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', u.id,
    'email', coalesce(p.email, u.email),
    'full_name', coalesce(p.full_name, u.raw_user_meta_data->>'full_name'),
    'avatar_url', p.avatar_url,
    'theme', coalesce(p.theme, 'system'),
    'prefs', coalesce(p.prefs, '{}'::jsonb),
    'is_platform_admin', coalesce(p.is_platform_admin, false),
    'tenant', (select to_jsonb(t) - 'created_by' from tenants t where t.id = public.current_tenant_id()),
    'role', public.current_app_role(),
    'custom_role', (select jsonb_build_object('id', c.id, 'name', c.name, 'permissions', c.permissions)
                    from memberships m join custom_roles c on c.id = m.custom_role_id
                    where m.user_id = u.id and m.tenant_id = public.current_tenant_id()),
    'employee', (select jsonb_build_object('id', e.id, 'code', e.employee_code, 'full_name', e.full_name, 'job_title', e.job_title,
                        'photo_url', e.photo_url, 'department_id', e.department_id, 'branch_id', e.branch_id, 'manager_id', e.manager_id,
                        'has_reports', exists (select 1 from employees r where r.manager_id = e.id and r.status <> 'exited'))
                 from employees e where e.id = public.current_employee_id()),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('tenant_id', t.id, 'name', t.name, 'role', m.role, 'logo_url', t.logo_url) order by t.name)
                           from memberships m join tenants t on t.id = m.tenant_id
                           where m.user_id = u.id and m.status = 'active'), '[]'::jsonb),
    'unread_notifications', (select count(*) from notifications n where n.user_id = u.id and n.read_at is null)
  )
  from auth.users u left join profiles p on p.id = u.id where u.id = auth.uid()
$$;

-- ── 2. Notification categories the person muted (Settings → Notifications) ─
-- The category comes from the notification link, so every existing notification keeps working.
create or replace function public.notification_category(p_link text) returns text
language sql immutable as $$
  select case
    when p_link is null then 'general'
    when p_link like '/approvals%' then 'approvals'
    when p_link like '/leave%' then 'leave'
    when p_link like '/attendance%' then 'attendance'
    when p_link like '/payroll%' or p_link like '/payslips%' then 'payroll'
    when p_link like '/expenses%' then 'expenses'
    when p_link like '/recruitment%' then 'recruitment'
    when p_link like '/engagement%' then 'announcements'
    when p_link like '/helpdesk%' then 'helpdesk'
    when p_link like '/performance%' or p_link like '/learning%' or p_link like '/lifecycle%' then 'growth'
    else 'general' end
$$;

create or replace function public.notify_user(p_user uuid, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare v_prefs jsonb;
begin
  if p_user is null then return; end if;
  select prefs into v_prefs from profiles where id = p_user;
  -- Approvals are never muted: work would get stuck.
  if public.notification_category(p_link) <> 'approvals'
     and coalesce(v_prefs -> 'notif' ->> public.notification_category(p_link), 'true') = 'false' then
    return;
  end if;
  insert into notifications (tenant_id, user_id, title, body, link)
  values (public.current_tenant_id(), p_user, p_title, p_body, p_link);
end $$;

-- ── 3. Own email codes (sign-up, sign-in and password reset by 6-digit code) ─
-- Only the server (service role) can read or write this table. Codes are stored as an HMAC, never in plain text.
create table if not exists public.email_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  purpose     text not null default 'signup' check (purpose in ('signup', 'signin', 'reset')),
  code_hash   text not null,
  attempts    int  not null default 0,
  ip          text,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists email_codes_email_idx on public.email_codes (email, purpose, created_at desc);
create index if not exists email_codes_ip_idx on public.email_codes (ip, created_at desc);
alter table public.email_codes enable row level security;   -- no policies: no access for anon or signed-in users
revoke all on public.email_codes from anon, authenticated;
grant all on public.email_codes to service_role;

create or replace function public.purge_email_codes() returns void
language sql security definer set search_path = public as $$
  delete from email_codes where created_at < now() - interval '1 day';
$$;
revoke all on function public.purge_email_codes() from public, anon, authenticated;
grant execute on function public.purge_email_codes() to service_role;

-- ── 4. AI copilot chat history (each person sees only their own chats) ─────
create table if not exists public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default 'New chat',
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ai_conversations_user_idx on public.ai_conversations (user_id, tenant_id, updated_at desc);

create table if not exists public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  conversation_id  uuid not null references public.ai_conversations(id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null default '',
  model            text,
  feedback         smallint not null default 0 check (feedback in (-1, 0, 1)),
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, created_at);

select public.hcm_attach_triggers('public.ai_conversations', false);
select public.hcm_attach_triggers('public.ai_messages', false);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
drop policy if exists ai_conv_own on public.ai_conversations;
create policy ai_conv_own on public.ai_conversations for all to authenticated
  using (user_id = auth.uid() and public.in_tenant(tenant_id)) with check (user_id = auth.uid() and public.in_tenant(tenant_id));
drop policy if exists ai_msg_own on public.ai_messages;
create policy ai_msg_own on public.ai_messages for all to authenticated
  using (user_id = auth.uid() and public.in_tenant(tenant_id))
  with check (user_id = auth.uid() and public.in_tenant(tenant_id)
              and exists (select 1 from ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()));
grant select, insert, update, delete on public.ai_conversations, public.ai_messages to authenticated;

-- ── 5. My activity (Settings → Activity): what I changed, newest first ─────
create or replace function public.my_activity(p_limit int default 100)
returns table (id bigint, action text, entity text, entity_id text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.action, a.entity, a.entity_id, a.created_at from audit_log a
  where a.actor_id = auth.uid() and a.tenant_id = public.current_tenant_id()
  order by a.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- ── 6. Export my data (Settings → Privacy & data) ─────────────────────────
create or replace function public.my_data_export() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e uuid := public.current_employee_id(); t uuid := public.current_tenant_id();
begin
  perform public.require(auth.uid() is not null, 'Not signed in');
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', p.email, 'full_name', p.full_name, 'phone', p.phone, 'prefs', p.prefs, 'created_at', p.created_at) from profiles p where p.id = auth.uid()),
    'memberships', (select coalesce(jsonb_agg(jsonb_build_object('company', tn.name, 'role', m.role, 'status', m.status, 'joined_at', m.created_at)), '[]') from memberships m join tenants tn on tn.id = m.tenant_id where m.user_id = auth.uid()),
    'employee', (select to_jsonb(x) - 'tenant_id' from employees x where x.id = e),
    'private', (select to_jsonb(x) - 'tenant_id' from employee_private x where x.employee_id = e),
    'compensation', (select coalesce(jsonb_agg(to_jsonb(x) - 'tenant_id' order by x.effective_from), '[]') from employee_compensation x where x.employee_id = e),
    'attendance', (select coalesce(jsonb_agg(jsonb_build_object('date', x.work_date, 'status', x.status, 'in', x.clock_in_at, 'out', x.clock_out_at, 'worked_minutes', x.worked_minutes) order by x.work_date desc), '[]')
                   from attendance_records x where x.employee_id = e and x.work_date > current_date - 400),
    'leave_requests', (select coalesce(jsonb_agg(to_jsonb(x) - 'tenant_id' order by x.start_date desc), '[]') from leave_requests x where x.employee_id = e),
    'payslips', (select coalesce(jsonb_agg(to_jsonb(x) - 'tenant_id' order by x.period desc), '[]') from payslips x where x.employee_id = e),
    'expense_claims', (select coalesce(jsonb_agg(to_jsonb(x) - 'tenant_id' order by x.created_at desc), '[]') from expense_claims x where x.employee_id = e),
    'loans', (select coalesce(jsonb_agg(to_jsonb(x) - 'tenant_id'), '[]') from loans x where x.employee_id = e),
    'goals', (select coalesce(jsonb_agg(to_jsonb(x) - 'tenant_id'), '[]') from goals x where x.employee_id = e),
    'ai_chats', (select coalesce(jsonb_agg(jsonb_build_object('title', c.title, 'created_at', c.created_at,
                   'messages', (select coalesce(jsonb_agg(jsonb_build_object('role', m.role, 'content', m.content, 'at', m.created_at) order by m.created_at), '[]') from ai_messages m where m.conversation_id = c.id))), '[]')
                 from ai_conversations c where c.user_id = auth.uid() and c.tenant_id = t)
  );
end $$;

revoke execute on function public.set_my_pref(text, jsonb), public.clear_my_pref(text), public.my_activity(int), public.my_data_export() from public, anon;
grant execute on function public.set_my_pref(text, jsonb), public.clear_my_pref(text), public.my_activity(int), public.my_data_export() to authenticated;
revoke execute on function public.notify_user(uuid, text, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
