-- Observação do vendedor usada pela Entrevista Inteligente e preparação do anúncio.
-- Idempotente: pode ser executada em bancos já atualizados sem alterar os dados existentes.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS seller_observation TEXT;
