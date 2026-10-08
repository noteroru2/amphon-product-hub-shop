-- Close historical SKU-collision inbox failures once the same System identity
-- has been successfully re-keyed and linked to a Product Hub product.
-- Keep DEAD/FAILED rows for audit; only remove them from active integrity incidents.

create or replace view public.one_integrity_issues_v
with (security_invoker=true)
as
select
  'ONE_MANAGED_STATUS_AVAILABILITY_DRIFT'::text issue_type,
  p.id::text entity_id,
  p.sku,
  jsonb_build_object('status',p.status,'availability',p.one_availability) detail,
  p.updated_at observed_at
from public.products p
where p.one_managed=true
  and (
    (p.status='sold' and p.one_availability is distinct from 'SOLD')
    or (p.status='published' and p.one_availability is distinct from 'IN_STOCK')
  )
union all
select
  'ONE_MANAGED_LINK_MISSING',
  p.id::text,
  p.sku,
  jsonb_build_object('oneManaged',true),
  p.updated_at
from public.products p
where p.one_managed=true
  and not exists (
    select 1 from public.external_entity_links l
    where l.target_system='product-hub'
      and l.target_entity_type='product'
      and l.target_entity_id=p.id::text
      and l.sync_status='LINKED'
  )
union all
select
  'ORPHAN_TARGET_LINK',
  l.id::text,
  l.business_key,
  jsonb_build_object('sourceEntityId',l.source_entity_id,'targetEntityId',l.target_entity_id,'syncStatus',l.sync_status),
  l.updated_at
from public.external_entity_links l
where l.target_system='product-hub'
  and l.target_entity_type='product'
  and not exists (select 1 from public.products p where p.id::text=l.target_entity_id)
union all
select
  'INTEGRATION_INBOX_FAILURE',
  i.id::text,
  i.entity_sku,
  jsonb_build_object('eventType',i.event_type,'status',i.status,'error',i.last_error,'attempts',i.attempts),
  i.updated_at
from public.integration_event_inbox i
where i.status in ('DEAD','FAILED')
  and i.updated_at >= now()-interval '14 days'
  and coalesce(i.last_error,'') not like 'RECOVERED_ORPHAN_TARGET:%'
  and not (
    coalesce(i.last_error,'') in ('BRIDGE_SKU_CONFLICT','PRICING_MAPPING_NOT_FOUND')
    and exists (
      select 1
      from public.external_entity_links l
      where l.source_system='amphon-system'
        and l.source_entity_type='product_intake_unit'
        and l.source_entity_id=i.entity_id
        and l.target_system='product-hub'
        and l.target_entity_type='product'
        and l.sync_status='LINKED'
    )
  );

revoke all on public.one_integrity_issues_v from anon,authenticated;
grant select on public.one_integrity_issues_v to service_role;
