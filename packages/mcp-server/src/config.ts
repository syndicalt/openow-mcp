import { readFileSync } from "node:fs";

export type Transport = "stdio" | "http";

export interface OAuthConfig {
  clientId: string;
  redirectUri: string;
  scopes?: string[];
  authorizeEndpoint?: string;
  tokenEndpoint?: string;
}

export interface OpenNowConfig {
  instanceUrl: string;
  transport: Transport;
  port?: number;
  /** Hard requirement: dispatch of write-class skills must be preceded by describe in-session. */
  requireDescribe?: boolean;
  /** Domain mode: expose `sn.<domain>.*` skills as tools (e.g. "itsm"). */
  domain?: string;
  enabledSkills?: string[];
  dbPath?: string;
  oauth?: OAuthConfig;
}

export type Env = Record<string, string | undefined>;

export function loadConfig(
  env: Env = globalThis.Bun?.env ?? {},
  filePath?: string,
): OpenNowConfig {
  const file = filePath
    ? (JSON.parse(readFileSync(filePath, "utf8")) as Partial<OpenNowConfig>)
    : {};
  const fromFile = file;

  const instanceUrl =
    env.OPEN_NOW_INSTANCE_URL ?? env.SNOW_INSTANCE ?? fromFile.instanceUrl;
  if (!instanceUrl) {
    throw new Error(
      "OPEN_NOW_INSTANCE_URL (or SNOW_INSTANCE) is required — e.g. https://dev123456.service-now.com",
    );
  }
  const transport: Transport =
    (env.OPEN_NOW_TRANSPORT as Transport | undefined) ??
    fromFile.transport ??
    "stdio";
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`OPEN_NOW_TRANSPORT must be stdio|http, got ${transport}`);
  }

  return {
    instanceUrl: instanceUrl.replace(/\/$/, ""),
    transport,
    port: env.OPEN_NOW_PORT ? Number(env.OPEN_NOW_PORT) : fromFile.port,
    requireDescribe:
      env.OPEN_NOW_REQUIRE_DESCRIBE !== undefined
        ? env.OPEN_NOW_REQUIRE_DESCRIBE === "true"
        : fromFile.requireDescribe,
    domain: env.OPEN_NOW_DOMAIN ?? fromFile.domain,
    enabledSkills: env.OPEN_NOW_ENABLED_SKILLS
      ? env.OPEN_NOW_ENABLED_SKILLS.split(",").map((s) => s.trim())
      : fromFile.enabledSkills,
    dbPath: env.OPEN_NOW_DB_PATH ?? fromFile.dbPath,
    oauth: {
      clientId: env.OPEN_NOW_OAUTH_CLIENT_ID ?? fromFile.oauth?.clientId ?? "",
      redirectUri:
        env.OPEN_NOW_OAUTH_REDIRECT_URI ?? fromFile.oauth?.redirectUri ?? "http://localhost:8787/oauth/callback",
      scopes: env.OPEN_NOW_OAUTH_SCOPES
        ? env.OPEN_NOW_OAUTH_SCOPES.split(",").map((s) => s.trim())
        : fromFile.oauth?.scopes,
      authorizeEndpoint: fromFile.oauth?.authorizeEndpoint,
      tokenEndpoint: fromFile.oauth?.tokenEndpoint,
    },
  };
}
