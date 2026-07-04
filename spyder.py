# 导入必要的库和模块
import requests
import datetime
import os  
from dotenv import load_dotenv  
from logs import logger  
from commit_fetch import CommitFetcher  # GitHub提交数据获取器
from cosmosdb_client import CosmosDBHandler  # CosmosDB数据库操作处理器
from call_gpt import CallGPT  # GPT模型调用器
from teams_notifier import TeamsNotifier  # Teams通知发送器

# 加载环境变量
load_dotenv(override=True)  # 允许覆盖环境变量  
PERSONAL_TOKEN = os.getenv("PERSONAL_TOKEN")  # GitHub访问令牌  
  
class Spyder(CommitFetcher, CallGPT, TeamsNotifier):  
    """
    文档更新监控爬虫主类
    继承了三个功能类：
    - CommitFetcher: GitHub提交数据获取功能
    - CallGPT: GPT模型调用功能  
    - TeamsNotifier: Teams通知发送功能
    """
    def __init__(self, topic, root_commits_url, language, teams_webhook_url, show_topic_in_title, system_prompt_dict, max_input_token, gpt_analysis_mode="legacy"):  
        """
        初始化爬虫实例
        
        Args:
            topic (str): 监控的主题名称，如"AML"、"Azure OpenAI"等
            root_commits_url (str): GitHub API提交列表的根URL
            language (str): 输出语言，如"Chinese"或"English"
            teams_webhook_url (str): Teams频道的Webhook URL
            show_topic_in_title (bool): 是否在通知标题中显示主题名称
            system_prompt_dict (dict): GPT系统提示词字典
            max_input_token (int): GPT输入的最大token数量限制
            gpt_analysis_mode (str): GPT分析模式，"legacy"或"structured"，默认"legacy"
        """
        # 保存配置参数
        self.topic = topic
        self.language = language
        self.root_commits_url = root_commits_url
        self.teams_webhook_url = teams_webhook_url
        self.system_prompt_dict = system_prompt_dict
        self.max_input_token = max_input_token
        self.show_topic_in_title = show_topic_in_title
        self.gpt_analysis_mode = gpt_analysis_mode  # 新增：GPT分析模式

        # 设置GitHub API请求头，包含认证令牌
        self.headers = {"Authorization": "token " + PERSONAL_TOKEN}
        # api_url = 'https://api.github.com/repos/MicrosoftDocs/azure-docs/commits'
        
        # 保留此常數僅用於 weekly summary 週一判斷 (line ~104: seconds_since_midnight < self.schedule)。
        # 實際執行頻率由 ACA Job cron (0 */2 * * *) 接管，此值不再決定執行週期。
        self.schedule = 7200
        
        # 初始化CosmosDB处理器和客户端
        self.cosmosDB = CosmosDBHandler()
        self.cosmosDB_client = self.cosmosDB.initialize_cosmos_client()
        
        # 从数据库获取最新的提交记录，用于确定起始时间点
        lastest_commit_in_cosmosdb = self.cosmosDB_client.get_lastest_commit(self.topic, self.language, self.root_commits_url, sort_order = 'DESC')

        # 确定爬取的起始时间点，避免重复处理已处理的提交
        self.start_time = self.cosmosDB.get_start_time(lastest_commit_in_cosmosdb)
        
        # 获取所有提交记录
        all_commits = self.get_all_commits(self.root_commits_url, self.headers)
        
        # 筛选出需要处理的最新提交记录
        self.latest_commits, self.latest_time = self.select_latest_commits(all_commits, self.start_time)  

        logger.info(f"Only get changes after the time point: {self.start_time}")
        
        # 初始化提交历史记录字典，用于临时存储处理过程中的数据
        self.commit_history = {}

    def determine_status(self, gpt_title):  
        """
        根据GPT生成的标题判断提交状态
        
        GPT生成的标题格式通常为："1 [标签] 实际标题" 或 "0 [标签] 标题"
        - 如果以"0 "开头，表示这次提交不重要，应该跳过
        - 如果以其他数字开头，表示这次提交需要发送通知
        
        Args:
            gpt_title (str): GPT生成的标题
            
        Returns:
            str: 'skip' 表示跳过，'post' 表示发送通知
        """
        # 检查标题是否以'0 '开头来决定是否跳过此次提交
        if gpt_title.startswith('0 '):  
            status = 'skip'  
            logger.info(f"Skipping this commit: {gpt_title}")  
        else:  
            status = 'post'  
            logger.info(f"GPT title (without first 2 chars): {gpt_title[2:]}")  
        return status  

    def generate_gpt_responses(self, commit_patch_data, language, prompts, url_mapping):  
        """
        使用GPT生成提交的摘要、标题和状态
        
        支持两种模式：
        - legacy: 传统的两次调用模式（摘要 + 标题）
        - structured: 新的一次调用模式（使用 structured output）
        
        Args:
            commit_patch_data (str): 提交的补丁数据（文件变更详情）
            language (str): 输出语言
            prompts (dict): GPT提示词字典
            url_mapping (dict): URL映射配置，用于修正文档链接
            
        Returns:
            tuple: (gpt_summary, gpt_title, status) 
                   GPT摘要、GPT标题、处理状态
        """
        if self.gpt_analysis_mode == "structured":
            # 新的 structured output 模式
            logger.info("Using structured output mode for GPT analysis")
            return self._generate_gpt_responses_structured(commit_patch_data, language, prompts, url_mapping)
        else:
            # 传统的 legacy 模式
            logger.info("Using legacy mode for GPT analysis")
            return self._generate_gpt_responses_legacy(commit_patch_data, language, prompts, url_mapping)
    
    def _generate_gpt_responses_legacy(self, commit_patch_data, language, prompts, url_mapping):
        """
        传统的两次GPT调用模式
        """
        # 第一步：使用GPT生成提交内容摘要
        gpt_summary, gpt_summary_tokens, commit_patch_data = self.gpt_summary(commit_patch_data, language, prompts["GPT_SUMMARY_PROMPT"], url_mapping)  
        # self.update_commit_history("gpt_summary_response", gpt_summary)  # 注释掉的代码保留
        
        # 记录摘要生成消耗的token数
        self.update_commit_history("gpt_summary_tokens", gpt_summary_tokens)
        
        # 记录处理后的提交补丁数据
        self.update_commit_history("commit_patch_data", commit_patch_data)
        
        # 第二步：基于摘要生成标题
        gpt_title, gpt_title_tokens = self.gpt_title(gpt_summary, language, prompts["GPT_TITLE_PROMPT"])  
        # self.update_commit_history("gpt_title_response", gpt_title)  # 注释掉的代码保留
        
        # 记录标题生成消耗的token数
        self.update_commit_history("gpt_title_tokens", gpt_title_tokens)
        
        # 第三步：根据生成的标题判断处理状态
        status = self.determine_status(gpt_title)  
        
        return gpt_summary, gpt_title, status
        
    def _generate_gpt_responses_structured(self, commit_patch_data, language, prompts, url_mapping):
        """
        新的 structured output 一次调用模式
        """
        try:
            # 使用 structured output 一次性生成摘要和标题
            gpt_summary, gpt_title, importance_score, importance_score_reasoning, gpt_tokens, processed_patch_data = self.gpt_summary_and_title_structured(
                commit_patch_data, language, prompts["GPT_STRUCTURED_PROMPT"], url_mapping
            )
            
            if gpt_summary is None or gpt_title is None or importance_score is None:
                # 如果 structured 模式失败，fallback 到 legacy 模式
                logger.warning("Structured output failed, falling back to legacy mode")
                return self._generate_gpt_responses_legacy(commit_patch_data, language, prompts, url_mapping)
            
            # 根据 importance_score 直接确定状态，不需要调用 determine_status
            if importance_score == 0:
                status = 'skip'
                logger.info(f"Skipping this commit based on importance_score: {gpt_title}")
            else:
                status = 'post'
                logger.info(f"Processing this commit based on importance_score: {gpt_title}")
            
            # 为了与 legacy 模式兼容，在标题前添加数字前缀用于保存到数据库
            # 这样现有的处理逻辑可以正常工作
            formatted_gpt_title = f"{importance_score} {gpt_title}"
            
            # 记录token使用情况（structured模式只有一次调用的token）
            self.update_commit_history("gpt_structured_tokens", gpt_tokens)
            # 为了保持兼容性，也记录到原有的字段中
            self.update_commit_history("gpt_summary_tokens", gpt_tokens)
            self.update_commit_history("gpt_title_tokens", {"prompt": 0, "completion": 0, "total": 0})  # 标题是同时生成的，所以为0
            
            # 记录处理后的提交补丁数据
            self.update_commit_history("commit_patch_data", processed_patch_data)
            
            # 记录额外的 structured 模式特有信息
            self.update_commit_history("importance_score", importance_score)
            self.update_commit_history("importance_score_reasoning", importance_score_reasoning)
            
            return gpt_summary, formatted_gpt_title, status
            
        except Exception as e:
            logger.exception("Exception in structured mode, falling back to legacy mode:", e)
            return self._generate_gpt_responses_legacy(commit_patch_data, language, prompts, url_mapping)  
    
    def generate_weekly_summary(self):
        """
        生成并发送周总结报告
        
        该方法的工作流程：
        1. 从CosmosDB获取上周的所有提交记录
        2. 使用GPT生成周总结
        3. 生成周总结标题（包含日期范围）
        4. 发送到Teams频道（如果配置了webhook）
        5. 保存到数据库
        
        周总结只在以下情况生成：
        - 周一的前2小时内（避免重复生成）
        - 或者数据库中没有本周的总结记录
        """
        # 清空提交历史记录，为周总结生成做准备
        self.commit_history.clear()
        logger.warning(f"Get last week summary from CosmosDB")
        
        # 从数据库获取上周的所有相关提交记录
        weekly_commit_list = self.cosmosDB_client.get_weekly_commit(self.topic, self.language, self.root_commits_url, sort_order = 'DESC')
        
        if weekly_commit_list:
            logger.info(f"Find {len(weekly_commit_list)} last week summary in CosmosDB")
            
            # 使用GPT基于上周的提交列表生成周总结
            gpt_weekly_summary_response, gpt_weekly_summary_tokens = self.generate_weekly_summary_using_weekly_commit_list(
                self.language, weekly_commit_list, self.system_prompt_dict["GPT_WEEKLY_SUMMARY_PROMPT"], self.max_input_token
                )
            try:
                # 获取当前UTC时间作为周总结的时间戳
                time = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                
                if gpt_weekly_summary_response:
                    # 生成周总结标题，格式如："[Weekly Summary] 2023-08-07 ~ 2023-08-13"
                    gpt_weekly_summary_title = self.generate_weekly_title()
                    teams_message_jsondata = None
                    post_status = None
                    error_message = None
                    
                    # web 前端通过读取 teams_message_jsondata 来获取周总结的标题和内容
                    # 如果配置了teams_webhook_url，则发送到Teams；否则只保存到数据库
                    if self.teams_webhook_url:
                        logger.warning(f"Push weekly summary report to teams")
                        # 发送周总结消息到Teams频道
                        teams_message_jsondata, post_status, error_message = self.post_teams_message(gpt_weekly_summary_title, time, gpt_weekly_summary_response, self.teams_webhook_url)
                        logger.debug(f"Teams Message jsonData: {teams_message_jsondata}")
                    else:
                        logger.warning(f"Skip sending weekly summary to teams: no webhook URL configured")
                        # 如果没有配置webhook，直接构造消息数据用于保存
                        teams_message_jsondata = {
                            "title": gpt_weekly_summary_title,
                            "text": gpt_weekly_summary_response,
                        }

                    # 保存周总结记录到数据库
                    self.save_commit_history(time, "", "", teams_message_jsondata, post_status, error_message)
                    
                    # 记录周总结生成消耗的token数
                    self.update_commit_history("gpt_weekly_summary_tokens", gpt_weekly_summary_tokens)
                    self.update_commit_history("teams_message_webhook_url", self.teams_webhook_url)
                else:
                    logger.warning(f"No weekly summary report to teams")
                    # 如果没有生成有效的周总结，记录失败状态
                    self.save_commit_history(time, "", "", "", "failed", "No important update last week")
                
                # 上传提交历史到数据库
                self.upload_commit_history()

            except requests.exceptions.HTTPError as err:
                logger.error(f"Error occured while sending message to Teams: {err}")
                logger.exception("HTTPError in post_teams_message:", err)
            except Exception as err:
                logger.error(f"An error occured in post_teams_message: {err}")
                logger.exception("Unknown Exception in post_teams_message:", err)
        else:
            logger.warning(f"Last week summary in CosmosDB is empty")

    def generate_weekly_title(self):
        """
        生成周总结的标题
        
        标题格式：[Weekly Summary] YYYY-MM-DD ~ YYYY-MM-DD
        时间范围是上周一到上周日
        
        Returns:
            str: 格式化的周总结标题
        """
        # 计算上周一的日期（当前日期减去当前是周几再减去7天）
        last_monday = datetime.date.today() - datetime.timedelta(days=datetime.date.today().weekday() + 7)
        
        # 计算上周日的日期（上周一加6天）
        last_sunday = last_monday + datetime.timedelta(days=6)
        
        # 返回格式化的标题
        return f"[Weekly Summary] {last_monday} ~ {last_sunday}"

    def process_commits(self, selected_commits, url_mapping):  
        """
        处理筛选出的提交记录
        
        这是核心处理方法，对每个选中的提交执行完整的处理流程：
        1. 获取提交的详细变更数据
        2. 使用GPT生成摘要和标题  
        3. 判断是否需要发送通知
        4. 发送Teams通知（如果需要）
        5. 保存处理结果到数据库
        
        Args:
            selected_commits (dict): 筛选出的提交字典，格式为{时间: API_URL}
            url_mapping (dict): URL映射配置，用于修正文档链接
        """
        # 遍历每个选中的提交记录
        for key in selected_commits:
            try:
                # 初始化变量，避免在异常情况下变量未定义
                time_, commit_url, status, teams_message_jsondata, post_status, error_message, gpt_title, gpt_summary = None, None, None, None, None, None, None, None

                # 从字典中提取时间和API URL
                time_, url = key, selected_commits[key]

                # 将GitHub API URL转换为网页URL，便于用户点击查看
                # 例如：从 https://api.github.com/repos/MicrosoftDocs/azure-docs/commits/abc123
                # 转换为：https://github.com/MicrosoftDocs/azure-docs/commit/abc123
                commit_url = url.replace("https://api.github.com/repos", "https://github.com").replace("commits", "commit")
                logger.warning(f"Getting changes from html_url: {commit_url}")  

                try:
                    # 获取提交的详细变更数据（补丁数据）
                    # input_dic, time_, summary, commit_url = self.get_change_from_each_url(time_, url, self.max_input_token)  # 旧版本代码注释
                    commit_patch_data = self.get_change_from_each_url(time_, url, self.max_input_token, self.headers)
                except Exception as e:
                    logger.error(f"Error getting change from url: {url}, Exception: {e}")
                    logger.exception("Exception in process_each_commit:", e)
                    
                # 初始化Teams消息相关变量
                teams_message_jsondata = None
                post_status = None
                error_message = None

                # commit_patch_data = input_dic.get("commits")  # 旧版本代码注释
                
                # 检查是否成功获取到补丁数据
                if commit_patch_data == "Error":
                    # 如果获取补丁数据失败，设置错误消息
                    logger.error(f"Error getting patch data from url: {commit_url}")
                    gpt_summary = "Too many changes in one commit.🤦‍♂️ \n\nThe bot isn't smart enough to handle temporarily.😢 \n\nPlease check the update via commit page button.🤪"
                    gpt_title = "Error in Getting Patch Data"
                    status = "Error in Getting Patch Data"
                else:
                    # 使用GPT模型生成摘要和标题
                    gpt_summary, gpt_title, status = self.generate_gpt_responses(commit_patch_data, self.language, self.system_prompt_dict, url_mapping)  
                    # Save commit history to CosmosDB  
                    
                    # 检查GPT是否成功生成摘要
                    if gpt_summary == None:
                        gpt_summary = "Something went wrong when generating Summary😂.\n\n You can report the issue(\"...\" -> Copy link) to zehua@micrsoft.com, thanks."
                        gpt_title = "Error in getting Summary"
                        status = "Error in getting Summary"
                    else:
                        # 检查GPT是否成功生成标题
                        if gpt_title == None:
                            gpt_title = "Error in getting Title"
                            status = "Error in getting Title"
                        else:
                            # 根据GPT生成的标题判断是否需要发送通知
                            if status == "skip":
                                logger.info(f"Skip this commit: {gpt_title}")
                            else:
                                # 准备发送Teams通知
                                # lastest_commit_in_cosmosdb = cosmos_conversation_client.get_lastest_commit(self.topic, self.language, self.root_commits_url, sort_order = 'DESC')  # 旧版本代码注释
                                # if self.get_similarity(input_dic, self.language, lastest_commit_in_cosmosdb, self.system_prompt_dict["GPT_SIMILARITL_PROMPT"]).split("\n")[1][0] == "1":  # 旧版本相似性检查代码注释
                                #     logger.error(f"Error detected content as similar to the previous entry, therefore skipping.")
                                # else:
                                
                                # 记录标题（去掉前两个字符，通常是数字和空格）
                                logger.warning(f"GPT_Title without first 2 chars: {gpt_title[2:]}")
                                
                                # 根据配置决定是否在通知中显示主题名称
                                if self.show_topic_in_title:
                                    time = self.topic + "\n\n" + str(time_)
                                else:
                                    time = time_
                                    
                                # 如果配置了Teams webhook，发送通知
                                if self.teams_webhook_url:
                                    teams_message_jsondata, post_status, error_message = self.post_teams_message(gpt_title[2:], time, gpt_summary, self.teams_webhook_url, commit_url)
                                    # print(gpt_title[2:]+"\n\n"+gpt_summary+"\n\n")  # 调试代码注释

            except Exception as e:  
                logger.exception("Unexpected exception:", e)  

            try: 
                # 上传提交历史到CosmosDB数据库
                self.update_commit_history("gpt_summary_response", gpt_summary)
                self.update_commit_history("gpt_title_response", gpt_title)

                # 保存本次处理的完整历史记录
                self.save_commit_history(time_, commit_url, status, teams_message_jsondata, post_status, error_message) 
                
                # 将记录上传到数据库
                self.upload_commit_history()
            except Exception as e:  
                logger.exception("Unexpected exception:", e)                  

            # 清空提交历史记录，为下一个提交的处理做准备
            self.commit_history.clear()
  
    def save_commit_history(self, commit_time, commit_url=None, status=None, teams_message_jsondata=None, post_status=None, error_message=None):  
        """
        保存提交历史记录到内存字典
        
        这个方法将处理结果保存到 self.commit_history 字典中，
        稍后会通过 upload_commit_history() 方法上传到CosmosDB数据库
        
        Args:
            commit_time (str): 提交时间
            commit_url (str, optional): 提交的网页URL
            status (str, optional): 处理状态（'post', 'skip', 'error'等）
            teams_message_jsondata (dict, optional): 发送到Teams的消息数据
            post_status (str, optional): Teams消息发送状态（'success', 'failed'）
            error_message (str, optional): 错误消息（如果有）
        """
        self.update_commit_history("commit_time", str(commit_time)) 
        self.update_commit_history("commit_url", str(commit_url)) 
        self.update_commit_history("status", status) 
        self.update_commit_history("topic", self.topic) 
        self.update_commit_history("language", self.language) 
        self.update_commit_history("root_commits_url", self.root_commits_url) 
        self.update_commit_history("teams_message_webhook_url", self.teams_webhook_url)
        self.update_commit_history("teams_message_jsondata", teams_message_jsondata) 
        self.update_commit_history("post_status", post_status) 
        self.update_commit_history("error_message", error_message) 

    def update_commit_history(self, key, value):  
        """  
        更新提交历史记录字典中的单个字段
        
        这是一个通用的字段更新方法，用于向 self.commit_history 字典添加或更新数据
        
        Args:
            key (str): 记录的键名
            value: 记录的值（可以是任意类型）
        """  
        self.commit_history[key] = value  

    def upload_commit_history(self):
        """
        将内存中的提交历史记录上传到CosmosDB数据库
        
        这个方法将 self.commit_history 字典中的数据保存到数据库，
        成功或失败都会记录相应的日志，处理完成后清空内存中的历史记录
        """
        if self.cosmosDB_client.create_commit_history(self.commit_history):  
            logger.info("Successfully created commit history in CosmosDB!")  
        else:  
            logger.error("Failed to create commit history in CosmosDB!")  
        
        # 清空提交历史记录，为下一次处理做准备
        self.commit_history.clear()
    
    