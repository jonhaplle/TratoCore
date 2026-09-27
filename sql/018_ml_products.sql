-- =====================================================
-- TRATO CORE
-- Mercado Livre
-- =====================================================

ALTER TABLE products
ADD COLUMN IF NOT EXISTS ml_item_id VARCHAR(30);

ALTER TABLE products
ADD COLUMN IF NOT EXISTS ml_permalink TEXT;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS ml_status VARCHAR(30);

ALTER TABLE products
ADD COLUMN IF NOT EXISTS ml_category_id VARCHAR(30);

ALTER TABLE products
ADD COLUMN IF NOT EXISTS ml_listing_type VARCHAR(50);

ALTER TABLE products
ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_products_ml_item
ON products(ml_item_id);

CREATE INDEX IF NOT EXISTS idx_products_ml_status
ON products(ml_status);