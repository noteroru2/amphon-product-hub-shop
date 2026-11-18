-- Any change to approved public details or photo metadata revokes approval.
create or replace function public.trade_evidence_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' and old.status = 'APPROVED'
      and (new.title, new.story, new.website_text, new.facebook_text, new.permission_confirmed,
           new.privacy_reviewed, new.show_price, new.public_price, new.kind, new.occurred_on,
           new.category, new.brand, new.model, new.specs_text, new.condition_text,
           new.service_details, new.city, new.related_sku)
      is distinct from
          (old.title, old.story, old.website_text, old.facebook_text, old.permission_confirmed,
           old.privacy_reviewed, old.show_price, old.public_price, old.kind, old.occurred_on,
           old.category, old.brand, old.model, old.specs_text, old.condition_text,
           old.service_details, old.city, old.related_sku)
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

create or replace function public.trade_evidence_image_revocation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_id uuid;
begin
  if tg_op = 'DELETE' then parent_id := old.evidence_id;
  else parent_id := new.evidence_id; end if;
  update public.trade_evidence set status='DRAFT'
  where id=parent_id and status='APPROVED';
  return coalesce(new,old);
end $$;
revoke all on function public.trade_evidence_image_revocation() from public, anon, authenticated;
drop trigger if exists trade_evidence_media_reapproval_tr on public.trade_evidence_images;
create trigger trade_evidence_media_reapproval_tr
after insert or update or delete on public.trade_evidence_images
for each row execute function public.trade_evidence_image_revocation();
