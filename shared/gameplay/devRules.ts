/** M4-B development-only exploration rule. No result here authorizes production play. */

import { MAX_SCHOOL_SLOTS } from "../world/constants.ts";
import { assertTileIndex } from "../world/coordinates.ts";
import type { EvaluateDevExplore } from "./devContract.ts";

function assertSchoolSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SCHOOL_SLOTS) {
    throw new RangeError("School slot outside registry");
  }
}

function assertFlag(value: boolean, label: string): void {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be boolean`);
  }
}

function assertNonnegativeBigInt(value: bigint, label: string): void {
  if (typeof value !== "bigint") {
    throw new TypeError(`${label} must be bigint`);
  }
  if (value < 0n) {
    throw new RangeError(`${label} must be nonnegative`);
  }
}

/**
 * Synthetic rule-version-0 exploration decision for the M4-A fixture only.
 * Validates first, then reports already-known-and-discovered as no_change before
 * any affordability check, then rejects insufficient fixture credit, otherwise
 * applies with exactly the configured cost.
 */
export const evaluateDevExplore: EvaluateDevExplore = (input, config) => {
  const ruleVersion: number = config.ruleVersion;
  if (ruleVersion !== 0) {
    throw new RangeError("Only development rule version 0 is supported");
  }
  const resource: string = config.resource;
  if (resource !== "fixture-credit") {
    throw new RangeError("Development rule resource must be fixture-credit");
  }

  assertTileIndex(input.tileIndex);
  assertSchoolSlot(input.schoolSlot);
  assertFlag(input.knownBySchool, "knownBySchool");
  assertFlag(input.discoveredBySchool, "discoveredBySchool");
  assertNonnegativeBigInt(input.balance, "balance");
  assertNonnegativeBigInt(config.cost, "cost");

  if (input.knownBySchool && input.discoveredBySchool) {
    return { kind: "no_change", debit: 0n };
  }
  if (input.balance < config.cost) {
    return {
      kind: "reject",
      reason: "insufficient_fixture_credit",
      debit: 0n,
    };
  }
  return { kind: "apply", debit: config.cost };
};
