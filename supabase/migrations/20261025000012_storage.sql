-- ═══════════════════════════════════════════════════════════════════════════
-- HCM Master Suite · 0012 · File storage
-- ───────────────────────────────────────────────────────────────────────────
-- Buckets
--   hr-documents  private  {tenant_id}/{employee_id}/{file}  CNIC, contracts, leave proofs
--   receipts      private  {tenant_id}/{employee_id}/{file}  expense receipts
--   cvs           private  {tenant_id}/{requisition_id}/{file} candidate CVs (public upload)
--   avatars       public   {tenant_id}/{employee_id}.{ext}   profile photos and company logos
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit)
values ('hr-documents', 'hr-documents', false, 10485760),
       ('receipts', 'receipts', false, 5242880),
       ('cvs', 'cvs', false, 5242880),
       ('avatars', 'avatars', true, 2097152)
on conflict (id) do nothing;

create or replace function public.storage_employee_ok(p_name text, p_write boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select (storage.foldername(p_name))[1] = public.current_tenant_id()::text
     and (
       public.is_hr_staff()
       or public.is_self(nullif((storage.foldername(p_name))[2], '')::uuid)
       or (not p_write and (public.is_auditor() or public.can_view_pay()))
     )
$$;
grant execute on function public.storage_employee_ok(text, boolean) to authenticated;

drop policy if exists hcm_docs_read on storage.objects;
drop policy if exists hcm_docs_write on storage.objects;
drop policy if exists hcm_docs_delete on storage.objects;
drop policy if exists hcm_cvs_upload on storage.objects;
drop policy if exists hcm_cvs_read on storage.objects;
drop policy if exists hcm_avatars_read on storage.objects;
drop policy if exists hcm_avatars_write on storage.objects;

create policy hcm_docs_read on storage.objects for select to authenticated
  using (bucket_id in ('hr-documents', 'receipts') and public.storage_employee_ok(name, false));
create policy hcm_docs_write on storage.objects for insert to authenticated
  with check (bucket_id in ('hr-documents', 'receipts') and public.storage_employee_ok(name, true));
create policy hcm_docs_delete on storage.objects for delete to authenticated
  using (bucket_id in ('hr-documents', 'receipts') and (storage.foldername(name))[1] = public.current_tenant_id()::text and public.is_hr_staff());

-- Applicants upload CVs from the public careers page (only into an open job's folder).
create or replace function public.job_accepts_cv(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_requisitions r where r.status = 'open' and r.is_public
                 and r.tenant_id::text = (storage.foldername(p_name))[1] and r.id::text = (storage.foldername(p_name))[2])
$$;
grant execute on function public.job_accepts_cv(text) to anon, authenticated;

create policy hcm_cvs_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'cvs' and public.job_accepts_cv(name));
create policy hcm_cvs_read on storage.objects for select to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = public.current_tenant_id()::text and public.is_recruiting());

create policy hcm_avatars_read on storage.objects for select using (bucket_id = 'avatars');
create policy hcm_avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.current_tenant_id()::text);

-- Tell the Supabase API (PostgREST) to load the new tables and functions right away.
notify pgrst, 'reload schema';
