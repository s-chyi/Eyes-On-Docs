# UAMI Migration — Rollback Steps

**Deployed**: 2026-07-28 (commit `75ec3e0`, CI run `30346076266`)
**Current revisions**:
- web `ca-eyesondocs-web-nonprod--0000012` (UAMI, Healthy)
- mcp `ca-eyesondocs-mcp-nonprod--0000010` (UAMI, Healthy)
- monitor job image tag with UAMI code (execution `jk8bn1d` Succeeded, Cosmos client init OK)

**Prior stable revisions**:
- web `ca-eyesondocs-web-nonprod--0000011` (SP secret, `NEXTAUTH_URL` fixed to docs.westiedoubao.com)
- mcp `ca-eyesondocs-mcp-nonprod--0000009` (SP secret)

## Rollback if UAMI breaks

### 1. Re-add SP env vars on all 3 workloads

```bash
python -c "
import subprocess, shutil
az = shutil.which('az.cmd') or 'az'
SUB = '937c6f45-ca76-4b29-8f60-e9cf566f6d2e'
RG = 'rg-eyesondocs'

# secret refs already exist (app-tenant-id, app-client-id, app-client-secret) — only env vars removed.
# Re-add them and remove AZURE_CLIENT_ID.

for app in ['ca-eyesondocs-web-nonprod','ca-eyesondocs-mcp-nonprod']:
    r = subprocess.run([az,'containerapp','update','-n',app,'-g',RG,'--subscription',SUB,
        '--set-env-vars',
            'APP_TENANT_ID=secretref:app-tenant-id',
            'APP_CLIENT_ID=secretref:app-client-id',
            'APP_CLIENT_SECRET=secretref:app-client-secret',
        '--remove-env-vars','AZURE_CLIENT_ID'
    ], capture_output=True, text=True)
    print(app, 'rc:', r.returncode, r.stderr[:200])

r = subprocess.run([az,'containerapp','job','update','-n','caj-eyesondocs-monitor-nonprod','-g',RG,'--subscription',SUB,
    '--set-env-vars',
        'APP_TENANT_ID=secretref:app-tenant-id',
        'APP_CLIENT_ID=secretref:app-client-id',
        'APP_CLIENT_SECRET=secretref:app-client-secret',
    '--remove-env-vars','AZURE_CLIENT_ID'
], capture_output=True, text=True)
print('monitor', 'rc:', r.returncode, r.stderr[:200])
"
```

### 2. Revert code + push

```bash
git revert 75ec3e0
git push fork master
# CI will build image with old ClientSecretCredential code
```

Or bypass CI faster: `az containerapp update --image acreyesondocsnonprod.azurecr.io/eyesondocs-web:<older-tag>` for each workload.

## Cleanup after 30d observation (no rollback needed)

### 3. Remove ACA secret refs (SP tenant/client/secret)

az CLI 沒有 `remove-single-secret`。要用 `--replace-secrets` 傳剩下的 8 個(每個 workload 不同)。或用 REST API `PUT`。或最省事 — 直接讓 CI 重跑一次:CI 已不寫這 3 個 secret、若走 create path 就沒了、但走 update path 只換 image、secret 保留。所以要不:
- 選 A: 手動 `--replace-secrets` 一次(繁瑣、每個 workload 8 個 secret 都要重列)
- 選 B: `az containerapp delete` 再讓 CI create 一次(不推薦、動 traffic)
- 選 C: 就留著、無害(secret 只在 workload 定義裡、沒被 env ref、不會被讀)

**推薦 C** — 留著、無 runtime 影響。

### 4. Remove GH env `non-prod` secrets

```bash
gh secret delete APP_TENANT_ID -R s-chyi/Eyes-On-Docs --env non-prod
gh secret delete APP_CLIENT_ID -R s-chyi/Eyes-On-Docs --env non-prod
gh secret delete APP_CLIENT_SECRET -R s-chyi/Eyes-On-Docs --env non-prod
```

### 5. Remove SP `sp-eyesondocs-nonprod` role assignment on Cosmos

```bash
python -c "
import subprocess, shutil
az = shutil.which('az.cmd') or 'az'
# SP principalId
r = subprocess.run([az,'ad','sp','show','--id','194f286e-fa14-4a81-8645-a64fce71fa5a','--query','id','-o','tsv'], capture_output=True, text=True)
sp_pid = r.stdout.strip()
# find assignment
r = subprocess.run([az,'cosmosdb','sql','role','assignment','list',
    '--account-name','cosmos-eyesondocs-nonprod','-g','rg-eyesondocs',
    '--subscription','937c6f45-ca76-4b29-8f60-e9cf566f6d2e','-o','json'], capture_output=True, text=True)
import json
for a in json.loads(r.stdout):
    if a.get('principalId','').lower() == sp_pid.lower():
        print('remove:', a['name'])
        subprocess.run([az,'cosmosdb','sql','role','assignment','delete',
            '--account-name','cosmos-eyesondocs-nonprod','-g','rg-eyesondocs',
            '--subscription','937c6f45-ca76-4b29-8f60-e9cf566f6d2e',
            '--role-assignment-id', a['name'], '--yes'])
"
```

### 6. Delete App Registration `sp-eyesondocs-nonprod` (optional)

```bash
az ad app delete --id 194f286e-fa14-4a81-8645-a64fce71fa5a
```

Skip if you still use SP for cross-tenant scripts (e.g. `.claude/tmp/cosmos_backfill.py`).

## What did NOT need rotation anymore

- ~~SP secret 30d~~ ✅ 死了、UAMI 免 rotate
- PAT 8d 還在(GitHub API 不吃 MI)

## Next steps if 30d clean

- Delete `.env-nonprod` from local(裡面 SP secret 已無用)
- Update memory `[[corp-nonprod-aca-facts]]` 移除 SP secret 段
