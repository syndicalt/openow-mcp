import { TABLE_TOOLKIT_READ_TABLES } from "@open-now/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkillDoc } from "@open-now/contracts";
import type { SnowGateway } from "../gateway/gateway.js";
import type { Kernel } from "../kernel/kernel.js";
import { KERNEL_TOOL_SPECS } from "../kernel/tools.js";
import { createDomainToolset } from "../domains/domain.js";
import { createToolkitTools, createGeneratedTableTools } from "../kernel/toolkit.js";

export interface ToolkitOptions {
  /** generic (default): 10 generic table/record/script tools; table: per-table generated tools; off: none */
  mode?: "generic" | "table" | "off";
  tableTools?: string[];
}

export interface McpServerOptions {
  name: string;
  version: string;
  kernel: Kernel;
  /** Required to expose the toolkit surface (generic + generated table tools). */
  gateway?: SnowGateway;
  domain?: string;
  docs?: SkillDoc[];
  toolkit?: ToolkitOptions;
}

export function createMcpServer(opts: McpServerOptions): McpServer {
  const server = new McpServer({ name: opts.name, version: opts.version });
  attachTools(server, opts.kernel);
  if (opts.domain && opts.docs?.length) {
    const set = createDomainToolset(opts.domain, opts.docs, opts.kernel);
    for (const tool of set.tools) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (args, extra) => {
          const res = await tool.handler(args as Record<string, unknown>, extra.sessionId ?? "default");
          return toolResult(res);
        },
      );
    }
  }
  if (opts.gateway) {
    attachToolkitTools(server, opts.gateway, opts.toolkit ?? { mode: "generic" });
  }
  return server;
}

export function attachToolkitTools(
  server: McpServer,
  gateway: SnowGateway,
  toolkit: ToolkitOptions = {},
): void {
  const mode = toolkit.mode ?? "generic";
  if (mode === "off") return;
  if (mode === "generic") {
    for (const tool of createToolkitTools(gateway)) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.schema },
        async (args, extra) => {
          const res = await tool.handler(args as Record<string, unknown>, extra.sessionId ?? "default");
          return toolResult(res);
        },
      );
    }
    return;
  }
  // table mode: generated per-table tools
  const tables =
    toolkit.tableTools?.length
      ? toolkit.tableTools
      : [...TABLE_TOOLKIT_READ_TABLES];
  for (const tool of createGeneratedTableTools(gateway, tables)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args, extra) => {
        const res = await tool.handler(args as Record<string, unknown>, extra.sessionId ?? "default");
        return toolResult(res);
      },
    );
  }
}

/**
 * Registers the four kernel tools on an MCP server. `getSessionId` is only a
 * fallback: the SDK exposes extra.sessionId when the transport provides it.
 */
export function attachTools(
  server: McpServer,
  kernel: Kernel,
  getSessionId?: () => string | undefined,
): void {
  for (const spec of KERNEL_TOOL_SPECS) {
    server.registerTool(
      spec.name,
      { description: spec.description, inputSchema: spec.schema },
      async (args, extra) => {
        const res = await kernel.dispatchTool(
          spec.name,
          args as Record<string, unknown>,
          { sessionId: extra.sessionId ?? getSessionId?.() ?? "default" },
        );
        return toolResult(res);
      },
    );
  }
}

function toolResult(res: {
  ok: boolean;
  text: string;
}): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  return { content: [{ type: "text", text: res.text }], isError: !res.ok };
}
