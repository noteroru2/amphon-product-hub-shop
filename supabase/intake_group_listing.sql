-- One staff-facing draft per System intake; physical SKU/stock events stay per unit.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS one_intake_group_id text;
CREATE INDEX IF NOT EXISTS products_one_intake_group_idx ON public.products(one_intake_group_id) WHERE one_intake_group_id IS NOT NULL;

-- Only the bridge may assign grouping; never group by a similar title/model.
CREATE OR REPLACE FUNCTION private.hub_guard_intake_group()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('postgres','service_role') AND (
      (TG_OP='INSERT' AND NEW.one_intake_group_id IS NOT NULL) OR
      (TG_OP='UPDATE' AND NEW.one_intake_group_id IS DISTINCT FROM OLD.one_intake_group_id)) THEN
    RAISE EXCEPTION 'SYSTEM_OWNED_INTAKE_GROUP';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hub_guard_intake_group BEFORE INSERT OR UPDATE OF one_intake_group_id ON public.products
FOR EACH ROW EXECUTE FUNCTION private.hub_guard_intake_group();

UPDATE public.products p
SET one_intake_group_id = 'amphon-system:' || (e.metadata->>'systemIntakeId')
FROM public.external_entity_links e
WHERE e.source_system='amphon-system' AND e.source_entity_type='product_intake_unit'
  AND e.target_system='product-hub' AND e.target_entity_type='product'
  AND e.target_entity_id=p.id::text AND e.sync_status='LINKED' AND p.one_managed
  AND e.metadata->>'systemIntakeId' ~ '^[0-9]+$'
  AND e.metadata->>'quantityInIntake' ~ '^[0-9]+$'
  AND (e.metadata->>'quantityInIntake')::int > 1;

-- Share listing content, but never price, finance, serial, SKU or stock state.
-- Invoker security keeps every write under the existing staff RLS policies.
CREATE OR REPLACE FUNCTION public.hub_sync_intake_listing(p_source_id uuid, p_target_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  s public.products%rowtype;
  t public.products%rowtype;
  n integer := 0;
BEGIN
  IF current_user NOT IN ('postgres','service_role') AND NOT public.current_user_active() THEN
    RAISE EXCEPTION 'ACTIVE_STAFF_REQUIRED';
  END IF;
  SELECT * INTO s FROM public.products WHERE id=p_source_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF NOT s.one_managed OR s.one_intake_group_id IS NULL THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-intake:' || s.one_intake_group_id,0));
  -- Lock every unit in a stable order, including the source, against sales/edits.
  PERFORM id FROM public.products WHERE one_intake_group_id=s.one_intake_group_id ORDER BY id FOR UPDATE;
  SELECT * INTO s FROM public.products WHERE id=p_source_id;
  FOR t IN SELECT * FROM public.products
    WHERE one_managed AND one_intake_group_id=s.one_intake_group_id AND id<>s.id
      AND (p_target_id IS NULL OR id=p_target_id)
      AND one_availability='IN_STOCK' AND status IN ('draft','photo_ready','ready_to_list','published')
    ORDER BY id
  LOOP
    UPDATE public.products SET category=s.category,subtype=s.subtype,brand=s.brand,model=s.model,
      title=s.title,condition_percent=s.condition_percent,warranty_until=s.warranty_until,
      defects=s.defects,notes=s.notes,specs=s.specs,battery_health_grade=s.battery_health_grade,
      updated_by=coalesce(auth.uid(),s.updated_by)
    WHERE id=t.id;
    -- Metadata rows can reference the same R2 object. No object is deleted here.
    IF (SELECT coalesce(jsonb_agg(jsonb_build_array(object_key,public_url,sort_order,is_cover,image_role) ORDER BY sort_order,id),'[]'::jsonb)
        FROM public.product_images WHERE product_id=t.id)
       IS DISTINCT FROM
       (SELECT coalesce(jsonb_agg(jsonb_build_array(object_key,public_url,sort_order,is_cover,image_role) ORDER BY sort_order,id),'[]'::jsonb)
        FROM public.product_images WHERE product_id=s.id) THEN
      DELETE FROM public.product_images WHERE product_id=t.id;
      INSERT INTO public.product_images(product_id,object_key,public_url,sort_order,is_cover,image_role,bytes,created_by)
      SELECT t.id,object_key,public_url,sort_order,is_cover,image_role,bytes,coalesce(auth.uid(),created_by)
      FROM public.product_images WHERE product_id=s.id ORDER BY sort_order,id;
    END IF;
    n := n+1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.hub_sync_intake_listing(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hub_sync_intake_listing(uuid,uuid) TO authenticated,service_role;

-- Future bridge shells join the exact same intake and inherit existing work.
CREATE OR REPLACE FUNCTION private.hub_intake_link_group()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE g text; donor uuid;
BEGIN
  IF NEW.source_system<>'amphon-system' OR NEW.source_entity_type<>'product_intake_unit'
     OR NEW.target_system<>'product-hub' OR NEW.target_entity_type<>'product' OR NEW.sync_status<>'LINKED'
     OR coalesce(NEW.metadata->>'systemIntakeId','') !~ '^[0-9]+$'
     OR coalesce(NEW.metadata->>'quantityInIntake','') !~ '^[0-9]+$' THEN RETURN NEW; END IF;
  IF (NEW.metadata->>'quantityInIntake')::int <= 1 THEN RETURN NEW; END IF;
  g := 'amphon-system:' || (NEW.metadata->>'systemIntakeId');
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-intake:' || g,0));
  UPDATE public.products SET one_intake_group_id=g
  WHERE id::text=NEW.target_entity_id AND one_managed AND one_intake_group_id IS NULL;
  SELECT p.id INTO donor FROM public.products p
  WHERE p.one_intake_group_id=g AND p.id::text<>NEW.target_entity_id AND (p.one_enrichment_started OR p.specs<>'{}'::jsonb OR EXISTS(SELECT 1 FROM public.product_images i WHERE i.product_id=p.id))
  ORDER BY p.one_photos_complete DESC,p.one_specs_complete DESC,p.updated_at DESC,p.id LIMIT 1;
  IF donor IS NOT NULL THEN
    PERFORM public.hub_sync_intake_listing(donor,NEW.target_entity_id::uuid);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hub_intake_link_group AFTER INSERT OR UPDATE OF sync_status,metadata ON public.external_entity_links
FOR EACH ROW EXECUTE FUNCTION private.hub_intake_link_group();

-- Group before pagination, so a large intake cannot truncate the remaining count.
CREATE OR REPLACE FUNCTION public.hub_list_inventory(p_limit integer DEFAULT 500,p_offset integer DEFAULT 0)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH units AS (
    SELECT p.*,coalesce(p.one_intake_group_id,p.id::text) group_key,
      (p.status NOT IN ('sold','cancelled','returned') AND coalesce(p.one_availability,'IN_STOCK')<>'SOLD') live,
      (SELECT count(*) FROM public.product_images i WHERE i.product_id=p.id) image_count
    FROM public.products p
  ), ranked AS (
    SELECT u.*,
      count(*) FILTER (WHERE live) OVER (PARTITION BY group_key) remaining,
      count(*) FILTER (WHERE live AND one_availability='RESERVED') OVER (PARTITION BY group_key) reserved_count,
      count(*) OVER (PARTITION BY group_key) total,
      row_number() OVER (PARTITION BY group_key ORDER BY live DESC,
        (one_availability='IN_STOCK') DESC NULLS LAST,one_enrichment_started DESC,
        image_count DESC,updated_at DESC,id) rn
    FROM units u
  )
  SELECT (to_jsonb(r)-ARRAY['group_key','live','image_count','remaining','reserved_count','total','rn'])
    || jsonb_build_object('quantity_remaining',r.remaining,'quantity_total',r.total,
       'quantity_reserved',r.reserved_count,
       'product_images',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order,i.id)
          FROM public.product_images i WHERE i.product_id=r.id),'[]'::jsonb))
  FROM ranked r WHERE rn=1 AND remaining>0
  ORDER BY r.updated_at DESC,r.id
  LIMIT least(greatest(p_limit,1),500) OFFSET greatest(p_offset,0);
$$;
REVOKE ALL ON FUNCTION public.hub_list_inventory(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hub_list_inventory(integer,integer) TO authenticated,service_role;

-- Restore already-entered work from the most complete unit, including a sold unit.
-- Do not overwrite differing enriched units: they require inspection before sharing.
DO $$
DECLARE g record; donor uuid;
BEGIN
  FOR g IN SELECT DISTINCT one_intake_group_id FROM public.products WHERE one_intake_group_id IS NOT NULL LOOP
    SELECT p.id INTO donor FROM public.products p WHERE p.one_intake_group_id=g.one_intake_group_id
      AND (p.one_enrichment_started OR p.specs<>'{}'::jsonb OR EXISTS(SELECT 1 FROM public.product_images i WHERE i.product_id=p.id))
    ORDER BY p.one_photos_complete DESC,p.one_specs_complete DESC,
      (SELECT count(*) FROM public.product_images i WHERE i.product_id=p.id) DESC,p.updated_at DESC,p.id LIMIT 1;
    IF donor IS NOT NULL THEN
      PERFORM public.hub_sync_intake_listing(donor,p.id) FROM public.products p
      WHERE p.one_intake_group_id=g.one_intake_group_id AND p.specs='{}'::jsonb AND p.brand IS NULL AND p.model IS NULL
        AND nullif(p.notes,'') IS NULL AND nullif(p.defects,'') IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.product_images i WHERE i.product_id=p.id);
    END IF;
  END LOOP;
END;
$$;

