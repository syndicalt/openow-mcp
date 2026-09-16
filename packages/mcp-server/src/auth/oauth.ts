import { createHash, randomBytes, randomUUID } from "node:crypto";

export interface TokenSet {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export interface OAuthClientOptions {
  instanceUrl: string;
  clientId: string;
  redirectUri: string;
  scopes?: string[];
  authorizeEndpoint?: string;
  tokenEndpoint?: string;
  /** injectable for tests */
  fetch?: typeof fetch;
}

export interface OAuthClient {
  generatePkce(): { verifier: string; challenge: string };
  authorizeUrl(state: string, challenge: string): string;
  exchangeCode(code: string, verifier: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
}

/**
 * OAuth 2.0 authorization code + PKCE (public client) against the ServiceNow
 * instance (spec §3.2 step 1, §4.1 interactive pattern). ServiceNow default
 * endpoints: /oauth_auth.do (authorize), /oauth_token.do (token). PKCE S256 —
 * code_verifier 43-128 chars, challenge = base64url(sha256(verifier)).
 */
export function createOAuthClient(opts: OAuthClientOptions): OAuthClient {
  if (!opts.clientId) {
    throw new Error("createOAuthClient: clientId is required");
  }
  const base = opts.instanceUrl.replace(/\/$/, "");
  const authorizeEndpoint = opts.authorizeEndpoint ?? "/oauth_auth.do";
  const tokenEndpoint = opts.tokenEndpoint ?? "/oauth_token.do";
  const fetchImpl = opts.fetch ?? fetch;

  return {
    generatePkce,
    authorizeUrl(state, challenge) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      if (opts.scopes?.length) params.set("scope", opts.scopes.join(" "));
      return `${base}${authorizeEndpoint}?${params.toString()}`;
    },
    async exchangeCode(code, verifier) {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: opts.redirectUri,
        client_id: opts.clientId,
        code_verifier: verifier,
      });
      return token(body, `${base}${tokenEndpoint}`, fetchImpl);
    },
    async refresh(refreshToken) {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: opts.clientId,
      });
      return token(body, `${base}${tokenEndpoint}`, fetchImpl);
    },
  };
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function token(
  body: URLSearchParams,
  endpoint: string,
  fetchImpl: typeof fetch,
): Promise<TokenSet> {
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenSet;
}

export { randomUUID };
