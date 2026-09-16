#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { allSkillDocs } from "@open-now/skill-docs";
import { loadConfig } from "../config.js";
import { InstanceGateway } from "../gateway/instance.js";
import { createKernel } from "../kernel/kernel.js";
import { SessionStore } from "../auth/session-store.js";
import { createMcpServer } from "../server/mcp.js";
import { createHttpServer } from "../server/http.js";

const USAGE = `open-now — headless MCP kernel for ServiceNow

Usage: open-now [--transport stdio|http] [--port N] [--domain itsm] [--config path.json]

Environment:
  OPEN_NOW_INSTANCE_URL   ServiceNow instance (e.g. https://dev123456.service-now.com)
  OPEN_NOW_ACCESS_TOKEN   static per-user token for stdio mode (or SNOW_ACCESS_TOKEN)
  OPEN_NOW_TRANSPORT      stdio | http
  OPEN_NOW_PORT           http port (default 8787)
  OPEN_NOW_DOMAIN         expose sn.<domain>.* skills as tools instead of the kernel
  OPEN_NOW_OAUTH_CLIENT_ID  OAuth application registry client id (http mode)
`;

export async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const configPath = flag(args, "--config");
  let config;
  try {
    config = loadConfig(process.env, configPath);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
  const domain = flag(args, "--domain") ?? config.domain;

  if (config.transport === "http") {
    const store = new SessionStore(config.dbPath);
    const server = createHttpServer({
      config: { ...config, domain },
      sessionStore: store,
      docs: allSkillDocs,
      toolkit: config.toolkit,
    });
    console.log(`open-now MCP listening on ${server.url}/mcp (sign in at ${server.url}/oauth/authorize)`);
    return 0;
  }

  const staticToken =
    process.env.OPEN_NOW_ACCESS_TOKEN ?? process.env.SNOW_ACCESS_TOKEN;
  const gateway = new InstanceGateway({
    baseUrl: config.instanceUrl,
    tokenProvider: staticToken ? async () => staticToken : undefined,
  });
  const kernel = createKernel(gateway, { clientApp: "open-now-stdio" });
  const server = createMcpServer({
    name: "open-now",
    version: "0.1.0",
    kernel,
    gateway,
    domain,
    docs: allSkillDocs,
    toolkit: config.toolkit,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return 0;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (import.meta.main) {
  process.exitCode = await main();
}
