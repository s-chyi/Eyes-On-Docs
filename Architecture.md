# Architecture

Eyes-On-Docs monitors Microsoft documentation repositories, uses GPT to summarize changes, and notifies via Teams / web / MCP.

Original flow / block diagrams (historical, may not reflect current state):

<img src="./image/README/flow.png" alt="Flow" width="1000">
<img src="./image/README/arc.png" alt="Architecture" width="1000">

## Current deployment (as of 2026-08-07)

Corp non-prod ACA (Nick's `NickShieh-Subscription`, tenant `16b3c013-...`) is the **live production environment** serving `docs.westiedoubao.com` and `mcp.westiedoubao.com`.

```
                     Internet
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
docs.westiedoubao.com  mcp.westiedoubao.com  (both A → 104.208.123.126)
        │               │
        └───────┬───────┘
                ▼
    ACA env cae-eyesondocs-nonprod (eastasia, workload-profiles, VNet-integrated)
                │
    ┌───────────┼──────────────────────┐
    ▼           ▼                      ▼
ca-web       ca-mcp             caj-monitor (cron */2h)
Next.js 14   FastMCP HTTP       Python + GPT
    │           │                      │
    │  (all use UAMI id-eyesondocs-nonprod
    │   → AZURE_CLIENT_ID env → ManagedIdentityCredential)
    │           │                      │
    └───────────┼──────────────────────┘
                ▼
    Cosmos DB cosmos-eyesondocs-nonprod
    (private endpoint only, publicNetworkAccess=Disabled,
     accessed via privatelink DNS zone through VNet)
```

## Components

| Component | Runtime | Auth to Cosmos | Notes |
|---|---|---|---|
| `ca-eyesondocs-web-nonprod` | Next.js 14, standalone | UAMI + `AZURE_CLIENT_ID` | Serves UI + REST API. Middleware runs on Edge, so Cosmos writes are proxied via `/api/visit` (Node runtime). |
| `ca-eyesondocs-mcp-nonprod` | FastMCP HTTP | UAMI + `AZURE_CLIENT_ID` | MCP tool server. Tools: `get_doc_updates`, `search_updates`, `get_usage_stats` (last requires `DOCS_USAGE_ADMIN_PASSWORD`). |
| `caj-eyesondocs-monitor-nonprod` | Python cron job | UAMI + `AZURE_CLIENT_ID` | Every 2h polls MicrosoftDocs repos, runs GPT, upserts to Cosmos. Uses gpt-4.1-mini via `ai-foundry-jpe.cognitiveservices.azure.com`. |

## Auth architecture

**All three workloads** use the same User-Assigned Managed Identity (UAMI):

- Identity: `id-eyesondocs-nonprod`
  - clientId: `f00cb259-273a-4a13-b7e3-eb38b59beb89`
  - principalId: `0a40e556-f82d-4299-a48b-8f89e343ecb7`
- Env var `AZURE_CLIENT_ID` set to the UAMI clientId (enables `ManagedIdentityCredential(clientId)`)
- Cosmos data-plane role: `Cosmos DB Built-in Data Contributor` at account scope
- ACR: `AcrPull` (and `AcrPush` for CI)

Legacy Service Principal auth (`sp-eyesondocs-nonprod`, appId `194f286e-...`) was **retired 2026-08-07** after its client secret expired. The SP object remains in Entra but is no longer referenced anywhere in ACA or GitHub Actions env.

## Networking

Cosmos has `publicNetworkAccess=Disabled` (corp policy default), so ACA reaches it via:
1. VNet `vnet-eyesondocs-nonprod` (`10.100.0.0/16`)
2. Subnet `snet-aca` (`10.100.0.0/23`) delegated to `Microsoft.App/environments`
3. Private endpoint `pe-cosmos-eyesondocs-nonprod` on `snet-pe` (`10.100.4.0/27`)
4. Private DNS zone `privatelink.documents.azure.com` linked to the VNet, resolving `cosmos-eyesondocs-nonprod` → `10.100.4.4`

Ingress is **public** (both web and mcp accept internet traffic on the ACA env static IP `104.208.123.126`). Custom domain bindings + certs on the ACA env:
- `docs.westiedoubao.com` — uploaded Let's Encrypt cert (`docs-westiedoubao-le`)
- `mcp.westiedoubao.com` — ACA Managed Certificate

## Middleware / Cosmos split (Next 14)

Next.js 14 runs middleware **only on Edge runtime** (`export const runtime = 'nodejs'` is ignored until Next 15.2+ with `experimental.nodeMiddleware`). The `@azure/identity` SDK refuses to load in Edge because it detects the sandbox as "browser".

So `web/src/middleware.ts` does **not** touch Cosmos. Instead:

1. Middleware handles auth redirect + response headers
2. Middleware fires `fetch('/api/visit', {keepalive:true})` — fire-and-forget, no await
3. `web/src/app/api/visit/route.ts` (`export const runtime = 'nodejs'`) receives the POST and writes to Cosmos `eyesondocsUserTraffic` container

Visit-log schema is unchanged, so `/api/usage` statistics (filtered by `path = "/"`) continue to work.

See `.claude/skills/deploy-aca-nonprod.md` step 7 and `web/src/middleware.ts` for detail.

## Data flow

```
Monitor Job (every 2h)
  → poll MicrosoftDocs/{azure-ai-docs-pr, azure-docs} GitHub API
  → filter commits by target_config.json topics
  → GPT summarize each commit (structured or legacy mode)
  → upsert to Cosmos docupdateContainer (status: pending → live via live_sweeper)

Web / MCP
  → query Cosmos docupdateContainer (topic + language + updateType filters)
  → return updates, group by weekly / single

Web middleware
  → fire-and-forget POST /api/visit
  → /api/visit writes visit info to Cosmos eyesondocsUserTraffic container

/api/usage
  → admin-authenticated aggregate queries on eyesondocsUserTraffic
```

## Related resources

- **Foundry**: `ai-foundry-jpe.cognitiveservices.azure.com` (japaneast, rg-eastus) — reuses existing Nick sub deployment `gpt-4.1-mini`. Not built in `rg-eyesondocs` because corp policy blocks new Cognitive Services accounts.
- **Log Analytics**: `log-eyesondocs-nonprod` (30-day retention) — attached to the ACA env for `ContainerAppConsoleLogs_CL`.
- **ACR**: `acreyesondocsnonprod` (Basic tier) — holds `eyesondocs-{web,mcp,monitor}` repositories, tags are git commit shas.

## Historical context

Prior to 2026-07, this ran on Joey's Ubuntu VM `104.40.72.157`. That VM has been deprovisioned. Nick's own Azure subscription also briefly hosted a shadow deployment (`Nick-Subscription`), which was deallocated 2026-07-10.

The corp non-prod ACA setup began 2026-07-07 as a Consumption env, was rebuilt 2026-07-08 as workload-profiles + VNet-integrated to work with corp policy's Cosmos `publicNetworkAccess=Disabled` default, and UAMI Cosmos auth landed 2026-08-07 after the SP secret expired.
