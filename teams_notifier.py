import os
import requests
from logs import logger

class TeamsNotifier:
    def post_teams_message(self, title, time, summary, teams_webhook_url, commit_url=None):
        # Kill switch: 測試期完全禁止推 Teams (ACA parity smoke test 用)
        # 保持 3-element list 回傳形狀給 spyder.py process_commits() unpacking
        if os.environ.get('DISABLE_TEAMS_WEBHOOK') == '1':
            logger.warning("Teams disabled by DISABLE_TEAMS_WEBHOOK env var")
            return [None, "disabled", "kill_switch"]
        if commit_url:
            message_data = {
                "@type": "MessageCard",
                "themeColor": "0076D7",
                "title": title,
                "text": str(time) + "\n\n" + str(summary),
                "potentialAction": [{
                    "@type": "OpenUri",
                    "name": "Go to commit page",
                    "targets": [{"os": "default", "uri": commit_url}],
                }],
            }
        else:
            message_data = {
                    "@type": "MessageCard",
                    "themeColor": "0076D7",
                    "title": title,
                    "text": str(summary),
                }
        try:
            response = requests.post(teams_webhook_url, json=message_data)
            response.raise_for_status()
            logger.info("Post message to Teams successfully!")
            return [message_data, "success", ""]
        except Exception as err:
            logger.error(f"An error occurred while sending message to Teams: {err}")
            return [message_data, "failed", str(err)]