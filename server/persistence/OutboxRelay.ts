import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface OutboxEvent {
  readonly id: string;
  readonly campaignId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: unknown;
  readonly attempts: number;
  readonly leaseToken: string;
}

/** At-least-once relay. Consumers deduplicate the stable event ID. */
export class OutboxRelay {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async claim(campaignId: string, limit = 50): Promise<OutboxEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError("Invalid outbox claim limit");
    const token = randomUUID();
    const result = await this.#pool.query<{
      id: string;
      campaign_id: string;
      event_type: string;
      event_version: number;
      payload: unknown;
      attempts: number;
      lease_token: string;
    }>(
      "WITH next AS (SELECT id FROM r2pl_v2.outbox_events WHERE campaign_id=$1 AND delivered_at IS NULL AND (lease_until IS NULL OR lease_until < clock_timestamp()) ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED) UPDATE r2pl_v2.outbox_events o SET lease_until=clock_timestamp()+interval '30 seconds',lease_token=$3,attempts=o.attempts+1 FROM next WHERE o.id=next.id RETURNING o.id,o.campaign_id,o.event_type,o.event_version,o.payload,o.attempts,o.lease_token",
      [campaignId, limit, token],
    );
    return result.rows.map((row) => ({
      id: row.id,
      campaignId: row.campaign_id,
      eventType: row.event_type,
      eventVersion: row.event_version,
      payload: row.payload,
      attempts: row.attempts,
      leaseToken: row.lease_token,
    }));
  }

  async markDelivered(id: string, leaseToken: string): Promise<void> {
    const result = await this.#pool.query(
      "UPDATE r2pl_v2.outbox_events SET delivered_at=clock_timestamp(),lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2 AND lease_until>=clock_timestamp() AND delivered_at IS NULL",
      [id, leaseToken],
    );
    if (result.rowCount !== 1)
      throw new Error("Outbox lease expired, replaced, delivered or missing");
  }

  async release(id: string, leaseToken: string): Promise<void> {
    const result = await this.#pool.query(
      "UPDATE r2pl_v2.outbox_events SET lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2 AND delivered_at IS NULL",
      [id, leaseToken],
    );
    if (result.rowCount !== 1)
      throw new Error("Outbox lease replaced, delivered or missing");
  }
}
