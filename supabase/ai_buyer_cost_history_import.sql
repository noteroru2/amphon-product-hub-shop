begin;
create table if not exists public.ai_buyer_cost_history (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('INVENTORY','SALE','FIELD')),
  source_key text not null check (length(source_key) between 1 and 100),
  inventory_code text not null default '',
  product_name text not null check(length(product_name) between 1 and 400),
  category text not null default '',
  source_type text not null default '',
  source_status text not null default '',
  buy_cost numeric(14,2) not null check(buy_cost>=0),
  actual_sale numeric(14,2),
  actual_profit numeric(14,2),
  quantity integer not null default 1 check (quantity between 1 and 100000),
  occurred_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique(source_kind,source_key)
);
create index if not exists aib_cost_history_product_idx on public.ai_buyer_cost_history(inventory_code);
create index if not exists aib_cost_history_kind_date_idx on public.ai_buyer_cost_history(source_kind,occurred_at desc);

create table if not exists public.ai_buyer_cost_import_batches(
 id bigint generated always as identity primary key,
 actor_id uuid not null references auth.users(id),
 source_kind text not null check(source_kind in ('INVENTORY','SALE','FIELD')),
 count_rows integer not null check(count_rows between 1 and 100),
 imported_at timestamptz not null default now()
);
create index if not exists aib_cost_batch_actor_idx on public.ai_buyer_cost_import_batches(actor_id);
create table if not exists public.ai_buyer_cost_import_audit(
 id bigint generated always as identity primary key,
 batch_id bigint not null references public.ai_buyer_cost_import_batches(id),
 history_id uuid not null references public.ai_buyer_cost_history(id),
 action text not null check(action in ('INSERT','UPDATE')),
 before_data jsonb,
 after_data jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists aib_cost_import_audit_batch_idx on public.ai_buyer_cost_import_audit(batch_id);

alter table public.ai_buyer_cost_history enable row level security;
alter table public.ai_buyer_cost_import_batches enable row level security;
alter table public.ai_buyer_cost_import_audit enable row level security;
revoke all on public.ai_buyer_cost_history,public.ai_buyer_cost_import_batches,public.ai_buyer_cost_import_audit from public,anon,authenticated;
grant select on public.ai_buyer_cost_history,public.ai_buyer_cost_import_batches,public.ai_buyer_cost_import_audit to authenticated;
drop policy if exists aib_cost_owner_select on public.ai_buyer_cost_history;
drop policy if exists aib_cost_owner_select on public.ai_buyer_cost_import_batches;
drop policy if exists aib_cost_owner_select on public.ai_buyer_cost_import_audit;
create policy aib_cost_owner_select on public.ai_buyer_cost_history for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role in ('owner','admin')));
create policy aib_cost_owner_select on public.ai_buyer_cost_import_batches for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role in ('owner','admin')));
create policy aib_cost_owner_select on public.ai_buyer_cost_import_audit for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role in ('owner','admin')));

create or replace function public.ai_buyer_cost_history_import(p_source_kind text,p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid();
  row_value jsonb;
  kind text := upper(btrim(coalesce(p_source_kind,'')));
  n int; batch_id bigint; prior jsonb; entry_id uuid;
  item_key text; item_name text; unit_cost numeric; unit_sale numeric; profit numeric;
  qty int; item_date timestamptz; details_value jsonb; product_code text;
begin
 if actor is null or not exists(select 1 from public.profiles p where p.id=actor and p.active and p.role in ('owner','admin')) then
   raise exception 'COST_HISTORY_ADMIN_REQUIRED' using errcode='42501';
 end if;
 if kind not in ('INVENTORY','SALE','FIELD') then raise exception 'COST_HISTORY_SOURCE_INVALID'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'COST_HISTORY_ROWS_INVALID';end if;
 n:=jsonb_array_length(p_rows);
 if n<1 or n>100 then raise exception 'COST_HISTORY_BATCH_SIZE_INVALID';end if;
 insert into public.ai_buyer_cost_import_batches(actor_id,source_kind,count_rows) values(actor,kind,n) returning id into batch_id;
 for row_value in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(row_value)<>'object' then raise exception 'COST_HISTORY_ROW_INVALID'; end if;
  item_key=btrim(coalesce(case when kind='SALE' then row_value->>'id' else row_value->>'code' end,''));
  if item_key='' then item_key=btrim(coalesce(row_value->>'id','')); end if;
  item_name=btrim(coalesce(case when kind='INVENTORY' then row_value->>'name'
     when kind='SALE' then row_value->>'itemName'
     else concat_ws(' ',nullif(row_value->>'brand',''),nullif(row_value->>'model','')) end,''));
  if length(item_key) not between 1 and 100 or length(item_name) not between 1 and 400 then raise exception 'COST_HISTORY_IDENTITY_INVALID';end if;
  begin
   unit_cost=(case when kind='FIELD' then coalesce(nullif(row_value->>'approvedBuyPrice',''),nullif(row_value->>'buyPrice','')) else row_value->>'cost' end)::numeric;
   unit_sale=(case when kind='SALE' then nullif(row_value->>'actualUnitPrice','') when kind='INVENTORY' then nullif(row_value->>'sellingPrice','') else null end)::numeric;
   profit=(case when kind='SALE' then nullif(row_value->>'actualProfit','') when kind='INVENTORY' then nullif(row_value->>'grossProfit','') else null end)::numeric;
   qty=coalesce(nullif(row_value->>'quantity','')::integer,1);
   item_date=(case when kind='SALE' then nullif(row_value->>'soldAt','') else nullif(row_value->>'createdAt','') end)::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then raise exception 'COST_HISTORY_NUMBER_OR_DATE_INVALID';end;
  if unit_cost is null or unit_cost<=0 or qty<=0 or qty>100000 or
     (unit_sale is not null and unit_sale<0) then raise exception 'COST_HISTORY_VALUE_INVALID';end if;
  product_code=case when kind='SALE' then coalesce(row_value->>'inventoryCode','')
   when kind='INVENTORY' then coalesce(row_value->>'code','') else '' end;
  details_value=case kind
   when 'INVENTORY' then jsonb_build_object('condition',row_value->>'condition','quantity_sold',row_value->>'quantitySold','updated_at',row_value->>'updatedAt')
   when 'SALE' then jsonb_build_object('sale_channel',row_value->>'saleChannel','age_days',row_value->>'stockAgeDays','actual_revenue',row_value->>'actualRevenue','actual_roi',row_value->>'actualRoi')
   else jsonb_build_object('model',row_value->>'model','brand',row_value->>'brand','spec',row_value->>'spec',
       'condition',row_value->>'conditionNote','defect',row_value->>'defectNote','inventory_item_id',row_value->>'inventoryItemId',
       'travel',row_value->>'travelExpense','shipping',row_value->>'shippingExpense',
       'field_commission',row_value->>'fieldCommission','repair',row_value->>'repairEstimate',
       'other',row_value->>'otherExpense','total_cost',row_value->>'totalCost',
       'approved_at',row_value->>'approvedAt','stocked_at',row_value->>'stockedAt')
  end;
  select to_jsonb(h) into prior from public.ai_buyer_cost_history h where h.source_kind=kind and h.source_key=item_key for update;
  insert into public.ai_buyer_cost_history(source_kind,source_key,inventory_code,product_name,category,source_type,source_status,buy_cost,actual_sale,actual_profit,quantity,occurred_at,details)
  values(kind,item_key,left(product_code,100),item_name,
      left(coalesce(case when kind='FIELD' then row_value->>'productType' else row_value->>'category' end,''),100),
      left(coalesce(row_value->>'sourceType',case when kind='FIELD' then 'FIELD_PURCHASE' else '' end),60),
      left(coalesce(row_value->>'status',case when kind='SALE' then 'SOLD' else '' end),60),
      unit_cost,unit_sale,profit,qty,item_date,details_value)
  on conflict (source_kind,source_key) do update set
   inventory_code=excluded.inventory_code,product_name=excluded.product_name,category=excluded.category,
   source_type=excluded.source_type,source_status=excluded.source_status,buy_cost=excluded.buy_cost,
   actual_sale=excluded.actual_sale,actual_profit=excluded.actual_profit,quantity=excluded.quantity,
   occurred_at=excluded.occurred_at,details=excluded.details,imported_at=now()
  returning id into entry_id;
  insert into public.ai_buyer_cost_import_audit(batch_id,history_id,action,before_data,after_data)
   select batch_id,entry_id,case when prior is null then 'INSERT' else 'UPDATE' end,prior,to_jsonb(h)
   from public.ai_buyer_cost_history h where h.id=entry_id;
 end loop;
 return n;
end;$$;
revoke all on function public.ai_buyer_cost_history_import(text,jsonb) from public,anon;
grant execute on function public.ai_buyer_cost_history_import(text,jsonb) to authenticated;
commit;