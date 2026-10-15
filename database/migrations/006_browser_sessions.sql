CREATE TABLE r2pl_v2.portal_socket_tickets (
 campaign_id uuid NOT NULL,
 ticket_hash bytea NOT NULL,
 session_hash bytea NOT NULL,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(campaign_id,ticket_hash),
 FOREIGN KEY(campaign_id,session_hash) REFERENCES r2pl_v2.portal_sessions(campaign_id,token_hash) ON DELETE CASCADE
);
ALTER TABLE r2pl_v2.portal_socket_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r2pl_v2.portal_socket_tickets FROM PUBLIC;
