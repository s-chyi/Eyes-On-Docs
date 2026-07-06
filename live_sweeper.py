"""
Live status sweeper: 每次 monitor Job 執行時，一次性把 Cosmos 內所有 live_status='pending'
的 doc 拿去比對 azure-ai-docs-pr 的 sha=live 分支 commit list，命中的翻成 live。

策略：per-repo 抓 live commit 一次（不是每個 pending 都打一次 API），
以 sha set 為 key 做 hash 比對；命中的一起 patch。
"""

import datetime
import os
import urllib.parse
import urllib.request
import json
from logs import logger

REPOS_WITH_LIVE_BRANCH = ["MicrosoftDocs/azure-ai-docs-pr"]

LIVE_COMMIT_FETCH_LIMIT = 500


def _extract_repo_from_url(root_commits_url):
    """
    從 root_commits_url 抽 owner/repo。
    e.g. https://api.github.com/repos/MicrosoftDocs/azure-ai-docs-pr/commits?path=... -> MicrosoftDocs/azure-ai-docs-pr
    """
    try:
        parsed = urllib.parse.urlparse(root_commits_url)
        parts = parsed.path.strip("/").split("/")
        if len(parts) >= 3 and parts[0] == "repos":
            return f"{parts[1]}/{parts[2]}"
    except Exception:
        pass
    return None


def _fetch_live_shas(repo_full_name, token, max_pages=5, per_page=100):
    """
    抓指定 repo 的 sha=live 分支最新 max_pages*per_page 個 commit sha。
    回傳 set[str]。
    """
    shas = set()
    for page in range(1, max_pages + 1):
        url = (
            f"https://api.github.com/repos/{repo_full_name}/commits"
            f"?sha=live&per_page={per_page}&page={page}"
        )
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"token {token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
        except Exception as e:
            logger.warning(f"[live-sweeper] fetch live shas failed for {repo_full_name} page {page}: {e}")
            break
        if not isinstance(data, list) or not data:
            break
        for c in data:
            sha = c.get("sha")
            if sha:
                shas.add(sha)
        if len(data) < per_page:
            break
    return shas


def sweep_live_status(cosmosDB_client):
    """
    對 REPOS_WITH_LIVE_BRANCH 內每個 repo：
      1. 從 Cosmos 抓 live_status='pending' 且屬於該 repo 的 doc
      2. 從 GitHub 抓該 repo 的 sha=live commit list
      3. 交集 → patch 為 live

    Args:
        cosmosDB_client (CosmosConversationClient): 已初始化的 client

    Returns:
        dict: {repo: promoted_count}
    """
    token = os.getenv("PERSONAL_TOKEN")
    if not token:
        logger.warning("[live-sweeper] PERSONAL_TOKEN missing, skip")
        return {}

    result = {}
    now_iso = datetime.datetime.utcnow().isoformat()

    for repo in REPOS_WITH_LIVE_BRANCH:
        try:
            pending = cosmosDB_client.get_pending_live_commits(repo)
            if not pending:
                logger.info(f"[live-sweeper] {repo}: 0 pending, skip")
                result[repo] = 0
                continue

            logger.info(f"[live-sweeper] {repo}: {len(pending)} pending doc(s)")
            live_shas = _fetch_live_shas(repo, token)
            if not live_shas:
                logger.warning(f"[live-sweeper] {repo}: got 0 live shas, skip patching")
                result[repo] = 0
                continue

            hits = [d["id"] for d in pending if d.get("commit_sha") in live_shas]
            if not hits:
                logger.info(f"[live-sweeper] {repo}: no pending sha matches live")
                result[repo] = 0
                continue

            promoted = cosmosDB_client.mark_commits_live(hits, now_iso)
            logger.warning(f"[live-sweeper] {repo}: promoted {promoted}/{len(hits)} pending → live")
            result[repo] = promoted
        except Exception as e:
            logger.exception(f"[live-sweeper] {repo}: sweep failed", e)
            result[repo] = 0

    return result
