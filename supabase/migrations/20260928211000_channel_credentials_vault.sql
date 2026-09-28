-- Secure channel credential vault. Never expose secret values to browser.
alter table public.sales_channel_connections add column if not exists credential_secret_id uuid;
create or replace function public.central_channel_store_credentials(p_channel_key text,p_connection_key text,p_credentials jsonb,p_external_account_id text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.sales_channel_connections%rowtype; sid uuid; secret_text text;
begin
 select * into c from public.sales_channel_connections where channel_key=p_channel_key and connection_key=p_connection_key for update;
 if c.id is null then raise exception 'CHANNEL_CONNECTION_NOT_FOUND'; end if;
 secret_text=p_credentials::text;
 if length(secret_text)<3 then raise exception 'CHANNEL_CREDENTIALS_EMPTY'; end if;
 if c.credential_secret_id is null then
   select vault.create_secret(secret_text,'channel_'||p_channel_key||'_'||replace(p_connection_key,'-','_'),'AMPHON sales channel credentials') into sid;
 else sid=c.credential_secret_id; perform vault.update_secret(sid,secret_text); end if;
 update public.sales_channel_connections set credential_secret_id=sid,external_account_id=nullif(trim(p_external_account_id),''),
 status='CONNECTED',last_error=null,updated_at=now() where id=c.id;
 return true;
end $$;
create or replace function public.central_channel_clear_credentials(p_channel_key text,p_connection_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.sales_channel_connections%rowtype;
begin
 select * into c from public.sales_channel_connections where channel_key=p_channel_key and connection_key=p_connection_key for update;
 if c.id is null then return false; end if;
 if c.credential_secret_id is not null then perform vault.delete_secret(c.credential_secret_id); end if;
 update public.sales_channel_connections set credential_secret_id=null,status=case when p_channel_key='shopee' then 'WAITING_ACCESS' else 'DISCONNECTED' end,last_error=null,updated_at=now() where id=c.id;
 return true;
end $$;
revoke all on function public.central_channel_store_credentials(text,text,jsonb,text),public.central_channel_clear_credentials(text,text) from public,anon,authenticated;
grant execute on function public.central_channel_store_credentials(text,text,jsonb,text),public.central_channel_clear_credentials(text,text) to service_role;
