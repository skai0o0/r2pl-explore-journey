export class R2plPartnerClient {
  constructor(config: { origin: string; campaignId: string; keyId: string; secret: string; timeoutMs?: number });
  request(operation: string, payload: unknown): Promise<Record<string, unknown>>;
}
