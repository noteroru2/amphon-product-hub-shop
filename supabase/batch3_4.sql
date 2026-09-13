-- AMPHON Product Hub — Batch 3.4 Employee Management
-- Run once after Batch 3.3. Safe to re-run.

create table if not exists public.employee_activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists employee_activity_logs_created_idx
on public.employee_activity_logs(created_at desc);

create index if not exists employee_activity_logs_target_idx
on public.employee_activity_logs(target_user_id, created_at desc);

alter table public.employee_activity_logs enable row level security;

drop policy if exists employee_logs_read_admin on public.employee_activity_logs;
create policy employee_logs_read_admin on public.employee_activity_logs
for select to authenticated
using (public.current_user_role() in ('owner','admin'));

-- Writes are intentionally server-only through the Cloudflare Worker secret key.
-- No authenticated INSERT/UPDATE/DELETE policy is granted here.

-- Keep employee list fresh across multiple owner/admin devices.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.profiles;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
