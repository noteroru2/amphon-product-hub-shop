-- P0 Intake reliability: atomic active-case creation + cleanup of concurrent duplicate shells.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('a7e5d8d0-053b-4cb0-996e-f7ee203380a9'::uuid,'145ce434-bc82-42a5-a1ac-dd87298bcb20'::uuid),
      ('36a0861e-c77f-4b98-bce3-9a6606954714'::uuid,'1f441860-498e-47be-b64f-0a40d784c1ef'::uuid),
      ('54ff7afa-309e-4946-9619-78f09f3ccb8f'::uuid,'ef5a96b0-f674-42ab-83cf-57aa91b2ff25'::uuid),
      ('f1c239a2-c387-4bc9-8e2b-a27c6cbd80c1'::uuid,'254f5381-e4e4-4c9f-b7dd-831bb8285af1'::uuid),
      ('4b59620c-5469-489d-8a97-271cedce8285'::uuid,'b6f1dd88-a645-4c69-bf8a-c6f35c12ce42'::uuid),
      ('8b73c829-9d97-4881-a9fd-58c454ad08b4'::uuid,'b6f1dd88-a645-4c69-bf8a-c6f35c12ce42'::uuid),
      ('92a81198-6cf5-4128-8d31-07b85a840728'::uuid,'7f172b2f-d622-48a8-9b76-8ae3818fb719'::uuid)
    ) as x(duplicate_id,canonical_id)
  loop
    if exists (
      select 1 from public.ai_buyer_valuation_cases
      where id=r.duplicate_id and state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED')
    ) and exists (
      select 1 from public.ai_buyer_valuation_cases where id=r.canonical_id
    ) then
      update public.ai_buyer_messages
      set case_id=r.canonical_id
      where case_id=r.duplicate_id;

      update public.ai_buyer_case_images
      set case_id=r.canonical_id
      where case_id=r.duplicate_id;

      update public.ai_buyer_analysis_runs
      set case_id=r.canonical_id
      where case_id=r.duplicate_id;

      update public.ai_buyer_valuation_cases
      set state='CANCELLED',
          control_mode='AUTO',
          completed_at=coalesce(completed_at,now()),
          metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
            'cancelReason','CONCURRENT_DUPLICATE_CASE',
            'canonicalCaseId',r.canonical_id,
            'cancelledAt',now()
          ),
          updated_at=now()
      where id=r.duplicate_id;
    end if;
  end loop;
end $$;

create unique index if not exists ai_buyer_one_active_case_per_conversation_idx
  on public.ai_buyer_valuation_cases(conversation_id)
  where state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED');

create or replace function public.ai_buyer_get_or_create_active_case(
  p_conversation_id uuid,
  p_customer_id uuid
)
returns table(id uuid,state text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_state text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text, 0));

  select c.id,c.state
  into v_id,v_state
  from public.ai_buyer_valuation_cases c
  where c.conversation_id=p_conversation_id
    and c.state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED')
  order by c.updated_at desc
  limit 1
  for update;

  if v_id is null then
    insert into public.ai_buyer_valuation_cases(
      conversation_id,customer_id,state,control_mode
    ) values (
      p_conversation_id,p_customer_id,'NEW','AUTO'
    )
    returning ai_buyer_valuation_cases.id,ai_buyer_valuation_cases.state
    into v_id,v_state;
  end if;

  return query select v_id,v_state;
end;
$$;

revoke all on function public.ai_buyer_get_or_create_active_case(uuid,uuid)
from public,anon,authenticated;
grant execute on function public.ai_buyer_get_or_create_active_case(uuid,uuid)
to service_role;

comment on function public.ai_buyer_get_or_create_active_case(uuid,uuid) is
  'Atomically reuses or creates one non-terminal valuation case per conversation.';
