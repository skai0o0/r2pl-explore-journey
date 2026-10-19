import { createHash, randomInt, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  GAME_CONFIG,
  type RewardProfile,
} from "../../shared/gameplay/gameConfig.ts";
import {
  GIFT_TIERS,
  type GiftPoolItem,
  type GiftPoolSnapshot,
  giftPoolTotals,
  parseGiftPoolCommand,
} from "../../shared/gameplay/giftPool.ts";
import type { AdminPermission } from "../../shared/integration/adminAccess.ts";
import { requireAdminPermission } from "./AdminAccessStore.ts";
import { PortalError } from "./PortalSignature.ts";

/** Call under signed-game:<campaign> transaction lock, shared by rewards and admin edits. */
export async function readGiftPool(
  db: PoolClient,
  campaign: string,
): Promise<GiftPoolSnapshot> {
  const row = (
    await db.query<{ data: { revision: number; items: GiftPoolItem[] } }>(
      "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='gift-pool' AND id='catalog'",
      [campaign],
    )
  ).rows[0];
  if (row) return { ...row.data, totals: giftPoolTotals(row.data.items) };
  // Preserve existing tier stock without resetting or requiring a data migration.
  const legacy = (
    await db.query<{ id: RewardProfile; data: { remaining: number } }>(
      "SELECT id,data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='gift-stock' AND id=ANY($2::text[])",
      [campaign, GIFT_TIERS],
    )
  ).rows;
  const items: GiftPoolItem[] = legacy
    .filter((r) => r.data.remaining > 0)
    .map((r) => ({
      id: `legacy-${r.id}`,
      tier: r.id,
      name: `Quà hiện vật ${r.id.toUpperCase()}`,
      remaining: r.data.remaining,
      awarded: 0,
      active: true,
    }));
  return { revision: 0, items, totals: giftPoolTotals(items) };
}

async function saveGiftPool(
  db: PoolClient,
  campaign: string,
  current: GiftPoolSnapshot,
  items: readonly GiftPoolItem[],
): Promise<GiftPoolSnapshot> {
  const totals = giftPoolTotals(items);
  if (
    items.length > GAME_CONFIG.rewards.giftPool.maxItems ||
    Object.values(totals).reduce((sum, n) => sum + n, 0) >
      GAME_CONFIG.rewards.giftPool.maxTotal
  )
    throw new PortalError(400, "GIFT_POOL_LIMIT");
  const next = { revision: current.revision + 1, items, totals };
  await db.query(
    "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'gift-pool','catalog',$2) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=EXCLUDED.data",
    [campaign, JSON.stringify({ revision: next.revision, items })],
  );
  // Compatibility for the existing operator command and old receipts/tests.
  for (const tier of GIFT_TIERS)
    await db.query(
      "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'gift-stock',$2,$3) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=EXCLUDED.data",
      [campaign, tier, JSON.stringify({ remaining: totals[tier] })],
    );
  return next;
}

export async function claimGiftPoolItem(
  db: PoolClient,
  campaign: string,
  current: GiftPoolSnapshot,
  tier: RewardProfile,
): Promise<GiftPoolItem> {
  const total = current.totals[tier];
  if (total <= 0) throw new Error("Gift pool exhausted before selection");
  let ticket = randomInt(total);
  const selected = current.items.find((item) => {
    if (!item.active || item.tier !== tier) return false;
    ticket -= item.remaining;
    return ticket < 0;
  });
  if (!selected) throw new Error("Invalid gift pool stock");
  await saveGiftPool(
    db,
    campaign,
    current,
    current.items.map((item) =>
      item.id === selected.id
        ? { ...item, remaining: item.remaining - 1, awarded: item.awarded + 1 }
        : item,
    ),
  );
  return selected;
}

export async function setLegacyGiftStock(
  db: PoolClient,
  campaign: string,
  tier: RewardProfile,
  amount: number,
): Promise<void> {
  const current = await readGiftPool(db, campaign);
  const id = `legacy-${tier}`;
  const previous = current.items.find((item) => item.id === id);
  const item: GiftPoolItem = {
    id,
    tier,
    name: previous?.name ?? `Quà hiện vật ${tier.toUpperCase()}`,
    remaining: amount,
    awarded: previous?.awarded ?? 0,
    active: true,
  };
  await saveGiftPool(db, campaign, current, [
    ...current.items.filter((item) => item.id !== id),
    item,
  ]);
}

export class GiftPoolStore {
  private readonly pool: Pool;
  private readonly campaign: string;
  constructor(pool: Pool, campaign: string) {
    this.pool = pool;
    this.campaign = campaign;
  }
  private async transaction(
    actor: string,
    token: string,
    body: (db: PoolClient) => Promise<GiftPoolSnapshot>,
    permission: AdminPermission = "gifts.view",
  ): Promise<GiftPoolSnapshot> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `signed-game:${this.campaign}`,
      ]);
      const valid = await db.query(
        "SELECT 1 FROM r2pl_v2.portal_admins a JOIN r2pl_v2.portal_admin_sessions s USING(campaign_id,actor_id) WHERE a.campaign_id=$1 AND a.actor_id=$2 AND a.organization_id='amtech' AND a.active AND s.token_hash=$3 AND s.expires_at>clock_timestamp() FOR SHARE OF a,s",
        [this.campaign, actor, createHash("sha256").update(token).digest()],
      );
      if (!valid.rowCount) throw new PortalError(403, "ADMIN_REQUIRED");
      await requireAdminPermission(db, this.campaign, actor, token, permission);
      const result = await body(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  snapshot(actor: string, token: string): Promise<GiftPoolSnapshot> {
    return this.transaction(actor, token, (db) =>
      readGiftPool(db, this.campaign),
    );
  }
  update(
    actor: string,
    token: string,
    input: unknown,
  ): Promise<GiftPoolSnapshot> {
    const command = parseGiftPoolCommand(input);
    return this.transaction(
      actor,
      token,
      async (db) => {
        const current = await readGiftPool(db, this.campaign);
        if (current.revision !== command.expectedRevision)
          throw new PortalError(409, "GIFT_POOL_CHANGED");
        const id = command.id ?? randomUUID(),
          previous = current.items.find((item) => item.id === id);
        if (command.id && !previous)
          throw new PortalError(404, "GIFT_POOL_ITEM_NOT_FOUND");
        if (
          previous &&
          command.tier !== undefined &&
          command.tier !== previous.tier
        )
          throw new PortalError(400, "GIFT_POOL_TIER_IMMUTABLE");
        const item: GiftPoolItem =
          command.action === "archive"
            ? { ...previous!, active: false }
            : {
                id,
                tier: command.tier!,
                name: command.name!,
                remaining: command.remaining!,
                awarded: previous?.awarded ?? 0,
                active: true,
              };
        const next = await saveGiftPool(db, this.campaign, current, [
          ...current.items.filter((item) => item.id !== id),
          item,
        ]);
        await db.query(
          "INSERT INTO r2pl_v2.operator_audit(campaign_id,actor_id,action,detail) VALUES($1,$2,$3,$4)",
          [
            this.campaign,
            actor,
            "gift-pool",
            JSON.stringify({
              action: command.action,
              itemId: id,
              remaining: item.remaining,
              revision: next.revision,
            }),
          ],
        );
        return next;
      },
      "gifts.manage",
    );
  }
}
