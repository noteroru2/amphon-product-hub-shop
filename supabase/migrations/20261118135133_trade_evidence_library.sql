-- AMPHON purchase/sale proof library. Private by default; nothing is auto-published.
create table if not exists public.trade_evidence (
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('purchase','sale')),
 occurred_on date not null default current_date,
 title text not null check (char_length(btrim(title)) between 3 and 180),
 category text not null default 'other',
 brand text,
 model text,
 specs_text text,
 condition_text text,
 story text not null default '',
 service_details text,
 city text,
 related_sku text,
 internal_reference text,
 website_text text,
 facebook_text text,
 show_price boolean not null default false,
 public_price numeric(12,2) check (public_price is null or public_price >= 0),
 permission_confirmed boolean not null default false,
 privacy_reviewed boolean not null default false,
 status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','ARCHIVED')),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 created_by uuid not null default auth.uid() references auth.users(id),
 updated_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint evidence_public_price_requires_opt_in check (not show_price or public_price is not null)
);
create table if not exists public.trade_evidence_images (
 id uuid primary key default gen_random_uuid(),
 evidence_id uuid not null references public.trade_evidence(id) on delete cascade,
 storage_path text not null unique,
 sort_order int not null default 0,
 alt_text text not null default '',
 approved_for_public boolean not null default false,
 uploaded_by uuid default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 constraint evidence_storage_path_scope check (split_part(storage_path,'/',1) = evidence_id::text)
);
create index if not exists trade_evidence_kind_date_idx on public.trade_evidence(kind,occurred_on desc);
create index if not exists trade_evidence_status_date_idx on public.trade_evidence(status,created_at desc);
create index if not exists trade_evidence_images_parent_idx on public.trade_evidence_images(evidence_id,sort_order);

-- A clear audit trail, including who approved a case, without exposing customer documents.
create table if not exists public.trade_evidence_audit (
 id bigint generated always as identity primary key,
 evidence_id uuid not null,
 actor_id uuid,
 operation text not null,
 old_status text,
 new_status text,
 changed_at timestamptz not null default now()
);
create index if not exists trade_evidence_audit_evidence_idx on public.trade_evidence_audit(evidence_id,changed_at desc);

create or replace function public.trade_evidence_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' and old.status = 'APPROVED'
      and (new.title, new.story, new.website_text, new.facebook_text, new.permission_confirmed,
           new.privacy_reviewed, new.show_price, new.public_price, new.kind, new.occurred_on)
      is distinct from
          (old.title, old.story, old.website_text, old.facebook_text, old.permission_confirmed,
           old.privacy_reviewed, old.show_price, old.public_price, old.kind, old.occurred_on)
      and new.status = 'APPROVED' then
    new.status := 'DRAFT';
  end if;
  if new.status = 'APPROVED' then
    if not new.permission_confirmed or not new.privacy_reviewed or length(btrim(new.story)) < 20
       or length(btrim(coalesce(new.website_text,''))) < 20 then
      raise exception 'Approval requires permission, privacy review and actual content' using errcode='23514';
    end if;
    if not exists (
      select 1 from public.trade_evidence_images i
      where i.evidence_id=new.id and i.approved_for_public
    ) then
      raise exception 'Approval requires at least one reviewed public-safe photo' using errcode='23514';
    end if;
    if tg_op = 'INSERT' or old.status is distinct from 'APPROVED' then
      new.approved_at := now();
      new.approved_by := auth.uid();
    end if;
  else
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end $$;
drop trigger if exists trade_evidence_guard_tr on public.trade_evidence;
create trigger trade_evidence_guard_tr before insert or update on public.trade_evidence
for each row execute function public.trade_evidence_guard();

create or replace function public.trade_evidence_audit_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trade_evidence_audit(evidence_id, actor_id, operation, old_status, new_status)
  values(new.id, auth.uid(), tg_op, case when tg_op='INSERT' then null else old.status end, new.status);
  return new;
end $$;
revoke all on function public.trade_evidence_audit_changes() from public, anon, authenticated;
drop trigger if exists trade_evidence_audit_tr on public.trade_evidence;
create trigger trade_evidence_audit_tr after insert or update on public.trade_evidence
for each row execute function public.trade_evidence_audit_changes();

alter table public.trade_evidence enable row level security;
alter table public.trade_evidence_images enable row level security;
alter table public.trade_evidence_audit enable row level security;
grant select,insert,update on public.trade_evidence to authenticated;
grant select,insert,update,delete on public.trade_evidence_images to authenticated;
grant select on public.trade_evidence_audit to authenticated;
grant usage,select on sequence public.trade_evidence_audit_id_seq to authenticated;

drop policy if exists "evidence_admin_select" on public.trade_evidence;
create policy "evidence_admin_select" on public.trade_evidence for select to authenticated
using ((select public.current_user_role()) in ('owner','admin'));
drop policy if exists "evidence_admin_insert" on public.trade_evidence;
create policy "evidence_admin_insert" on public.trade_evidence for insert to authenticated
with check ((select public.current_user_role()) in ('owner','admin') and created_by = (select auth.uid()));
drop policy if exists "evidence_admin_update" on public.trade_evidence;
create policy "evidence_admin_update" on public.trade_evidence for update to authenticated
using ((select public.current_user_role()) in ('owner','admin'))
with check ((select public.current_user_role()) in ('owner','admin'));

drop policy if exists "evidence_images_admin_select" on public.trade_evidence_images;
create policy "evidence_images_admin_select" on public.trade_evidence_images for select to authenticated
using ((select public.current_user_role()) in ('owner','admin'));
drop policy if exists "evidence_images_admin_insert" on public.trade_evidence_images;
create policy "evidence_images_admin_insert" on public.trade_evidence_images for insert to authenticated
with check ((select public.current_user_role()) in ('owner','admin'));
drop policy if exists "evidence_images_admin_update" on public.trade_evidence_images;
create policy "evidence_images_admin_update" on public.trade_evidence_images for update to authenticated
using ((select public.current_user_role()) in ('owner','admin'))
with check ((select public.current_user_role()) in ('owner','admin'));
drop policy if exists "evidence_images_admin_delete" on public.trade_evidence_images;
create policy "evidence_images_admin_delete" on public.trade_evidence_images for delete to authenticated
using ((select public.current_user_role()) in ('owner','admin'));
drop policy if exists "evidence_audit_admin_select" on public.trade_evidence_audit;
create policy "evidence_audit_admin_select" on public.trade_evidence_audit for select to authenticated
using ((select public.current_user_role()) in ('owner','admin'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('trade-evidence-private','trade-evidence-private',false,8388608,ARRAY['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=8388608,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "evidence_storage_admin_read" on storage.objects;
create policy "evidence_storage_admin_read" on storage.objects for select to authenticated
using (bucket_id='trade-evidence-private'
 and (select public.current_user_role()) in ('owner','admin')
 and exists(select 1 from public.trade_evidence e where e.id::text=(storage.foldername(name))[1]));
drop policy if exists "evidence_storage_admin_insert" on storage.objects;
create policy "evidence_storage_admin_insert" on storage.objects for insert to authenticated
with check (bucket_id='trade-evidence-private'
 and (select public.current_user_role()) in ('owner','admin')
 and exists(select 1 from public.trade_evidence e where e.id::text=(storage.foldername(name))[1]));
drop policy if exists "evidence_storage_admin_delete" on storage.objects;
create policy "evidence_storage_admin_delete" on storage.objects for delete to authenticated
using (bucket_id='trade-evidence-private'
 and (select public.current_user_role()) in ('owner','admin')
 and exists(select 1 from public.trade_evidence e where e.id::text=(storage.foldername(name))[1]));

-- Private, invoker-secured AI/editorial feed. Does NOT grant anonymous access or publish media.
create or replace view public.trade_evidence_ai_ready_v with (security_invoker = true) as
 select e.id,e.kind,e.occurred_on,e.title,e.category,e.brand,e.model,
        e.specs_text,e.condition_text,e.story,e.service_details,e.city,e.related_sku,
        e.website_text,e.facebook_text,
        case when e.show_price then e.public_price else null end as public_price,
        e.approved_at,
        coalesce((select jsonb_agg(jsonb_build_object('path',i.storage_path,'alt',i.alt_text)
                            order by i.sort_order)
                  from public.trade_evidence_images i where i.evidence_id=e.id and i.approved_for_public),
                  '[]'::jsonb) as reviewed_images
 from public.trade_evidence e where e.status='APPROVED';
revoke all on public.trade_evidence_ai_ready_v from public, anon;
grant select on public.trade_evidence_ai_ready_v to authenticated;
