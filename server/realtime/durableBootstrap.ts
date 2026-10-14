import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { Pool } from "pg";
import type { EvaluateDevExplore } from "../../shared/gameplay/devContract.ts";
import type { SchoolRegistry } from "../../shared/world/registry.ts";
import type { ExploreBoundary } from "../persistence/ExploreBoundary.ts";
import type { FaultHooks } from "../persistence/M3TestMutation.ts";
import { M35FixtureAuthority } from "../persistence/M35FixtureAuthority.ts";
import { DurableRealtimeCore } from "./DurableRealtimeCore.ts";
import { createGatewayRoom } from "./GatewayRoom.ts";
import { SyntheticAuth } from "./SyntheticAuth.ts";

/** Separate test bootstrap; production mutation opcode remains disabled. */
export async function createDurableSyntheticServer(
  pool: Pool,
  campaignId: string,
  registry: SchoolRegistry,
  fixtures: readonly { token: string; actorId: string; schoolSlot: number }[],
  explicitFixtureCost: bigint,
  faultHooks: FaultHooks = {},
  traceCorrelationIds?: ReadonlySet<string>,
  devExplore?: EvaluateDevExplore,
  boundary?: ExploreBoundary,
): Promise<{
  readonly server: Server;
  readonly transport: WebSocketTransport;
  readonly core: DurableRealtimeCore;
  readonly authority: M35FixtureAuthority;
}> {
  const authority = new M35FixtureAuthority(
    pool,
    campaignId,
    explicitFixtureCost,
    faultHooks,
    devExplore,
    boundary,
  );
  await authority.validateCampaign(registry);
  const core = new DurableRealtimeCore(authority, {
    ...(traceCorrelationIds ? { traceCorrelationIds } : {}),
  });
  const auth = new SyntheticAuth(registry, fixtures);
  const transport = new WebSocketTransport();
  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
  });
  server.define("m2", createGatewayRoom(core, auth));
  core.startRelay();
  return { server, transport, core, authority };
}
