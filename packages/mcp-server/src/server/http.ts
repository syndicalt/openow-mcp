import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenNowConfig } from "../config.js";
import { createOAuthClient, type OAuthClient } from "../auth/oauth.js";
import { SessionStore, SessionTokenProvider } from "../auth/session-store.js";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from "../auth/well-known.js";
import { InstanceGateway, type InstanceGatewayOptions } from "../gateway/instance.js";
import type { SnowGateway } from "../gateway/gateway.js";
import type { Kernel } from "../kernel/kernel.js";
import { createKernel } from "../kernel/kernel.js";
import { createMcpServer } from "./mcp.js";

export interface HttpServerOptions {
  config: OpenNowConfig;
  /** Factory so each MCP session gets its own Kernel (describe state is per-session). Defaults to createKernel(gateway). */
  createSessionKernel?: (sessionId: string, gateway: SnowGateway) => Kernel;
  /** Override; defaults to an InstanceGateway over the configured OAuth session. */
  gatewayForSession?: (sessionId: string) => SnowGateway;
  oauth?: OAuthClient;
  sessionStore?: SessionStore;
  docs?: import("@open-now/contracts").SkillDoc[];
}

/** The subset of Bun.serve's handle this module uses (port + graceful stop). */
export interface ServeHandle {
  port?: number;
  stop(closeActiveConnections?: boolean): Promise<void>;
}

export interface RunningHttpServer {
  url: string;
  stop(): Promise<void>;
}

interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
}

/**
 * Streamable HTTP MCP server + OAuth authorization front-end (spec §3.2):
 * user signs in against ServiceNow (PKCE), the token is bound to the session,
 * and every /mcp request carries the session id via `Mcp-Session-Id` header or
 * `Authorization: Bearer <sessionId>`.
 */
export function createHttpServer(
  opts: HttpServerOptions,
): RunningHttpServer {
  const { config } = opts;
  const base = config.instanceUrl;
  const oauth: OAuthClient =
    opts.oauth ??
    createOAuthClient({
      instanceUrl: base,
      clientId: config.oauth?.clientId ?? "",
      redirectUri: config.oauth?.redirectUri ?? "http://localhost:8787/oauth/callback",
    });
  const store = opts.sessionStore ?? new SessionStore(config.dbPath);
  const sessions = new Map<string, SessionEntry>();
  let server: ServeHandle | undefined;

  const gatewayFor =
    opts.gatewayForSession ??
    ((sessionId: string): SnowGateway => {
      const provider = new SessionTokenProvider(
        store,
        () => sessionId,
      );
      const gwOpts: InstanceGatewayOptions = {
        baseUrl: base,
        tokenProvider: () => provider.token(),
      };
      return new InstanceGateway(gwOpts);
    });

  function makeEntry(sessionId: string): SessionEntry {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });
    const gateway = gatewayFor(sessionId);
    const kernel =
      opts.createSessionKernel?.(sessionId, gateway) ?? createKernel(gateway, { clientApp: "open-now-http" });
    const server = createMcpServer({
      name: "open-now",
      version: "0.1.0",
      kernel,
      domain: config.domain,
      docs: opts.docs,
    });
    void server.connect(transport);
    transport.onclose = () => sessions.delete(sessionId);
    return { transport, server };
  }

  function currentSessionId(req: Request): string | undefined {
    const header = req.headers.get("mcp-session-id");
    if (header) return header;
    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
    return undefined;
  }

  server = Bun.serve({
    port: config.port ?? 8787,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return json(
          authorizationServerMetadata(
            `${origin(req)}`,
            "/oauth/authorize",
            "/oauth/token",
            config.oauth?.scopes ?? ["useraccounts"],
          ),
        );
      }
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        return json(
          protectedResourceMetadata(`${origin(req)}`, config.oauth?.scopes ?? []),
        );
      }
      if (url.pathname === "/oauth/authorize" && req.method === "GET") {
        const state = url.searchParams.get("state") ?? randomUUID();
        const challenge = url.searchParams.get("code_challenge");
        const verifier = url.searchParams.get("code_verifier") ?? oauth.generatePkce().verifier;
        const challenge2 =
          challenge ?? oauth.generatePkce().challenge;
        const authUrl = oauth.authorizeUrl(state, challenge2);
        return new Response(null, {
          status: 302,
          headers: {
            Location: authUrl,
            "Set-Cookie": `open_now_verifier=${verifier}; Path=/; HttpOnly; SameSite=Lax`,
          },
        });
      }
      if (url.pathname === "/oauth/callback" && req.method === "GET") {
        const code = url.searchParams.get("code");
        const cookie = req.headers.get("cookie") ?? "";
        const verifier = /open_now_verifier=([^;]+)/.exec(cookie)?.[1];
        if (!code) return json({ error: "missing code" }, 400);
        if (!verifier) return json({ error: "missing pkce verifier (error state?" }, 400);
        const tokenSet = await oauth.exchangeCode(code, verifier);
        const sessionId = randomUUID();
        store.create({
          sessionId,
          userSysId: tokenSet.scope ?? "user",
          userName: "user",
          accessToken: tokenSet.access_token,
          refreshToken: tokenSet.refresh_token,
          createdAt: new Date().toISOString(),
        });
        return html(sessionId);
      }
      if (url.pathname === "/oauth/token" && req.method === "POST") {
        const body = new URLSearchParams(await req.text());
        const grant = body.get("grant_type");
        const verifier = body.get("code_verifier") ?? "";
        if (grant === "authorization_code") {
          const code = body.get("code") ?? "";
          const tokenSet = await oauth.exchangeCode(code, verifier);
          const sessionId = randomUUID();
          store.create({
            sessionId,
            userSysId: sessionId,
            userName: "user",
            accessToken: tokenSet.access_token,
            refreshToken: tokenSet.refresh_token,
            createdAt: new Date().toISOString(),
          });
          return json({ access_token: sessionId, token_type: "Bearer", expires_in: 3600 });
        }
        return json({ error: "unsupported_grant_type" }, 400);
      }

      if (url.pathname === "/mcp") {
        const sessionId = currentSessionId(req) ?? randomUUID();
        let entry = sessions.get(sessionId);
        if (!entry) {
          entry = makeEntry(sessionId);
          sessions.set(sessionId, entry);
        }
        const transport = entry.transport;
        const response = await transport.handleRequest(req);
        // Stateful session id is echoed so the client can return it.
        if (!response.headers.has("mcp-session-id") && transport.sessionId) {
          response.headers.set("mcp-session-id", transport.sessionId);
        }
        return response;
      }

      return json({ error: "not found" }, 404);
    },
  });

  return {
    get url() {
      return `http://127.0.0.1:${server?.port ?? config.port ?? 8787}`;
    },
    async stop() {
      await server!.stop(true);
      for (const s of sessions.values()) s.transport.close();
      sessions.clear();
      store.close();
    },
  };
}

function origin(req: Request): string {
  return new URL(req.url).origin;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function html(sessionId: string): Response {
  return new Response(
    `<!doctype html><html><body><h1>Open Now connected</h1><p>Session <code>${sessionId}</code> — paste this as the MCP session id / Bearer token.</p></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
