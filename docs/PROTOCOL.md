# V2 protocol contract — M1 world format, later network proposal

This document defines semantic and binary boundaries. The exact command opcodes and envelope byte offsets will be assigned in M2 with golden byte fixtures; no V1 frame is wire-compatible by assumption. World chunk payload format v1 below is frozen for M1 review.

## Addressing and binary world format v1

- Map: width=height=1000; integer `x,z` from 0 through 999; `tileIndex=z*1000+x` from 0 through 999999. Never accept fractional, NaN or out-of-range coordinates.
- `chunkX=floor(x/64)`, `chunkZ=floor(z/64)` in 0..15. `local=(z%64)*64+(x%64)` in 0..4095. Sector coordinates are `floor(chunkX/4), floor(chunkZ/4)` in 0..3.
- Knowledge chunk payload is exactly 8192 bytes: 4096 unsigned 16-bit masks in row-major local order, **little endian**. Out-of-world slots on edge chunks are zero on encode and required zero on decode; the bottom-right chunk contains 40×40 real cells.
- Mask bit `b` equals `1 << b`, b in 0..15. A bit means that school currently holds knowledge, with no strength, timestamp, ownership priority, timer, challenge or fog meaning. Slot mapping comes from the campaign registry, not list order.
- Fog chunk payload is exactly 512 bytes per school and chunk, bit `local & 7` in byte `local >> 3`. A set bit means discovered. Edge padding must be zero. A school receives only its authorized fog and any separately approved public visibility data.
- Each M1 chunk record has `formatVersion=1`, coordinates, `revision` and CRC-32/ISO-HDLC checksum over its payload. Fog records also have a school slot. Revision is a validated unsigned 64-bit `bigint` in memory and never wraps. These are in-memory records, not a finalized network envelope or database row layout. Network revision fields will be unsigned 64-bit integers; JSON boundaries must reject values above `Number.MAX_SAFE_INTEGER` or encode them as decimal strings.

## Gameplay envelope

Every binary command has protocol version, command opcode, campaign/session context, 128-bit action idempotency key, rule version, payload length and bounded payload. The server derives actor and school from the authenticated session. Client-supplied identity, balance, reward, school or admin role fields are ignored or rejected. Production command size budget is **1 KiB** until measured otherwise; oversized or unknown-version commands fail closed.

Action results carry the same action key, status (`committed`, `rejected`, or `pending`), stable reason code, committed rule version and relevant world revision/ledger references. `pending` means no success guarantee. A duplicate command with the same canonical payload returns the original committed result. Reuse of a key with different payload returns `IDEMPOTENCY_CONFLICT`. No successful result is sent before PostgreSQL commit.

Snapshots carry protocol/world format, campaign and chunk coordinates, revision, payload length and checksum. Deltas carry base and next revision, a bounded record count and records of local index plus new mask or approved visible projection. A client applies a delta only when its local revision exactly equals `baseRevision`; duplicate/old deltas are ignored, gaps trigger resync. Decode validates length, bounds, chunk membership, reserved bytes and checksum before touching state. Snapshot/delta payloads must be visibility filtered; raw all-school masks are not automatically public.

The initial subscription handshake fences a revision before the snapshot, registers delivery for later updates and replays or buffers intervening changes. Reconnect authenticates again, re-establishes the viewport, and resumes by revision when retained deltas are available; otherwise it gets a new snapshot. Action acknowledgements are independent of broadcast delivery.

## Limits and compatibility

Proposed M2 frame budgets: gameplay command ≤1 KiB, a chunk snapshot ≤16 KiB including envelope, a delta ≤64 KiB, at most 256 subscribed chunks per connection (normally far fewer). These are design limits to verify under benchmarks. Outbound per-client queues have a measured finite cap; overflow requests resync or disconnects. Compression is optional after measuring CPU and bytes, never required for correctness.

Protocol and world format versions are independent. A breaking field or interpretation change increments the relevant version and adds decoder compatibility or a migration. Golden fixtures cover little-endian bytes, bit 15, edge padding, malformed lengths, duplicate records, revision gaps and old clients. Administrative publishing uses a separately authenticated and audited API, not student command opcodes.
