import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  type GameCommand,
  type GameReceipt,
  type GameView,
  type LandmarkView,
  parseGameCommand,
} from "../../shared/gameplay/commands.ts";
import {
  edgeNeighbors,
  headquartersOwner,
} from "../../shared/gameplay/expansion.ts";
import {
  BEACON_BUFF_CONFIG,
  GAME_CONFIG,
  LANDMARKS,
  type RewardOutcome,
  SCHOOLS,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import { effectiveRewardOutcomes } from "../../shared/gameplay/giftPool.ts";
import {
  selectedTileAction,
  type TileAction,
} from "../../shared/gameplay/tileAction.ts";
import {
  campaignWeekStart,
  parseRunningSnapshot,
} from "../../shared/integration/running.ts";
import {
  chunkId,
  localIndex,
  tileCoordinates,
} from "../../shared/world/coordinates.ts";
import { recordLedger } from "../persistence/WalletLedger.ts";
import { requireAdminPermission } from "./AdminAccessStore.ts";
import {
  activeView,
  chooseBuff,
  currentBuff,
  dailyBuff,
  emptyBeacon,
  migrateBeacons,
  nextBeaconTarget,
  rewardBuff,
  schoolBeacon,
  sharedPaymentBuff,
} from "./BeaconBuffs.ts";
import { scoutFrontier } from "./BeaconScout.ts";
import type { CampaignProvider } from "./CampaignProvider.ts";
import { claimGiftPoolItem, readGiftPool } from "./GiftPoolStore.ts";
import { campaignProviderFromEnv } from "./HttpCampaignProvider.ts";
import { requirePortalActorSession } from "./PortalActorSession.ts";
import type {
  SchoolPlayActor,
  SchoolPlayFixture,
} from "./SchoolPlayFixture.ts";
import { clusters, payShared, settleShared } from "./SharedKnowledge.ts";
import { SyntheticCampaignProvider } from "./SyntheticCampaignProvider.ts";

const actionNames: Record<GameCommand["action"], string> = {
  running: "Đồng bộ Running",
  upkeep: "Duy trì Shared Knowledge",
  consolidate: "Đóng góp consolidation",
  guess: "Giải đố địa danh",
  contribute: "Đóng góp Crystal",
  spin: "Quay UniStop",
  open: "Mở Chest",
  rally: "Hiệu triệu cùng trường",
  scout: "Trinh sát biên tri thức",
};
const rejectionMessages: Record<string, string> = {
  INSUFFICIENT_BALANCE: "Ví chưa đủ tài nguyên",
  COOLDOWN: "Lượt tại trạm này đang hồi",
  CHEST_COLLECTED: "Chest đã được thu thập",
  CHEST_NOT_DISCOVERED: "Bạn chưa tìm thấy Chest này",
  KNOWLEDGE_PATH_REQUIRED:
    "Tri thức trường cần chạm công trình; Trạm tiếp tế phải thuộc trường bạn.",
  GUESS_COOLDOWN: "Chưa hết thời gian chờ đoán lại",
  UNKNOWN_OBJECT: "Đối tượng đã thay đổi; tải bản đồ mới",
  BEACON_ALREADY_ACTIVE: "Đèn hiệu này đang hoạt động cho trường bạn",
  RALLY_COOLDOWN:
    "Trường bạn vừa hiệu triệu. Vui lòng chờ trước khi gửi thông báo tiếp",
  SCOUT_UNAVAILABLE: "Trường bạn chưa có đặc quyền trinh sát",
  SCOUT_COOLDOWN: "Trường đã dùng lượt trinh sát hôm nay",
  SCOUT_NO_FRONTIER: "Chưa có vùng biên mới để trinh sát",
  "Upkeep not due": "Cluster đang trong 24 giờ miễn upkeep",
  "Not your consolidation": "Trường bạn không phải guest nhận consolidation",
  "Unknown school cluster": "Cluster đã kết thúc hoặc không thuộc trường bạn",
};
const initialBeacon = emptyBeacon;
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll("đ", "d")
    .replace(/[^a-z0-9]/g, "");
export class SignedGameplay {
  private pool: Pool;
  private fixture: SchoolPlayFixture;
  private draw: () => number;
  private readonly campaignProvider: CampaignProvider | undefined;
  private readonly portalMode: boolean;
  constructor(
    pool: Pool,
    fixture: SchoolPlayFixture,
    draw: () => number = () => randomInt(GAME_CONFIG.rewards.weightTotal),
    campaignProvider: CampaignProvider | undefined = campaignProviderFromEnv(),
    portalMode = false,
  ) {
    this.pool = pool;
    this.fixture = fixture;
    this.draw = draw;
    this.campaignProvider = portalMode ? undefined : campaignProvider;
    this.portalMode = portalMode;
  }
  async tileAction(actor: SchoolPlayActor, index: number): Promise<TileAction> {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= GAME_CONFIG.world.width * GAME_CONFIG.world.height
    )
      throw new RangeError("Invalid tile");
    const indexes = [index, ...edgeNeighbors(index)];
    const tiles = indexes.map(tileCoordinates);
    const ids = [
      ...new Set(
        tiles.map(({ x, z }) =>
          chunkId(Math.floor(x / 64), Math.floor(z / 64)),
        ),
      ),
    ];
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const rows = (
        await db.query<{ chunk_id: number; mask: Buffer }>(
          "SELECT chunk_id,mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 AND chunk_id=ANY($2::smallint[])",
          [this.fixture.campaignId, ids],
        )
      ).rows;
      const masks = new Map(rows.map((r) => [r.chunk_id, r.mask]));
      const read = ({ x, z }: { x: number; z: number }): number =>
        masks
          .get(chunkId(Math.floor(x / 64), Math.floor(z / 64)))
          ?.readUInt16LE(localIndex(x, z) * 2) ?? 0;
      const owner = headquartersOwner(index, this.fixture.headquarters);
      const result = selectedTileAction(
        index,
        read(tiles[0]!),
        actor.schoolSlot,
        tiles.slice(1).some((t) => !!(read(t) & (1 << actor.schoolSlot))),
        owner !== undefined && owner !== actor.schoolSlot,
      );
      await db.query("COMMIT");
      return result;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async settle(): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `signed-game:${this.fixture.campaignId}`,
      ]);
      await settleShared(
        db,
        this.fixture.campaignId,
        this.fixture.actors[0]?.actorId ?? this.fixture.campaignId,
        Date.now(),
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  actor(token: string | undefined): SchoolPlayActor | undefined {
    return this.fixture.actors.find((a) => a.token === token);
  }
  private async state<T>(
    db: PoolClient,
    scope: string,
    id: string,
    fallback: T,
  ): Promise<T> {
    return (
      (
        await db.query<{ data: T }>(
          "SELECT data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope=$2 AND id=$3",
          [this.fixture.campaignId, scope, id],
        )
      ).rows[0]?.data ?? fallback
    );
  }
  private async save(
    db: PoolClient,
    scope: string,
    id: string,
    data: unknown,
  ): Promise<void> {
    await db.query(
      "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,scope,id) DO UPDATE SET data=EXCLUDED.data",
      [this.fixture.campaignId, scope, id, JSON.stringify(data)],
    );
  }
  private async object(
    db: PoolClient,
    id: string,
  ): Promise<WorldObject | undefined> {
    return (
      await db.query<{ data: WorldObject }>(
        "SELECT data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 AND id=$2",
        [this.fixture.campaignId, id],
      )
    ).rows[0]?.data;
  }
  private async path(
    db: PoolClient,
    o: WorldObject,
    slot: number,
  ): Promise<boolean> {
    const left = Math.max(0, o.x - o.width / 2 - 1),
      right = Math.min(GAME_CONFIG.world.width - 1, o.x + o.width / 2),
      top = Math.max(0, o.z - o.height / 2 - 1),
      bottom = Math.min(GAME_CONFIG.world.height - 1, o.z + o.height / 2);
    const ids: number[] = [];
    for (let z = Math.floor(top / 64); z <= Math.floor(bottom / 64); z++)
      for (let x = Math.floor(left / 64); x <= Math.floor(right / 64); x++)
        ids.push(chunkId(x, z));
    const rows = (
      await db.query<{ chunk_id: number; mask: Buffer }>(
        "SELECT chunk_id,mask FROM r2pl_v2.world_chunks WHERE campaign_id=$1 AND chunk_id=ANY($2::smallint[]) ORDER BY chunk_id",
        [this.fixture.campaignId, ids],
      )
    ).rows;
    const masks = new Map(rows.map((r) => [r.chunk_id, r.mask]));
    for (let z = top; z <= bottom; z++)
      for (let x = left; x <= right; x++) {
        if (x < 0 || z < 0 || x >= 1000 || z >= 1000) continue;
        if (
          (masks
            .get(chunkId(Math.floor(x / 64), Math.floor(z / 64)))
            ?.readUInt16LE(localIndex(x, z) * 2) ?? 0) &
          (1 << slot)
        )
          return true;
      }
    return false;
  }
  async captureReachedStops(db: PoolClient): Promise<void> {
    const stops = (
      await db.query<{ id: string; data: WorldObject }>(
        "SELECT id, data FROM r2pl_v2.game_world_objects WHERE campaign_id=$1 AND data->>'kind'='unistop'",
        [this.fixture.campaignId],
      )
    ).rows;
    if (!stops.length) return;

    for (const { id, data: stop } of stops) {
      const present: number[] = [];
      for (let s = 0; s < 8; s++) {
        if (await this.path(db, stop, s)) present.push(s);
      }

      const arrivals = await this.state<Record<string, number>>(
        db,
        "unistop-arrivals",
        id,
        {},
      );
      let changedArrivals = false;
      const now = Date.now();
      for (const s of present) {
        if (arrivals[String(s)] === undefined) {
          arrivals[String(s)] = now;
          changedArrivals = true;
        }
      }
      for (const key of Object.keys(arrivals)) {
        if (!present.includes(Number(key))) {
          delete arrivals[key];
          changedArrivals = true;
        }
      }

      let nextOwner: number | null = null;
      if (
        stop.ownerSchoolSlot !== null &&
        stop.ownerSchoolSlot !== undefined &&
        present.includes(stop.ownerSchoolSlot)
      ) {
        nextOwner = stop.ownerSchoolSlot;
      } else if (present.length > 0) {
        nextOwner = present
          .slice()
          .sort(
            (a, b) => (arrivals[String(a)] ?? 0) - (arrivals[String(b)] ?? 0),
          )[0]!;
      }

      if (stop.ownerSchoolSlot !== nextOwner) {
        const updated: WorldObject = {
          ...stop,
          ownerSchoolSlot: nextOwner,
          ownerSchoolId: nextOwner !== null ? SCHOOLS[nextOwner]!.id : null,
        };
        await db.query(
          "UPDATE r2pl_v2.game_world_objects SET data=$1 WHERE campaign_id=$2 AND id=$3",
          [JSON.stringify(updated), this.fixture.campaignId, id],
        );
      }
      if (changedArrivals) {
        await this.save(db, "unistop-arrivals", id, arrivals);
      }
    }
  }
  async syncStops(): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await this.captureReachedStops(db);
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async initialize(): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `signed-game:${this.fixture.campaignId}`,
      ]);
      await migrateBeacons(db, this.fixture.campaignId);
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    for (const actor of this.fixture.actors)
      for (const tier of ["aspire", "nitro", "predator"])
        await this.pool.query(
          "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,opening_balance,balance) VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING",
          [
            this.fixture.campaignId,
            actor.actorId,
            `key-${tier}`,
            GAME_CONFIG.staging.initialKeysPerTier,
          ],
        );
  }
  async view(actor: SchoolPlayActor): Promise<GameView> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `signed-game:${this.fixture.campaignId}`,
      ]);
      await this.captureReachedStops(db);
      const wallets = (
        await db.query<{ resource: string; balance: string }>(
          "SELECT resource,balance::text FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2",
          [this.fixture.campaignId, actor.actorId],
        )
      ).rows;
      const balance = (r: string) =>
        wallets.find((w) => w.resource === r)?.balance ?? "0";
      const landmarks: LandmarkView[] = [];
      const ownBeacon = await schoolBeacon(
        db,
        this.fixture.campaignId,
        actor.schoolSlot,
      );
      const storedRally = await this.state<
        { target: string; createdAt: number } | undefined
      >(db, "beacon-rally", String(actor.schoolSlot), undefined);
      // Completed calls remain stored for rate limiting, but must not become new UI objectives after a later switch.
      const rally =
        storedRally && storedRally.createdAt > (ownBeacon.activatedAt ?? 0)
          ? storedRally
          : undefined;
      for (const l of LANDMARKS) {
        const b = await this.state(db, "beacon", l.id, initialBeacon());
        const o = await this.object(db, l.id);
        landmarks.push({
          id: l.id,
          holder: b.holder,
          target:
            b.holder === actor.schoolSlot
              ? ownBeacon.lastCost
              : nextBeaconTarget(b, ownBeacon),
          pot: b.pots[String(actor.schoolSlot)] ?? 0,
          solved: b.solved.includes(actor.schoolSlot),
          cooldownUntil: b.cooldowns[String(actor.schoolSlot)] ?? 0,
          hasPath: !!o && (await this.path(db, o, actor.schoolSlot)),
          buff:
            b.holder === null
              ? undefined
              : activeView(
                  await schoolBeacon(db, this.fixture.campaignId, b.holder),
                ),
          rallied: rally?.target === l.id,
        });
      }
      const chests = (
        await db.query<{ data: WorldObject }>(
          `SELECT o.data FROM r2pl_v2.game_world_objects o JOIN r2pl_v2.game_chest_discoveries d ON o.campaign_id=d.campaign_id AND o.id=d.object_id WHERE o.campaign_id=$1 AND d.actor_id=$2 AND NOT EXISTS(SELECT 1 FROM r2pl_v2.game_state s WHERE s.campaign_id=o.campaign_id AND s.scope='chest-claim' AND s.id=o.id) ORDER BY o.id`,
          [this.fixture.campaignId, actor.actorId],
        )
      ).rows.map((r) => r.data);
      let revealedTiles = 0;
      for (const row of (
        await db.query<{ fog: Buffer }>(
          "SELECT fog FROM r2pl_v2.school_fog_chunks WHERE campaign_id=$1 AND school_slot=$2",
          [this.fixture.campaignId, actor.schoolSlot],
        )
      ).rows)
        for (const byte of row.fog) {
          let bits = byte;
          while (bits) {
            bits &= bits - 1;
            revealedTiles++;
          }
        }
      const gifts = (
        await db.query<{
          id: string;
          data: {
            tier: string;
            giftName?: string;
            giftCode?: string;
            redeemedAt?: number | null;
            createdAt?: number;
            schoolName?: string;
          };
        }>(
          "SELECT id,data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='gift-entitlement' AND data->>'actorId'=$2 ORDER BY id DESC",
          [this.fixture.campaignId, actor.actorId],
        )
      ).rows.map((r) => ({
        id: r.id,
        tier: r.data.tier,
        giftName: r.data.giftName,
        giftCode:
          r.data.giftCode ?? `R2PL-GIFT-${r.id.slice(0, 6).toUpperCase()}`,
        redeemedAt: r.data.redeemedAt ?? null,
        createdAt: r.data.createdAt,
        schoolName: r.data.schoolName,
      }));
      const cooldowns = await this.state<Record<string, number>>(
        db,
        "cooldowns",
        actor.actorId,
        {},
      );
      const running = await this.state<{
        week?: number;
        weeklyMeters?: number;
      }>(db, "running", actor.actorId, {});
      const shared = (await clusters(db, this.fixture.campaignId))
        .filter((c) => c.pair.includes(actor.schoolSlot))
        .map((c) => ({
          id: c.id,
          pair: c.pair,
          tiles: c.tiles.length,
          tileIndexes: c.tiles.map((t) => t.tile),
          due: c.due[String(actor.schoolSlot)] ?? 0,
          freeUntil: c.createdAt + GAME_CONFIG.knowledge.freeUpkeepMs,
          guest: c.guest ?? null,
          status: c.status,
          required: c.required ?? 0,
          contributed: Object.values(c.escrow).reduce((a, b) => a + b, 0),
          hardUntil: c.hardUntil ?? 0,
          rollingUntil: c.rollingUntil ?? 0,
        }));
      const events = (
        await db.query<{ id: string; title: string; body: string }>(
          "SELECT id::text,title,body FROM r2pl_v2.game_events WHERE campaign_id=$1 AND (actor_id IS NULL OR actor_id=$2) AND (school_slot IS NULL OR school_slot=$3) ORDER BY id DESC LIMIT 30",
          [this.fixture.campaignId, actor.actorId, actor.schoolSlot],
        )
      ).rows;
      const canScout =
        (await currentBuff(db, this.fixture.campaignId, actor.schoolSlot))
          ?.id === "scout" &&
        ((await dailyBuff(db, this.fixture.campaignId, actor.schoolSlot)).data
          .earned.scout ?? 0) < BEACON_BUFF_CONFIG.scouts.dailyCap;
      const giftPool = await readGiftPool(db, this.fixture.campaignId);
      await db.query("COMMIT");
      return {
        giftStock: giftPool.totals,
        activeBeacon: activeView(ownBeacon),
        beaconTarget: nextBeaconTarget(initialBeacon(), ownBeacon),
        rally,
        canScout,
        contributionCapacity: (
          BigInt(balance("fixture-crystals")) +
          BigInt(balance("fixture-credit")) /
            BigInt(GAME_CONFIG.landmark.pointsPerCrystal)
        ).toString(),
        ruleVersion: 1,
        runningMode: this.portalMode
          ? "portal"
          : this.campaignProvider
            ? "http"
            : "synthetic",
        crystals: balance("fixture-crystals"),
        treasureMaps: balance("fixture-treasure-map"),
        revealedTiles,
        gifts,
        keys: {
          aspire: balance("key-aspire"),
          nitro: balance("key-nitro"),
          predator: balance("key-predator"),
        },
        landmarks,
        chests,
        cooldowns,
        weeklyKm:
          running.week === campaignWeekStart(Date.now())
            ? (running.weeklyMeters ?? 0) / 1000
            : 0,
        events,
        shared,
      };
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async command(actor: SchoolPlayActor, input: unknown): Promise<GameReceipt> {
    const c = parseGameCommand(input),
      key = Buffer.from(c.key.replaceAll("-", ""), "hex"),
      hash = createHash("sha256").update(JSON.stringify(c)).digest();
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout='5s'");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `signed-game:${this.fixture.campaignId}`,
      ]);
      const binding = await db.query(
        "SELECT 1 FROM r2pl_prep.running_bindings b JOIN r2pl_v2.campaign_schools s ON s.campaign_id=b.campaign_id AND s.slot=b.school_slot AND s.school_id=b.external_school_id WHERE b.campaign_id=$1 AND b.actor_id=$2 AND b.school_slot=$3 FOR SHARE",
        [this.fixture.campaignId, actor.actorId, actor.schoolSlot],
      );
      if (binding.rowCount !== 1) throw new TypeError("Unbound actor");
      if (this.portalMode) {
        await requirePortalActorSession(
          db,
          this.fixture.campaignId,
          actor.actorId,
          actor.schoolSlot,
          createHash("sha256").update(actor.token).digest("hex"),
        );
        const member = await db.query(
          "SELECT 1 FROM r2pl_v2.portal_members WHERE campaign_id=$1 AND actor_id=$2 AND school_slot=$3 AND active FOR SHARE",
          [this.fixture.campaignId, actor.actorId, actor.schoolSlot],
        );
        if (!member.rowCount) throw new TypeError("Unbound actor");
      }
      const inserted = await db.query(
        "INSERT INTO r2pl_v2.command_results(campaign_id,actor_id,command_key,payload_hash,status) VALUES($1,$2,$3,$4,'processing') ON CONFLICT DO NOTHING RETURNING 1",
        [this.fixture.campaignId, actor.actorId, key, hash],
      );
      if (!inserted.rowCount) {
        const old = (
          await db.query<{ payload_hash: Buffer; result: GameReceipt }>(
            "SELECT payload_hash,result FROM r2pl_v2.command_results WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3",
            [this.fixture.campaignId, actor.actorId, key],
          )
        ).rows[0]!;
        if (!old.payload_hash.equals(hash))
          throw new Error("Command key conflict");
        await db.query("COMMIT");
        return old.result;
      }
      await settleShared(
        db,
        this.fixture.campaignId,
        actor.actorId,
        Date.now(),
      );
      await db.query("SAVEPOINT gameplay");
      let receipt: GameReceipt;
      try {
        receipt = await this.apply(db, actor, c, key);
      } catch (e) {
        if (!(e instanceof RuleRejection)) throw e;
        await db.query("ROLLBACK TO SAVEPOINT gameplay");
        receipt = {
          status: "rejected",
          reason: e.message,
          message: rejectionMessages[e.message] ?? e.message,
        };
      }
      await db.query(
        "UPDATE r2pl_v2.command_results SET status=$4,result=$5 WHERE campaign_id=$1 AND actor_id=$2 AND command_key=$3",
        [
          this.fixture.campaignId,
          actor.actorId,
          key,
          receipt.status === "applied" ? "test_applied" : "rejected",
          JSON.stringify(receipt),
        ],
      );
      await db.query(
        "INSERT INTO r2pl_v2.game_events(campaign_id,actor_id,title,body) VALUES($1,$2,$3,$4)",
        [
          this.fixture.campaignId,
          actor.actorId,
          actionNames[c.action],
          receipt.message,
        ],
      );
      await db.query("COMMIT");
      return receipt;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  private async change(
    db: PoolClient,
    a: SchoolPlayActor,
    key: Buffer,
    resource: string,
    amount: number,
  ): Promise<void> {
    if (amount === 0) return;
    await db.query(
      "INSERT INTO r2pl_v2.wallet_accounts(campaign_id,actor_id,resource,balance) VALUES($1,$2,$3,0) ON CONFLICT DO NOTHING",
      [this.fixture.campaignId, a.actorId, resource],
    );
    const updated = await db.query(
      "UPDATE r2pl_v2.wallet_accounts SET balance=balance+$4 WHERE campaign_id=$1 AND actor_id=$2 AND resource=$3 AND balance+$4>=0 RETURNING 1",
      [this.fixture.campaignId, a.actorId, resource, amount],
    );
    if (!updated.rowCount) throw new RuleRejection("INSUFFICIENT_BALANCE");
    await recordLedger(
      db,
      this.fixture.campaignId,
      a.actorId,
      key,
      resource,
      amount,
    );
  }
  private async apply(
    db: PoolClient,
    a: SchoolPlayActor,
    c: GameCommand,
    key: Buffer,
  ): Promise<GameReceipt> {
    const now = Date.now();
    if (c.action === "running") {
      if (this.portalMode)
        throw new RuleRejection(
          "Thành tích chạy được đồng bộ từ web giải chạy",
        );
      let delta: number;
      if (this.campaignProvider) {
        const identity = await this.campaignProvider.verifySession(a.token);
        const binding = (
          await db.query<{
            external_student_id: string;
            external_school_id: string;
          }>(
            "SELECT external_student_id,external_school_id FROM r2pl_prep.running_bindings WHERE campaign_id=$1 AND actor_id=$2",
            [this.fixture.campaignId, a.actorId],
          )
        ).rows[0];
        if (
          !binding ||
          identity.externalStudentId !== binding.external_student_id ||
          identity.externalSchoolId !== binding.external_school_id ||
          identity.sessionExpiresAtMs <= now
        )
          throw new RuleRejection("CAMPAIGN_IDENTITY_MISMATCH");
        const snapshot = parseRunningSnapshot(
          await this.campaignProvider.fetchRunningSnapshot(
            identity.externalStudentId,
          ),
        );
        if (
          snapshot.provider !== identity.provider ||
          snapshot.externalStudentId !== identity.externalStudentId ||
          snapshot.observedAtMs > now + 60000 ||
          now - snapshot.observedAtMs > 300000
        )
          throw new RuleRejection("INVALID_RUNNING_SNAPSHOT");
        const before = await this.state<{
          revision?: string;
          meters?: number;
          attributedPoints?: number;
          provider?: string;
        }>(db, "running", a.actorId, {});
        const target = Number(
          (snapshot.cumulativeMeters *
            BigInt(GAME_CONFIG.running.kmToPointsRate)) /
            1000n,
        );
        if (
          !Number.isSafeInteger(target) ||
          snapshot.cumulativeMeters > BigInt(Number.MAX_SAFE_INTEGER) ||
          snapshot.weeklyMeters > BigInt(Number.MAX_SAFE_INTEGER)
        )
          throw new RuleRejection("INVALID_RUNNING_SNAPSHOT");
        if (before.provider && before.provider !== snapshot.provider)
          throw new RuleRejection("RUNNING_PROVIDER_CHANGED");
        if (before.revision && snapshot.revision < BigInt(before.revision))
          throw new RuleRejection("STALE_RUNNING_SNAPSHOT");
        if (
          before.provider &&
          snapshot.revision === BigInt(before.revision ?? "0") &&
          Number(snapshot.cumulativeMeters) !== before.meters
        )
          throw new RuleRejection("INVALID_RUNNING_SNAPSHOT");
        delta =
          target -
          (before.attributedPoints ??
            Math.floor(
              ((before.meters ?? 0) * GAME_CONFIG.running.kmToPointsRate) /
                1000,
            ));
        if (delta < 0) throw new RuleRejection("RUNNING_DISTANCE_REGRESSION");
        await this.save(db, "running", a.actorId, {
          provider: snapshot.provider,
          revision: snapshot.revision.toString(),
          meters: Number(snapshot.cumulativeMeters),
          weeklyMeters: Number(snapshot.weeklyMeters),
          week: snapshot.weekStartMs,
          attributedPoints: target,
        });
      } else {
        if (!c.amount) throw new RuleRejection("METERS_REQUIRED");
        const provider = new SyntheticCampaignProvider(
          db,
          this.fixture.campaignId,
          a,
        );
        await provider.verifySession(a.token);
        const before = parseRunningSnapshot(
          await provider.fetchRunningSnapshot(a.actorId),
        );
        await provider.addMeters(c.amount);
        const after = parseRunningSnapshot(
          await provider.fetchRunningSnapshot(a.actorId),
        );
        delta = Number(
          (after.cumulativeMeters *
            BigInt(GAME_CONFIG.running.kmToPointsRate)) /
            1000n -
            (before.cumulativeMeters *
              BigInt(GAME_CONFIG.running.kmToPointsRate)) /
              1000n,
        );
      }
      await this.change(db, a, key, "fixture-credit", delta);
      return {
        status: "applied",
        reason: null,
        message: `Running: +${delta} Points`,
      };
    }
    if (c.action === "upkeep" || c.action === "consolidate") {
      const before = (await clusters(db, this.fixture.campaignId)).find(
        (v) => v.id === c.target && v.pair.includes(a.schoolSlot),
      );
      if (!c.target || !c.amount) throw new RuleRejection("AMOUNT_REQUIRED");
      try {
        await payShared(
          db,
          this.fixture.campaignId,
          a.actorId,
          a.schoolSlot,
          c.target,
          c.amount,
          c.action,
          (amount) => this.change(db, a, key, "fixture-credit", -amount),
          now,
        );
      } catch (e) {
        if (e instanceof RangeError) throw new RuleRejection(e.message);
        throw e;
      }
      const completed =
        c.action === "consolidate" &&
        before &&
        !(await clusters(db, this.fixture.campaignId)).some(
          (v) => v.id === c.target,
        );
      const rebate = await sharedPaymentBuff(
        db,
        this.fixture.campaignId,
        a.schoolSlot,
        c.action === "upkeep" ? "upkeep" : "consolidation",
        c.action === "upkeep"
          ? GAME_CONFIG.knowledge.upkeepPoints
          : completed
            ? (before.required ?? 0)
            : 0,
      );
      if (rebate) await this.change(db, a, key, "fixture-credit", rebate);
      return {
        status: "applied",
        reason: null,
        message: "Đã đóng góp Points cho cluster",
      };
    }
    if (c.action === "scout") {
      try {
        await scoutFrontier(
          db,
          this.fixture.campaignId,
          a.schoolSlot,
          a.actorId,
          key,
        );
      } catch (e) {
        if (e instanceof RangeError) throw new RuleRejection(e.message);
        throw e;
      }
      return {
        status: "applied",
        reason: null,
        message: "Đã trinh sát một vùng biên cho trường",
      };
    }
    const o = c.target ? await this.object(db, c.target) : undefined;
    if (!o) throw new RuleRejection("UNKNOWN_OBJECT");
    if (
      c.action === "contribute" ||
      c.action === "guess" ||
      c.action === "rally"
    ) {
      if (o.kind !== "landmark" || !(await this.path(db, o, a.schoolSlot)))
        throw new RuleRejection("KNOWLEDGE_PATH_REQUIRED");
      const b = await this.state(db, "beacon", o.id, initialBeacon()),
        slot = String(a.schoolSlot);
      const school = await schoolBeacon(
        db,
        this.fixture.campaignId,
        a.schoolSlot,
      );
      const currentTarget = nextBeaconTarget(b, school);
      let deposited = 0;
      if (c.action === "rally") {
        if (b.holder === a.schoolSlot)
          throw new RuleRejection("BEACON_ALREADY_ACTIVE");
        const old = await this.state<
          { target: string; createdAt: number } | undefined
        >(db, "beacon-rally", slot, undefined);
        if (old && now - old.createdAt < GAME_CONFIG.landmark.rallyCooldownMs)
          throw new RuleRejection("RALLY_COOLDOWN");
        await this.save(db, "beacon-rally", slot, {
          target: o.id,
          createdAt: now,
        });
        await db.query(
          "INSERT INTO r2pl_v2.game_events(campaign_id,school_slot,title,body) VALUES($1,$2,$3,$4)",
          [
            this.fixture.campaignId,
            a.schoolSlot,
            "Hiệu triệu thắp đèn hiệu",
            `${a.schoolName} kêu gọi cùng góp vào ${o.name}. Tiến độ ${b.pots[slot] ?? 0}/${currentTarget} Tinh thể.`,
          ],
        );
        return {
          status: "applied",
          reason: null,
          message: `Đã hiệu triệu cùng trường tới ${o.name}`,
        };
      }
      if (c.action === "guess") {
        if (!GAME_CONFIG.landmark.puzzleEnabled)
          throw new RuleRejection("PUZZLE_DISABLED");
        if (b.solved.includes(a.schoolSlot))
          return {
            status: "applied",
            reason: null,
            message: "Đã giải đố · 0 Crystal",
          };
        if ((b.cooldowns[slot] ?? 0) > now)
          throw new RuleRejection("GUESS_COOLDOWN");
        const l = LANDMARKS.find((l) => l.id === o.id)!;
        if (normalize(c.guess ?? "") !== normalize(l.name)) {
          b.cooldowns[slot] = now + GAME_CONFIG.landmark.wrongGuessCooldownMs;
          await this.save(db, "beacon", o.id, b);
          return {
            status: "applied",
            reason: null,
            message: "Sai đáp án · chờ 10 phút",
            nextAvailableAtMs: b.cooldowns[slot],
          };
        }
        b.solved.push(a.schoolSlot);
        b.pots[slot] =
          (b.pots[slot] ?? 0) + GAME_CONFIG.landmark.puzzleBonusCrystals;
      } else {
        if (!c.amount) throw new RuleRejection("AMOUNT_REQUIRED");
        if (b.holder === a.schoolSlot)
          throw new RuleRejection("BEACON_ALREADY_ACTIVE");
        const amount = Math.min(
          c.amount,
          Math.max(0, currentTarget - (b.pots[slot] ?? 0)),
        );
        deposited = amount;
        const wallet = (
          await db.query<{ balance: string }>(
            "SELECT balance::text FROM r2pl_v2.wallet_accounts WHERE campaign_id=$1 AND actor_id=$2 AND resource='fixture-crystals' FOR UPDATE",
            [this.fixture.campaignId, a.actorId],
          )
        ).rows[0];
        const available = BigInt(wallet?.balance ?? "0");
        const shortage = Number(
          BigInt(amount) > available ? BigInt(amount) - available : 0n,
        );
        if (shortage > 0) {
          await this.change(
            db,
            a,
            key,
            "fixture-credit",
            -shortage * GAME_CONFIG.landmark.pointsPerCrystal,
          );
          await this.change(db, a, key, "fixture-crystals", shortage);
        }
        await this.change(db, a, key, "fixture-crystals", -amount);
        b.pots[slot] = (b.pots[slot] ?? 0) + amount;
      }
      let lit = false;
      if (b.holder !== a.schoolSlot && (b.pots[slot] ?? 0) >= currentTarget) {
        if (school.active && school.active !== o.id) {
          const previous = await this.state(
            db,
            "beacon",
            school.active,
            initialBeacon(),
          );
          if (previous.holder === a.schoolSlot) previous.holder = null;
          previous.pots[slot] = 0;
          await this.save(db, "beacon", school.active, previous);
        }
        if (b.holder !== null) {
          b.takeovers++;
          const displaced = await schoolBeacon(
            db,
            this.fixture.campaignId,
            b.holder,
          );
          b.pots[String(b.holder)] = 0;
          displaced.active = null;
          displaced.buffId = null;
          await this.save(db, "school-beacon", String(b.holder), displaced);
        }
        const { buff, rank } = await chooseBuff(
          db,
          this.fixture.campaignId,
          a.schoolSlot,
          school.previous,
        );
        school.activations++;
        school.lastCost = currentTarget;
        school.active = o.id;
        school.buffId = buff.id;
        school.previous = [...school.previous, buff.id].slice(-2);
        school.rankAtActivation = rank;
        school.activatedAt = now;
        await this.save(db, "school-beacon", slot, school);
        b.lastCost = currentTarget;
        b.holder = a.schoolSlot;
        lit = true;
        await db.query(
          "INSERT INTO r2pl_v2.game_events(campaign_id,title,body) VALUES($1,$2,$3)",
          [
            this.fixture.campaignId,
            `Đèn hiệu ${o.name}`,
            `${a.schoolName} đã thắp sáng Beacon`,
          ],
        );
      }
      await this.save(db, "beacon", o.id, b);
      return {
        status: "applied",
        reason: null,
        ...(c.action === "contribute" ? { contributed: deposited } : {}),
        message: lit
          ? "Beacon đã sáng · Buff hoạt động"
          : "Đã cập nhật Crystal pot",
      };
    }
    if (c.action !== "spin" && c.action !== "open")
      throw new RuleRejection("INVALID_ACTION");
    const kind = c.action === "spin" ? "unistop" : "chest";
    if (o.kind !== kind || !o.tier) throw new RuleRejection("INVALID_OBJECT");
    const cooldowns = await this.state<Record<string, number>>(
      db,
      "cooldowns",
      a.actorId,
      {},
    );
    if (kind === "unistop") {
      await this.captureReachedStops(db);
      const currentStop = (await this.object(db, o.id)) ?? o;
      if (
        !GAME_CONFIG.staging.stationsUnlocked &&
        currentStop.ownerSchoolSlot !== a.schoolSlot
      )
        throw new RuleRejection("KNOWLEDGE_PATH_REQUIRED");
      if ((cooldowns[o.id] ?? 0) > now) throw new RuleRejection("COOLDOWN");
    } else {
      const known = await db.query(
        "SELECT 1 FROM r2pl_v2.game_chest_discoveries WHERE campaign_id=$1 AND actor_id=$2 AND object_id=$3",
        [this.fixture.campaignId, a.actorId, o.id],
      );
      if (!known.rowCount) throw new RuleRejection("CHEST_NOT_DISCOVERED");
      if (await this.state(db, "chest-claim", o.id, false))
        throw new RuleRejection("CHEST_COLLECTED");
      await this.change(
        db,
        a,
        key,
        `key-${o.tier}`,
        -GAME_CONFIG.rewards.chestKeyCost,
      );
      await this.save(db, "chest-claim", o.id, { actorId: a.actorId });
    }
    const running = await this.state<{ week?: number; weeklyMeters?: number }>(
      db,
      "running",
      a.actorId,
      {},
    );
    const pool = await readGiftPool(db, this.fixture.campaignId);
    const outcomes = effectiveRewardOutcomes(
      kind,
      o.tier,
      pool.totals[o.tier],
      running.week === campaignWeekStart(now) &&
        (running.weeklyMeters ?? 0) > 0,
    );
    let roll = this.draw();
    if (
      !Number.isInteger(roll) ||
      roll < 0 ||
      roll >= GAME_CONFIG.rewards.weightTotal
    )
      throw new Error("Invalid RNG");
    let reward: RewardOutcome | undefined;
    for (const r of outcomes) {
      if (roll < r.weight) {
        reward = r;
        break;
      }
      roll -= r.weight;
    }
    if (!reward) throw new Error("Empty reward");
    let giftCode: string | undefined;
    let giftName: string | undefined;
    if (reward.kind === "gift") {
      const item = await claimGiftPoolItem(
        db,
        this.fixture.campaignId,
        pool,
        o.tier,
      );
      giftName = item.name;
      // Retry random-code collisions without aborting the reward transaction.
      for (;;) {
        giftCode = "R2PL-GIFT-" + randomBytes(3).toString("hex").toUpperCase();
        const inserted = await db.query(
          "INSERT INTO r2pl_v2.game_state(campaign_id,scope,id,data) VALUES($1,'gift-entitlement',$2,$3) ON CONFLICT DO NOTHING RETURNING id",
          [
            this.fixture.campaignId,
            a.actorId + ":" + c.key,
            JSON.stringify({
              actorId: a.actorId,
              schoolSlot: a.schoolSlot,
              schoolName:
                this.fixture.schools[a.schoolSlot]?.label ?? "Unknown",
              tier: o.tier,
              giftName: item.name,
              giftPoolItemId: item.id,
              giftCode,
              sourceKind: kind,
              sourceId: o.id,
              createdAt: now,
              redeemedAt: null,
            }),
          ],
        );
        if (inserted.rowCount) break;
      }
    }
    const benefit = await rewardBuff(
      db,
      this.fixture.campaignId,
      a.schoolSlot,
      kind,
      reward.kind === "crystals" ? reward.quantity : 0,
    );
    if (reward.kind === "crystals" && benefit.crystals)
      reward = { ...reward, quantity: reward.quantity + benefit.crystals };
    if (benefit.points)
      await this.change(db, a, key, "fixture-credit", benefit.points);
    let discovery: WorldObject | undefined;
    if (reward.kind === "points")
      await this.change(db, a, key, "fixture-credit", reward.quantity);
    else if (reward.kind === "crystals")
      await this.change(db, a, key, "fixture-crystals", reward.quantity);
    else if (reward.kind === "key")
      await this.change(db, a, key, `key-${o.tier}`, reward.quantity);
    else if (reward.kind === "treasure_map") {
      await this.change(db, a, key, "fixture-treasure-map", reward.quantity);
      discovery = (
        await db.query<{ data: WorldObject }>(
          `SELECT o.data FROM r2pl_v2.game_world_objects o WHERE campaign_id=$1 AND data->>'kind'='chest' AND NOT EXISTS(SELECT 1 FROM r2pl_v2.game_state s WHERE s.campaign_id=o.campaign_id AND s.scope='chest-claim' AND s.id=o.id) AND NOT EXISTS(SELECT 1 FROM r2pl_v2.game_chest_discoveries d WHERE d.campaign_id=o.campaign_id AND d.actor_id=$2 AND d.object_id=o.id) ORDER BY id LIMIT 1`,
          [this.fixture.campaignId, a.actorId],
        )
      ).rows[0]?.data;
      if (discovery)
        await db.query(
          "INSERT INTO r2pl_v2.game_chest_discoveries(campaign_id,actor_id,object_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [this.fixture.campaignId, a.actorId, discovery.id],
        );
    }
    let nextAvailableAtMs: number | undefined;
    if (kind === "unistop") {
      nextAvailableAtMs =
        now +
        Math.ceil(
          (GAME_CONFIG.rewards.unistopCooldownMs[o.tier] *
            (100 - benefit.cooldownPercent)) /
            100,
        );
      cooldowns[o.id] = nextAvailableAtMs;
      await this.save(db, "cooldowns", a.actorId, cooldowns);
    }
    return {
      status: "applied",
      reason: null,
      reward,
      rewardTable: outcomes,
      ...(giftName ? { giftName } : {}),
      ...(giftCode ? { giftCode } : {}),
      ...(discovery ? { discovery } : {}),
      ...(nextAvailableAtMs ? { nextAvailableAtMs } : {}),
      message: `${reward.kind} ×${reward.quantity}`,
    };
  }

  async findGiftByCode(giftCode: string): Promise<{
    id: string;
    actorId: string;
    schoolSlot: number;
    schoolName: string;
    tier: string;
    giftCode: string;
    giftName: string;
    createdAt: number;
    redeemedAt: number | null;
  } | null> {
    const normalized = giftCode.trim().toUpperCase();
    const res = await this.pool.query<{
      id: string;
      data: Record<string, unknown>;
    }>(
      "SELECT id, data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='gift-entitlement' AND (UPPER(data->>'giftCode')=$2 OR UPPER(id)=$2) LIMIT 1",
      [this.fixture.campaignId, normalized],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0]!;
    const data = r.data;
    return {
      id: r.id,
      giftCode: (data.giftCode as string) ?? normalized,
      actorId: data.actorId as string,
      schoolSlot: (data.schoolSlot as number) ?? 0,
      schoolName: (data.schoolName as string) ?? "Unknown",
      tier: (data.tier as string) ?? "aspire",
      giftName: (data.giftName as string) ?? "Quà hiện vật",
      createdAt: (data.createdAt as number) ?? 0,
      redeemedAt: (data.redeemedAt as number | null) ?? null,
    };
  }

  async listGifts(limit = 50): Promise<
    Array<{
      id: string;
      actorId: string;
      schoolSlot: number;
      schoolName: string;
      tier: string;
      giftCode: string;
      giftName: string;
      createdAt: number;
      redeemedAt: number | null;
    }>
  > {
    const res = await this.pool.query<{
      id: string;
      data: Record<string, unknown>;
    }>(
      "SELECT id, data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='gift-entitlement' ORDER BY id DESC LIMIT $2",
      [this.fixture.campaignId, limit],
    );
    return res.rows.map((r) => {
      const data = r.data;
      return {
        id: r.id,
        giftCode:
          (data.giftCode as string) ??
          `R2PL-GIFT-${r.id.slice(0, 6).toUpperCase()}`,
        actorId: data.actorId as string,
        schoolSlot: (data.schoolSlot as number) ?? 0,
        schoolName: (data.schoolName as string) ?? "Unknown",
        tier: (data.tier as string) ?? "aspire",
        giftName: (data.giftName as string) ?? "Quà hiện vật",
        createdAt: (data.createdAt as number) ?? 0,
        redeemedAt: (data.redeemedAt as number | null) ?? null,
      };
    });
  }

  async redeemGift(
    giftCode: string,
    adminId?: string,
    sessionToken?: string,
  ): Promise<{
    success: boolean;
    alreadyRedeemed?: boolean;
    gift?: Record<string, unknown>;
    error?: string;
  }> {
    const normalized = giftCode.trim().toUpperCase();
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      if (adminId) {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `signed-game:${this.fixture.campaignId}`,
        ]);
        if (
          !(
            await db.query(
              "SELECT 1 FROM r2pl_v2.portal_admins a JOIN r2pl_v2.portal_admin_sessions s USING(campaign_id,actor_id) WHERE a.campaign_id=$1 AND a.actor_id=$2 AND a.active AND s.token_hash=$3 AND s.expires_at>clock_timestamp() FOR SHARE OF a,s",
              [
                this.fixture.campaignId,
                adminId,
                createHash("sha256")
                  .update(sessionToken ?? "")
                  .digest(),
              ],
            )
          ).rowCount
        )
          throw new TypeError("ADMIN_REQUIRED");
        await requireAdminPermission(
          db,
          this.fixture.campaignId,
          adminId,
          sessionToken ?? "",
          "gifts.redeem",
        );
        await db.query(
          "INSERT INTO r2pl_v2.operator_audit(campaign_id,actor_id,action,detail) VALUES($1,$2,'gift-redeem',$3)",
          [
            this.fixture.campaignId,
            adminId,
            JSON.stringify({ giftCode: normalized }),
          ],
        );
      }
      const res = await db.query<{ id: string; data: Record<string, unknown> }>(
        "SELECT id, data FROM r2pl_v2.game_state WHERE campaign_id=$1 AND scope='gift-entitlement' AND (UPPER(data->>'giftCode')=$2 OR UPPER(id)=$2) FOR UPDATE",
        [this.fixture.campaignId, normalized],
      );
      if (res.rows.length === 0) {
        await db.query("ROLLBACK");
        return { success: false, error: "GIFT_NOT_FOUND" };
      }
      const row = res.rows[0]!;
      const data = { ...row.data };
      if (data.redeemedAt) {
        await db.query("ROLLBACK");
        return {
          success: false,
          alreadyRedeemed: true,
          gift: {
            ...data,
            id: row.id,
            giftCode: (data.giftCode as string) ?? normalized,
          },
        };
      }
      const now = Date.now();
      data.redeemedAt = now;
      await db.query(
        "UPDATE r2pl_v2.game_state SET data=$1,redeemed_at=to_timestamp($4::double precision/1000) WHERE campaign_id=$2 AND scope='gift-entitlement' AND id=$3",
        [JSON.stringify(data), this.fixture.campaignId, row.id, now],
      );
      await db.query(
        "INSERT INTO r2pl_v2.game_events(campaign_id, actor_id, school_slot, title, body) VALUES($1, $2, $3, $4, $5)",
        [
          this.fixture.campaignId,
          data.actorId,
          data.schoolSlot,
          "Đã nhận quà tại sự kiện",
          `Mã ${data.giftCode ?? normalized} (${data.tier}) đã được Ban tổ chức xác nhận check-in phát quà thành công.`,
        ],
      );
      await db.query("COMMIT");
      return {
        success: true,
        gift: {
          ...data,
          id: row.id,
          giftCode: (data.giftCode as string) ?? normalized,
        },
      };
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
}
class RuleRejection extends Error {}
