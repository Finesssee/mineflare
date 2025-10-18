# MCP OAuth Implementation Status

## What We've Implemented (MCP Server Side)

### ✅ Step 1: OAuth Metadata Discovery Endpoint
**Location:** `src/agent.ts` + `src/server/mcp-oauth.ts`

The MCP server now handles:
- `GET /.well-known/oauth-authorization-server` - Returns metadata pointing to your external auth server

**Response Format:**
```json
{
  "issuer": "https://95ff0861-0a5c-4be4-80e0-98fb03764264-00-3oqp1uegjygry.janeway.replit.dev",
  "authorization_endpoint": "https://.../authorize",
  "token_endpoint": "https://.../token",
  "registration_endpoint": "https://.../register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
  "code_challenge_methods_supported": ["S256"]
}
```

### ✅ Step 2: 401 Unauthorized Response
**Location:** `src/server/mcp-oauth.ts` - `createUnauthorizedResponse()`

When MCP requests come without valid Bearer tokens, we return:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="https://95ff0861-0a5c-4be4-80e0-98fb03764264-00-3oqp1uegjygry.janeway.replit.dev/.well-known/oauth-protected-resource"
Content-Type: application/json

{
  "error": "unauthorized",
  "error_description": "Bearer token required"
}
```

### ✅ Step 3: Bearer Token Validation
**Location:** `src/server/mcp-oauth.ts` - `validateMcpBearerToken()`

Every MCP request is checked for:
1. Presence of `Authorization: Bearer <token>` header
2. Token validation via external auth server's `/introspect` endpoint

**Extensive Logging Includes:**
- Request URL and headers
- Token extraction and validation steps
- Introspection endpoint calls
- Success/failure reasons

## What Your Auth Server Must Provide

### 🔴 REQUIRED: OAuth Protected Resource Metadata
**Endpoint:** `GET /.well-known/oauth-protected-resource`

This is what ChatGPT/Claude will fetch when they see the 401 response.

**Required Response:**
```json
{
  "resource": "https://YOUR_MCP_SERVER/.well-known/oauth-protected-resource",
  "authorization_servers": [
    "https://95ff0861-0a5c-4be4-80e0-98fb03764264-00-3oqp1uegjygry.janeway.replit.dev"
  ]
}
```

### 🔴 REQUIRED: OAuth Authorization Server Metadata
**Endpoint:** `GET /.well-known/oauth-authorization-server`

Already mentioned above - your auth server needs this to tell clients about your OAuth endpoints.

### 🔴 REQUIRED: Dynamic Client Registration (RFC7591)
**Endpoint:** `POST /register`

MCP clients will call this to obtain a client_id automatically.

**Request Example:**
```json
{
  "client_name": "Claude Desktop",
  "client_uri": "https://claude.ai",
  "redirect_uris": ["http://localhost:PORT/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

**Response Example:**
```json
{
  "client_id": "generated-client-id-123",
  "client_id_issued_at": 1234567890,
  "registration_access_token": "...",
  "registration_client_uri": "https://.../register/client-id-123"
}
```

### 🔴 REQUIRED: Authorization Endpoint
**Endpoint:** `GET /authorize`

Standard OAuth 2.1 authorization endpoint with PKCE support.

**Query Parameters:**
- `response_type=code`
- `client_id=...`
- `redirect_uri=...`
- `code_challenge=...` (PKCE)
- `code_challenge_method=S256`
- `state=...`
- `scope=...` (optional)

### 🔴 REQUIRED: Token Endpoint
**Endpoint:** `POST /token`

Exchanges authorization codes for access tokens.

**For Authorization Code:**
```
grant_type=authorization_code
code=...
redirect_uri=...
client_id=...
code_verifier=... (PKCE)
```

**For Refresh Token:**
```
grant_type=refresh_token
refresh_token=...
client_id=...
```

### 🔴 REQUIRED: Token Introspection Endpoint
**Endpoint:** `POST /introspect`

Our MCP server calls this to validate Bearer tokens.

**Request:**
```
Content-Type: application/x-www-form-urlencoded

token=eyJhbGc...
```

**Response:**
```json
{
  "active": true,
  "exp": 1234567890,
  "scope": "read write",
  "client_id": "...",
  "sub": "user-id"
}
```

## OAuth Flow Summary

```
1. MCP Client (Claude/ChatGPT) → MCP Server (no token)
   ↓
2. MCP Server → 401 + WWW-Authenticate: Bearer realm="...oauth-protected-resource"
   ↓
3. MCP Client → GET /.well-known/oauth-protected-resource (on auth server)
   ↓
4. Auth Server → Returns authorization_servers list
   ↓
5. MCP Client → GET /.well-known/oauth-authorization-server (on auth server)
   ↓
6. Auth Server → Returns OAuth endpoints
   ↓
7. MCP Client → POST /register (dynamic client registration)
   ↓
8. Auth Server → Returns client_id
   ↓
9. MCP Client → Opens browser to /authorize?...&code_challenge=...
   ↓
10. User authorizes in browser
    ↓
11. Auth Server → Redirects to callback with authorization code
    ↓
12. MCP Client → POST /token with code + code_verifier
    ↓
13. Auth Server → Returns access_token + refresh_token
    ↓
14. MCP Client → Retries original request with Authorization: Bearer <token>
    ↓
15. MCP Server → Validates token via /introspect → Success!
```

## Testing the Implementation

### Test 1: Metadata Discovery
```bash
curl https://YOUR_MCP_SERVER/.well-known/oauth-authorization-server
```

Should return OAuth metadata pointing to your auth server.

### Test 2: Unauthorized Request
```bash
curl -i https://YOUR_MCP_SERVER/
```

Should return 401 with WWW-Authenticate header.

### Test 3: With Valid Token
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" https://YOUR_MCP_SERVER/
```

Should validate token and proceed (or return proper error if token invalid).

## Logging

All OAuth operations are extensively logged with the `[MCP OAuth]` prefix:
- Metadata requests
- Token validation attempts
- Introspection endpoint calls
- Success/failure reasons
- Full request/response details

Check your Cloudflare Workers logs to trace the OAuth flow.


