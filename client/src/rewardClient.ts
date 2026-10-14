/** Validated synthetic reward HTTP transport. */
import {
  parseRewardCommand,
  type RewardPreparationCommand,
  type RewardReceipt,
} from "../../shared/rewards/commands.ts";
import {
  type DevInventory,
  type DevRewardTarget,
  type PrivateRewardPage,
  parseDevInventory,
  parsePrivateRewardPage,
  parseRewardCatalog,
  parseRewardReceipt,
} from "../../shared/rewards/playable.ts";
export class DevRewardClient {
  readonly #token: string;
  readonly #fetch: typeof fetch;
  constructor(
    token: string,
    transport: typeof fetch = (input, init) => fetch(input, init),
  ) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(token))
      throw new TypeError("Invalid synthetic token");
    this.#token = token;
    this.#fetch = transport;
  }
  async #request(
    path: string,
    command?: RewardPreparationCommand,
  ): Promise<unknown> {
    const response = await this.#fetch(path, {
      method: command ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.#token}`,
        ...(command ? { "Content-Type": "application/json" } : {}),
      },
      ...(command ? { body: JSON.stringify(command) } : {}),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`Dev reward request failed (${response.status})`);
    return response.json() as Promise<unknown>;
  }
  async catalog(): Promise<readonly DevRewardTarget[]> {
    return parseRewardCatalog(await this.#request("/api/fixture/rewards"));
  }
  async inventory(): Promise<DevInventory> {
    const profile = (await this.#request("/api/fixture/me")) as {
      fixtureOnly?: unknown;
      inventory?: unknown;
    };
    if (profile?.fixtureOnly !== true)
      throw new TypeError("Invalid synthetic account");
    return parseDevInventory(profile.inventory);
  }
  async apply(
    input: RewardPreparationCommand,
  ): Promise<{ kind: "committed" | "replay"; receipt: RewardReceipt }> {
    const command = parseRewardCommand(input);
    const result = (await this.#request("/api/fixture/rewards", command)) as {
      fixtureOnly?: unknown;
      kind?: unknown;
      receipt?: unknown;
    };
    if (
      result?.fixtureOnly !== true ||
      (result.kind !== "committed" && result.kind !== "replay")
    )
      throw new TypeError("Invalid synthetic reward result");
    const receipt = parseRewardReceipt(result.receipt);
    if (
      receipt.command.key !== command.key ||
      receipt.command.kind !== command.kind ||
      receipt.command.targetId !== command.targetId ||
      receipt.command.ruleVersion !== command.ruleVersion
    )
      throw new TypeError("Mismatched reward receipt");
    return { kind: result.kind, receipt };
  }
  async events(after = "0"): Promise<PrivateRewardPage> {
    if (
      !/^(0|[1-9][0-9]{0,18})$/.test(after) ||
      BigInt(after) > 9223372036854775807n
    )
      throw new RangeError("Invalid reward cursor");
    return parsePrivateRewardPage(
      await this.#request(`/api/fixture/rewards/events?after=${after}`),
    );
  }
}
