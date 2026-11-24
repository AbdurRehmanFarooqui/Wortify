-- Run AFTER the generated table migration.
-- Needs PostgreSQL 15+ (ON DELETE SET NULL (column_list)).

-- ---------------------------------------------------------------------
-- 1. Composite "SET NULL" foreign keys
--    Drizzle can't express ON DELETE SET NULL (col) yet. Without the column
--    list Postgres would try to null store_id too (NOT NULL) and fail.
--    These keep the cross-tenant guarantee while still allowing deletes.
-- ---------------------------------------------------------------------
ALTER TABLE collections ADD CONSTRAINT fk_collections_image
  FOREIGN KEY (store_id, image_id) REFERENCES media_assets (store_id, id) ON DELETE SET NULL (image_id);
ALTER TABLE products ADD CONSTRAINT fk_products_featured_media
  FOREIGN KEY (store_id, featured_media_id) REFERENCES media_assets (store_id, id) ON DELETE SET NULL (featured_media_id);
ALTER TABLE product_variants ADD CONSTRAINT fk_variants_media
  FOREIGN KEY (store_id, media_id) REFERENCES media_assets (store_id, id) ON DELETE SET NULL (media_id);
ALTER TABLE carts ADD CONSTRAINT fk_carts_customer
  FOREIGN KEY (store_id, customer_id) REFERENCES customers (store_id, id) ON DELETE SET NULL (customer_id);
ALTER TABLE orders ADD CONSTRAINT fk_orders_customer
  FOREIGN KEY (store_id, customer_id) REFERENCES customers (store_id, id) ON DELETE SET NULL (customer_id);
ALTER TABLE discount_redemptions ADD CONSTRAINT fk_redemptions_customer
  FOREIGN KEY (store_id, customer_id) REFERENCES customers (store_id, id) ON DELETE SET NULL (customer_id);
ALTER TABLE refunds ADD CONSTRAINT fk_refunds_payment
  FOREIGN KEY (store_id, payment_id) REFERENCES payments (store_id, id) ON DELETE SET NULL (payment_id);
ALTER TABLE reviews ADD CONSTRAINT fk_reviews_customer
  FOREIGN KEY (store_id, customer_id) REFERENCES customers (store_id, id) ON DELETE SET NULL (customer_id);
ALTER TABLE reviews ADD CONSTRAINT fk_reviews_order
  FOREIGN KEY (store_id, order_id) REFERENCES orders (store_id, id) ON DELETE SET NULL (order_id);

-- ---------------------------------------------------------------------
-- 2. updated_at triggers (safety net: the DB sets it even for raw SQL)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. OPTIONAL: Row-Level Security (defence in depth). Uncomment when ready.
--    Per request the app runs: SELECT set_config('app.store_id', '42', true);
--    (see withTenant() in src/db/client.ts). The app must connect as a
--    NON-owner role, otherwise RLS is bypassed. Tables looked up before the
--    store is known are skipped.
-- ---------------------------------------------------------------------
-- DO $$
-- DECLARE t text;
-- BEGIN
--   FOR t IN
--     SELECT c.table_name FROM information_schema.columns c
--     WHERE c.table_schema = 'public' AND c.column_name = 'store_id'
--       AND c.table_name NOT IN ('store_domains','payments','webhook_events','stores','store_members','billing_invoices')
--   LOOP
--     EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
--     EXECUTE format(
--       'CREATE POLICY tenant_isolation ON %I
--          USING (store_id = current_setting(''app.store_id'', true)::bigint)
--          WITH CHECK (store_id = current_setting(''app.store_id'', true)::bigint)', t);
--   END LOOP;
-- END $$;
