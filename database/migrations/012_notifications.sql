CREATE TABLE r2pl_v2.notification_routes (
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('rally','station_arrival','chest_opened')),
 forward_to_portal boolean NOT NULL DEFAULT false,
 PRIMARY KEY(campaign_id,kind)
);
CREATE TABLE r2pl_v2.notification_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id) ON DELETE CASCADE,
 event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN ('rally','station_arrival','chest_opened','admin')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 500),
 school_slot smallint CHECK(school_slot BETWEEN 0 AND 7),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 live_expires_at timestamptz NOT NULL,
 UNIQUE(campaign_id,event_key)
);
CREATE INDEX notification_events_feed ON r2pl_v2.notification_events(campaign_id,id);
CREATE TABLE r2pl_v2.notification_outbox (
 delivery_id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES r2pl_v2.campaigns(id) ON DELETE CASCADE,
 event_id bigint NOT NULL UNIQUE REFERENCES r2pl_v2.notification_events(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','delivered','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 available_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 lease_token uuid,
 lease_until timestamptz,
 delivered_at timestamptz
);
CREATE INDEX notification_outbox_due ON r2pl_v2.notification_outbox(campaign_id,available_at) WHERE status IN ('pending','leased');
ALTER TABLE r2pl_v2.notification_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_v2.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE r2pl_v2.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r2pl_v2.notification_routes,r2pl_v2.notification_events,r2pl_v2.notification_outbox FROM PUBLIC;
