export type CompetitiveSchoolId = "hcmut" | "ou" | "dtu" | "hpuni" | "hsu" | "huce" | "ntu" | "hcmiu";
export type VerifiedMemberInput = {
  externalStudentId: string;
  displayName: string;
  active: boolean;
} & ({ schoolId: CompetitiveSchoolId; eduVerified: true; email?: string; emailVerified?: boolean } | { schoolId: "amtech" | CompetitiveSchoolId; email: string; emailVerified: true; eduVerified?: boolean });
export interface ProvisionedMember {
  externalStudentId: string;
  schoolId: CompetitiveSchoolId | null;
  organizationId?: "amtech";
  role: "user" | "admin";
  playable: boolean;
  active: boolean;
}
export class R2plPartnerClient {
  constructor(config: { origin: string; campaignId: string; keyId: string; secret: string; timeoutMs?: number });
  request(operation: string, payload: unknown): Promise<Record<string, unknown>>;
  provisionMember(payload: VerifiedMemberInput): Promise<ProvisionedMember>;
}
