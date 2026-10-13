import { fileURLToPath } from "node:url";
import {
  createKnowledgeQaServer,
  createPostgresKnowledgeQa,
} from "../server/qa/KnowledgeQaGatewayV1.ts";

const runtime = await createPostgresKnowledgeQa();
const server = createKnowledgeQaServer(
  runtime.backend,
  fileURLToPath(new URL("../dist/knowledge-qa/", import.meta.url)),
);
try {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(4174, "127.0.0.1", resolve);
  });
} catch {
  await runtime.close();
  throw new Error("Could not bind local QA server on 127.0.0.1:4174");
}
console.log(
  "Synthetic Knowledge QA: http://127.0.0.1:4174 — succession and contributions only. UI assets: dist/knowledge-qa. No Shared upkeep, M3 world, external auth or production integration.",
);
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
  await runtime.close();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
