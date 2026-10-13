BEGIN;
DO $$
DECLARE a uuid; b uuid; c uuid; r jsonb; n int;
BEGIN
  INSERT INTO public.products(category,title,status,one_managed,one_intake_complete,one_intake_group_id)
    VALUES('other','Hub lot regression','draft',true,true,'regression:lot') RETURNING id INTO a;
  INSERT INTO public.products(category,title,status,one_managed,one_intake_complete,one_intake_group_id)
    VALUES('other','Hub lot regression','draft',true,true,'regression:lot') RETURNING id INTO b;
  UPDATE public.products SET title='Shared listing',notes='Shared description',specs='{"description":"shared"}' WHERE id=a;
  PERFORM public.hub_sync_intake_listing(a);
  IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=b AND notes='Shared description' AND sku<>(SELECT sku FROM public.products WHERE id=a) AND status='draft') THEN
    RAISE EXCEPTION 'Shared content changed identity or failed to copy';
  END IF;
  SELECT x INTO r FROM public.hub_list_inventory() x WHERE x->>'one_intake_group_id'='regression:lot';
  IF (r->>'quantity_remaining')::int<>2 OR (SELECT count(*) FROM public.hub_list_inventory() x WHERE x->>'one_intake_group_id'='regression:lot')<>1 THEN RAISE EXCEPTION 'Two units must show one draft'; END IF;
  INSERT INTO public.product_images(product_id,object_key,public_url,sort_order,is_cover,image_role)
    VALUES(a,'regression/shared-image.jpg','https://example.invalid/shared.jpg',0,true,'cover');
  PERFORM public.hub_sync_intake_listing(a);
  PERFORM public.hub_sync_intake_listing(a);
  IF (SELECT count(*) FROM public.product_images WHERE product_id=b)<>1 THEN RAISE EXCEPTION 'Shared image retry duplicated metadata'; END IF;
  PERFORM set_config('amphon.one3_projection','on',true);
  UPDATE public.products SET one_availability='SOLD',status='sold',sold_at=now() WHERE id=a;
  SELECT x INTO r FROM public.hub_list_inventory() x WHERE x->>'one_intake_group_id'='regression:lot';
  IF r->>'id'<>b::text OR (r->>'quantity_remaining')::int<>1 OR r->>'notes'<>'Shared description' THEN RAISE EXCEPTION 'Partial sale lost remaining listing'; END IF;
  UPDATE public.products SET one_availability='SOLD',status='sold',sold_at=now() WHERE id=b;
  IF EXISTS(SELECT 1 FROM public.hub_list_inventory() x WHERE x->>'one_intake_group_id'='regression:lot') THEN RAISE EXCEPTION 'Sold-out group still visible'; END IF;
  UPDATE public.products SET one_availability='IN_STOCK',status='draft',sold_at=null WHERE id=b;
  IF NOT EXISTS(SELECT 1 FROM public.hub_list_inventory() x WHERE x->>'id'=b::text AND (x->>'quantity_remaining')::int=1) THEN RAISE EXCEPTION 'Return did not reopen group'; END IF;
  DELETE FROM public.product_images WHERE product_id=b;
  IF NOT EXISTS(SELECT 1 FROM public.product_images WHERE product_id=a AND object_key='regression/shared-image.jpg') THEN RAISE EXCEPTION 'Removing shared metadata damaged sold history'; END IF;
END;
$$;
ROLLBACK;

