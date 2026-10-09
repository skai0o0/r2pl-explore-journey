import { crc32 } from "../world/checksum.ts";
import {
  CHUNK_FOG_BYTES,
  CHUNK_MASK_BYTES,
  MAX_REVISION,
  WORLD_TILE_COUNT,
} from "../world/constants.ts";

export const M2_VERSION = 1;
export const MAX_COMMAND_BYTES = 1024;
export const MAX_SUBSCRIBED_CHUNKS = 64;
export const M2_KIND = {
  EXPLORE: 1,
  SUBSCRIBE: 2,
  RESYNC: 3,
  PRODUCTION_MUTATION: 4,
  HELLO: 16,
  ACK: 17,
  SNAPSHOT: 18,
  DELTA: 19,
  ERROR: 20,
} as const;
export const ACK_STATUS = {
  TEST_APPLIED: 1,
  TEST_NO_CHANGE: 2,
  REJECTED: 3,
} as const;
export const REASON = {
  NONE: 0,
  INVALID_FRAME: 1,
  INVALID_COMMAND: 2,
  RATE_LIMITED: 3,
  IDEMPOTENCY_CONFLICT: 4,
  QUEUE_FULL: 5,
  NOT_SUBSCRIBED: 6,
  PRODUCTION_DISABLED: 7,
  INTERNAL: 8,
} as const;

export type M2Kind = (typeof M2_KIND)[keyof typeof M2_KIND];
export type AckStatus = (typeof ACK_STATUS)[keyof typeof ACK_STATUS];
export type Reason = (typeof REASON)[keyof typeof REASON];
export interface Frame {
  readonly kind: M2Kind;
  readonly payload: Uint8Array;
}
export interface ExploreCommand {
  readonly key: Uint8Array;
  readonly tileIndex: number;
  readonly ruleVersion: number;
}
export interface Ack {
  readonly key: Uint8Array;
  readonly status: AckStatus;
  readonly reason: Reason;
  readonly chunkId: number;
  readonly viewRevision: bigint;
}
export interface Snapshot {
  readonly chunkId: number;
  readonly viewRevision: bigint;
  readonly mask: Uint8Array;
  readonly fog: Uint8Array;
}
export interface Delta {
  readonly chunkId: number;
  readonly baseRevision: bigint;
  readonly nextRevision: bigint;
  readonly localIndex: number;
  readonly mask: number;
  readonly discovered: boolean;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function assertRevision(revision: bigint): void {
  if (revision < 0n || revision > MAX_REVISION)
    throw new RangeError("Invalid view revision");
}
function assertChunkId(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id >= 256)
    throw new RangeError("Invalid chunk id");
}
function assertKey(key: Uint8Array): void {
  if (key.byteLength !== 16)
    throw new RangeError("Action key must be 16 bytes");
}

/** Envelope: magic R2, version, kind, u16 payload length, u16 zero, payload, u32 LE CRC of preceding bytes. */
export function encodeFrame(kind: M2Kind, payload: Uint8Array): Uint8Array {
  if (payload.byteLength > 0xffff)
    throw new RangeError("Frame payload too large");
  const bytes = new Uint8Array(8 + payload.byteLength + 4);
  bytes[0] = 0x52;
  bytes[1] = 0x32;
  bytes[2] = M2_VERSION;
  bytes[3] = kind;
  view(bytes).setUint16(4, payload.byteLength, true);
  bytes.set(payload, 8);
  view(bytes).setUint32(
    bytes.byteLength - 4,
    crc32(bytes.subarray(0, bytes.byteLength - 4)),
    true,
  );
  return bytes;
}

export function decodeFrame(bytes: Uint8Array, maxBytes = 0xffff + 12): Frame {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 12 ||
    bytes.byteLength > maxBytes
  )
    throw new Error("Invalid frame length");
  const data = view(bytes);
  if (
    bytes[0] !== 0x52 ||
    bytes[1] !== 0x32 ||
    bytes[2] !== M2_VERSION ||
    data.getUint16(6, true) !== 0
  )
    throw new Error("Invalid frame header");
  const length = data.getUint16(4, true);
  if (length + 12 !== bytes.byteLength)
    throw new Error("Frame length mismatch");
  const kind = bytes[3];
  if (!Object.values(M2_KIND).includes(kind as M2Kind))
    throw new Error("Unknown frame kind");
  if (
    data.getUint32(bytes.byteLength - 4, true) !==
    crc32(bytes.subarray(0, bytes.byteLength - 4))
  )
    throw new Error("Frame checksum mismatch");
  return {
    kind: kind as M2Kind,
    payload: bytes.subarray(8, bytes.byteLength - 4),
  };
}

export function encodeExplore(command: ExploreCommand): Uint8Array {
  assertKey(command.key);
  if (
    !Number.isInteger(command.tileIndex) ||
    command.tileIndex < 0 ||
    command.tileIndex >= WORLD_TILE_COUNT ||
    command.ruleVersion !== 0
  )
    throw new RangeError("Invalid synthetic explore command");
  const payload = new Uint8Array(22);
  payload.set(command.key);
  view(payload).setUint32(16, command.tileIndex, true);
  view(payload).setUint16(20, command.ruleVersion, true);
  return encodeFrame(M2_KIND.EXPLORE, payload);
}
export function decodeExplore(payload: Uint8Array): ExploreCommand {
  if (payload.byteLength !== 22)
    throw new Error("Invalid explore payload length");
  const tileIndex = view(payload).getUint32(16, true);
  const ruleVersion = view(payload).getUint16(20, true);
  if (tileIndex >= WORLD_TILE_COUNT || ruleVersion !== 0)
    throw new Error("Invalid synthetic explore parameters");
  return {
    key: Uint8Array.from(payload.subarray(0, 16)),
    tileIndex,
    ruleVersion,
  };
}

export function encodeSubscribe(chunkIds: readonly number[]): Uint8Array {
  if (
    chunkIds.length > MAX_SUBSCRIBED_CHUNKS ||
    new Set(chunkIds).size !== chunkIds.length
  )
    throw new RangeError("Invalid subscription count or duplicate");
  const payload = new Uint8Array(1 + chunkIds.length * 2);
  payload[0] = chunkIds.length;
  chunkIds.forEach((id, i) => {
    assertChunkId(id);
    view(payload).setUint16(1 + i * 2, id, true);
  });
  return encodeFrame(M2_KIND.SUBSCRIBE, payload);
}
export function decodeSubscribe(payload: Uint8Array): number[] {
  const count = payload[0];
  if (
    count === undefined ||
    count > MAX_SUBSCRIBED_CHUNKS ||
    payload.byteLength !== 1 + count * 2
  )
    throw new Error("Invalid subscription payload");
  const ids = Array.from({ length: count }, (_, i) =>
    view(payload).getUint16(1 + i * 2, true),
  );
  ids.forEach(assertChunkId);
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate subscribed chunk");
  return ids;
}
export function encodeResync(chunkId: number): Uint8Array {
  assertChunkId(chunkId);
  const payload = new Uint8Array(2);
  view(payload).setUint16(0, chunkId, true);
  return encodeFrame(M2_KIND.RESYNC, payload);
}
export function decodeResync(payload: Uint8Array): number {
  if (payload.byteLength !== 2) throw new Error("Invalid resync payload");
  const id = view(payload).getUint16(0, true);
  assertChunkId(id);
  return id;
}

export function encodeHello(schoolSlot: number): Uint8Array {
  if (!Number.isInteger(schoolSlot) || schoolSlot < 0 || schoolSlot > 15)
    throw new RangeError("Invalid school slot");
  return encodeFrame(M2_KIND.HELLO, Uint8Array.of(schoolSlot, 1));
}
export function decodeHello(payload: Uint8Array): number {
  if (payload.byteLength !== 2 || payload[0]! > 15 || payload[1] !== 1)
    throw new Error("Invalid hello");
  return payload[0]!;
}

export function encodeAck(ack: Ack): Uint8Array {
  assertKey(ack.key);
  assertChunkId(ack.chunkId);
  assertRevision(ack.viewRevision);
  const payload = new Uint8Array(28);
  payload.set(ack.key);
  payload[16] = ack.status;
  payload[17] = ack.reason;
  view(payload).setUint16(18, ack.chunkId, true);
  view(payload).setBigUint64(20, ack.viewRevision, true);
  return encodeFrame(M2_KIND.ACK, payload);
}
export function decodeAck(payload: Uint8Array): Ack {
  if (payload.byteLength !== 28) throw new Error("Invalid ack payload");
  const data = view(payload);
  const status = payload[16] as AckStatus;
  const reason = payload[17] as Reason;
  if (
    !Object.values(ACK_STATUS).includes(status) ||
    !Object.values(REASON).includes(reason)
  )
    throw new Error("Invalid ack status");
  const chunkId = data.getUint16(18, true);
  assertChunkId(chunkId);
  return {
    key: Uint8Array.from(payload.subarray(0, 16)),
    status,
    reason,
    chunkId,
    viewRevision: data.getBigUint64(20, true),
  };
}

export function encodeSnapshot(snapshot: Snapshot): Uint8Array {
  assertChunkId(snapshot.chunkId);
  assertRevision(snapshot.viewRevision);
  if (
    snapshot.mask.byteLength !== CHUNK_MASK_BYTES ||
    snapshot.fog.byteLength !== CHUNK_FOG_BYTES
  )
    throw new RangeError("Invalid projected chunk length");
  const payload = new Uint8Array(10 + CHUNK_MASK_BYTES + CHUNK_FOG_BYTES);
  view(payload).setUint16(0, snapshot.chunkId, true);
  view(payload).setBigUint64(2, snapshot.viewRevision, true);
  payload.set(snapshot.mask, 10);
  payload.set(snapshot.fog, 10 + CHUNK_MASK_BYTES);
  return encodeFrame(M2_KIND.SNAPSHOT, payload);
}
export function decodeSnapshot(payload: Uint8Array): Snapshot {
  if (payload.byteLength !== 10 + CHUNK_MASK_BYTES + CHUNK_FOG_BYTES)
    throw new Error("Invalid snapshot payload length");
  const data = view(payload);
  const chunkId = data.getUint16(0, true);
  assertChunkId(chunkId);
  return {
    chunkId,
    viewRevision: data.getBigUint64(2, true),
    mask: Uint8Array.from(payload.subarray(10, 10 + CHUNK_MASK_BYTES)),
    fog: Uint8Array.from(payload.subarray(10 + CHUNK_MASK_BYTES)),
  };
}

export function encodeDelta(delta: Delta): Uint8Array {
  assertChunkId(delta.chunkId);
  assertRevision(delta.baseRevision);
  assertRevision(delta.nextRevision);
  if (
    delta.nextRevision !== delta.baseRevision + 1n ||
    !Number.isInteger(delta.localIndex) ||
    delta.localIndex < 0 ||
    delta.localIndex >= 4096 ||
    !Number.isInteger(delta.mask) ||
    delta.mask < 0 ||
    delta.mask > 0xffff
  )
    throw new RangeError("Invalid delta");
  const payload = new Uint8Array(23);
  const data = view(payload);
  data.setUint16(0, delta.chunkId, true);
  data.setBigUint64(2, delta.baseRevision, true);
  data.setBigUint64(10, delta.nextRevision, true);
  data.setUint16(18, delta.localIndex, true);
  data.setUint16(20, delta.mask, true);
  payload[22] = delta.discovered ? 1 : 0;
  return encodeFrame(M2_KIND.DELTA, payload);
}
export function decodeDelta(payload: Uint8Array): Delta {
  if (payload.byteLength !== 23)
    throw new Error("Invalid delta payload length");
  const data = view(payload);
  const chunkId = data.getUint16(0, true);
  assertChunkId(chunkId);
  const baseRevision = data.getBigUint64(2, true);
  const nextRevision = data.getBigUint64(10, true);
  const localIndex = data.getUint16(18, true);
  const mask = data.getUint16(20, true);
  if (
    nextRevision !== baseRevision + 1n ||
    localIndex >= 4096 ||
    payload[22]! > 1
  )
    throw new Error("Invalid delta values");
  return {
    chunkId,
    baseRevision,
    nextRevision,
    localIndex,
    mask,
    discovered: payload[22] === 1,
  };
}

export function encodeError(reason: Reason): Uint8Array {
  return encodeFrame(M2_KIND.ERROR, Uint8Array.of(reason));
}
export function decodeError(payload: Uint8Array): Reason {
  if (
    payload.byteLength !== 1 ||
    !Object.values(REASON).includes(payload[0] as Reason)
  )
    throw new Error("Invalid error payload");
  return payload[0] as Reason;
}
