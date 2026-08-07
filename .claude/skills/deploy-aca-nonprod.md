# Skill: Deploy to ACA Non-Prod

Deploy latest code from local master to corp non-prod ACA (Nick's environment). Covers image build, revision rollout, verification, and UAMI-based Cosmos auth.

## Environment context

- **Subscription**: `NickShieh-Subscription` (`937c6f45-ca76-4b29-8f60-e9cf566f6d2e`)
- **Tenant**: corp non-prod (`16b3c013-d300-468d-ac64-7eda0820b6d3`)
- **Resource group**: `rg-eyesondocs` (eastasia)
- **ACR**: `acreyesondocsnonprod.azurecr.io`
- **ACA env**: `cae-eyesondocs-nonprod` (workload-profiles, VNet-integrated)
- **Public domains**:
  - `docs.westiedoubao.com` → web ACA
  - `mcp.westiedoubao.com` → mcp ACA
- **Static IP**: `104.208.123.126`
- **UAMI**: `id-eyesondocs-nonprod` (clientId `f00cb259-273a-4a13-b7e3-eb38b59beb89`)

Three workloads:
- `ca-eyesondocs-web-nonprod` — Next.js web UI
- `ca-eyesondocs-mcp-nonprod` — MCP server
- `caj-eyesondocs-monitor-nonprod` — monitor cron job (every 2h)

## Prerequisites

- Local Windows Git Bash, `az cli` at `/c/Program Files (x86)/Microsoft SDKs/Azure/CLI2/wbin/az.cmd`
- `az login` with account that has access to the `NickShieh-Subscription`
- Local master committed (per shared-repo rules: **do NOT push origin**, fork only)

Set PATH once per shell:

```bash
export PATH="/c/Program Files (x86)/Microsoft SDKs/Azure/CLI2/wbin:$PATH"
az account set --subscription "NickShieh-Subscription"
```

## Step 1: Commit code changes locally

Per collaboration rules ([[collaboration-shared-repo]] in memory), Nick does NOT push origin or open PRs. Commit to local master (fork remote optional).

```bash
cd C:/Project/Eyes-On-Docs
git status
git add <files>
git commit -m "..."
```

Note the commit sha — it becomes the image tag.

## Step 2: Build image on ACR

Use `az acr build` from repo root (Dockerfile paths are `Dockerfile.web`, `Dockerfile.mcp`, `Dockerfile.monitor`). Build context is repo root because target_config.json needs to be baked in.

```bash
cd C:/Project/Eyes-On-Docs
COMMIT=$(git rev-parse HEAD)

# web image
az acr build \
  --registry acreyesondocsnonprod \
  --image "eyesondocs-web:$COMMIT" \
  --image "eyesondocs-web:latest" \
  --file Dockerfile.web \
  .

# mcp / monitor — swap Dockerfile + image name
```

**Gotcha (Windows-only)**: if `az acr build` errors with `WinError 1921` about nested `web/node_modules/doc-update-notification-web/...`, run `rm C:/Project/Eyes-On-Docs/web/node_modules/doc-update-notification-web` (single self-symlink) and retry. Detail in memory [[web-node-modules-self-symlink-trap]].

Build takes ~3 min (web), less for mcp/monitor. Output shows `Successfully pushed image: acreyesondocsnonprod.azurecr.io/eyesondocs-web:<tag>`.

## Step 3: Update ACA to new image

```bash
COMMIT=$(git rev-parse HEAD)
RG=rg-eyesondocs

az containerapp update -n ca-eyesondocs-web-nonprod -g $RG \
  --image "acreyesondocsnonprod.azurecr.io/eyesondocs-web:$COMMIT"
```

A new revision (e.g. `ca-eyesondocs-web-nonprod--0000023`) is created and (in Single revision mode) receives 100% traffic immediately.

**If in Multiple revision mode** (some workloads are, historically): must flip traffic manually:
```bash
az containerapp ingress traffic set -n <app> -g $RG --revision-weight <new-rev>=100
```

## Step 4: Verify revision is healthy

```bash
az containerapp revision list -n ca-eyesondocs-web-nonprod -g $RG \
  --query "[?properties.active].{name:name,health:properties.healthState,traffic:properties.trafficWeight,image:properties.template.containers[0].image}" \
  -o table
```

`healthState=Healthy` + traffic 100 + image tag matches your commit = deployed.

## Step 5: End-to-end smoke test

```bash
# web
curl -sS -o /dev/null -w "GET / => %{http_code}\n" "https://docs.westiedoubao.com/"
# expected 307 (redirect to /auth) or 200 if already signed in

curl -sS "https://docs.westiedoubao.com/api/updates?product=AOAI-V2&language=Chinese&page=1&updateType=single" | head -c 500
# expected JSON with "updates":[...]

# mcp
curl -sS -o /dev/null -w "POST /mcp => %{http_code}\n" -X POST "https://mcp.westiedoubao.com/mcp" \
  -H "content-type: application/json" -d '{}'
# expected 405/406 (method/headers wrong but service alive)
```

If `/api/updates` returns AAD error → check UAMI config (Step 6).

## Step 6: UAMI + Cosmos configuration (reference)

**All three workloads should have this exact setup for Cosmos to work:**

- **Identity**: UserAssigned = `id-eyesondocs-nonprod`
- **Env var**: `AZURE_CLIENT_ID=f00cb259-273a-4a13-b7e3-eb38b59beb89` (required for `ManagedIdentityCredential(clientId)`)
- **Cosmos data-plane role**: UAMI has `Cosmos DB Built-in Data Contributor` (roleDef `00000000-0000-0000-0000-000000000002`) at account scope

Verify:
```bash
az containerapp show -n ca-eyesondocs-web-nonprod -g $RG \
  --query "{identity:identity.userAssignedIdentities,clientIdEnv:properties.template.containers[0].env[?name=='AZURE_CLIENT_ID']}" -o json

az cosmosdb sql role assignment list --account-name cosmos-eyesondocs-nonprod -g $RG \
  --query "[?principalId=='0a40e556-f82d-4299-a48b-8f89e343ecb7']"
```

**Do NOT have** these on any workload (leftover from old SP-based auth):
- env vars `APP_TENANT_ID`, `APP_CLIENT_ID`, `APP_CLIENT_SECRET`
- secrets `app-tenant-id`, `app-client-id`, `app-client-secret`

If found, remove:
```bash
az containerapp update -n <app> -g $RG --remove-env-vars APP_TENANT_ID APP_CLIENT_ID APP_CLIENT_SECRET
az containerapp secret remove -n <app> -g $RG --secret-names app-tenant-id app-client-id app-client-secret
```

## Step 7: Diagnose failures

**500 error on `/api/updates` with `AADSTS7000222` (SP secret expired)**:
Root cause: workload is running old SP-based image, or `APP_CLIENT_SECRET` env still points to expired SP secret. Deploy latest image + verify Step 6.

**500 error on `/` with `ManagedIdentityCredential is not supported in the browser`**:
Root cause: middleware.ts is trying to use `@azure/identity` on Next 14 Edge runtime. See memory [[web-middleware-cosmos-split]] and [[aca-lessons-learned]] (J). Requires code fix, not config change.

**503 or replicas=0**:
```bash
az containerapp logs show -n <app> -g $RG --tail 100
```
Look for exceptions during startup. Common: env var missing, Cosmos endpoint unreachable (VNet/PE issue), image pull failure (ACR role missing).

**Cosmos returns empty but no error**:
Verify DB + container names match. UAMI is scoped to account, but Cosmos SDK 4xx if container missing:
```bash
az containerapp show -n <app> -g $RG \
  --query "properties.template.containers[0].env[?contains(name,'COSMOSDB')]" -o table
```

## Rollback

To pin traffic back to a known-good revision:
```bash
az containerapp ingress traffic set -n <app> -g $RG --revision-weight <known-good-rev>=100
```

Or redeploy old image tag:
```bash
az containerapp update -n <app> -g $RG \
  --image "acreyesondocsnonprod.azurecr.io/eyesondocs-web:<old-commit-sha>"
```

Available image tags:
```bash
az acr repository show-tags -n acreyesondocsnonprod --repository eyesondocs-web --orderby time_desc --top 10 -o tsv
```

## Cross-reference

- [Architecture.md](../../Architecture.md) — overall system diagram + component roles
- Memory [[corp-nonprod-aca-facts]] — complete resource inventory
- Memory [[aca-lessons-learned]] — gotchas & tribal knowledge from migration
- Memory [[web-middleware-cosmos-split]] — why middleware doesn't touch Cosmos directly
- [deploy-vm.md](./deploy-vm.md) — legacy VM deploy path (Joey's old prod, mostly decommissioned)
