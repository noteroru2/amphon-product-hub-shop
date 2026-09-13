-- HUB-6 — Sold Item Cleanup & Channel Task Automation
-- Internal work only: this migration never calls or controls an external platform.

create table if not exists public.sales_channel_cleanup_rules (
  channel text primary key check (channel in ('facebook','marketplace','winner_it','website','line')),
  sold_cleanup_enabled boolean not null default false,
  task_type text check (task_type is null or task_type in ('REMOVE_LISTING','UPDATE_LISTING','VERIFY_REMOVAL')),
  priority text not null default 'NORMAL' check (priority in ('HIGH','NORMAL')),
  instruction text not null,
  updated_at timestamptz not null default now()
);

insert into public.sales_channel_cleanup_rules(channel,sold_cleanup_enabled,task_type,priority,instruction)
values
  ('website',false,null,'NORMAL','SHOP ใช้สถานะสินค้าและ inventory อัตโนมัติ'),
  ('marketplace',true,'REMOVE_LISTING','HIGH','ปิดประกาศ Facebook Marketplace ด้วยตนเอง'),
  ('facebook',true,'UPDATE_LISTING','HIGH','อัปเดตโพสต์เป็นขายแล้วหรือปิดโพสต์ตามนโยบายร้าน'),
  ('line',false,null,'NORMAL','LINE เป็นประวัติการแชร์ ไม่ใช่ประกาศถาวร'),
  ('winner_it',true,'UPDATE_LISTING','HIGH','อัปเดตโพสต์เป็นขายแล้วหรือปิดโพสต์ตามนโยบายร้าน')
on conflict (channel) do nothing;

create table if not exists public.sales_channel_tasks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  publication_id uuid not null references public.product_publications(id) on delete restrict,
  channel text not null check (channel in ('facebook','marketplace','winner_it','website','line')),
  task_type text not null check (task_type in ('REMOVE_LISTING','UPDATE_LISTING','VERIFY_REMOVAL')),
  status text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  priority text not null default 'HIGH' check (priority in ('HIGH','NORMAL')),
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_to_name text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null default 'ระบบ',
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  completed_by_name text,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_by_name text,
  cancellation_reason text,
  completion_note text,
  source_event text not null check (source_event in ('SOLD_TRANSITION','RECONCILIATION','PUBLICATION_UPDATED')),
  source_product_status text not null default 'sold',
  last_action_id uuid unique,
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_channel_tasks_one_active_action_idx
on public.sales_channel_tasks(publication_id,task_type)
where status in ('OPEN','IN_PROGRESS');

create index if not exists sales_channel_tasks_open_priority_idx
on public.sales_channel_tasks(priority,created_at)
where status in ('OPEN','IN_PROGRESS');

create index if not exists sales_channel_tasks_product_idx
on public.sales_channel_tasks(product_id,created_at desc);

create index if not exists sales_channel_tasks_publication_idx
on public.sales_channel_tasks(publication_id,created_at desc);

create index if not exists sales_channel_tasks_assignee_idx
on public.sales_channel_tasks(assigned_to,status,created_at)
where assigned_to is not null;

create or replace function public.touch_sales_channel_task()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sales_channel_tasks_touch on public.sales_channel_tasks;
create trigger sales_channel_tasks_touch
before update on public.sales_channel_tasks
for each row execute procedure public.touch_sales_channel_task();

create or replace function public.ensure_sold_product_cleanup_tasks(
  target_product_id uuid,
  task_source text default 'RECONCILIATION'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  actor_name text;
begin
  if task_source not in ('SOLD_TRANSITION','RECONCILIATION') then
    raise exception 'INVALID_TASK_SOURCE';
  end if;

  if coalesce(auth.role(),'') <> 'service_role' and not public.current_user_active() then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists(select 1 from public.products p where p.id=target_product_id and p.status='sold') then
    return 0;
  end if;

  select nullif(p.display_name,'') into actor_name
  from public.profiles p where p.id=auth.uid();

  insert into public.sales_channel_tasks(
    product_id,publication_id,channel,task_type,priority,
    created_by,created_by_name,source_event,source_product_status
  )
  select
    pp.product_id,pp.id,pp.channel,r.task_type,r.priority,
    auth.uid(),coalesce(actor_name,'ระบบ'),task_source,'sold'
  from public.product_publications pp
  join public.sales_channel_cleanup_rules r on r.channel=pp.channel
  where pp.product_id=target_product_id
    and pp.status='published'
    and r.sold_cleanup_enabled=true
    and r.task_type is not null
  on conflict (publication_id,task_type) where status in ('OPEN','IN_PROGRESS') do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.hub6_product_status_task_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and new.status='sold' then
    begin
      perform public.ensure_sold_product_cleanup_tasks(new.id,'SOLD_TRANSITION');
    exception when others then
      -- Cleanup work is noncritical and must never block inventory/payment completion.
      raise warning 'HUB6_TASK_SYNC_SKIPPED product=% error=%',new.id,sqlerrm;
    end;
  elsif old.status='sold' and new.status is distinct from 'sold' then
    begin
      update public.sales_channel_tasks t
      set status='CANCELLED',cancelled_at=now(),cancelled_by=auth.uid(),
          cancelled_by_name=coalesce((select nullif(p.display_name,'') from public.profiles p where p.id=auth.uid()),'ระบบ'),
          cancellation_reason='PRODUCT_NO_LONGER_SOLD'
      where t.product_id=new.id and t.status in ('OPEN','IN_PROGRESS');
    exception when others then
      raise warning 'HUB6_REVERSAL_SYNC_SKIPPED product=% error=%',new.id,sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists products_hub6_task_sync on public.products;
create trigger products_hub6_task_sync
after update of status on public.products
for each row execute procedure public.hub6_product_status_task_sync();

create or replace function public.hub6_publication_task_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor_name text;
begin
  if old.status='published' and new.status in ('ended','expired') then
    select nullif(p.display_name,'') into actor_name from public.profiles p where p.id=new.updated_by;
    update public.sales_channel_tasks t
    set status='COMPLETED',completed_at=coalesce(new.ended_at,now()),completed_by=new.updated_by,
        completed_by_name=coalesce(actor_name,nullif(new.updated_by_name,''),'พนักงาน'),
        completion_note=coalesce(t.completion_note,'ปิดจากหน้าสถานะช่องทางขาย'),
        last_action_id=coalesce(t.last_action_id,new.last_action_id,gen_random_uuid())
    where t.publication_id=new.id and t.status in ('OPEN','IN_PROGRESS');
  end if;
  return new;
end;
$$;

drop trigger if exists product_publications_hub6_task_sync on public.product_publications;
create trigger product_publications_hub6_task_sync
after update of status on public.product_publications
for each row execute procedure public.hub6_publication_task_sync();

create or replace function public.claim_sales_channel_task(target_task_id uuid, start_now boolean default false)
returns public.sales_channel_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare t public.sales_channel_tasks%rowtype; actor_name text;
begin
  if not public.current_user_active() or public.current_user_role() not in ('owner','admin','sales') then raise exception 'NOT_AUTHORIZED'; end if;
  select * into t from public.sales_channel_tasks where id=target_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if t.status not in ('OPEN','IN_PROGRESS') then return t; end if;
  if t.assigned_to is not null and t.assigned_to<>auth.uid() and public.current_user_role() not in ('owner','admin') then raise exception 'TASK_ALREADY_ASSIGNED'; end if;
  select coalesce(nullif(p.display_name,''),'พนักงาน') into actor_name from public.profiles p where p.id=auth.uid();
  update public.sales_channel_tasks set assigned_to=auth.uid(),assigned_to_name=actor_name,
    claimed_at=coalesce(claimed_at,now()),status=case when start_now then 'IN_PROGRESS' else status end
  where id=target_task_id returning * into t;
  return t;
end;
$$;

create or replace function public.complete_sales_channel_task(target_task_id uuid, action_id uuid, note text default null)
returns public.sales_channel_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare t public.sales_channel_tasks%rowtype; actor_name text; publication_status text;
begin
  if action_id is null then raise exception 'ACTION_ID_REQUIRED'; end if;
  if not public.current_user_active() or public.current_user_role() not in ('owner','admin','sales') then raise exception 'NOT_AUTHORIZED'; end if;
  select * into t from public.sales_channel_tasks where id=target_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if t.status='COMPLETED' then return t; end if;
  if t.status='CANCELLED' then raise exception 'TASK_CANCELLED'; end if;
  if t.assigned_to is not null and t.assigned_to<>auth.uid() and public.current_user_role() not in ('owner','admin') then raise exception 'TASK_ALREADY_ASSIGNED'; end if;
  select coalesce(nullif(p.display_name,''),'พนักงาน') into actor_name from public.profiles p where p.id=auth.uid();
  select status into publication_status from public.product_publications where id=t.publication_id for update;
  if publication_status='published' then
    update public.product_publications set status='ended',ended_at=now(),ended_by=auth.uid(),ended_by_name=actor_name,
      updated_by=auth.uid(),updated_by_name=actor_name,last_action_id=action_id
    where id=t.publication_id;
  end if;
  update public.sales_channel_tasks set status='COMPLETED',assigned_to=coalesce(assigned_to,auth.uid()),
    assigned_to_name=coalesce(assigned_to_name,actor_name),claimed_at=coalesce(claimed_at,now()),
    completed_at=coalesce(completed_at,now()),completed_by=coalesce(completed_by,auth.uid()),
    completed_by_name=coalesce(completed_by_name,actor_name),completion_note=nullif(left(coalesce(note,''),500),''),
    last_action_id=coalesce(last_action_id,action_id)
  where id=target_task_id returning * into t;
  return t;
exception when unique_violation then
  select * into t from public.sales_channel_tasks where id=target_task_id;
  if t.status='COMPLETED' then return t; end if;
  raise;
end;
$$;

create or replace function public.cancel_sales_channel_task(target_task_id uuid, reason text)
returns public.sales_channel_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare t public.sales_channel_tasks%rowtype; actor_name text;
begin
  if not public.current_user_active() or public.current_user_role() not in ('owner','admin') then raise exception 'NOT_AUTHORIZED'; end if;
  if length(trim(coalesce(reason,'')))<3 then raise exception 'CANCELLATION_REASON_REQUIRED'; end if;
  select * into t from public.sales_channel_tasks where id=target_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if t.status not in ('OPEN','IN_PROGRESS') then return t; end if;
  select coalesce(nullif(p.display_name,''),'พนักงาน') into actor_name from public.profiles p where p.id=auth.uid();
  update public.sales_channel_tasks set status='CANCELLED',cancelled_at=now(),cancelled_by=auth.uid(),
    cancelled_by_name=actor_name,cancellation_reason=left(trim(reason),500)
  where id=target_task_id returning * into t;
  return t;
end;
$$;

create or replace function public.hub6_cleanup_reconciliation_report()
returns table(metric text,value bigint)
language sql
security definer
set search_path = ''
as $$
  select 'sold_products',count(*) from public.products where status='sold'
  union all
  select 'actionable_active_publications',count(*) from public.product_publications pp join public.sales_channel_cleanup_rules r using(channel) join public.products p on p.id=pp.product_id where p.status='sold' and pp.status='published' and r.sold_cleanup_enabled
  union all
  select 'existing_active_tasks',count(*) from public.sales_channel_tasks where status in ('OPEN','IN_PROGRESS')
  union all
  select 'missing_tasks',count(*) from public.product_publications pp join public.sales_channel_cleanup_rules r using(channel) join public.products p on p.id=pp.product_id where p.status='sold' and pp.status='published' and r.sold_cleanup_enabled and not exists(select 1 from public.sales_channel_tasks t where t.publication_id=pp.id and t.task_type=r.task_type and t.status in ('OPEN','IN_PROGRESS'))
  union all
  select 'conflicts',count(*) from (select publication_id,task_type from public.sales_channel_tasks where status in ('OPEN','IN_PROGRESS') group by publication_id,task_type having count(*)>1) x;
$$;

alter table public.sales_channel_cleanup_rules enable row level security;
alter table public.sales_channel_tasks enable row level security;

create policy cleanup_rules_read_staff on public.sales_channel_cleanup_rules for select to authenticated using(public.current_user_active());
create policy sales_channel_tasks_read_staff on public.sales_channel_tasks for select to authenticated using(public.current_user_active());

revoke all on public.sales_channel_cleanup_rules from anon;
revoke all on public.sales_channel_tasks from anon;
revoke insert,update,delete on public.sales_channel_cleanup_rules from authenticated;
revoke insert,update,delete on public.sales_channel_tasks from authenticated;
grant select on public.sales_channel_cleanup_rules,public.sales_channel_tasks to authenticated;
grant select,insert,update,delete on public.sales_channel_cleanup_rules,public.sales_channel_tasks to service_role;

revoke all on function public.ensure_sold_product_cleanup_tasks(uuid,text) from public,anon;
revoke all on function public.claim_sales_channel_task(uuid,boolean) from public,anon;
revoke all on function public.complete_sales_channel_task(uuid,uuid,text) from public,anon;
revoke all on function public.cancel_sales_channel_task(uuid,text) from public,anon;
revoke all on function public.hub6_cleanup_reconciliation_report() from public,anon;
grant execute on function public.ensure_sold_product_cleanup_tasks(uuid,text) to authenticated,service_role;
grant execute on function public.claim_sales_channel_task(uuid,boolean) to authenticated,service_role;
grant execute on function public.complete_sales_channel_task(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.cancel_sales_channel_task(uuid,text) to authenticated,service_role;
grant execute on function public.hub6_cleanup_reconciliation_report() to authenticated,service_role;

do $$ begin
  begin
    alter publication supabase_realtime add table public.sales_channel_tasks;
  exception when duplicate_object then null;
  end;
end $$;

comment on table public.sales_channel_tasks is 'Internal staff cleanup work. Completion is employee attestation, not external-platform verification.';
