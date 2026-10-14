import {
  parseRewardCommand,
  REWARD_PREPARATION_VERSION,
  type RewardPreparationCommand,
  type RewardReceipt,
} from "../../shared/rewards/commands.ts";
import {
  type DevInventory,
  type DevRewardTarget,
  parseBalance,
  parseRewardReceipt,
} from "../../shared/rewards/playable.ts";
import { DevRewardClient } from "./rewardClient.ts";

interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface RewardState {
  readonly inventory?: DevInventory | undefined;
  readonly targets: readonly DevRewardTarget[];
  readonly pending?: RewardPreparationCommand | undefined;
  readonly receipt?: RewardReceipt | undefined;
  readonly busy: boolean;
  readonly message: string;
}
type ClientPort = Pick<
  DevRewardClient,
  "catalog" | "inventory" | "apply" | "events"
>;
/** Account-scoped recovery; never grants resources optimistically. */
export class RewardSession {
  #token = "";
  #generation = 0;
  #refresh = 0;
  #client?: ClientPort;
  #state: RewardState = { targets: [], busy: false, message: "" };
  readonly #storage: StoragePort;
  readonly #changed: (state: RewardState) => void;
  readonly #committed: (token: string) => void;
  readonly #factory: (token: string) => ClientPort;
  readonly #uuid: () => string;
  constructor(
    storage: StoragePort,
    changed: (state: RewardState) => void,
    committed: (token: string) => void,
    factory: (token: string) => ClientPort = (token) =>
      new DevRewardClient(token),
    uuid: () => string = () => crypto.randomUUID(),
  ) {
    this.#storage = storage;
    this.#changed = changed;
    this.#committed = committed;
    this.#factory = factory;
    this.#uuid = uuid;
  }
  get state(): RewardState {
    return this.#state;
  }
  #key(token: string, field: string): string {
    return `r2pl-rewards-v1:${token}:${field}`;
  }
  #read<T>(field: string, parser: (value: unknown) => T): T | undefined {
    try {
      const raw = this.#storage.getItem(this.#key(this.#token, field));
      return raw ? parser(JSON.parse(raw)) : undefined;
    } catch {
      return undefined;
    }
  }
  #emit(patch: Partial<RewardState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#changed(this.#state);
  }
  select(token: string): void {
    if (token === this.#token) return;
    this.#token = token;
    this.#generation++;
    this.#refresh++;
    this.#client = this.#factory(token);
    this.#state = {
      targets: [],
      busy: false,
      pending: this.#read("pending", parseRewardCommand),
      receipt: this.#read("receipt", parseRewardReceipt),
      message: "Đang tải kho…",
    };
    this.#changed(this.#state);
    void this.refresh();
  }
  async refresh(): Promise<void> {
    const client = this.#client;
    if (!client || this.#state.busy) return;
    const generation = this.#generation;
    const refresh = ++this.#refresh;
    const token = this.#token;
    const cursor = this.#read("cursor", parseBalance) ?? "0";
    try {
      const [inventory, targets, page] = await Promise.all([
        client.inventory(),
        client.catalog(),
        client.events(cursor),
      ]);
      if (generation !== this.#generation || refresh !== this.#refresh) return;
      if (BigInt(page.nextCursor) < BigInt(cursor))
        throw new Error("Regressed cursor");
      const receipt = page.events.at(-1)?.receipt ?? this.#state.receipt;
      this.#storage.setItem(
        this.#key(token, "cursor"),
        JSON.stringify(page.nextCursor),
      );
      if (receipt)
        this.#storage.setItem(
          this.#key(token, "receipt"),
          JSON.stringify(receipt),
        );
      this.#emit({
        inventory,
        targets,
        receipt,
        message: this.#state.pending
          ? "Có lệnh chưa rõ kết quả. Thử lại để đối chiếu với máy chủ."
          : "Kho đã đồng bộ với máy chủ.",
      });
    } catch {
      if (generation === this.#generation && refresh === this.#refresh)
        this.#emit({ message: "Chưa tải được kho. Bấm Đồng bộ để thử lại." });
    }
  }
  async act(target: DevRewardTarget): Promise<void> {
    if (
      this.#state.busy ||
      this.#state.pending ||
      !this.#state.inventory ||
      !target.available ||
      target.policyPending ||
      (target.kind === "chest" && this.#state.inventory.keys === "0")
    )
      return;
    const command: RewardPreparationCommand = {
      key: this.#uuid(),
      kind: target.kind === "chest" ? "open_chest" : "use_unistop",
      targetId: target.targetId,
      ruleVersion: REWARD_PREPARATION_VERSION,
    };
    try {
      this.#storage.setItem(
        this.#key(this.#token, "pending"),
        JSON.stringify(command),
      );
    } catch {
      this.#emit({
        message:
          "Không lưu được mã lệnh. Hãy bật lưu trữ trình duyệt trước khi nhận thưởng.",
      });
      return;
    }
    this.#emit({ pending: command });
    await this.retry();
  }
  async retry(): Promise<void> {
    const command = this.#state.pending;
    const client = this.#client;
    if (!command || !client || this.#state.busy) return;
    const generation = this.#generation;
    const token = this.#token;
    this.#refresh++;
    this.#emit({ busy: true, message: "Đang chờ máy chủ xác nhận…" });
    try {
      const result = await client.apply(command);
      const saved = this.#storage.getItem(this.#key(token, "pending"));
      if (saved && parseRewardCommand(JSON.parse(saved)).key === command.key) {
        this.#storage.removeItem(this.#key(token, "pending"));
        this.#storage.setItem(
          this.#key(token, "receipt"),
          JSON.stringify(result.receipt),
        );
      }
      if (generation !== this.#generation) return;
      this.#emit({
        busy: false,
        pending: undefined,
        receipt: result.receipt,
        message:
          result.kind === "replay"
            ? "Đã đối chiếu lệnh cũ; không nhận thêm thưởng."
            : "Máy chủ đã xử lý lệnh.",
      });
      this.#committed(token);
      await this.refresh();
    } catch {
      if (generation === this.#generation)
        this.#emit({
          busy: false,
          message:
            "Chưa rõ kết quả. Thử lại cùng mã lệnh; không tạo lượt nhận mới.",
        });
    }
  }
}
