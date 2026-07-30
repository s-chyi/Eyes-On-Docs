# UAMI Migration — Web-side Failure Postmortem

**Date**: 2026-07-30 (Nick timezone)
**Impact**: 2 x 500 Internal Server Error incidents on `https://docs.westiedoubao.com/`, each ~5 min.
**Discovery**: user (Nick) saw 500 page in browser.

## Timeline

- 2026-07-28 09:XX  UAMI migration deployed to non-prod (all 3 workloads)
- 2026-07-28 09:XX  All probes green: web `/api/updates` 200, Monitor Job Succeeded, MCP 406
- ...~40h gap where nobody hit `/` (root Next.js page) via a code path that triggered SSR + Cosmos client instantiation...
- 2026-07-30 02:03 UTC  Nick opens https://docs.westiedoubao.com/, sees 500
- 2026-07-30 02:10 UTC  Rollback #1: web image → `c363b24` + SP env vars back. Site restored.
- 2026-07-30 02:20 UTC  Fix attempt: `DefaultAzureCredential` → explicit `ManagedIdentityCredential` chain. CI green, redeployed.
- 2026-07-30 02:22 UTC  Same error under `ManagedIdentityCredential` — `/` still 500 (`/api/updates` 200!).
- 2026-07-30 02:23 UTC  Rollback #2: web back to SP secret. Site restored again.

## Root cause (as much as we understand)

Both `DefaultAzureCredential` and `ManagedIdentityCredential` from `@azure/identity` throw:
```
Error: <ClassName> is not supported in the browser.
Use InteractiveBrowserCredential instead.
```

under Next.js 14 SSR runtime on ACA — even though we're running on Node.js.

Key clue: **`/api/updates` returned 200** but **`/` returned 500** on the *same* deployment. Both go through the same `getCosmosClient()` singleton. Difference:
- `/api/updates` is a Route Handler (`app/api/**/route.ts`) — pure server-side.
- `/` is a page (`app/page.tsx`) with SSR — Next.js may pre-render or serialize props / execute in a hybrid RSC environment where `@azure/identity` internal environment detection mis-fires.

`@azure/identity` uses `typeof window !== 'undefined'` or similar to detect browser vs Node. Under some Next.js RSC bundling, that check returns truthy → the credential class throws.

## What was NOT the cause

- ✅ UAMI Cosmos role assignment (verified — Python Monitor Job auth OK)
- ✅ ACA `AZURE_CLIENT_ID` env wiring (verified — API routes work)
- ✅ CosmosClient constructor path (same client works for `/api/updates`)

## What worked

- Python side: `DefaultAzureCredential` in `cosmosdb_client.py` — Monitor Job execution `jk8bn1d` Succeeded, cosmos client init OK, no auth error.
- Node.js API routes: Cosmos calls from `app/api/*/route.ts` work under UAMI (proven by 200 response after env cutover).

## What did NOT work

- Node.js page rendering (`app/page.tsx`) — throws 500 during SSR because `@azure/identity` credential class throws browser-support error.

## Current state (2026-07-30 02:24 UTC)

- Web: SP secret (image `c363b24`, rev `--0000016`, env `APP_TENANT_ID/CLIENT_ID/SECRET`) ✅
- MCP: UAMI (image `2928b2b`, rev `--0000010`, `AZURE_CLIENT_ID` env) ✅
- Monitor Job: UAMI ✅
- SP secret expire: **2026-08-06** (~7 days away) — must rotate OR fix web UAMI by then.

## Next steps (any of)

### Option A: Just rotate SP secret next week
Give up on web UAMI. Rotate SP secret manually or via script. Live with monthly rotation loop. **Least effort, no upside**.

### Option B: Fix Next.js SSR + @azure/identity
Approaches:
1. **webpack externals**: mark `@azure/identity` as server-only in `next.config.mjs`, force it into the Node.js bundle path.
2. **dynamic import**: `const { ManagedIdentityCredential } = await import('@azure/identity')` inside `getCosmosClient()` — defers evaluation past module load.
3. **REST auth**: skip `@azure/identity` entirely, hit `http://169.254.169.254/metadata/identity/oauth2/token` (IMDS) yourself, feed Bearer token to Cosmos SDK via `TokenCredential` interface implemented by hand. Small custom credential class, no browser detection.
4. **Server component boundary**: mark `getCosmosClient()`'s callers with `import 'server-only'` and use `'use server'` boundaries to keep `@azure/identity` out of RSC serialization.

Recommend: **Option 3** — hand-rolled IMDS `TokenCredential` — smallest surface, no bundler concerns, well-documented pattern in Azure docs.

### Option C: Split web app
Move all Cosmos calls to `/api/*` route handlers only. Never touch Cosmos in `app/page.tsx` SSR. Requires refactoring pages that currently server-render with Cosmos data.

## Lessons

1. **UAMI on Node.js is not one-size-fits-all** — Route Handlers ≠ SSR pages.
2. **Smoke test must hit all code paths that use the credential**, not just `/api/products` (which has a fallback branch).
3. **@azure/identity has known bundler quirks** — check the SDK issues before assuming client-class swap works.
4. **Keep old ACA revisions** — auto-cleanup at revision 12 → 11 lost meant no `az containerapp revision copy` rollback available; had to find image tag manually.

## Files affected

- `web/src/lib/cosmos.ts` — reverted current tree back to `DefaultAzureCredential` NOT, actually still has `ManagedIdentityCredential` — since web is on old image `c363b24` (SP secret code), the current tree code doesn't actually run in prod. Leave the fix in place for next attempt.
- `cosmosdb_client.py` — kept UAMI (works).
- `.github/workflows/aca-deploy.yml` — kept UAMI (create path only, update path just updates image so no live impact).
