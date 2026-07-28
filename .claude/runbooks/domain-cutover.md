# Domain Cutover Runbook — westiedoubao.com → ACA (corp non-prod)

**Owner**: Nick (@s-chyi) + Joey
**Target**: 把 `docs.westiedoubao.com` + `mcp.westiedoubao.com` 從 Joey VM 遷到 ACA `cae-eyesondocs-nonprod`,對 web 用戶完全無感、MCP 用戶只改一次 config。

---

## 資源速查

| 項目 | 值 |
|---|---|
| ACA env | `cae-eyesondocs-nonprod` (rg-eyesondocs, sub `937c6f45-ca76-4b29-8f60-e9cf566f6d2e`) |
| ACA env staticIp | **`104.208.123.126`** |
| ACA env defaultDomain | `livelycoast-9bb618a7.eastasia.azurecontainerapps.io` |
| Web app FQDN | `ca-eyesondocs-web-nonprod.livelycoast-9bb618a7.eastasia.azurecontainerapps.io` |
| MCP app FQDN | `ca-eyesondocs-mcp-nonprod.livelycoast-9bb618a7.eastasia.azurecontainerapps.io` |
| ACA env asuid (TXT 驗證值) | `AC7404E0B5F623084AF9E4E1F4AA76E75B04EC0BB392327DD70CDB0BD8A2F2B4` |
| DNS zone owner | Joey (Azure DNS, in his sub) |
| Joey VM | `104.40.72.157`(Standard_B2s、跑他個人多個 side project) |
| 現有 web hostname | `docs.westiedoubao.com` |
| 新 MCP hostname | `mcp.westiedoubao.com`(新增) |
| Cert 現況 | Let's Encrypt E7,SAN `docs.westiedoubao.com`,到期 2026-08-23 |

## 目前狀態(2026-07-28)

- [x] **Phase 0.1** — ACA hostname add 拿 TXT 值 ✅
- [x] **Phase 0.2** — Application Insights `appi-eyesondocs-nonprod` + 4 條 Alert 已建 ✅
- [ ] Phase 1 — Joey 加 DNS
- [ ] Phase 2 — Nick bind hostname + BYO cert
- [ ] Phase 3 — 通知 5 個 MCP 用戶
- [ ] Phase 4 — Web cutover
- [ ] Phase 5 — 收尾

---

## Phase 1 — Joey 加 DNS(合併 A 的一部分)

**執行者**: Joey
**用戶影響**: 零
**Wait time**: 加完後等 1 小時 DNS propagate

### Joey 動作

到 Azure Portal / az CLI、在 DNS zone `westiedoubao.com` 加 3 條 record:

| Type | Name | Value | TTL |
|---|---|---|---|
| TXT | `asuid.docs` | `AC7404E0B5F623084AF9E4E1F4AA76E75B04EC0BB392327DD70CDB0BD8A2F2B4` | 3600 |
| TXT | `asuid.mcp` | `AC7404E0B5F623084AF9E4E1F4AA76E75B04EC0BB392327DD70CDB0BD8A2F2B4` | 3600 |
| CNAME | `mcp` | `ca-eyesondocs-mcp-nonprod.livelycoast-9bb618a7.eastasia.azurecontainerapps.io` | 300 |

**都是新增、不改任何現有 record。docs.westiedoubao.com 的 A record 不動、你的 GTJA/53ai 完全不受影響。**

az CLI 版本(Joey 到他 sub 執行):
```bash
# 假設 zone 在 rg-<Joey 的>、Joey 的 sub
ZONE_RG=<Joey DNS zone RG>
ZONE=westiedoubao.com
ASUID=AC7404E0B5F623084AF9E4E1F4AA76E75B04EC0BB392327DD70CDB0BD8A2F2B4

az network dns record-set txt add-record -g $ZONE_RG -z $ZONE -n asuid.docs -v $ASUID
az network dns record-set txt add-record -g $ZONE_RG -z $ZONE -n asuid.mcp  -v $ASUID
az network dns record-set cname set-record -g $ZONE_RG -z $ZONE -n mcp \
  -c ca-eyesondocs-mcp-nonprod.livelycoast-9bb618a7.eastasia.azurecontainerapps.io
```

### Nick 驗證(Joey 做完後)

```bash
# 等 5-10 分鐘 propagate 後
dig +short TXT asuid.docs.westiedoubao.com
dig +short TXT asuid.mcp.westiedoubao.com
dig +short CNAME mcp.westiedoubao.com
# 三個都應該回對應值
```

### Rollback

Joey 用 `az network dns record-set {txt,cname} delete` 或 portal 刪掉這 3 條、DNS zone 回到原狀。零 side effect。

---

## Phase 2.1 — Nick bind MCP hostname + Managed Cert

**執行者**: Nick
**用戶影響**: 零
**Wait time**: 綁完後 Managed Cert 頒發 15-30 分鐘

```bash
python -c "
import subprocess, shutil
az = shutil.which('az.cmd') or 'az'
r = subprocess.run([az,'containerapp','hostname','add',
    '-n','ca-eyesondocs-mcp-nonprod',
    '-g','rg-eyesondocs',
    '--subscription','937c6f45-ca76-4b29-8f60-e9cf566f6d2e',
    '--hostname','mcp.westiedoubao.com'], capture_output=True, text=True)
print('add rc:', r.returncode); print(r.stdout[:300]); print(r.stderr[:300])
"
# 這次應該過(TXT + CNAME 都在了)

python -c "
import subprocess, shutil
az = shutil.which('az.cmd') or 'az'
r = subprocess.run([az,'containerapp','hostname','bind',
    '-n','ca-eyesondocs-mcp-nonprod',
    '-g','rg-eyesondocs',
    '--subscription','937c6f45-ca76-4b29-8f60-e9cf566f6d2e',
    '--hostname','mcp.westiedoubao.com',
    '--environment','cae-eyesondocs-nonprod',
    '--validation-method','CNAME'], capture_output=True, text=True)
print('bind rc:', r.returncode); print(r.stdout[:400]); print(r.stderr[:400])
"
```

### 驗證

```bash
# Managed Cert 頒發完(15-30 分鐘)後
curl -v https://mcp.westiedoubao.com/mcp 2>&1 | grep -E "subject|issuer|HTTP/"
# 期望:
#   subject: CN=mcp.westiedoubao.com
#   issuer: CN=Microsoft Azure ... 或 DigiCert(Managed Cert)
#   HTTP/2 200 (or 405 若 GET 不 support、代表 route 通)
```

### Rollback

```bash
az containerapp hostname delete -n ca-eyesondocs-mcp-nonprod -g rg-eyesondocs \
  --subscription 937c6f45-ca76-4b29-8f60-e9cf566f6d2e --hostname mcp.westiedoubao.com --yes
```

---

## Phase 2.2 — 匯出 Let's Encrypt cert 上傳 ACA(BYO cert 給 web)

**執行者**: Joey(匯出)+ Nick(上傳綁定)
**用戶影響**: 零(docs A record 還沒動)
**為什麼要做**: `docs.westiedoubao.com` 現在還指 Joey VM、ACA 無法自己頒 Managed Cert(HTTP-01 拿不到 challenge)。用 Joey 現有的 Let's Encrypt cert 預先綁完、Phase 4 改 A record 那一刻就能無縫接管、**避免 15-30 分鐘 cert 破窗**。Phase 5 再換成 Managed Cert 讓 Microsoft 自動 renew。

### Joey 匯出

在他 VM 上執行:
```bash
sudo tar -czf /tmp/docs-westiedoubao-cert-$(date +%Y%m%d).tar.gz \
  /etc/letsencrypt/live/docs.westiedoubao.com/ \
  /etc/letsencrypt/archive/docs.westiedoubao.com/
sudo chown joey:joey /tmp/docs-westiedoubao-cert-*.tar.gz
```

### 傳送管道(**待決定**)

- **選項 A**: Azure Key Vault(Joey upload cert + secret,授權 Nick 讀。最安全)
- **選項 B**: 加密 tar.gz + 分開傳 password(Signal/Teams DM)
- **選項 C**: 當面 USB / SSH scp within 內網

### Nick 上傳

```bash
# 解壓
tar -xzf docs-westiedoubao-cert-YYYYMMDD.tar.gz

# 轉 PFX(自訂密碼 PFX_PASS,含大小寫數字符號、記到 Key Vault)
PFX_PASS='<自訂密碼>'
openssl pkcs12 -export \
  -in etc/letsencrypt/live/docs.westiedoubao.com/fullchain.pem \
  -inkey etc/letsencrypt/live/docs.westiedoubao.com/privkey.pem \
  -out docs-westiedoubao.pfx \
  -passout pass:"$PFX_PASS"

# 上傳到 ACA env certificate store
python -c "
import subprocess, shutil, os
az = shutil.which('az.cmd') or 'az'
r = subprocess.run([az,'containerapp','env','certificate','upload',
    '-n','cae-eyesondocs-nonprod',
    '-g','rg-eyesondocs',
    '--subscription','937c6f45-ca76-4b29-8f60-e9cf566f6d2e',
    '--certificate-file','docs-westiedoubao.pfx',
    '--password', os.environ['PFX_PASS']], capture_output=True, text=True)
print(r.returncode); print(r.stdout[:500]); print(r.stderr[:300])
"

# 記下輸出的 cert name(類似 docs-westiedoubao-le)

# 綁 web hostname 用這張 BYO cert
python -c "
import subprocess, shutil
az = shutil.which('az.cmd') or 'az'
r = subprocess.run([az,'containerapp','hostname','add',
    '-n','ca-eyesondocs-web-nonprod',
    '-g','rg-eyesondocs',
    '--subscription','937c6f45-ca76-4b29-8f60-e9cf566f6d2e',
    '--hostname','docs.westiedoubao.com'], capture_output=True, text=True)
print('add rc:', r.returncode); print(r.stdout[:300]); print(r.stderr[:300])
# 這次會過因為 TXT 已在

r = subprocess.run([az,'containerapp','hostname','bind',
    '-n','ca-eyesondocs-web-nonprod',
    '-g','rg-eyesondocs',
    '--subscription','937c6f45-ca76-4b29-8f60-e9cf566f6d2e',
    '--hostname','docs.westiedoubao.com',
    '--environment','cae-eyesondocs-nonprod',
    '--certificate','<上一步的 cert name>'], capture_output=True, text=True)
print('bind rc:', r.returncode); print(r.stdout[:400]); print(r.stderr[:400])
"
```

### 驗證

```bash
# 因 docs A record 還指 Joey VM、直接 curl 打的是他的 nginx。用 --resolve 手動指 ACA IP 測 ACA 那頭:
curl -v --resolve docs.westiedoubao.com:443:104.208.123.126 \
  https://docs.westiedoubao.com/ 2>&1 | grep -E "subject|issuer|HTTP/"
# 期望:
#   subject: CN=docs.westiedoubao.com
#   issuer: CN=E7 (Let's Encrypt)  ← BYO cert
#   HTTP/2 200
```

### Rollback

```bash
az containerapp hostname delete -n ca-eyesondocs-web-nonprod -g rg-eyesondocs \
  --subscription 937c6f45-ca76-4b29-8f60-e9cf566f6d2e --hostname docs.westiedoubao.com --yes
# cert 上傳的可以留、Phase 5 前不刪
```

---

## Phase 3 — 通知 5 個 MCP 用戶

**執行者**: Nick(通知)+ 用戶(改 config)
**用戶影響**: MCP 用戶改一次 config
**Wait time**: 給 1-2 週

### 通知範本

發給 5 個 MCP 用戶:

```
主旨: [ACTION REQUIRED] Eyes-On-Docs MCP 網址更新 by <YYYY-MM-DD>

Hi <name>,

我們把 Eyes-On-Docs 從 VM 搬到 ACA、MCP URL 有兩個變動:
1. hostname: docs.westiedoubao.com → mcp.westiedoubao.com
2. port: :8001 → 443 (拿掉)

請把 MCP client config 從
    "doc-updates": {"type": "http", "url": "https://docs.westiedoubao.com:8001/mcp"}
改成
    "doc-updates": {"type": "http", "url": "https://mcp.westiedoubao.com/mcp"}

Deadline: <YYYY-MM-DD>(2 週後)。過了那天舊 URL 會關閉、務必先改。
改完後跟我確認一下,我這邊 log 有看到你的流量會回你。

有問題找 Nick / thread。
```

### 追蹤

```bash
# 每天看 mcp.westiedoubao.com 有沒有流量進來
python << 'PY'
import subprocess, shutil, json
az = shutil.which('az.cmd') or 'az'
q = 'ContainerAppConsoleLogs_CL | where ContainerAppName_s == "ca-eyesondocs-mcp-nonprod" | where TimeGenerated > ago(24h) | summarize c=count()'
r = subprocess.run([az,'monitor','log-analytics','query','--workspace','a18607dd-8b0e-4faa-9b34-794814a8f7e3','--analytics-query',q,'-o','json'], capture_output=True, text=True)
print(json.loads(r.stdout))
PY
```

Joey VM `:8001` MCP 流量下降到 0(需 Joey 幫看 `/var/log/nginx/access.log`)。

**進 Phase 4 的前提**: 5 個用戶都確認切完、Joey VM `:8001` 流量 3-5 天為 0。

---

## Phase 4 — Web cutover(合併 B、最關鍵的一刻)

**執行者**: Joey(改 DNS + VM 停 service)+ Nick(驗證)
**用戶影響**: web 用戶 5-10 分鐘 DNS propagate、cert 由 BYO 無縫接管、URL 一字不改
**Wait time**: DNS TTL 300s = 5 分鐘 max
**時段建議**: 週六凌晨 UTC 02:00 / 台灣 10:00(離峰)

### 4.1 Joey 改 A record

```bash
ZONE_RG=<Joey DNS zone RG>
az network dns record-set a update -g $ZONE_RG -z westiedoubao.com -n docs --set ttl=300
az network dns record-set a remove-record -g $ZONE_RG -z westiedoubao.com -n docs -a 104.40.72.157
az network dns record-set a add-record    -g $ZONE_RG -z westiedoubao.com -n docs -a 104.208.123.126
```

### 4.2 Nick 驗證(5 分鐘後)

```bash
# 3 個 DNS resolver 都要對得上
for r in 8.8.8.8 1.1.1.1 168.95.1.1; do
  echo "== $r =="
  dig +short @$r docs.westiedoubao.com
done
# 全部應該回 104.208.123.126

# HTTPS + cert
curl -v https://docs.westiedoubao.com/ 2>&1 | grep -E "subject|issuer|HTTP/"
# 期望: subject CN=docs, issuer Let's Encrypt E7, HTTP/2 200

# 從瀏覽器打開 https://docs.westiedoubao.com 、看到 UI 有資料(從 corp non-prod Cosmos 讀)
```

### 4.3 Joey 停 VM service

```bash
# 停 web nginx site
sudo rm /etc/nginx/sites-enabled/docs.westiedoubao.com
sudo nginx -t && sudo systemctl reload nginx

# 停 MCP :8001 service
sudo systemctl stop eyes-on-docs-mcp.service
sudo systemctl disable eyes-on-docs-mcp.service

# 驗證其他 vhost(GTJA/53ai)還在
sudo nginx -T | grep -E "server_name|listen"
```

### Rollback(Phase 4 出事)

**症狀 1**: 用戶回報 web 打不開或 cert 錯誤
```bash
# Joey 立即 rollback A record(TTL 300s、5 分鐘內恢復)
az network dns record-set a remove-record -g $ZONE_RG -z westiedoubao.com -n docs -a 104.208.123.126
az network dns record-set a add-record    -g $ZONE_RG -z westiedoubao.com -n docs -a 104.40.72.157
```

**症狀 2**: Web 通但資料錯(Cosmos 讀不到)
```bash
# 保持 DNS 指 ACA、修 corp non-prod Cosmos 那邊(SP secret 過期?VNet 問題?)
# 檢查 SP secret expiry:
az ad app credential list --id 194f286e-fa14-4a81-8645-a64fce71fa5a --query "[].endDateTime"
```

---

## Phase 5 — 收尾(cutover 穩定 1-4 週後)

**執行者**: Nick(主)+ Joey(可選 certbot)
**用戶影響**: 零

### 5.1 切 BYO cert → ACA Managed Cert

```bash
# 現在 docs A record 已指 ACA、Managed Cert 能通過 HTTP-01
python -c "
import subprocess, shutil
az = shutil.which('az.cmd') or 'az'
# 重新 bind 用 HTTP validation、ACA 自動申請 Managed Cert
r = subprocess.run([az,'containerapp','hostname','bind',
    '-n','ca-eyesondocs-web-nonprod',
    '-g','rg-eyesondocs',
    '--subscription','937c6f45-ca76-4b29-8f60-e9cf566f6d2e',
    '--hostname','docs.westiedoubao.com',
    '--environment','cae-eyesondocs-nonprod',
    '--validation-method','HTTP'], capture_output=True, text=True)
print(r.returncode); print(r.stdout[:500])
"

# 頒發完(15-30 分鐘)驗證 issuer 已變 Microsoft Azure
curl -v https://docs.westiedoubao.com/ 2>&1 | grep issuer
```

### 5.2 停 Nick sub prod ACA

Nick sub 那套(`rg-eyesondocs`, sub `318df428-...`)只剩 Monitor Job 在寫 Joey Cosmos。corp non-prod 已完全獨立、可以整套下線:
```bash
# 停 Monitor Job
az containerapp job stop -n caj-eyesondocs-monitor -g rg-eyesondocs --subscription 318df428-...
# 24-48h 觀察無問題後
az group delete -n rg-eyesondocs --subscription 318df428-... --yes
```

### 5.3 Joey certbot(可選)

`docs.westiedoubao.com` 的 certbot 每日 renewal 會 fail、log 有 warning:
```bash
sudo certbot delete --cert-name docs.westiedoubao.com
```

---

## Alert 通知(cutover 期間會觸發)

Phase 4 那 5 分鐘可能會有幾筆 5xx(ACA cold start / DNS mixed cache)、屬正常:
- `alert-web-5xx-nonprod` (sev 2)
- `alert-mcp-5xx-nonprod` (sev 2)

Phase 5.1 Managed Cert 頒發期間可能有 TLS handshake fail:
- 不會觸發現有 alert、但用瀏覽器測試會看到

---

## 給 Joey 的一次總集(2 次 session)

**Session A** (Phase 1 + 2.2 準備、~15 分鐘):
1. DNS zone 加 3 條 record(Phase 1 表格)
2. VM 匯出 Let's Encrypt cert 打包給 Nick

**Session B** (Phase 4 cutover、~10 分鐘、離峰時段):
1. 改 A record `docs` → `104.208.123.126`
2. Nick 驗證 OK 後、`rm sites-enabled/docs.westiedoubao.com` + `systemctl stop + disable eyes-on-docs-mcp.service`

**選擇性 Session C** (Phase 5.3、~2 分鐘、任何時間):
- `certbot delete --cert-name docs.westiedoubao.com`

---

## 附錄:BYO cert 到期後的自動化(可選)

BYO cert 到期 2026-08-23、如果 Phase 5.1 沒切成 Managed Cert、就要手動 renew。建議 Phase 5.1 直接切 Managed Cert、避免這事。若因故一定要用 BYO,可以:
1. Joey VM certbot 每 60 天 renew(需 DNS-01 challenge、因為 HTTP-01 已無法)
2. Renew 完再匯出 → 上傳 ACA env certificate update → hostname bind 換 cert

Managed Cert 沒這問題、Microsoft 全自動。
