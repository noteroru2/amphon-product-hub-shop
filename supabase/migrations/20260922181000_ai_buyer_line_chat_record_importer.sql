-- Normalized importer for LINE OA chat-history rows after CSV parsing.
-- The CSV parser is intentionally kept outside SQL because LINE may change export columns.
create or replace function public.ai_buyer_import_line_chat_records(
  p_window_id uuid,
  p_import_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r jsonb;
  v_inserted integer := 0;
  v_direction text;
  v_speaker text;
  v_type text;
  v_at timestamptz;
  v_external text;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ROWS_MUST_BE_ARRAY';
  end if;

  if not exists (
    select 1 from public.ai_buyer_learning_windows where id=p_window_id
  ) then
    raise exception 'LEARNING_WINDOW_NOT_FOUND';
  end if;

  for r in select value from jsonb_array_elements(p_rows)
  loop
    v_direction := upper(coalesce(nullif(trim(r->>'direction'),''),'UNKNOWN'));
    if v_direction not in ('INBOUND','OUTBOUND','UNKNOWN') then v_direction := 'UNKNOWN'; end if;

    v_speaker := upper(coalesce(nullif(trim(r->>'speaker'),''),
      case
        when v_direction='INBOUND' then 'CUSTOMER'
        when v_direction='OUTBOUND' then 'OWNER_MANUAL'
        else 'UNKNOWN'
      end
    ));
    if v_speaker not in ('CUSTOMER','OWNER_MANUAL','OWNER_APPROVED','AI_SYSTEM','SHOP_OTHER','UNKNOWN') then
      v_speaker := case when v_direction='INBOUND' then 'CUSTOMER' when v_direction='OUTBOUND' then 'OWNER_MANUAL' else 'UNKNOWN' end;
    end if;

    v_type := upper(coalesce(nullif(trim(r->>'message_type'),''),'TEXT'));
    begin
      v_at := (r->>'occurred_at')::timestamptz;
    exception when others then
      v_at := now();
    end;

    v_external := nullif(trim(r->>'source_external_id'),'');
    if v_external is null then
      v_external := encode(digest(
        coalesce(r->>'conversation_key','') || '|' ||
        v_direction || '|' ||
        coalesce(r->>'text_content','') || '|' ||
        v_at::text,
        'sha256'
      ),'hex');
    end if;

    insert into public.ai_buyer_learning_events(
      window_id,source,source_external_id,conversation_id,case_id,
      direction,speaker,message_type,text_content,occurred_at,raw_payload
    ) values (
      p_window_id,
      'LINE_OA_CHAT_EXPORT',
      v_external,
      nullif(r->>'conversation_id','')::uuid,
      nullif(r->>'case_id','')::uuid,
      v_direction,
      v_speaker,
      v_type,
      r->>'text_content',
      v_at,
      coalesce(r->'raw_payload','{}'::jsonb)
        || jsonb_build_object(
          'conversation_key',r->>'conversation_key',
          'import_id',p_import_id
        )
    )
    on conflict do nothing;

    if found then v_inserted := v_inserted + 1; end if;
  end loop;

  if p_import_id is not null then
    update public.ai_buyer_learning_imports
    set parse_status='PARSED',
        rows_parsed=v_inserted,
        parsed_at=now(),
        error=null
    where id=p_import_id and window_id=p_window_id;
  end if;

  return jsonb_build_object('ok',true,'inserted',v_inserted,'windowId',p_window_id,'importId',p_import_id);
exception when others then
  if p_import_id is not null then
    update public.ai_buyer_learning_imports
    set parse_status='FAILED',error=left(sqlerrm,2000),parsed_at=now()
    where id=p_import_id and window_id=p_window_id;
  end if;
  raise;
end;
$$;

revoke all on function public.ai_buyer_import_line_chat_records(uuid,uuid,jsonb)
from public,anon,authenticated;
grant execute on function public.ai_buyer_import_line_chat_records(uuid,uuid,jsonb)
to service_role;
