import type {
  DescribePayload,
  DiscoverResult,
  InvokeRequest,
  InvokeResponse,
  SkillDoc,
} from "@open-now/contracts";

export type RpcCall = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface DispatchOptions {
  dryRun?: boolean;
  confirm?: boolean;
  requestId?: string;
}

/**
 * Thin typed client for MCP hosts / plugins (spec §7.3 "thin" distribution
 * wrapper). Translates friendly call shapes to kernel tool args; stores nothing
 * durable about records.
 */
export class OpenNowClient {
  constructor(private readonly rpc: RpcCall) {}

  async discover(q: string, limit = 10): Promise<DiscoverResult> {
    return (await this.rpc("discover", { q, limit })) as DiscoverResult;
  }

  async describe(skillId: string): Promise<DescribePayload> {
    return (await this.rpc("describe", { skillId })) as DescribePayload;
  }

  async dispatch(
    skillId: string,
    inputs: Record<string, unknown> = {},
    opts: DispatchOptions = {},
  ): Promise<InvokeResponse> {
    const args: Record<string, unknown> = {
      skillId,
      inputs,
      ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
      ...(opts.confirm !== undefined ? { confirm: opts.confirm } : {}),
      ...(opts.requestId ? { requestId: opts.requestId } : {}),
    };
    const data = (await this.rpc("dispatch", args)) as { data?: InvokeResponse };
    return (data.data ?? data) as InvokeResponse;
  }

  /** Human-readable diff for a confirmation UI. */
  static formatDiff(resp: InvokeResponse): string {
    if (resp.diff?.length) {
      return resp.diff
        .map((d) => `${d.field}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`)
        .join("\n");
    }
    if (resp.draft) {
      return `${resp.draft.summary}\n${Object.entries(resp.draft.fields)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join("\n")}`;
    }
    return "applied";
  }

  /** One-line record summary for display; uses numbers, never raw dumps. */
  static summarize(doc: SkillDoc, payload: Record<string, unknown>): string {
    const number =
      (payload.number as string | undefined) ??
      (payload.record_numbers as string[] | undefined)?.join(",") ??
      "";
    return `${doc.id}${number ? ` ${number}` : ""}`;
  }
}
