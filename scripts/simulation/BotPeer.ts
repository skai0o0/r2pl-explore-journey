import { performance } from "node:perf_hooks";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import {
  ACK_STATUS,
  type Ack,
  decodeAck,
  decodeDelta,
  decodeFrame,
  decodeSnapshot,
  encodeExplore,
  encodeResync,
  encodeSubscribe,
  M2_KIND,
} from "../../shared/protocol/m2.ts";
import { ProjectionReplica } from "../../shared/protocol/replica.ts";
import {
  BotPlanner,
  type BotRole,
  type BotSchool,
  regionChunks,
} from "../../shared/simulation/schoolBots.ts";
import { crc32 } from "../../shared/world/checksum.ts";
import {
  chunkCoordinatesForId,
  tileIndex,
} from "../../shared/world/coordinates.ts";
export interface ViewSignature {
  readonly slot: number;
  readonly chunk: number;
  readonly revision: string;
  readonly maskCrc: number;
  readonly fogCrc: number;
}
export const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
interface Pending {
  readonly hex: string;
  readonly resolve: (ack: Ack) => void;
  readonly reject: (error: Error) => void;
  timer: NodeJS.Timeout | undefined;
}
/** Test client: private own-school replica only. No database access or rival knowledge. */
export class BotPeer {
  readonly school: BotSchool;
  readonly role: BotRole;
  readonly planner: BotPlanner;
  readonly chunks: readonly number[];
  readonly latencies: number[] = [];
  readonly #sdk: ColyseusSDK;
  readonly #token: string;
  #replica: ProjectionReplica;
  #room: Room | undefined;
  #pending: Pending | undefined;
  #intentional = false;
  readonly #ready = new Set<number>();
  readonly #resolved = new Set<string>();
  readonly #applied = new Map<string, { tile: number; sentAt: number }>();
  readonly #firstSent = new Map<string, number>();
  readonly #seenTiles = new Map<number, number>();
  error: string | null = null;
  applied = 0;
  noChange = 0;
  rejected = 0;
  retries = 0;
  reconnects = 0;
  resyncs = 0;
  frames = 0;
  bytes = 0;
  wireCommands = 0;
  constructor(
    url: string,
    token: string,
    school: BotSchool,
    role: BotRole,
    seed: number,
  ) {
    const endpoint = new URL(url);
    if (
      endpoint.protocol !== "ws:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
    )
      throw new RangeError(
        "Bots may only connect to the isolated loopback fixture",
      );
    this.school = school;
    this.role = role;
    this.planner = new BotPlanner(school, seed);
    this.chunks = regionChunks(school.region);
    this.#sdk = new ColyseusSDK(url);
    this.#token = token;
    this.#replica = new ProjectionReplica(school.slot);
  }
  async connect(roomId?: string): Promise<string> {
    this.#intentional = false;
    this.#ready.clear();
    this.#replica = new ProjectionReplica(this.school.slot);
    const room = roomId
      ? await this.#sdk.joinById(roomId, { token: this.#token })
      : await this.#sdk.joinOrCreate("m2", { token: this.#token });
    this.#room = room;
    room.reconnection.enabled = false;
    room.onMessage("m2", (raw: Uint8Array) => {
      if (this.#room !== room) return;
      try {
        this.#frame(Uint8Array.from(raw));
      } catch {
        this.#fail("Invalid or unauthorized bot projection");
      }
    });
    room.onError(() => this.#fail("Bot transport error"));
    room.onLeave(() => {
      if (!this.#intentional && this.#room === room)
        this.#fail("Bot connection closed unexpectedly");
    });
    room.sendBytes("m2", encodeSubscribe(this.chunks));
    const deadline = performance.now() + 10000;
    while (
      this.#ready.size < this.chunks.length &&
      !this.error &&
      performance.now() < deadline
    )
      await pause(10);
    if (this.error || this.#ready.size !== this.chunks.length)
      throw new Error(this.error ?? "Bot snapshot timeout");
    return room.roomId;
  }
  #learn(chunk: number, local: number): void {
    if (!this.#replica.maskAt(chunk, local)) return;
    const c = chunkCoordinatesForId(chunk);
    const x = c.chunkX * 64 + (local % 64);
    const z = c.chunkZ * 64 + Math.floor(local / 64);
    if (x >= 1000 || z >= 1000) return;
    const tile = tileIndex(x, z);
    if (!this.#seenTiles.has(tile))
      this.#seenTiles.set(tile, performance.now());
    this.planner.learn(tile);
  }
  #frame(bytes: Uint8Array): void {
    this.bytes += bytes.byteLength;
    this.frames++;
    const frame = decodeFrame(bytes);
    if (frame.kind === M2_KIND.SNAPSHOT) {
      const snapshot = decodeSnapshot(frame.payload);
      if (!this.chunks.includes(snapshot.chunkId))
        throw new Error("Unexpected bot chunk");
      this.#replica.applySnapshot(snapshot);
      this.#ready.add(snapshot.chunkId);
      for (let i = 0; i < 4096; i++) this.#learn(snapshot.chunkId, i);
    } else if (frame.kind === M2_KIND.DELTA) {
      const delta = decodeDelta(frame.payload);
      if (!this.chunks.includes(delta.chunkId))
        throw new Error("Unexpected bot delta");
      if (this.#replica.applyDelta(delta) === "resync") {
        this.resyncs++;
        this.#room!.sendBytes("m2", encodeResync(delta.chunkId));
      } else this.#learn(delta.chunkId, delta.localIndex);
    } else if (frame.kind === M2_KIND.ACK) {
      const ack = decodeAck(frame.payload);
      const hex = Buffer.from(ack.key).toString("hex");
      if (this.#pending?.hex === hex) {
        const pending = this.#pending;
        this.#pending = undefined;
        if (pending.timer) clearTimeout(pending.timer);
        pending.resolve(ack);
      }
    } else if (frame.kind === M2_KIND.ERROR)
      this.#fail("Server rejected bot frame");
  }
  #fail(message: string): void {
    this.error ??= message;
    if (this.#pending) {
      const pending = this.#pending;
      this.#pending = undefined;
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
  }
  async explore(tile: number, key: Uint8Array): Promise<Ack> {
    if (!this.#room || this.error || this.#pending)
      throw new Error(this.error ?? "Bot connection not ready or busy");
    const hex = Buffer.from(key).toString("hex");
    const started = performance.now();
    if (!this.#firstSent.has(hex)) this.#firstSent.set(hex, started);
    const bytes = encodeExplore({ key, tileIndex: tile, ruleVersion: 0 });
    const ack = await new Promise<Ack>((resolve, reject) => {
      const pending: Pending = { hex, resolve, reject, timer: undefined };
      this.#pending = pending;
      let attempts = 0;
      const send = () => {
        if (this.#pending !== pending) return;
        if (attempts >= 3) {
          this.#pending = undefined;
          pending.reject(new Error("Bot ACK timeout after stable-key retries"));
          return;
        }
        if (attempts > 0) this.retries++;
        attempts++;
        this.wireCommands++;
        this.#room!.sendBytes("m2", bytes);
        pending.timer = setTimeout(send, 2000);
      };
      send();
    });
    this.latencies.push(performance.now() - started);
    if (!this.#resolved.has(hex)) {
      this.#resolved.add(hex);
      if (ack.status === ACK_STATUS.TEST_APPLIED) {
        this.applied++;
        this.#applied.set(hex, { tile, sentAt: this.#firstSent.get(hex)! });
      } else if (ack.status === ACK_STATUS.TEST_NO_CHANGE) this.noChange++;
      else this.rejected++;
    }
    return ack;
  }
  async replay(tile: number, key: Uint8Array): Promise<Ack> {
    this.retries++;
    return this.explore(tile, key);
  }
  async reconnect(): Promise<void> {
    const id = this.#room!.roomId;
    await this.close();
    this.error = null;
    await this.connect(id);
    this.reconnects++;
  }
  async close(): Promise<void> {
    this.#intentional = true;
    if (this.#pending) this.#fail("Bot session closing");
    const room = this.#room;
    if (room) await Promise.race([room.leave().catch(() => {}), pause(2000)]);
    this.#room = undefined;
  }
  visibleLatencies(): { samples: number[]; missing: number } {
    const samples: number[] = [];
    let missing = 0;
    for (const action of this.#applied.values()) {
      const seen = this.#seenTiles.get(action.tile);
      if (seen === undefined || seen < action.sentAt) missing++;
      else samples.push(seen - action.sentAt);
    }
    return { samples, missing };
  }
  signatures(): ViewSignature[] {
    return this.chunks.map((chunk) => {
      const mask = new Uint8Array(8192);
      const fog = new Uint8Array(512);
      const data = new DataView(mask.buffer);
      for (let local = 0; local < 4096; local++) {
        data.setUint16(local * 2, this.#replica.maskAt(chunk, local), true);
        if (this.#replica.isDiscovered(chunk, local))
          fog[local >> 3]! |= 1 << (local & 7);
      }
      return {
        slot: this.school.slot,
        chunk,
        revision: this.#replica.revision(chunk)!.toString(),
        maskCrc: crc32(mask),
        fogCrc: crc32(fog),
      };
    });
  }
}
