-- AMPHON Trade Evidence -> private, owner-verified purchase/sale economics.
-- No LINE match required. No inference that a store transaction came from SEO.
-- Additive schema only; existing marketing AI/public export is unchanged.
alter table public.trade_evidence
  add column if not exists deal_code text,
  add column if not exists quantity integer not null default 1,
  add column if not exists transaction_amount numeric(14,2),
  add column if not exists repair_cost numeric(14,2) not null default 0,
  add column if not exists shipping_cost numeric(14,2) not null default 0,
  add column if not exists platform_fee numeric(14,2) not null default 0,
  add column if not exists other_direct_cost numeric(14,2) not null default 0,
  add column if not exists customer_channel text not null default 'UNKNOWN',
  add column if not exists channel_evidence text not null default 'UNKNOWN',
  add column if not exists channel_evidence_ref text,
  add column if not exists verification_reference text,
  add column if not exists transaction_verified boolean not null default false,
  add column if not exists transaction_verified_at timestamptz,
  add column if not exists transaction_verified_by uuid references auth.users(id);

alter table public.trade_evidence
  add constraint trade_evidence_deal_code_format_check
    check (deal_code is null or (length(btrim(deal_code)) between 3 and 80
           and deal_code ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]*$')),
  add constraint trade_evidence_financial_nonnegative_check
    check (quantity > 0 and quantity <= 100000
      and (transaction_amount is null or transaction_amount >= 0)
      and repair_cost >= 0 and shipping_cost >= 0
      and platform_fee >= 0 and other_direct_cost >= 0),
  add constraint trade_evidence_channel_check
    check (customer_channel in ('UNKNOWN','GOOGLE','FACEBOOK','WALK_IN','REPEAT','REFERRAL','OTHER')
      and channel_evidence in ('UNKNOWN','CUSTOMER_STATED','DOCUMENTED')),
  add constraint trade_evidence_channel_documented_check
    check (channel_evidence <> 'DOCUMENTED'
      or (customer_channel <> 'UNKNOWN'
        and length(btrim(coalesce(channel_evidence_ref,''))) between 4 and 240)),
  add constraint trade_evidence_receipt_lengths_check
    check (char_length(coalesce(verification_reference,'')) <= 240
       and char_length(coalesce(channel_evidence_ref,'')) <= 240),
  add constraint trade_evidence_verified_fields_check
    check (not transaction_verified or
      (deal_code is not null and transaction_amount is not null
       and length(btrim(coalesce(verification_reference,''))) >= 4
       and transaction_verified_at is not null
       and transaction_verified_by is not null));

-- Exactly one purchase + one final sale may use the same deal code.
-- Lots and partial sales must be split into their own deal codes before verification.
create unique index if not exists trade_evidence_kind_deal_code_unique_idx
on public.trade_evidence(kind, upper(btrim(deal_code)))
where deal_code is not null;
create index if not exists trade_evidence_verified_economics_idx
on public.trade_evidence(kind,transaction_verified,occurred_on desc)
where transaction_verified;

-- Transaction verification is separate from public-media editorial APPROVED status.
-- Only the store owner may verify actual financial receipts, and real private image
-- evidence must exist before verification. Editing economic facts revokes verification.
create or replace function public.trade_evidence_economics_guard()
returns trigger language plpgsql set search_path = '' as $$
declare material_edit boolean := false;
begin
  if tg_op='UPDATE' then
    material_edit :=
      (new.kind,new.occurred_on,new.deal_code,new.quantity,new.transaction_amount,
       new.repair_cost,new.shipping_cost,new.platform_fee,new.other_direct_cost,
       new.customer_channel,new.channel_evidence,new.channel_evidence_ref,
       new.verification_reference,new.internal_reference,new.related_sku)
      is distinct from
      (old.kind,old.occurred_on,old.deal_code,old.quantity,old.transaction_amount,
       old.repair_cost,old.shipping_cost,old.platform_fee,old.other_direct_cost,
       old.customer_channel,old.channel_evidence,old.channel_evidence_ref,
       old.verification_reference,old.internal_reference,old.related_sku);
    if old.transaction_verified and material_edit then
      new.transaction_verified := false;
    end if;
  end if;

  if new.deal_code is not null then
    new.deal_code := upper(btrim(new.deal_code));
  end if;

  if new.transaction_verified then
    if tg_op='INSERT' or not old.transaction_verified then
      if (select public.current_user_role()) <> 'owner' then
        raise exception 'Only owner can verify real purchase/sale financial evidence'
          using errcode='42501';
      end if;
      if new.deal_code is null or new.transaction_amount is null
          or length(btrim(coalesce(new.verification_reference,''))) < 4 then
        raise exception 'Verification requires deal code, real amount and receipt reference'
          using errcode='23514';
      end if;
      if not exists (
        select 1 from public.trade_evidence_images i where i.evidence_id=new.id
      ) then
        raise exception 'Upload at least one private transaction image before owner verification'
          using errcode='23514';
      end if;
      new.transaction_verified_at := now();
      new.transaction_verified_by := auth.uid();
    end if;
  else
    new.transaction_verified_at := null;
    new.transaction_verified_by := null;
  end if;
  return new;
end $$;

revoke all on function public.trade_evidence_economics_guard() from public,anon,authenticated;
drop trigger if exists trade_evidence_economics_guard_tr on public.trade_evidence;
create trigger trade_evidence_economics_guard_tr
before insert or update on public.trade_evidence
for each row execute function public.trade_evidence_economics_guard();

-- Preserve the pre-existing privacy approval revocation. Also invalidate financial
-- verification if a supporting image changes; owner may reverify after review.
create or replace function public.trade_evidence_image_revocation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_id uuid;
begin
  if tg_op='DELETE' then parent_id := old.evidence_id;
  else parent_id := new.evidence_id; end if;
  update public.trade_evidence
    set status='DRAFT',transaction_verified=false
    where id=parent_id
      and (status='APPROVED' or transaction_verified);
  return coalesce(new,old);
end $$;
revoke all on function public.trade_evidence_image_revocation() from public,anon,authenticated;

-- Verified completed, 1:1 whole-quantity matches only.
-- A source field is a manually reported channel, never a GSC attribution claim.
create or replace view public.trade_evidence_economics_v
with (security_invoker=true) as
select
 p.id as purchase_evidence_id,
 s.id as sale_evidence_id,
 p.deal_code,
 p.title,
 p.category,
 p.related_sku,
 p.quantity,
 p.occurred_on as purchased_on,
 s.occurred_on as sold_on,
 p.customer_channel as buyer_acquisition_channel,
 p.channel_evidence as buyer_channel_evidence,
 p.transaction_amount as acquisition_amount,
 p.repair_cost as repair_cost,
 p.shipping_cost as inbound_shipping_cost,
 p.other_direct_cost as other_acquisition_cost,
 s.transaction_amount as sale_amount,
 s.shipping_cost as outbound_shipping_cost,
 s.platform_fee as sale_platform_fee,
 s.other_direct_cost as other_selling_cost,
 (s.transaction_amount - p.transaction_amount
    - p.repair_cost - p.shipping_cost - p.other_direct_cost
    - s.shipping_cost - s.platform_fee - s.other_direct_cost
 )::numeric(14,2) as realized_gross_profit_after_direct_costs,
 false as seo_attribution_proven,
 greatest(p.transaction_verified_at,s.transaction_verified_at) as last_verified_at
from public.trade_evidence p
join public.trade_evidence s
  on upper(btrim(p.deal_code))=upper(btrim(s.deal_code))
  and s.kind='sale'
where p.kind='purchase'
  and p.transaction_verified and s.transaction_verified
  and p.deal_code is not null
  and p.quantity=s.quantity
  and p.transaction_amount is not null and s.transaction_amount is not null
  and p.transaction_verified_at is not null and s.transaction_verified_at is not null;

-- Never grant financials to anonymous/public/AI feed. Existing RLS on the
-- underlying tables enforces owner/admin on this invoker view.
revoke all on public.trade_evidence_economics_v from public,anon,authenticated;
grant select on public.trade_evidence_economics_v to authenticated;
comment on view public.trade_evidence_economics_v is
 'Owner/admin-only verified one-to-one purchase+sale gross profit after direct expenses. Not net profit, not Google/SEO attribution; excludes partial lots and unverified transactions.';

-- New financial columns stay private on trade_evidence. Marketing AI ready view
-- remains an explicit-column allowlist; never expose real cost, source receipts
-- or verified flags through public editorial and Facebook content paths.
