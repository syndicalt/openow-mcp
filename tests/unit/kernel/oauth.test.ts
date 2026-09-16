import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createOAuthClient } from "@open-now/mcp-server";

describe("OAuth PKCE client", () => {
  const client = createOAuthClient({
    instanceUrl: "https://dev123456.service-now.com",
    clientId: "open-now-app",
    redirectUri: "http://localhost:8787/oauth/callback",
    scopes: ["useraccounts"],
  });

  test("generates a verifier/challenge pair with S256", () => {
    const { verifier, challenge } = client.generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
    expect(challenge).not.toContain("=");
  });

  test("RFC 7636 Appendix B challenge vector holds", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("authorizeUrl carries PKCE params against ServiceNow endpoints", () => {
    const url = new URL(client.authorizeUrl("state-1", "challenge-1"));
    expect(url.origin).toBe("https://dev123456.service-now.com");
    expect(url.pathname).toBe("/oauth_auth.do");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("open-now-app");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("useraccounts");
  });

  test("exchangeCode posts code_verifier to the token endpoint", async () => {
    let captured: { url: string; body: URLSearchParams } | undefined;
    const mockFetch = async (url: string, init: RequestInit) => {
      captured = { url, body: new URLSearchParams(String(init.body)) };
      return new Response(
        JSON.stringify({ access_token: "tok", token_type: "Bearer", refresh_token: "rt" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const c = createOAuthClient({
      instanceUrl: "https://dev123456.service-now.com",
      clientId: "id",
      redirectUri: "http://localhost/cb",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const token = await c.exchangeCode("code-1", "verifier-1");
    expect(token.access_token).toBe("tok");
    expect(captured?.url).toBe("https://dev123456.service-now.com/oauth_token.do");
    expect(captured?.body.get("grant_type")).toBe("authorization_code");
    expect(captured?.body.get("code_verifier")).toBe("verifier-1");
    expect(captured?.body.get("code")).toBe("code-1");
    expect(captured?.body.get("client_id")).toBe("id");
  });

  test("refresh uses the refresh grant", async () => {
    let body: URLSearchParams | undefined;
    const mockFetch = async (_url: string, init: RequestInit) => {
      body = new URLSearchParams(String(init.body));
      return new Response(JSON.stringify({ access_token: "new", token_type: "Bearer" }), { status: 200 });
    };
    const c = createOAuthClient({
      instanceUrl: "https://x.service-now.com",
      clientId: "id",
      redirectUri: "http://localhost/cb",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const token = await c.refresh("refresh-1");
    expect(token.access_token).toBe("new");
    expect(body?.get("grant_type")).toBe("refresh_token");
    expect(body?.get("refresh_token")).toBe("refresh-1");
  });

  test("requires a client id", () => {
    expect(() =>
      createOAuthClient({ instanceUrl: "https://x", clientId: "", redirectUri: "http://l" }),
    ).toThrow(/clientId/);
  });
});
