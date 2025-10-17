/**
 * MCP OAuth 2.1 Implementation
 * 
 * This module implements OAuth 2.1 authorization for the MCP server,
 * delegating to an external authorization server.
 * 
 * Based on: docs/mcp/AUTH.md
 */

const EXTERNAL_AUTH_SERVER = "https://95ff0861-0a5c-4be4-80e0-98fb03764264-00-3oqp1uegjygry.janeway.replit.dev";

export interface OAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  code_challenge_methods_supported: string[];
}

/**
 * Returns OAuth 2.0 Authorization Server Metadata (RFC8414)
 * This tells MCP clients where to find the OAuth endpoints
 */
export function getOAuthMetadata(): OAuthMetadata {
  console.log("[MCP OAuth] Generating OAuth metadata discovery response");
  console.log("[MCP OAuth] External auth server:", EXTERNAL_AUTH_SERVER);
  
  const metadata: OAuthMetadata = {
    // The issuer identifier - this is the external auth server
    issuer: EXTERNAL_AUTH_SERVER,
    
    // Authorization endpoint for OAuth authorization code flow
    authorization_endpoint: `${EXTERNAL_AUTH_SERVER}/authorize`,
    
    // Token endpoint for exchanging codes and refreshing tokens
    token_endpoint: `${EXTERNAL_AUTH_SERVER}/token`,
    
    // Dynamic client registration endpoint (RFC7591)
    registration_endpoint: `${EXTERNAL_AUTH_SERVER}/register`,
    
    // Supported response types (authorization code flow)
    response_types_supported: ["code"],
    
    // Supported grant types
    grant_types_supported: [
      "authorization_code",
      "refresh_token",
      "client_credentials"
    ],
    
    // Token endpoint authentication methods
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none" // For public clients with PKCE
    ],
    
    // PKCE is REQUIRED per OAuth 2.1
    code_challenge_methods_supported: ["S256"]
  };
  
  console.log("[MCP OAuth] Metadata generated:", JSON.stringify(metadata, null, 2));
  
  return metadata;
}

/**
 * Validates a Bearer token from the Authorization header
 * 
 * @param request - The incoming HTTP request
 * @returns null if valid, or an error Response if invalid
 */
export async function validateMcpBearerToken(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get("Authorization");
  
  console.log("[MCP OAuth] Validating bearer token for request:", request.url);
  console.log("[MCP OAuth] Authorization header present:", !!authHeader);
  
  if (!authHeader) {
    console.log("[MCP OAuth] No Authorization header - returning 401");
    return createUnauthorizedResponse("Bearer token required");
  }
  
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    console.log("[MCP OAuth] Invalid Authorization header format:", authHeader);
    return createUnauthorizedResponse("Invalid Authorization header format");
  }
  
  const token = parts[1];
  console.log("[MCP OAuth] Token extracted (first 20 chars):", token.substring(0, 20) + "...");
  
  // Validate the token against the external auth server
  try {
    console.log("[MCP OAuth] Validating token with external auth server:", EXTERNAL_AUTH_SERVER);
    
    // Call the auth server's token introspection endpoint
    // This is a standard OAuth 2.0 feature (RFC7662)
    const introspectionUrl = `${EXTERNAL_AUTH_SERVER}/introspect`;
    console.log("[MCP OAuth] Calling introspection endpoint:", introspectionUrl);
    
    const response = await fetch(introspectionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `token=${encodeURIComponent(token)}`,
    });
    
    console.log("[MCP OAuth] Introspection response status:", response.status);
    
    if (!response.ok) {
      console.log("[MCP OAuth] Introspection failed with status:", response.status);
      const errorText = await response.text();
      console.log("[MCP OAuth] Error response:", errorText);
      return createUnauthorizedResponse("Token validation failed");
    }
    
    const introspection = await response.json() as { active: boolean; exp?: number; scope?: string };
    console.log("[MCP OAuth] Introspection result:", JSON.stringify(introspection, null, 2));
    
    if (!introspection.active) {
      console.log("[MCP OAuth] Token is not active (expired or revoked)");
      return createUnauthorizedResponse("Token is not active");
    }
    
    console.log("[MCP OAuth] Token is valid! Proceeding with request");
    
    // Token is valid - return null to allow the request to proceed
    return null;
    
  } catch (error) {
    console.error("[MCP OAuth] Error validating token:", error);
    return createUnauthorizedResponse("Token validation error");
  }
}

/**
 * Creates a 401 Unauthorized response with proper OAuth error formatting
 * 
 * The WWW-Authenticate header's realm MUST point to the OAuth server's
 * protected resource metadata endpoint, which then points to the authorization server.
 */
function createUnauthorizedResponse(message: string): Response {
  console.log("[MCP OAuth] Creating 401 Unauthorized response:", message);
  
  // Per MCP OAuth spec: realm should point to /.well-known/oauth-protected-resource
  const realm = `${EXTERNAL_AUTH_SERVER}/.well-known/oauth-protected-resource`;
  console.log("[MCP OAuth] Setting WWW-Authenticate realm to:", realm);
  
  return new Response(
    JSON.stringify({
      error: "unauthorized",
      error_description: message,
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        // WWW-Authenticate header triggers OAuth flow in MCP clients
        // The realm URL points to the protected resource metadata
        "WWW-Authenticate": `Bearer realm="${realm}"`,
      },
    }
  );
}

