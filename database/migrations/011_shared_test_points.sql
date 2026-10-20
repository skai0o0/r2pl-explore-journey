-- Test Points are shared by school, while profiles/inventory/sessions stay private.
CREATE TABLE r2pl_v2.test_point_pools (
 campaign_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 school_slot smallint NOT NULL CHECK(school_slot BETWEEN 0 AND 7),
 resource text NOT NULL DEFAULT 'fixture-credit' CHECK(resource='fixture-credit'),
 opening_balance bigint NOT NULL CHECK(opening_balance>=0),
 balance bigint NOT NULL CHECK(balance>=0),
 PRIMARY KEY(campaign_id,actor_id,resource),
 UNIQUE(campaign_id,school_slot),
 FOREIGN KEY(campaign_id,actor_id) REFERENCES r2pl_v2.portal_members(campaign_id,actor_id)
);
-- Preserve the funded test pool, never sum independent legacy wallets or refill it.
INSERT INTO r2pl_v2.test_point_pools(campaign_id,actor_id,school_slot,opening_balance,balance)
SELECT DISTINCT ON(p.campaign_id,p.school_slot) p.campaign_id,p.actor_id,p.school_slot,w.balance,w.balance
FROM r2pl_v2.partner_test_profiles p
JOIN r2pl_v2.portal_admins a ON a.campaign_id=p.campaign_id AND a.actor_id=p.owner_actor_id
JOIN r2pl_v2.wallet_accounts w ON w.campaign_id=p.campaign_id AND w.actor_id=p.actor_id AND w.resource='fixture-credit'
ORDER BY p.campaign_id,p.school_slot,(a.email='test@amtech.vn') DESC,w.balance DESC,p.actor_id;
CREATE TABLE r2pl_v2.test_point_ledger (
 campaign_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 command_key bytea NOT NULL,
 resource text NOT NULL CHECK(resource='fixture-credit'),
 amount bigint NOT NULL CHECK(amount<>0),
 pool_actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(campaign_id,actor_id,command_key,resource),
 FOREIGN KEY(campaign_id,actor_id,command_key) REFERENCES r2pl_v2.command_results(campaign_id,actor_id,command_key),
 FOREIGN KEY(campaign_id,pool_actor_id,resource) REFERENCES r2pl_v2.test_point_pools(campaign_id,actor_id,resource)
);
CREATE INDEX test_point_ledger_pool ON r2pl_v2.test_point_ledger(campaign_id,pool_actor_id,resource);
ALTER TABLE r2pl_v2.test_point_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_v2.test_point_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r2pl_v2.test_point_pools,r2pl_v2.test_point_ledger FROM PUBLIC;
