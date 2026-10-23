import {
  GAME_CONFIG,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import type {
  MapBeacon,
  MapStateBatch,
} from "../../shared/protocol/mapStream.ts";

/** Internal source contains only public landmark ownership. */
export interface MapStateSource {
  readonly objects: readonly WorldObject[];
  readonly beacons: readonly {
    id: string;
    holder: number | null;
  }[];
}
interface SchoolState {
  objects: Map<string, WorldObject>;
  beacons: Map<string, MapBeacon>;
  nextRivalAt: number;
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Bounded latest-state buffers, shared by every viewer of a school. No per-player DB reads. */
export class MapStateBatcher {
  readonly #schools = new Map<number, SchoolState>();
  update(
    source: MapStateSource,
    slots: readonly number[],
    now: number,
  ): { slot: number; batch: MapStateBatch }[] {
    const updates: { slot: number; batch: MapStateBatch }[] = [];
    const objects = source.objects.filter((o) => o.kind !== "chest");
    const active = new Set(slots);
    for (const slot of this.#schools.keys())
      if (!active.has(slot)) this.#schools.delete(slot);
    for (const slot of active) {
      const beacons = source.beacons.map((b) => ({
        id: b.id,
        holder: b.holder,
      }));
      let state = this.#schools.get(slot);
      if (!state) {
        state = {
          objects: new Map(objects.map((o) => [o.id, o])),
          beacons: new Map(beacons.map((b) => [b.id, b])),
          nextRivalAt: now + GAME_CONFIG.realtime.rivalBatchMs,
        };
        this.#schools.set(slot, state);
        continue;
      }
      const rivalDue = now >= state.nextRivalAt;
      const batchObjects: WorldObject[] = [],
        removed: string[] = [],
        batchBeacons: MapBeacon[] = [];
      for (const object of objects) {
        const previous = state.objects.get(object.id);
        if (equal(previous, object)) continue;
        if (
          rivalDue ||
          previous?.ownerSchoolSlot === slot ||
          object.ownerSchoolSlot === slot ||
          object.schoolSlot === slot
        ) {
          batchObjects.push(object);
          state.objects.set(object.id, object);
        }
      }
      const ids = new Set(objects.map((o) => o.id));
      for (const [id, previous] of state.objects)
        if (
          !ids.has(id) &&
          (rivalDue ||
            previous.ownerSchoolSlot === slot ||
            previous.schoolSlot === slot)
        ) {
          removed.push(id);
          state.objects.delete(id);
        }
      for (const beacon of beacons) {
        const previous = state.beacons.get(beacon.id);
        if (equal(previous, beacon)) continue;
        if (
          rivalDue ||
          previous?.holder === slot ||
          beacon.holder === slot
        ) {
          batchBeacons.push(beacon);
          state.beacons.set(beacon.id, beacon);
        }
      }
      if (rivalDue) state.nextRivalAt = now + GAME_CONFIG.realtime.rivalBatchMs;
      if (batchObjects.length || removed.length || batchBeacons.length)
        updates.push({
          slot,
          batch: {
            reset: false,
            objects: batchObjects,
            removed,
            beacons: batchBeacons,
          },
        });
    }
    return updates;
  }
  snapshot(slot: number): MapStateBatch | undefined {
    const state = this.#schools.get(slot);
    return state
      ? {
          reset: true,
          objects: [...state.objects.values()],
          removed: [],
          beacons: [...state.beacons.values()],
        }
      : undefined;
  }
}
