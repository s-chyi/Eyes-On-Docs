import json
import os
import toml
import datetime
from dotenv import load_dotenv


from logs import logger
from gpt_reply import *
from spyder import *
from live_sweeper import sweep_live_status
from cosmosdb_client import CosmosDBHandler

load_dotenv(override=True)  # 允许覆盖环境变量
  
def load_system_prompts(target):  
    """
    讀取prompts.toml中的system prompt, 若要使用其他版本的prompt請在target_config.json選擇v1、v2、v3....
    更改prompt請依照順序v1->v2->v3, 請勿直接更改現有版本!!!
    """
    with open('prompts.toml', 'r') as f:  
        data = toml.load(f)
        default_prompt = {
        "GPT_SUMMARY_PROMPT": "gpt_summary_prompt_v2",  
        "GPT_TITLE_PROMPT": "gpt_title_prompt_v4",  
        "GPT_SIMILARITY_PROMPT": "gpt_similarity_prompt_v1",  
        "GPT_WEEKLY_SUMMARY_PROMPT": "gpt_weekly_summary_prompt_v1",
        "GPT_STRUCTURED_PROMPT": "gpt_structured_prompt_v1"  # 新增 structured prompt
        }
    system_prompt =  {k: v for k, v in target.items() if "GPT" in k}
    for k, v in default_prompt.items():
        system_prompt.setdefault(k, v)
        system_prompt.update({k: data[system_prompt[k]]['prompt'] })
    return system_prompt
  
def load_targets_config():
    """
    讀取目標主題、爬取的root Url、顯示語言、推送到teams的channel webhook
    可用 TARGET_CONFIG_PATH env 覆蓋預設路徑 (ACA smoke test 用 Nick-only config)
    """
    config_path = os.environ.get('TARGET_CONFIG_PATH', 'target_config.json')
    with open(config_path, 'r') as f:
        return json.load(f)
  
def process_targets(targets):
    """
    根據target_config.json的目標依次爬取更新並總結推送至teams的channel
    並在每週一推送一次上週更新總結
    """
    for target in targets:  

        try:
                
            topic = target['topic_name']  
            root_commits_url = target['root_commits_url']  
            language = target['language']  
            teams_webhook_url = target.get('teams_webhook_url', None)
            system_prompts = load_system_prompts(target)

            if target.get("show_topic_in_title", "False") in ("True", "true"):
                show_topic_in_title = True
            else:
                show_topic_in_title = False
            

            if target.get("push_summary", "False") in ("True", "true"):
                show_weekly_summary = True
            else:
                show_weekly_summary = False
            
            url_mapping = target.get("url_mapping", None)
            
            # 获取 GPT 分析模式配置，默认为 legacy 模式确保向后兼容
            gpt_analysis_mode = target.get("gpt_analysis_mode", "legacy")

            logger.warning(f"========================= Start to process topic: {topic} =========================")  
            logger.info(f"show_topic_in_title: {show_topic_in_title}, show_weekly_summary: {show_weekly_summary}")  
            logger.info(f"gpt_analysis_mode: {gpt_analysis_mode}")  # 记录使用的分析模式  

            logger.info(f"Root commits url: {root_commits_url}")  
            logger.info(f"Language: {language}")  
            if teams_webhook_url:
                logger.info(f"Teams webhook url: {teams_webhook_url}") 
            else:
                logger.info("No Teams webhook url provided, skipping Teams notifications")
            logger.warning(f"url_mapping: {url_mapping}")  
    

            # 最后一个参数是 max_input_token 30000 
            git_spyder = Spyder(topic, root_commits_url, language, teams_webhook_url, show_topic_in_title, system_prompts, 30000, gpt_analysis_mode)  
            # all_commits = git_spyder.get_all_commits()  
            # selected_commits, latest_crawl_time = git_spyder.select_latest_commits(all_commits)  
            git_spyder.process_commits(git_spyder.latest_commits, url_mapping)  
    
            if show_weekly_summary:
                # 检查是否已经存在本周的summary
                this_week_summary = git_spyder.cosmosDB_client.check_weekly_summary(topic, language, root_commits_url)  

                # 获取当前时间
                now = datetime.datetime.now()
                # 计算从午夜到现在的秒数
                seconds_since_midnight = (now - now.replace(hour=0, minute=0, second=0, microsecond=0)).total_seconds()    
                
                # 在以下两种情况下生成weekly summary：
                # 1. 如果是周一(weekday==0)且在   git_spyder.schedule 现在设的是7200秒（2小时） 也就是只有周一的0点到2点之间才会生成weekly summary
                # 2. 或者没有找到本周的summary
                if (now.weekday() == 0 and seconds_since_midnight < git_spyder.schedule) or this_week_summary is None:  
                    git_spyder.generate_weekly_summary()
    
            logger.warning(f"Finish processing topic: {topic}")  
        except Exception as e:  
            logger.exception("Unexpected exception:", e) 
    return git_spyder.schedule

def main():
    """
    執行一次爬取檢測。
    排程由外部 (ACA Job cron: 0 */2 * * *) 接管，本進程跑完 process_targets 就 exit(0)。
    """
    targets = load_targets_config()
    try:
        process_targets(targets)
    except Exception as e:
        logger.exception("Unexpected exception:", e)

    try:
        handler = CosmosDBHandler()
        client = handler.initialize_cosmos_client()
        if client is not None:
            sweep_live_status(client)
    except Exception as e:
        logger.exception("live-sweeper failed at top level", e)

if __name__ == "__main__":
    main()
