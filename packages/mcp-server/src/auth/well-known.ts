/**
 * Minimal OAuth metadata for MCP clients that perform discovery
 * (RFC 8414 + RFC 9728 shapes as consumed by MCP hosts). Our server acts as an
 * authorization front-end: the token we mint is the session id (opaque), and
 * the instance token lives server-side in the SessionStore.
 */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: ["S256"];
}

export function authorizationServerMetadata(
  issuer: string,
  authorizeEndpoint: string,
  tokenEndpoint: string,
  _scopes: string[],
): AuthorizationServerMetadata {
  return {
    issuer,
    authorization_endpoint: authorizeEndpoint,
    token_endpoint: tokenEndpoint,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
  };
}

export interface ProtectedResourceMetadata {
  resource: string;
  scopes_supported: string[];
}

export function protectedResourceMetadata(
  resource: string,
  scopes: string[],
): ProtectedResourceMetadata {
  return { resource, scopes_supported: scopes };
}
