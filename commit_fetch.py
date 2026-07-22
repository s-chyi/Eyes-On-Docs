# 导入必要的库
import requests  # HTTP请求库，用于调用GitHub API
from bs4 import BeautifulSoup  # HTML解析库（用于废弃的网页爬虫方法）
import datetime  # 时间处理库
from urllib.parse import urlparse, parse_qs  # URL 解析，避免手动 split 出错
from logs import logger  # 日志记录器

class CommitFetcher:  
    """
    GitHub Commit数据获取器
    
    这个类负责从GitHub仓库获取commit历史记录和具体的文件变更内容。
    主要功能包括：
    1. 获取指定仓库路径的所有commit记录
    2. 筛选出指定时间之后的新commit
    3. 获取每个commit的详细文件变更内容（patch数据）
    """
    topic_path : str = ""  # 主题路径，用于过滤特定目录下的文件变更
    def get_all_commits(self, root_commits_url, headers={}):  
        """
        获取指定仓库路径的所有commit记录
        
        通过GitHub API获取commit列表，解析每个commit的时间和URL信息。
        相比旧版本的网页爬虫方法，API方式更稳定可靠。
        
        Args:
            root_commits_url (str): GitHub API的commit列表URL
                                  格式如：https://api.github.com/repos/MicrosoftDocs/azure-docs/commits?path=articles/ai-services/openai
            headers (dict): HTTP请求头，包含认证信息
            
        Returns:
            dict: commit时间到URL的映射字典，格式为 {datetime: url, ...}
        """
        logger.info(f"Commit Root page: {root_commits_url}")

        # 从URL中提取主题路径，用于后续过滤特定目录的文件变更
        # 使用 urllib.parse 处理query string，正确支持多参数（例如 ?path=X&sha=live），
        # 避免旧版本 `split('path=')` 在 path 参数后面还有其他参数时把它们粘在一起。
        # 例：
        #   .../commits?path=articles/foundry/openai              -> "articles/foundry/openai"
        #   .../commits?path=articles/foundry/openai&sha=live     -> "articles/foundry/openai"
        #   .../commits?sha=live&path=articles/foundry/openai     -> "articles/foundry/openai"
        #   .../commits                                            -> None
        query_params = parse_qs(urlparse(root_commits_url).query)
        path_values = query_params.get('path', [])
        self.topic_path = path_values[0] if path_values else None

        # 通过GitHub API获取commit列表的JSON响应
        # response = requests.get(root_commits_url, headers=headers).text  # 废弃的直接请求方式
        response = self._make_request_to_json(root_commits_url, headers=headers)
        
        # 验证响应格式是否正确（应该是包含commit记录的列表）
        if not isinstance(response, list):
            logger.error(f"Failed to fetch commits or response is not a list. URL: {root_commits_url}, Response: {response}")
            return {}

        # 初始化数据存储列表
        precise_time_list = []  # 存储commit的精确时间
        commits_url_list = []   # 存储commit的API URL

        # 解析每个commit记录
        for idx, item in enumerate(response):
            try:
                # 验证数据结构是否正确
                if not isinstance(item, dict):
                    logger.warning(f"Item at index {idx} is not a dict: {item}")
                    continue
                    
                # 检查必要的字段是否存在
                if 'commit' not in item or 'author' not in item['commit'] or 'date' not in item['commit']['author']:
                    logger.warning(f"Missing expected keys in item at index {idx}: {item}")
                    continue
                    
                # 提取并解析commit时间
                datetime_str = item['commit']['author']['date']
                try:
                    # 将ISO格式的时间字符串转换为datetime对象
                    # 格式：2023-08-07T10:30:45Z
                    precise_time = datetime.datetime.strptime(datetime_str, "%Y-%m-%dT%H:%M:%SZ")
                except ValueError as ve:
                    logger.warning(f"Invalid datetime format at index {idx}: {datetime_str}, Exception: {ve}")
                    continue
                    
                precise_time_list.append(precise_time)
                
                # 提取commit的API URL
                full_url = item.get('url')
                if not full_url:
                    logger.warning(f"Missing 'url' in item at index {idx}: {item}")
                    continue
                commits_url_list.append(full_url)
                
            except Exception as e:
                logger.error(f"Error processing item at index {idx}: {item}, Exception: {e}", exc_info=True)
                continue

        # 验证是否获取到有效数据
        if not precise_time_list or not commits_url_list:
            logger.warning(f"No valid commits found for URL: {root_commits_url}. precise_time_list: {precise_time_list}, commits_url_list: {commits_url_list}")
            return {}

        # 将时间和URL打包成字典，便于后续按时间筛选和排序
        commits_dic_time_url = dict(zip(precise_time_list, commits_url_list))  
        return commits_dic_time_url    
    
    
        ########################老代码 网页爬虫#########################################
        # 以下是废弃的网页爬虫代码，保留作为参考
        # 旧版本通过解析GitHub网页HTML来获取commit信息，现在改用API方式更稳定
        
        # # 解析HTML  
        # soup = BeautifulSoup(response, "html.parser")  
      
        # # 找到每天的commits集合  
        # commits_per_day = soup.find_all("div", {"class": "TimelineItem-body"})  
  
        # # 解析每個commits集合  
        # for item in commits_per_day:  
        #     # 提取並解析時間信息  
        #     time_elements = item.find_all("relative-time")  
        #     for time_element in time_elements:  
        #         datetime_str = time_element["datetime"]  
        #         precise_time = datetime.datetime.strptime(datetime_str, "%Y-%m-%dT%H:%M:%SZ")  
        #         precise_time_list.append(precise_time)  
  
        #     # 提取commits的URL  
        #     for div in item.find_all("div", {"class": "flex-auto min-width-0 js-details-container Details"}):  
        #         commit_url = div.find('a', 'Link--primary text-bold js-navigation-open markdown-title').get('href')  
        #         full_url = f"https://github.com{commit_url}"  
        #         commits_url_list.append(full_url)  
  
        # # 將時間和URL打包成字典  
        # commits_dic_time_url = dict(zip(precise_time_list, commits_url_list))  
        # return commits_dic_time_url  
        #################################################################


    def get_change_from_each_url(self, time, commit_url, max_input_token, headers={}):  
        """
        获取单个commit的详细文件变更内容
        
        通过GitHub API获取commit的详细信息，包括所有文件的变更patch数据。
        这些patch数据包含了文件的具体修改内容，将作为GPT分析的输入。
        
        Args:
            time: commit时间（用于日志记录）
            commit_url (str): commit的API URL
            max_input_token (int): 最大输入token限制，用于截断过长的内容
            headers (dict): HTTP请求头，包含认证信息
            
        Returns:
            str: 格式化的patch数据字符串，包含文件路径和变更内容
        """
        logger.warning(f"Getting changes from url: {commit_url}")  

        # 通过GitHub API获取具体commit信息的JSON数据
        # response = requests.get(commit_url, headers=headers).json()  # 废弃的直接请求方式
        response = self._make_request_to_json(commit_url, headers=headers)

        # 提取commit中的文件变更信息
        commit_response = response['files']
        # result_list = []  # 构建结果列表（废弃的处理方式）
        commit_patch_data = ""  # 用于存储所有相关文件的patch数据
        
        # 遍历commit中的每个文件变更
        for item in commit_response:
            # 检查文件是否包含patch数据和文件名
            if "patch" in item.keys() and "filename" in item.keys():

                # 过滤：只处理指定主题路径下的文件变更
                # 如果topic_path为None，则处理所有文件
                if item["filename"].startswith(self.topic_path) or self.topic_path is None:
                    # 格式化patch数据：原始路径 + 变更内容
                    patch_data = "Original Path:" + item["filename"] + "\r\n" + item["patch"] + "\n\n"
                    commit_patch_data += patch_data
                    
                    # 废弃的处理方式（保留作为参考）
                    # if len(patch_data) >= max_input_token:
                    #     result_list.append(patch_data[:max_input_token])
                    # else:
                    #     result_list.append(patch_data)
        
        # 根据最大token限制截断内容，确保不超过GPT的输入限制
        commit_patch_data = commit_patch_data[:max_input_token] if len(commit_patch_data) >= max_input_token else commit_patch_data

        logger.debug(f"Get commit_patch_data: {commit_patch_data}")  
        
        return commit_patch_data
  
        ########################废弃的网页爬虫代码（保留作为参考）#########################
        # 以下是旧版本通过解析GitHub网页HTML获取commit详情的代码
        # 现在改用GitHub API获取JSON数据，更加稳定和高效
        
        # # 獲取commit頁面的內容  
        # response = self._make_request(commit_url)  
  
        # # 解析commit頁面  
        # soup = BeautifulSoup(response, "html.parser")  
        # commit_title = soup.find("div", class_="commit-title markdown-title").get_text(strip=True) if soup.find("div", class_="commit-title markdown-title") else ""  
        # commit_desc = soup.find("div", {"class": "commit-desc"}).pre.get_text(strip=True) if soup.find("div", {"class": "commit-desc"}) else ""  
  
        # # 獲取patch數據  
        # patch_url = commit_url + ".patch"  
        # patch_data = self._make_request(patch_url, is_stream=True)  
  
        # # 構建結果字典  
        # result_dic = {  
        #     "commits": patch_data[:max_input_token] if len(patch_data) >= max_input_token else patch_data,  
        #     "urls": []  
        # }  
  
        # logger.debug(f"Get Change result_dic: {result_dic}")  
  
        # return result_dic, time, f"{commit_title}, {commit_desc}", commit_url  
        ##########################################################################  

    def select_latest_commits(self, commits_dic_time_url, start_time):  
        """
        筛选出指定时间之后的最新commit记录
        
        从所有commit记录中筛选出start_time之后的新commit，避免重复处理已经处理过的commit。
        结果按时间顺序排序，便于后续按顺序处理。
        
        Args:
            commits_dic_time_url (dict): 所有commit的时间到URL映射字典
            start_time (datetime): 起始时间点，只处理此时间之后的commit
            
        Returns:
            tuple: (selected_commits, latest_crawl_time)
                   - selected_commits: 筛选后的commit字典
                   - latest_crawl_time: 最新的commit时间，用于下次筛选的起始点
        """
        # 筛选出开始时间之后的commit
        selected_commits = {key: url for key, url in commits_dic_time_url.items() if key > start_time}

        # 按时间升序排序，确保按时间顺序处理commit
        selected_commits = dict(sorted(selected_commits.items(), key=lambda x: x[0]))

        # 记录筛选后的commit数量
        selected_commits_length = len(selected_commits)
        logger.warning(f"++++++++++++++++++++++++ {selected_commits_length} selected commits: {selected_commits}")

        # Sanity cap：一次 >10 筆通常代表 monitor 曾中斷（PAT 過期、job 停跑等）恢復後
        # 大量 catch-up。保留最新 10 筆處理、log 丟掉的 sha 讓運維知道 gap。
        # 避免一口氣推 30+ 則 Teams、也避免長時間跑一輪。
        SELECT_CAP = 10
        if selected_commits_length > SELECT_CAP:
            all_times_sorted_desc = sorted(selected_commits.keys(), reverse=True)
            kept_times = set(all_times_sorted_desc[:SELECT_CAP])
            dropped = {t: u for t, u in selected_commits.items() if t not in kept_times}
            selected_commits = {t: u for t, u in selected_commits.items() if t in kept_times}
            selected_commits = dict(sorted(selected_commits.items(), key=lambda x: x[0]))
            logger.warning(
                f"!! SELECT_CAP triggered: kept newest {SELECT_CAP}/{selected_commits_length}, "
                f"dropped {len(dropped)} older commits (NOT processed): {list(dropped.values())}"
            )
            selected_commits_length = len(selected_commits)

        # 获取最新的commit时间，用作下次筛选的起始时间
        if selected_commits_length > 0:  
            latest_crawl_time = str(max(selected_commits.keys()))  
            logger.warning(f"Max new commits time: {latest_crawl_time}")  
        else:  
            # 如果没有新commit，保持原来的起始时间
            latest_crawl_time = start_time  
            logger.warning("No new commits")  
  
        # 返回筛选后的commit以及最新的爬取时间  
        return selected_commits, latest_crawl_time 

    def _make_request(self, url, is_stream=False, headers={}):  
        """
        发送HTTP请求的通用方法（废弃方法，保留用于向后兼容）
        
        这是旧版本使用的请求方法，用于获取HTML或文本内容。
        现在主要使用_make_request_to_json方法获取JSON数据。
        
        Args:
            url (str): 请求的URL
            is_stream (bool): 是否使用流式请求
            headers (dict): HTTP请求头
            
        Returns:
            str: 响应的文本内容，失败时返回"Error"
        """
        try:  
            response = requests.get(url, stream=is_stream, headers=headers)  
            response.raise_for_status()  # 如果HTTP状态码表示错误，则抛出异常
            return response.text  
        except requests.RequestException as e:  
            logger.error(f"Request exception for URL: {url}", exc_info=e)  
            return "Error"  
        
    def _make_request_to_json(self, url, is_stream=False, headers={}, retries=3, delay=2):
        """
        发送HTTP请求并返回JSON数据的方法（当前使用的主要请求方法）
        
        这个方法专门用于调用GitHub API获取JSON格式的响应数据。
        包含重试机制，提高请求的稳定性。
        
        Args:
            url (str): 请求的URL（GitHub API URL）
            is_stream (bool): 是否使用流式请求（通常为False）
            headers (dict): HTTP请求头，包含认证Token
            retries (int): 最大重试次数，默认3次
            delay (int): 重试间隔时间（秒），默认2秒
            
        Returns:
            dict/list: 解析后的JSON数据，失败时返回None
        """
        import time
        
        # 执行重试逻辑
        for attempt in range(retries):
            try:
                response = requests.get(url, stream=is_stream, headers=headers)
                response.raise_for_status()  # 检查HTTP状态码
                return response.json()  # 解析并返回JSON数据
            except requests.RequestException as e:
                logger.error(f"Request exception for URL: {url}, Attempt: {attempt+1}, Exception: {e}", exc_info=True)
                time.sleep(delay)  # 等待后重试
                
        # 所有重试都失败
        logger.error(f"All retries failed for URL: {url}")
        return None

# 主程序入口，用于测试CommitFetcher类的功能
if __name__ == "__main__":  
    """
    测试代码：演示如何使用CommitFetcher类
    
    这段代码展示了完整的使用流程：
    1. 创建CommitFetcher实例
    2. 获取所有提交记录
    3. 筛选最新提交
    4. 获取每个提交的详细变更内容
    
    注意：这里使用的是GitHub网页URL而不是API URL，在实际使用中需要转换为API格式
    """
    fetcher = CommitFetcher()  
    
    # 获取Azure OpenAI文档的所有commit记录
    # 注意：这里应该使用API URL格式，例如：
    # "https://api.github.com/repos/MicrosoftDocs/azure-docs/commits?path=articles/ai-services/openai"
    all_commits = fetcher.get_all_commits("https://github.com/MicrosoftDocs/azure-docs/commits/main/articles/ai-services/openai/")  
    
    # 筛选出从当前时间开始的新commit（测试时会返回空结果，因为没有未来的commit）
    latest_commits, latest_time = fetcher.select_latest_commits(all_commits, datetime.datetime.now())  
    
    # 遍历每个筛选出的commit，获取详细的变更内容
    for commit_time, commit_url in latest_commits.items():  
        change_details = fetcher.get_change_from_each_url(commit_time, commit_url)  
