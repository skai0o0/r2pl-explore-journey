-- Durable check-in timestamp and code uniqueness across campaigns.
ALTER TABLE r2pl_v2.game_state ADD COLUMN IF NOT EXISTS redeemed_at timestamptz;
UPDATE r2pl_v2.game_state SET redeemed_at=to_timestamp((data->>'redeemedAt')::double precision/1000)
WHERE scope='gift-entitlement' AND redeemed_at IS NULL AND data->>'redeemedAt' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gift_code_unique ON r2pl_v2.game_state ((data->>'giftCode'))
WHERE scope='gift-entitlement' AND data->>'giftCode' IS NOT NULL;
