-- AMPHON ONE-4D — production activation guard
-- Fail closed until controlled E2E evidence has been accepted by a reviewed migration.

create table if not exists private.one4d_activation_state (
  id smallint primary key default 1 check (id = 1),
  contract_version text not null default 'ONE-4D-PROD.1',
  status text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','REVOKED')),
  system_revision text,
  shop_revision text,
  worker_revision text,
  evidence jsonb not null default '{}'::jsonb,
  accepted_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);

revoke all on private.one4d_activation_state from public, anon, authenticated;

insert into private.one4d_activation_state (id, contract_version, status, evidence)
values (
  1,
  'ONE-4D-PROD.1',
  'PENDING',
  jsonb_build_object(
    'activationAllowed', false,
    'reason', 'ONE-4D production E2E acceptance not yet completed'
  )
)
on conflict (id) do nothing;

create or replace function private.one4d_guard_purchase_enable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate_status text;
begin
  if new.purchase_enabled is true and coalesce(old.purchase_enabled, false) is false then
    select s.status
      into gate_status
      from private.one4d_activation_state s
     where s.id = 1;

    if gate_status is distinct from 'ACCEPTED' then
      raise exception using
        errcode = 'P0001',
        message = 'ONE4D_ACTIVATION_NOT_ACCEPTED';
    end if;

    if exists (
      select 1
        from private.one4_shop_stock_command_outbox o
       where o.status <> 'DELIVERED'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'ONE4D_COMMAND_OUTBOX_NOT_CLEAR';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.one4d_guard_purchase_enable() from public, anon, authenticated;

drop trigger if exists trg_one4d_guard_purchase_enable on public.commerce_store_settings;
create trigger trg_one4d_guard_purchase_enable
before update of purchase_enabled on public.commerce_store_settings
for each row
execute function private.one4d_guard_purchase_enable();

create or replace function public.one4d_activation_readiness()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with gate as (
    select contract_version, status, system_revision, shop_revision, worker_revision,
           evidence, accepted_at, revoked_at
      from private.one4d_activation_state
     where id = 1
  ), counts as (
    select
      count(*) filter (where status in ('PENDING','PROCESSING','RETRY'))::int as nonterminal_commands,
      count(*) filter (where status = 'DEAD')::int as dead_commands
      from private.one4_shop_stock_command_outbox
  ), orders as (
    select count(*)::int as one_orders
      from public.commerce_orders
     where one_stock_authority is true
  ), settings as (
    select purchase_enabled
      from public.commerce_store_settings
     where id = 1
  )
  select jsonb_build_object(
    'contractVersion', gate.contract_version,
    'status', gate.status,
    'systemRevision', gate.system_revision,
    'shopRevision', gate.shop_revision,
    'workerRevision', gate.worker_revision,
    'evidence', gate.evidence,
    'acceptedAt', gate.accepted_at,
    'revokedAt', gate.revoked_at,
    'purchaseEnabled', coalesce(settings.purchase_enabled, false),
    'nonterminalCommands', counts.nonterminal_commands,
    'deadCommands', counts.dead_commands,
    'oneOrders', orders.one_orders,
    'activationAllowed',
      gate.status = 'ACCEPTED'
      and counts.nonterminal_commands = 0
      and counts.dead_commands = 0
  )
  from gate cross join counts cross join orders cross join settings;
$$;

revoke all on function public.one4d_activation_readiness() from public, anon, authenticated;
grant execute on function public.one4d_activation_readiness() to service_role;

-- ONE-4D starts fail closed. A later reviewed acceptance migration may mark the
-- gate ACCEPTED only after signed production E2E evidence is complete.
update public.commerce_store_settings
   set purchase_enabled = false,
       updated_at = now()
 where id = 1;
