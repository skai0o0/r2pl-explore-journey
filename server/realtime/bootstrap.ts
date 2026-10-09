import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { SchoolRegistry } from "../../shared/world/registry.ts";
import { WorldState } from "../../shared/world/world.ts";
import { createGatewayRoom } from "./GatewayRoom.ts";
import { RealtimeCore, type RealtimeCoreOptions } from "./RealtimeCore.ts";
import { SyntheticAuth } from "./SyntheticAuth.ts";

export interface SyntheticServerFixture {
  readonly server: Server;
  readonly transport: WebSocketTransport;
  readonly core: RealtimeCore;
}

/** Explicit test bootstrap. No production credentials, school roster or durable command path. */
export function createSyntheticServer(
  registry: SchoolRegistry,
  fixtures: readonly { token: string; actorId: string; schoolSlot: number }[],
  options: RealtimeCoreOptions = {},
): SyntheticServerFixture {
  const world = new WorldState(registry);
  const core = new RealtimeCore(world, options);
  const auth = new SyntheticAuth(registry, fixtures);
  const transport = new WebSocketTransport();
  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
  });
  server.define("m2", createGatewayRoom(core, auth));
  return { server, transport, core };
}
