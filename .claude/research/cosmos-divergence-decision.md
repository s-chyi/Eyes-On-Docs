# Cosmos 資料 Divergence 處理決策

**Date**: 2026-07-28
**Context**: Phase 4 web cutover 之後,`docs.westiedoubao.com` 會從 Joey VM 切到 ACA、users 看到的是 corp non-prod Cosmos (`cosmos-eyesondocs-nonprod`) 的資料。這個 Cosmos 跟原本 Joey Cosmos (`jz-150-cosmosdb`) 自 2026-07-07 回填後就 **未再同步**、兩邊資料會 diverge。

## 兩個 Cosmos 現況

| 面向 | Joey Cosmos `jz-150-cosmosdb` | corp non-prod `cosmos-eyesondocs-nonprod` |
|---|---|---|
| Sub | Joey sub | corp non-prod (`937c6f45-...`) |
| 網路 | Public | VNet-only, private endpoint |
| Writers | Nick sub prod ACA Monitor Job(每 2h)| corp non-prod ACA Monitor Job(每 2h) |
| Readers 現況 | Joey VM web/MCP(用戶目前打的) | corp non-prod ACA web/MCP(Phase 4 後成 user-facing) |
| 初始資料 | 從 2020s 累積的完整歷史 | 907 筆(2026-07-07 從 Joey 回填最近 20 筆/topic × lang + 10 筆 seed) |

## Divergence 產生的原因

自 2026-07-07 起兩邊各自跑 Monitor Job:
- Joey Cosmos 拿到 2026-07-07 之後所有新 doc(Nick sub prod ACA 是唯一 writer)
- corp non-prod Cosmos 也拿到 2026-07-07 之後所有新 doc(自己 Monitor Job)
- 兩邊 **新資料一致**、但 **2026-07-07 之前的歷史 corp non-prod 只有 907 筆**、Joey Cosmos 有完整

## 決策題

Phase 4 之後 user 看到的是 corp non-prod。要不要處理 Joey Cosmos 那份完整歷史?

## 選項比較

| 選項 | 說明 | 缺點 | 適合情境 |
|---|---|---|---|
| **A. 接受 divergence**(推薦)| corp non-prod 為 source of truth、Joey Cosmos 未來 read-only 甚至停用 | 老 doc 歷史看不到、但每 topic × lang 有最近 20 筆已足夠 UI 呈現 | 用戶只看最近更新、不查很久以前的 |
| B. Dual-write | Nick sub prod ACA Monitor Job 保留、同步寫兩邊 | Nick sub 帳單持續、SPOF 沒消除、governance 依賴 Joey 仍在 | 完全不確定要不要脫離 Joey 生態 |
| C. 補回填歷史 | 寫 script 從 Joey Cosmos 抓全部 doc backfill 到 corp non-prod | 一次性工程、~907 → 幾千筆、要處理 schema 差異 + 分頁 | 歷史查詢真的重要 |
| D. Joey Cosmos 保留、UI 提供切換 | UI 加下拉:corp non-prod / Joey (read-only) | 前端複雜化、兩份 UI 邏輯、governance SPOF 仍在 | 用戶很在意歷史但又要脫離 |

## 推薦 A、原因

1. **UI 只顯示最近 20 筆/topic × lang** — 用戶不會查很久以前
2. **Joey Cosmos governance SPOF** — Nick 這邊靠他一個 role assignment 撐,長期是風險
3. **corp non-prod 已完全獨立** — private endpoint + VNet + 自己帳單、脫離 Joey 生態圈才是目標
4. **每次 rebuild 環境的成本** — 現在留 dual-write 未來要再一次拆
5. **記憶 [[aca-migration-status]] 現有走向已經是** corp non-prod 為未來的 source of truth

## 執行步驟(選 A 的話)

Phase 5 收尾一起做:

1. **停 Nick sub prod ACA Monitor Job**
   ```bash
   az containerapp job stop -n caj-eyesondocs-monitor -g rg-eyesondocs \
     --subscription 318df428-...
   ```
   → Joey Cosmos 從此無 writer、資料凍結在停的那一刻

2. **觀察 Joey VM UI(`docs.westiedoubao.com` 已切到 ACA、Joey VM 那邊只剩 GTJA/53ai)不再依賴新 doc**
   → 因 Phase 4 已 disable Joey VM 上的 Eyes-On-Docs nginx site,Joey Cosmos 沒 reader 也沒 writer

3. **選:24-48h 後砍 Nick sub 整套** `rg-eyesondocs`(sub `318df428-...`)
   - ACR / UAMI / LA / ACA env / Job / role assignment 全刪
   - Nick VM 已 deallocate ([[new-vm-runtime-facts]])、也可從 disk 砍
   - Joey Cosmos 保留給 Joey 自己(他 sub 資產、他決定)

4. **告知 Joey**:「Joey Cosmos 現在沒 writer、沒 reader、資料凍結。你要繼續用或砍都 OK、跟我無關。」

## 決策記錄

- ✅ 推薦: **A. 接受 divergence**
- 執行時機: Phase 5(cutover 穩定 1-4 週後)
- 需 Joey 動作: 無(他 sub 的 Cosmos 他自己決定)

## 相關

- [[aca-migration-status]] — Nick sub prod ACA 退場時序
- [[corp-nonprod-aca-facts]] — corp non-prod Cosmos 現況
- [[collaboration-shared-repo]] — 觸及 Joey 資源前的謹慎原則
