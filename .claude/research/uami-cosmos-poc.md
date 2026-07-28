# UAMI Workload Identity 取代 SP Client Secret — PoC 報告

**Date**: 2026-07-28
**Motivation**: SP `sp-eyesondocs-nonprod` client secret 受 corp policy `9d2624cb-...` 卡 30 天 lifetime、每月要 rotate、忘記 rotate = Cosmos 401 = 網站掛。用 UAMI Workload Identity 免密鑰、免 rotate、免 policy 卡。

## 結論

**可以做、diff 極小、風險低**。基礎設施 100% ready、只需改 code(Python 3 行 / Node.js 3 行)+ 更新 3 個 ACA workload env 和 GH Actions workflow。

---

## 現況盤點

### 1. UAMI 已完備

| 項目 | 值 |
|---|---|
| UAMI resource | `id-eyesondocs-nonprod` |
| clientId | `f00cb259-273a-4a13-b7e3-eb38b59beb89` |
| principalId | `0a40e556-f82d-4299-a48b-8f89e343ecb7` |

### 2. Cosmos data-plane role 已授

`cosmos-eyesondocs-nonprod` 上有兩個 role assignment,都是 `Cosmos DB Built-in Data Contributor`:

| principalId | 對應 | 需不需要保留 |
|---|---|---|
| `0a40e556-...` | UAMI `id-eyesondocs-nonprod` | **要留** |
| `6d908f3f-...` | SP `sp-eyesondocs-nonprod` | 遷完後可刪 |

### 3. 三個 ACA workload 都掛了 UAMI

- `ca-eyesondocs-web-nonprod` ✅
- `ca-eyesondocs-mcp-nonprod` ✅
- `caj-eyesondocs-monitor-nonprod` ✅

### 4. Code 現況

- **Python** (`cosmosdb_client.py:65`) `ClientSecretCredential(tenant_id, client_id, client_secret)` — 讀 `APP_TENANT_ID/APP_CLIENT_ID/APP_CLIENT_SECRET`
- **Node.js** (`web/src/lib/cosmos.ts:26`) 同 pattern
- `web/src/middleware.ts:77` 已標註 Node.js runtime、Edge runtime 不會擋 UAMI

---

## Diff 範圍

### Python `cosmosdb_client.py`
```python
# before
from azure.identity import ClientSecretCredential
credential = ClientSecretCredential(
    tenant_id=self.app_tenant_id,
    client_id=self.app_client_id,
    client_secret=self.app_client_secret
)

# after
from azure.identity import ManagedIdentityCredential
credential = ManagedIdentityCredential(client_id=self.uami_client_id)
```

新增 env: `AZURE_CLIENT_ID` = UAMI clientId `f00cb259-...`(azure-identity 的 `ManagedIdentityCredential` 或 `DefaultAzureCredential` 都能自動吃這個 env)。

### Node.js `web/src/lib/cosmos.ts`
```typescript
// before
import { ClientSecretCredential } from '@azure/identity';
const credential = new ClientSecretCredential(
  process.env.APP_TENANT_ID!,
  process.env.APP_CLIENT_ID!,
  process.env.APP_CLIENT_SECRET!,
);

// after
import { ManagedIdentityCredential } from '@azure/identity';
const credential = new ManagedIdentityCredential({
  clientId: process.env.AZURE_CLIENT_ID!,
});
```

### 更穩妥的替代:用 `DefaultAzureCredential`

一次改成 `DefaultAzureCredential()` 就好、它會依序試 env → workload identity → managed identity → azure cli(本機開發也能通),兩邊 code 統一、也不用改 env name。

代價:credential chain 探測比 explicit `ManagedIdentityCredential` 慢一點(~200ms 冷啟動時)、可接受。

---

## Env 變動

### ACA workload

3 個 workload 現在有 `APP_TENANT_ID` / `APP_CLIENT_ID` / `APP_CLIENT_SECRET`(secret 引用)。改成:
- **移除**: 3 個 env
- **新增**: `AZURE_CLIENT_ID=f00cb259-273a-4a13-b7e3-eb38b59beb89`(UAMI clientId、明文 env、非 secret)

### GitHub Actions env `non-prod`

- **移除 secret**: `APP_CLIENT_SECRET`(不再用)
- **移除 secret**: `APP_TENANT_ID` / `APP_CLIENT_ID`(可選、保留無害)
- **新增 var**: `UAMI_CLIENT_ID` = `f00cb259-...`

`.github/workflows/aca-deploy.yml` 的 `create` path 對 web/mcp/job 三個 workload 各改一次 `--env-vars` 和 `--secrets` 段。

### 本機 `.env-nonprod`

`.claude/tmp/*` script 走本機 SP 認證(跨 corp tenant),那些 script 不影響 runtime,可以保留 SP secret 給本機開發用。或者換成 `az login` + `DefaultAzureCredential`(需要你有 Cosmos DB Data Contributor role assignment 給 nickshieh 這個 upn — 目前沒有、要加)。

---

## 遷移步驟(建議、~1 小時)

1. **PoC 分支**:code 兩個檔改 `DefaultAzureCredential`、build image、push ACR、部到 non-prod web 一個 revision(舊 revision 保留、traffic 0%)
2. **本機測**:`az login` + `AZURE_CLIENT_ID=UAMI-client-id`(要能 override) + `python -c "from cosmosdb_client import ...; connect + list docs"` 通
3. **ACA 測**:新 revision assign 10% traffic、看 Log Analytics 有沒 Cosmos 401、web `/api/updates` 回 200
4. **推 100% traffic**、24h 觀察
5. **Monitor Job**:下一次 execution 用新 image、Cosmos read/write 通
6. **Cleanup**:
   - GH env `non-prod` 移 `APP_CLIENT_SECRET`
   - ACA workload `--remove-env-vars APP_TENANT_ID APP_CLIENT_ID APP_CLIENT_SECRET`
   - 30 天後如果沒回頭、砍 Cosmos role assignment for SP `6d908f3f-...`
   - App Registration `sp-eyesondocs-nonprod` 可保留(其他跨 tenant 用途?)或砍

---

## 風險 / 已知坑

| 風險 | 影響 | 緩解 |
|---|---|---|
| Managed Identity token 有 5-10 min 冷取期(cold call 慢) | web 冷啟動 API 首個 request 慢 200-500ms | web 有 min=1、不會冷啟 |
| `DefaultAzureCredential` 在本機開發要 `az login` 且 upn 要有 Cosmos role | 本機 script 撞 401 | 保留 SP secret env 給本機 fallback、或給 nickshieh 加 role |
| corp policy 對 UAMI 沒卡(2026-07-08 已驗) | 無 | — |
| Windows Git Bash 改 code 時撞轉譯坑 | 部署失敗 | 改 code 不涉及 az CLI 呼叫、正常編輯無風險 |

---

## 相關記憶

- `[[corp-nonprod-aca-facts]]` — SP secret 30 天 policy 出處
- `[[github-pat-msft-oss-policy]]` — 另一個 rotation loop 案例(這個 UAMI 拆不了、GitHub API 不支援 MI)

## 下一步

要做的話,建議先在 fork chore branch 開一個 `chore/uami-cosmos-noSecret` 分支、上面兩個 diff + workflow 改動、CI 部到 non-prod 一個 canary revision 測。要現在就做嗎?
