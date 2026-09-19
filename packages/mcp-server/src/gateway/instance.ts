import type {
  AuditRun,
  DescribePayload,
  DiscoverResult,
  FocusedPayload,
  InvokeRequest,
  InvokeResponse,
  RawRequest,
  ToolkitRequest,
  ToolkitResponse,
} from "@open-now/contracts";
import { GatewayError, type SnowGateway } from "./gateway.js";

export interface InstanceGatewayOptions {
  /** e.g. https://dev123456.service-now.com (no trailing slash). */
  baseUrl: string;
  /** Per-request OAuth/Bearer token source; null means unauthenticated. */
  tokenProvider?: () => Promise<string | null>;
  /** HTTP Basic for PDI / web-service users. Takes precedence over Bearer. */
  basic?: { username: string; password: string };
}

/** Prefer SNOW_USER+SNOW_PASSWORD (PDI basic) over a static bearer token. */
export function instanceAuthFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Pick<InstanceGatewayOptions, "tokenProvider" | "basic"> {
  const user = env.SNOW_USER;
  const password = env.SNOW_PASSWORD;
  if (user && password) return { basic: { username: user, password } };
  const token = env.SNOW_ACCESS_TOKEN ?? env.OPEN_NOW_ACCESS_TOKEN;
  return { tokenProvider: async () => token ?? null };
}

const BASE_PATH = "/api/now/sn_headless";

/**
 * ServiceNow Scripted REST wraps setBody(x) as `{ result: x }`. Unwrap that
 * envelope so callers see the kernel contract (DiscoverResult, etc.).
 */
export function unwrapScriptedRest(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const rec = json as Record<string, unknown>;
  if (!("result" in rec)) return json;
  const looksNative =
    "results" in rec ||
    "outcome" in rec ||
    "available" in rec ||
    "auditId" in rec ||
    "doc" in rec;
  if (looksNative) return json;
  let value: unknown = rec.result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      // keep the string
    }
  }
  return value;
}

/**
 * Calls the in-instance sn_headless Scripted REST surface, which owns the
 * trust model (GlideRecordSecure, ACLs, QueryGuard, audit). The kernel never
 * touches the Table API directly.
 */
export class InstanceGateway implements SnowGateway {
  constructor(private readonly opts: InstanceGatewayOptions) {}

  async discover(q: string, limit = 10): Promise<DiscoverResult> {
    const params = new URLSearchParams({ q });
    if (limit !== 10) params.set("limit", String(limit));
    return this.call<DiscoverResult>(`${BASE_PATH}/discover?${params.toString()}`);
  }

  async describe(skillId: string): Promise<DescribePayload> {
    return this.call<DescribePayload>(
      `${BASE_PATH}/skills/${encodeURIComponent(skillId)}`,
    );
  }

  async invoke(req: InvokeRequest): Promise<InvokeResponse> {
    return this.call<InvokeResponse>(
      `${BASE_PATH}/skills/${encodeURIComponent(req.skillId)}/invoke`,
      { method: "POST", body: JSON.stringify(req) },
    );
  }

  async raw(req: RawRequest): Promise<FocusedPayload> {
    return this.call<FocusedPayload>(`${BASE_PATH}/raw`, {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async toolkit(req: ToolkitRequest): Promise<ToolkitResponse> {
    return this.call<ToolkitResponse>(`${BASE_PATH}/toolkit`, {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async getRun(requestId: string): Promise<AuditRun | undefined> {
    return this.call<AuditRun>(
      `${BASE_PATH}/runs/${encodeURIComponent(requestId)}`,
    );
  }

  async close(): Promise<void> {
    // no persistent resources to release
  }

  private async call<T>(
    path: string,
    init?: { method?: string; body?: string },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.opts.basic) {
      const raw = `${this.opts.basic.username}:${this.opts.basic.password}`;
      headers.Authorization = `Basic ${Buffer.from(raw).toString("base64")}`;
    } else {
      const token = await this.opts.tokenProvider?.();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await fetch(`${this.opts.baseUrl}${path}`, {
        method: init?.method ?? "GET",
        headers,
        body: init?.body,
      });
    } catch (err) {
      throw new GatewayError(
        null,
        `cannot reach ServiceNow at ${this.opts.baseUrl}: ${(err as Error).message}`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GatewayError(
        res.status,
        `ServiceNow returned ${res.status} for ${path}${body ? `: ${body.slice(0, 500)}` : ""}`,
        body,
      );
    }
    return unwrapScriptedRest(await res.json()) as T;
  }
}
