CREATE TABLE IF NOT EXISTS product_images (

    id SERIAL PRIMARY KEY,

    product_id INTEGER NOT NULL,

    file_name VARCHAR(255) NOT NULL,

    original_url TEXT NOT NULL,

    thumb_url TEXT,

    mime_type VARCHAR(100),

    width INTEGER,

    height INTEGER,

    file_size BIGINT,

    is_main BOOLEAN NOT NULL DEFAULT TRUE,

    sort_order INTEGER NOT NULL DEFAULT 1,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_product_images_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE

);

CREATE INDEX IF NOT EXISTS idx_product_images_product
ON product_images(product_id);

CREATE INDEX IF NOT EXISTS idx_product_images_main
ON product_images(product_id, is_main);