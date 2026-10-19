import type { AdminAccess } from "./adminAccess.ts";
/** Organization membership is independent of the eight competitive school slots. */
export const AMTECH = Object.freeze({
  id: "amtech",
  name: "Đại học AMTECH",
  role: "admin" as const,
  playable: false as const,
  emailDomains: ["amtech-vn.com", "amtech.vn", "dava.vn", "acer.com"] as const,
});

/** Server-side provisioning reference. Never used to authorize a browser claim. */
export const AMTECH_ACCOUNTS = [
  { name: "Châu", email: "minhchau.nguyen@acer.com", vraceId: "1068320088" },
  { name: "Acer Test", email: "acer@amtech.vn", vraceId: "1127137296" },
  { name: "Test 003", email: "test003@amtech.vn", vraceId: "1126593265" },
  { name: "Test 002", email: "test002@amtech.vn", vraceId: "1127114035" },
  { name: "Test 001", email: "test001@amtech.vn", vraceId: "1063995423" },
  { name: "Predador AMTECH", email: "predator@amtech.vn", vraceId: null },
  { name: "AMTECH", email: "leanhtuan@amtech.vn", vraceId: "1127101164" },
  { name: "Predator Dava", email: "predator@dava.vn", vraceId: null },
  { name: "Elephant Test", email: "khang70121@gmail.com", vraceId: null },
  { name: "Diep Le SG", email: "dieplt.sg@gmail.com", vraceId: null },
  { name: "vRace", email: "vrace@amtech.vn", vraceId: "1040591433" },
  { name: "Diep Le", email: "dieplt@dava.vn", vraceId: "1126756024" },
] as const;

/** Call only with identity attributes verified by the signed Portal backend. */
export function isAmtechIdentity(
  email: unknown,
  emailVerified: unknown,
): boolean {
  if (emailVerified !== true || typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254)
    return false;
  return (
    AMTECH_ACCOUNTS.some((a) => a.email === normalized) ||
    AMTECH.emailDomains.some((domain) => normalized.split("@")[1] === domain)
  );
}

export interface AdminPrincipal extends AdminAccess {
  readonly actorId: string;
  readonly name: string;
  readonly organizationId: "amtech";
  readonly role: "admin";
  readonly playable: false;
}
