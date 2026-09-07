"""
One-shot backfill for commits dropped by commit_fetch.SELECT_CAP during the
2026-08-31 → 2026-09-07 PAT-expiry gap. Reads the SELECT_CAP dropped-URL list,
looks up each commit's real time from GitHub API, then reuses Spyder's
process_commits() with teams_webhook_url=None so notifications stay silent
and only Cosmos gets the doc_updates entries.

Not committed to the shared repo. Runs once via ACA job command override.
"""
import json
import os
import time
import requests
import datetime

from logs import logger
from eyes_on_docs import load_targets_config, load_system_prompts
from spyder import Spyder


BACKFILL_MAP = {
    "Microsoft-Foundry/Chinese": [
        "def312f6a47b5975cbef4082f30ad3892b116c5c",
        "41033f990d300cd810c4e27f9a67a328792ca0a2",
        "c9d8f87aa2f7389606bfe6bfe3677bbc665cf42e",
        "febf1b49f8c3ce178f343cb1bd15218d253f4887",
        "498feba74b415b432fd0725a1ae73a58cfba97f4",
        "35646c48074c523c83a1cc3fda44772d12ffa0d9",
        "f75bbca9604addc3e4b139981cc2f97bee471e3a",
        "ea9c54219f8970cb0aa8edeb3007c4411955bb04",
        "0d91f6a95571c6271f60d1f2f2da65cc6bfed5a7",
        "baaf775e61c1fe49b9f09a0aaa33aa7fbe611aa8",
        "c66994ff059339488892d0cd523186965b1193c6",
        "4a290c49fbf908e4d8d97d2640c32f8dd7225a63",
        "37c33b3ea1948075bcf84339327ed37882e0d40c",
        "636ff74dc8346a8a9f70a5cc37e4caf47f13fa4e",
        "be3cf918f78800712b3f97286d8744c961973a42",
        "6bfe85461f59fc45032f2b68b3050d404883ed7f",
        "9cc7bd22324a706b4997a45cf14d1cfa23cacb8c",
        "250f4d77c720b80304b0bf50a6458c76ebc7b26a",
        "f9fd13cb85279639b2bf65fd55413e5f085fddab",
        "ef13a53472455a5d3d66234601e311d28c9d6b0f",
    ],
    "Microsoft-Foundry/English": [
        "def312f6a47b5975cbef4082f30ad3892b116c5c",
        "41033f990d300cd810c4e27f9a67a328792ca0a2",
        "c9d8f87aa2f7389606bfe6bfe3677bbc665cf42e",
        "febf1b49f8c3ce178f343cb1bd15218d253f4887",
        "498feba74b415b432fd0725a1ae73a58cfba97f4",
        "35646c48074c523c83a1cc3fda44772d12ffa0d9",
        "f75bbca9604addc3e4b139981cc2f97bee471e3a",
        "ea9c54219f8970cb0aa8edeb3007c4411955bb04",
        "0d91f6a95571c6271f60d1f2f2da65cc6bfed5a7",
        "baaf775e61c1fe49b9f09a0aaa33aa7fbe611aa8",
        "c66994ff059339488892d0cd523186965b1193c6",
        "4a290c49fbf908e4d8d97d2640c32f8dd7225a63",
        "37c33b3ea1948075bcf84339327ed37882e0d40c",
        "636ff74dc8346a8a9f70a5cc37e4caf47f13fa4e",
        "be3cf918f78800712b3f97286d8744c961973a42",
        "6bfe85461f59fc45032f2b68b3050d404883ed7f",
        "9cc7bd22324a706b4997a45cf14d1cfa23cacb8c",
        "250f4d77c720b80304b0bf50a6458c76ebc7b26a",
        "f9fd13cb85279639b2bf65fd55413e5f085fddab",
        "ef13a53472455a5d3d66234601e311d28c9d6b0f",
    ],
    "AML/Chinese": [
        "2cd8f9969ae499f8c7e0d8113bc85d9f98e2e77f",
        "abf86b9bb94152f5b27a9b8816d6b9ad4e2c0478",
    ],
    "AML/English": [
        "2cd8f9969ae499f8c7e0d8113bc85d9f98e2e77f",
        "abf86b9bb94152f5b27a9b8816d6b9ad4e2c0478",
    ],
    "Cog-speech-service/Chinese": [
        "c50ed1069f9898d7805f7714fa630c4146494584",
        "67480fa25ad06c8eb86b87d64709fa4f7eddb595",
        "cea9593552ba696aeccfc549950f388fb988b8c1",
    ],
    "Cog-speech-service/English": [
        "c50ed1069f9898d7805f7714fa630c4146494584",
        "67480fa25ad06c8eb86b87d64709fa4f7eddb595",
        "cea9593552ba696aeccfc549950f388fb988b8c1",
    ],
}

# GitHub API repo path (all dropped commits are from this repo)
REPO = "MicrosoftDocs/azure-ai-docs-pr"

# Pacing between commits (seconds). Set via env for override.
SLEEP_BETWEEN = float(os.environ.get("BACKFILL_SLEEP", "5"))


def fetch_commit_time(sha, headers):
    """Fetch the committer date for a single sha as a datetime object."""
    url = f"https://api.github.com/repos/{REPO}/commits/{sha}"
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    date_str = r.json()["commit"]["committer"]["date"]  # e.g. 2026-09-03T15:08:50Z
    return datetime.datetime.strptime(date_str, "%Y-%m-%dT%H:%M:%SZ")


def find_target(targets, topic, language):
    for t in targets:
        if t["topic_name"] == topic and t["language"] == language:
            return t
    raise RuntimeError(f"target not found: {topic}/{language}")


def main():
    pat = os.environ["PERSONAL_TOKEN"]
    headers = {"Authorization": "token " + pat}
    targets = load_targets_config()

    total_planned = sum(len(v) for v in BACKFILL_MAP.values())
    logger.warning(f"=== BACKFILL START: {total_planned} commit-entries across {len(BACKFILL_MAP)} target/lang pairs ===")
    logger.warning(f"    pacing: {SLEEP_BETWEEN}s between commits; Teams webhook FORCED OFF")

    done = 0
    for key, shas in BACKFILL_MAP.items():
        topic, language = key.split("/")
        target = find_target(targets, topic, language)

        # Look up commit times from GitHub API (small burst; well within 5000/hr)
        selected_commits = {}
        for sha in shas:
            try:
                dt = fetch_commit_time(sha, headers)
            except Exception as e:
                logger.error(f"[{key}] failed to fetch time for {sha}: {e}")
                continue
            url = f"https://api.github.com/repos/{REPO}/commits/{sha}"
            selected_commits[dt] = url

        if not selected_commits:
            logger.warning(f"[{key}] no commits to backfill (all lookups failed?)")
            continue

        # Sort ascending to match production ordering
        selected_commits = dict(sorted(selected_commits.items(), key=lambda x: x[0]))

        logger.warning(f"[{key}] backfilling {len(selected_commits)} commits (Teams=OFF)")

        # Build a Spyder scoped to this target. teams_webhook_url=None short-circuits notifications.
        system_prompts = load_system_prompts(target)
        show_topic_in_title = str(target.get("show_topic_in_title", "False")).lower() == "true"
        gpt_analysis_mode = target.get("gpt_analysis_mode", "legacy")
        url_mapping = target.get("url_mapping", None)

        spyder = Spyder(
            topic=topic,
            root_commits_url=target["root_commits_url"],
            language=language,
            teams_webhook_url=None,      # <-- silent
            show_topic_in_title=show_topic_in_title,
            system_prompt_dict=system_prompts,
            max_input_token=30000,
            gpt_analysis_mode=gpt_analysis_mode,
        )

        # process_commits reuses the exact same pipeline (GitHub diff -> GPT -> Cosmos)
        # We pace ourselves by processing one at a time and sleeping between.
        for t_key, url in selected_commits.items():
            spyder.process_commits({t_key: url}, url_mapping)
            done += 1
            logger.warning(f"    progress: {done}/{total_planned} — sleeping {SLEEP_BETWEEN}s")
            time.sleep(SLEEP_BETWEEN)

    logger.warning(f"=== BACKFILL DONE: processed {done}/{total_planned} entries ===")


if __name__ == "__main__":
    main()
