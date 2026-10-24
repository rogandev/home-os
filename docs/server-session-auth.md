# Owner session gateway — draft, not ready for production

Browser requests use /api/data. A server-only bearer is forwarded to the fixed Railway API after an Auth0 owner session check. Explicit app route/method allowlists and same-origin checks restrict forwarding. This does not add upstream per-client scopes. FORM and connector credentials are unchanged.

## Required setup (separate approval)

Create an isolated Auth0 confidential Regular Web Application: authorization_code with PKCE S256, client_secret_basic, RS256, scope openid only. Verify the intended owner's immutable subject independently. No API audience, refresh token, offline_access or management grants. Configure Production-only server variables AUTH_ISSUER_URL, AUTH_CLIENT_ID, AUTH_CLIENT_SECRET, AUTH_SESSION_SECRET, AUTH_ALLOWED_SUBJECT, AUTH_BASE_URL, ROGAN_API_TOKEN. Never prefix secrets with VITE_. Client/session secrets must be unique per app; session secret must be cryptographically random (at least 32 random bytes encoded as base64url or hex).

The production origin is fixed in api/gateway.js. Auth0 allowed callback is that origin plus /api/auth/callback. Provider logout URLs, web origins and CORS origins need no entries for this server-side flow. App-local POST /api/auth/logout clears its own cookie and returns to /. Provider SSO remains active. Session cookies are Secure, HttpOnly, host-only, SameSite Lax with a one-hour absolute lifetime. Stateless cookies copied before logout remain valid until expiry; centralized revocation is not implemented. Preview deployments fail closed, including when production configuration is accidentally inherited.

## Verification and release gates

Run npm test, npm run test:auth and npm run build. Auth tests use a synthetic issuer and verify signature/claims, exact owner, cookies, expiry/logout, CSRF, route/method restrictions, no retry and browser bearer removal. Browser fixtures simulate sessions only in test code.

Before merging: verify actual Vercel function packaging/rewrites, sign-in with the intended owner and denial of another account, and all real consumer/payload constraints. Vercel Functions have a 4.5 MB request/response cap. Requests above 4,000,000 bytes are rejected locally before transmission. Large Trello migrations/exports and large unpaginated datasets require a separate compatible design or measured evidence; no truncation or blind splitting is acceptable. Real provider configuration and payload sizes have not been tested.

The review branch has git.deploymentEnabled:false only for codex/server-session-auth-review, preventing automatic preview deployment. Other branches retain their existing behavior. No live credentials/settings are configured by this change.

Coordinate shared API replacement only after every active consumer is accounted for. Keep Railway's staged replacement unapplied until then. Do not restore an exposed bearer or browser-token build as rollback. Keep a verified secure build with fresh credentials, or fail closed and repair forward. Reconcile uncertain writes before retrying. Existing persistent records, feature flags and connector scopes stay unchanged. Home OS must retain its public URL settings used for its prior IndexedDB journal namespace.
