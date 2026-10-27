import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import { GAME_CONFIG } from "../../shared/gameplay/gameConfig.ts";
import { PortalError } from "./PortalSignature.ts";

const exec = promisify(execFile);
export type CampaignBackup = (db: PoolClient) => Promise<string>;
/** A full, private, verified backup must exist before destructive reset. */
export const createCampaignBackup: CampaignBackup = async (db) => {
  const dir = "/var/backups/r2pl-admin-resets";
  const file = `${dir}/campaign-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.dump`;
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const info = await stat(dir);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0)
      throw Error("unsafe backup directory");
    const cp = (
      db as PoolClient & {
        connectionParameters: {
          host: string;
          port: number;
          user: string;
          database: string;
          password?: string;
          ssl?: unknown;
        };
      }
    ).connectionParameters;
    if (
      !cp?.host ||
      !cp.port ||
      !cp.user ||
      !cp.database ||
      (cp.ssl && !process.env.PGSSLMODE)
    )
      throw Error("unsupported database backup configuration");
    const env = {
      ...process.env,
      PGHOST: cp.host,
      PGPORT: String(cp.port),
      PGUSER: cp.user,
      PGDATABASE: cp.database,
      ...(cp.password ? { PGPASSWORD: cp.password } : {}),
    };
    const handle = await open(file, "wx", 0o600);
    await handle.close();
    await exec("pg_dump", ["-Fc", "-f", file], {
      env,
      timeout: GAME_CONFIG.campaignAdmin.backupTimeoutMs,
      maxBuffer: 1024 * 1024,
    });
    await exec("pg_restore", ["--list", file], {
      env,
      timeout: GAME_CONFIG.campaignAdmin.backupTimeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return file;
  } catch {
    await unlink(file).catch(() => {});
    throw new PortalError(503, "BACKUP_FAILED");
  }
};
