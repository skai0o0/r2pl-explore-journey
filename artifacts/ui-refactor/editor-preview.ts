import { randomUUID } from "node:crypto";
process.env.EDITOR_CAMPAIGN_ID = randomUUID();
process.env.EDITOR_PORT = "4184";
process.env.EDITOR_WS_PORT = "2575";
process.env.EDITOR_LOGIN_PORT = "4185";
await import("../../scripts/play-editor.ts");
