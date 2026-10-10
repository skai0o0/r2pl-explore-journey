/** M4-B development-only rule boundary. No result here authorizes production play. */
export interface DevExploreInput {
  readonly tileIndex: number;
  readonly schoolSlot: number;
  readonly knownBySchool: boolean;
  readonly discoveredBySchool: boolean;
  readonly balance: bigint;
}

export interface DevExploreConfig {
  readonly ruleVersion: 0;
  readonly resource: "fixture-credit";
  readonly cost: bigint;
}

export type DevExploreDecision =
  | { readonly kind: "apply"; readonly debit: bigint }
  | { readonly kind: "no_change"; readonly debit: 0n }
  | {
      readonly kind: "reject";
      readonly reason: "insufficient_fixture_credit";
      readonly debit: 0n;
    };

/** Evaluated only after authoritative world and wallet data are read under the transaction lock. */
export type EvaluateDevExplore = (
  input: DevExploreInput,
  config: DevExploreConfig,
) => DevExploreDecision;
