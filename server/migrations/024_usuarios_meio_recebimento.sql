-- 024 · 0.18.13 · Meio de recebimento da comissão, preenchido pelo próprio usuário (menu do usuário → Dados de recebimento).
-- payout_method: 'pix' | 'dolafy' | 'other' · payout_method_other: nome do meio quando 'other' · payout_key: chave PIX, @ Dolafy ou identificação.
ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_method TEXT CHECK (payout_method IN ('pix', 'dolafy', 'other'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_method_other TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_key TEXT;
