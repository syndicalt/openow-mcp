import type {
  AuditRun,
  DescribePayload,
  DiscoverResult,
  FocusedPayload,
  InvokeRequest,
  InvokeResponse,
  RawRequest,
} from "@open-now/contracts";

/**
 * Trust boundary abstraction. All capability access in the kernel flows through
 * a SnowGateway; the instance-side runtime is the only production
 * implementation (InstanceGateway). MockGateway keeps CI offline.
 */
export interface SnowGateway {
  discover(q: string, limit?: number): Promise<DiscoverResult>;
  describe(skillId: string): Promise<DescribePayload>;
  invoke(req: InvokeRequest): Promise<InvokeResponse>;
  raw(req: RawRequest): Promise<FocusedPayload>;
  getRun?(requestId: string): Promise<AuditRun | undefined>;
  close?(): Promise<void>;
}

/** A failed instance round-trip (401/403/404/5xx + transport errors). */
export class GatewayError extends Error {
  constructor(
    public readonly status: number | null,
    message: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}
