CREATE TABLE IF NOT EXISTS product_images (

    id SERIAL PRIMARY KEY,

    product_id INTEGER NOT NULL
        REFERENCES products(id)
        ON DELETE CASCADE,

    original_url TEXT NOT NULL,

    thumb_url TEXT,

    is_primary BOOLEAN DEFAULT FALSE,

    sort_order INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT NOW()

);