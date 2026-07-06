# 导入必要的库
import os  # 系统环境变量操作
import re  # 正则表达式库，用于文本模式匹配
import uuid  # UUID生成库，用于创建唯一标识符
from datetime import datetime, timedelta  # 时间处理库
from collections import Counter  # 计数器库，用于统计数据
# from flask import Flask, request  # Flask框架（已注释，未使用）
from azure.identity import DefaultAzureCredential  # Azure默认身份认证
from azure.cosmos import CosmosClient, PartitionKey, exceptions  # Azure CosmosDB SDK
  
class CosmosConversationClient:
    """
    CosmosDB会话客户端
    
    这个类提供了与Azure CosmosDB数据库交互的所有方法。
    主要功能包括：
    1. commit历史记录的增删改查
    2. 周总结数据的管理
    3. 用户会话和消息的管理（保留的功能）
    4. 数据统计和分析功能
    5. 标签和时间范围的过滤查询
    
    注意：虽然类名包含"Conversation"，但现在主要用于管理commit相关数据
    """
    
    def __init__(self, cosmosdb_endpoint: str, credential: any, database_name: str, container_name: str):
        """
        初始化CosmosDB客户端
        
        Args:
            cosmosdb_endpoint (str): CosmosDB的端点URL
            credential: Azure身份认证凭据
            database_name (str): 数据库名称
            container_name (str): 容器名称
        """
        self.cosmosdb_endpoint = cosmosdb_endpoint
        self.credential = credential
        self.database_name = database_name
        self.container_name = container_name
        # 创建CosmosDB客户端连接
        self.cosmosdb_client = CosmosClient(self.cosmosdb_endpoint, credential=credential)
        # 获取数据库客户端
        self.database_client = self.cosmosdb_client.get_database_client(database_name)
        # 获取容器客户端
        self.container_client = self.database_client.get_container_client(container_name)

    # ===========================================
    # 正在使用的方法（项目中有调用）
    # ===========================================

    def check_weekly_summary(self, topic, language, root_commits_url, sort_order = 'DESC'):
        """
        检查本周是否已经存在周总结
        
        查询数据库中是否已经存在本周的weekly summary记录，
        避免重复生成周总结。
        
        Args:
            topic (str): 主题名称
            language (str): 语言
            root_commits_url (str): commit根URL
            sort_order (str): 排序方式，默认降序
            
        Returns:
            list: 本周的周总结列表，如果没有则返回None
        """
        # 构建查询参数
        parameters = [
            {
                'name': '@topic',
                'value': topic
            },
            {
                'name': '@language',
                'value': language
            },
            {
                'name': '@root_commits_url',
                'value': root_commits_url
            }
        ]
  
        # 获取当前UTC时间
        now = datetime.utcnow()  
        
        # 计算今天是本周的第几天，周一是0，周日是6
        today_weekday = now.weekday()  
        
        # 计算本周的周一
        this_monday = now - timedelta(days=(today_weekday))
        
        # 计算本周的周日（周一加6天）
        this_sunday = this_monday + timedelta(days=6)
        
        # 格式化为ISO8601字符串
        this_monday_str = this_monday.strftime("%Y-%m-%dT00:00:00")  
        this_sunday_str = this_sunday.strftime('%Y-%m-%dT23:59:59')  
        
        # 构建SQL查询语句，查找本周的weekly summary
        query = f"""  
            SELECT * FROM c  
            WHERE  
                CONTAINS(LOWER(c.teams_message_jsondata.title), '[weekly summary]') 
                AND c.topic = @topic  
                AND c.root_commits_url = @root_commits_url  
                AND c.language = @language 
                AND c.log_time >= '{this_monday_str}'  
                AND c.log_time <= '{this_sunday_str}'  
            ORDER BY c.log_time {sort_order}  
        """  
        # 执行查询
        weekly_summary_list = list(self.container_client.query_items(  
            query=query,  
            parameters=parameters,  
            enable_cross_partition_query=True))  

        # 返回结果
        if len(weekly_summary_list) == 0:
            return None
        else:
            return weekly_summary_list

    def create_commit_history(self, history_dict: dict):
        """
        创建commit历史记录
        
        将commit处理的历史记录保存到数据库中，
        包括GPT生成的内容、Teams消息数据等。
        
        Args:
            history_dict (dict): 包含commit历史信息的字典
            
        Returns:
            dict/bool: 成功时返回数据库响应，失败时返回False
        """
        # 为记录添加唯一ID和时间戳
        history_dict['id'] = str(uuid.uuid4())
        history_dict['log_time'] = datetime.utcnow().isoformat()
        
        # 将记录插入或更新到数据库
        resp = self.container_client.upsert_item(history_dict)  
        if resp:
            # 废弃的代码（保留作为参考）
            # ## update the parent conversations's updatedAt field with the current message's createdAt datetime value
            # conversation = self.get_conversation(user_id, conversation_id)
            # conversation['updatedAt'] = message['createdAt']
            # self.upsert_conversation(conversation)
            return resp
        else:
            return False

    def get_lastest_commit(self, topic, language, root_commits_url, sort_order = 'DESC'):
        """
        获取最新的commit记录

        查询数据库中指定主题、语言和URL的最新commit记录，
        用于确定下次处理的起始时间点。

        Args:
            topic (str): 主题名称
            language (str): 语言
            root_commits_url (str): commit根URL
            sort_order (str): 排序方式，默认降序

        Returns:
            dict/None: 最新的commit记录，如果没有则返回None
        """
        # 构建查询参数
        parameters = [
            {
                'name': '@topic',
                'value': topic
            },
            {
                'name': '@language',
                'value': language
            },
            {
                'name': '@root_commits_url',
                'value': root_commits_url
            }
        ]

        # 构建查询语句，获取最新的一条记录
        query = f"SELECT TOP 1 * FROM c where c.topic = @topic and c.root_commits_url = @root_commits_url and c.language = @language order by c.commit_time {sort_order}"

        # 执行查询
        lastest_commit = list(self.container_client.query_items(query=query, parameters=parameters,
                                                                               enable_cross_partition_query =True))
        ## 如果没有找到记录，返回None
        if len(lastest_commit) == 0:
            return None
        else:
            return lastest_commit[0]

    def get_pending_live_commits(self, repo_full_name):
        """
        取回所有 live_status='pending' 且 commit_sha 非空、且 root_commits_url 屬於指定 repo 的 doc。
        用於 sweeper：每輪 monitor 執行時掃 pending，比對 sha 是否已上 live 分支。

        Args:
            repo_full_name (str): e.g. "MicrosoftDocs/azure-ai-docs-pr"

        Returns:
            list[dict]: [{id, commit_sha, root_commits_url, ...}, ...]
        """
        query = (
            "SELECT c.id, c.commit_sha, c.root_commits_url, c.topic, c.language "
            "FROM c "
            "WHERE c.live_status = 'pending' "
            "AND IS_DEFINED(c.commit_sha) AND c.commit_sha != '' "
            "AND CONTAINS(c.root_commits_url, @repo)"
        )
        params = [{"name": "@repo", "value": repo_full_name}]
        return list(self.container_client.query_items(
            query=query,
            parameters=params,
            enable_cross_partition_query=True,
        ))

    def mark_commits_live(self, doc_ids, went_live_at):
        """
        把一批 doc 從 pending 翻成 live。用 upsert 策略（read → mutate → upsert）
        以避免和 monitor write path 競爭；每筆單獨處理，一筆失敗不影響其他。

        Args:
            doc_ids (list[str]): 要標 live 的 doc id list
            went_live_at (str): ISO timestamp 字串

        Returns:
            int: 成功更新的筆數
        """
        updated = 0
        for doc_id in doc_ids:
            try:
                query = "SELECT * FROM c WHERE c.id = @id"
                params = [{"name": "@id", "value": doc_id}]
                items = list(self.container_client.query_items(
                    query=query,
                    parameters=params,
                    enable_cross_partition_query=True,
                ))
                if not items:
                    continue
                doc = items[0]
                doc["live_status"] = "live"
                doc["went_live_at"] = went_live_at
                self.container_client.upsert_item(doc)
                updated += 1
            except Exception:
                continue
        return updated

    def get_commit_history(self):
        """
        获取所有commit历史记录
        
        获取数据库中的所有commit历史记录，主要用于数据分析和调试。
        
        Returns:
            list: 所有commit历史记录的列表
        """
        # 废弃的查询代码（保留作为参考）
        # parameters = [
        #     {
        #         'name': '@conversationId',
        #         'value': conversation_id
        #     },
        #     {
        #         'name': '@userId',
        #         'value': user_id
        #     }
        # ]
        # query = f"SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type='message' AND c.userId = @userId ORDER BY c.timestamp ASC"
        
        # 查询所有记录
        query = f"SELECT * FROM c"
        messages = list(self.container_client.query_items(query=query, enable_cross_partition_query =True))
        
        ## 如果没有找到消息，返回空列表
        if len(messages) == 0:
            return []
        else:
            return messages

    def get_weekly_commit(self, topic, language, root_commits_url, sort_order = 'DESC'):
        """
        获取指定条件的上周commit记录
        
        查询上周内指定主题、语言和URL的commit记录，
        特别筛选有GPT标题响应且状态为"post"但未生成周报摘要的记录。
        
        Args:
            topic (str): 主题名称
            language (str): 语言
            root_commits_url (str): commit根URL
            sort_order (str): 排序方式，默认降序
            
        Returns:
            list: 符合条件的commit记录列表
        """
        # 构建查询参数
        parameters = [
            {
                'name': '@topic',
                'value': topic
            },
            {
                'name': '@language',
                'value': language
            },
            {
                'name': '@root_commits_url',
                'value': root_commits_url
            }
        ]

        # 获取当前UTC时间  
        now = datetime.utcnow()  
        
        # 计算今天是这周的第几天，周一是0，周日是6  
        today_weekday = now.weekday()  
        
        # 计算上周的周一  
        last_monday = now - timedelta(days=(today_weekday+7))
        
        # 计算上周的周日（周一加6天）  
        last_sunday = last_monday + timedelta(days=6)
        
        # 格式化为ISO8601字符串  
        last_monday_str = last_monday.strftime("%Y-%m-%dT00:00:00")  
        last_sunday_str = last_sunday.strftime('%Y-%m-%dT23:59:59')  
        
        # 构建复杂查询语句，筛选上周有GPT响应但未生成周报的记录
        query = f"""  
            SELECT * FROM c  
            WHERE  
                c.topic = @topic  
                AND c.root_commits_url = @root_commits_url  
                AND c.language = @language  
                AND IS_DEFINED(c.gpt_title_response) 
                AND c.status = "post" 
                AND NOT IS_DEFINED(c.gpt_weekly_summary_tokens)
                AND c.commit_time >= '{last_monday_str}'  
                AND c.commit_time <= '{last_sunday_str}'  
            ORDER BY c.commit_time {sort_order}  
        """  
        # 废弃的查询语句（保留作为参考）
        # query = f"SELECT TOP 1 *FROM c WHERE c.topic = @topic AND c.root_commits_url = @root_commits_url AND c.language = @language AND c.commit_time >= (DateTimeOffset() - 7) ORDER BY c.commit_time {sort_order}"
        # 执行查询
        weekly_commit_list = list(self.container_client.query_items(query=query, parameters=parameters,
                                                                               enable_cross_partition_query =True))
        ## 如果没有找到记录，返回None
        if len(weekly_commit_list) == 0:
            return None
        else:
            return weekly_commit_list

    def get_value_list(self, name):
        """
        获取指定字段的唯一值列表（仅在archived/cosmosdb_ui.py中使用）
        
        查询数据库中指定字段的所有唯一值，用于统计分析。
        例如获取所有不同的主题名称、语言等。
        
        Args:
            name (str): 字段名称
            
        Returns:
            list: 唯一值列表
        """
        # 特殊处理：如果是获取标签（tag）信息
        if name == "tag":
            # 查询所有GPT标题响应
            query = 'SELECT c.gpt_title_response FROM c'  
            items = list(self.container_client.query_items(  
                query=query,  
                enable_cross_partition_query=True  
            ))  
            import re
            # 正则表达式，用于匹配括号内的内容（标签）
            pattern = re.compile(r"\[(.*?)\]")  
            
            # 遍历查询结果，提取所有标签
            extracted_data = []  
            for item in items:  
                title_response = item.get('gpt_title_response', '')  
                matches = pattern.findall(title_response)  
                if matches:  
                    # 每个匹配项都是括号内的文本（标签）
                    extracted_data.extend(matches)
            
            # 使用Counter计算每个标签的出现次数，并按计数降序排序  
            counter = Counter(extracted_data)  
            sorted_data = counter.most_common()  # 返回一个列表，其中包含出现次数的降序排列的元素和它们的计数
            sorted_elements = [element for element, count in sorted_data]
            count = [count for element, count in sorted_data] 
            return ["Select All"] + sorted_elements, count
        else:
            # 普通字段的处理：获取指定字段的所有唯一值
            query = f"SELECT c.{name} FROM c"  
            # 执行查询
            message = list(self.container_client.query_items(query=query, enable_cross_partition_query=True))
            if len(message) == 0:
                return ["None"]
            
            # 统计每个值的出现次数
            counts = Counter(item.get(name, '') for item in message if item)  

            # 按出现次数降序排序
            sorted_value_count_pairs = sorted(counts.items(), key=lambda pair: pair[1], reverse=True)  
    
            sorted_values  = [str(name) for name, count in sorted_value_count_pairs]  
            count  = [count for name, count in sorted_value_count_pairs] 

            return ["Select All"] + sorted_values, count

    def get_commit_time_list(self):
        """
        获取所有commit时间的列表（仅在archived/cosmosdb_ui.py中使用）
        
        查询数据库中所有commit的时间，按时间升序排列，
        用于时间筛选功能。
        
        Returns:
            list: commit时间列表，如果没有则返回None
        """
        # 查询所有commit时间，按时间升序排列
        query = f"SELECT c.commit_time FROM c ORDER BY c.commit_time ASC"  
        
        value_list = []  
        message = list(self.container_client.query_items(query=query, enable_cross_partition_query=True))
        if len(message) == 0:
            return None
        
        # 去重处理，构建唯一时间列表
        for item in message:
            if item == {}:
                continue
            if str(item["commit_time"]) not in value_list: 
                value_list.append(str(item["commit_time"])) 
        return value_list

    def get_current_select(self, topic, language, status, tag, post, start_time, end_time):
        """
        根据多个条件筛选commit记录（仅在archived/cosmosdb_ui.py中使用）
        
        这是一个复杂的查询方法，根据主题、语言、状态、标签、类型、时间范围等条件
        筛选commit记录，主要用于数据分析和报告生成。
        
        Args:
            topic (str): 主题名称
            language (str): 语言
            status (str): 状态
            tag (str): 标签
            post (str): 文章类型（如Weekly Summary）
            start_time (str): 开始时间
            end_time (str): 结束时间
            
        Returns:
            list: 符合条件的commit记录列表
        """
        # 构建查询参数字典
        query_parameters = {
            'topic': topic,
            'language': language,
            'status': status,
            'gpt_title_response': tag
        }
        
        # 构建查询条件
        query_conditions = []
        for param, value in query_parameters.items():
            if value is not None and value != "Select All":
                if param == 'gpt_title_response':
                    # 标签使用CONTAINS进行模糊匹配
                    query_conditions.append(f"CONTAINS(c.gpt_title_response, '{value}')")
                else:
                    # 其他字段使用精确匹配
                    query_conditions.append(f"c.{param} = @{param}")
        
        # 特殊处理：如果是Weekly Summary类型
        if post == 'Weekly Summary':
            query_conditions.append(f"CONTAINS(c.teams_message_jsondata.title, '[Weekly Summary]') OR CONTAINS(c.root_commiteams_message_jsondatats_url.title, '[Weekly Summary]')")
        
        # 拼接查询条件
        query_condition_str = " AND ".join(query_conditions)
        if query_condition_str:
            query_condition_str = "WHERE " + query_condition_str + " AND"
        else:
            query_condition_str = "WHERE "
        
        # 构建完整的查询语句，包含时间范围筛选
        query = f"""
        SELECT * FROM c
        {query_condition_str} 
            c.commit_time >= "{start_time}"
            AND c.commit_time <= "{end_time}"
        ORDER BY c.commit_time DESC
        """
        
        # 构建查询参数列表
        parameters = [
            {'name': f'@{k}', 'value': v}
            for k, v in query_parameters.items()
            if v is not None and v != "Select All"
        ]
        
        # 如果没有参数，设置为None
        if len(parameters) == 0:
            parameters = None 
        items = []
        
        # 执行查询
        try:
            items = list(self.container_client.query_items(
                query=query,
                parameters=parameters,
                enable_cross_partition_query=True
            ))
        except exceptions.CosmosHttpResponseError as e:
            print(f"查询时发生错误: {e.message}")
            # 根据需要处理异常，例如重新抛出或返回空列表
            return None  
        
        if len(items) == 0:  
            return None
        
        # 从'gpt_title_response'字段中提取括号内的值（标签）
        bracket_values = []
        pattern = re.compile(r"\[([^\]]+)\]")
        for item in items:
            matches = pattern.findall(item.get('gpt_title_response', ''))
            item['tag'] = matches
            bracket_values.extend(matches)

        # 统计标签出现次数并按降序排列
        value_counts = Counter(bracket_values)
        sorted_values = [value for value, count in value_counts.most_common()]
        count = [count for value, count in value_counts.most_common()]

        return items, sorted_values, count

    # ===========================================
    # 以下方法在项目中从未被调用（未使用的方法）
    # ===========================================
    
    def create_message(self, conversation_id, user_id, input_message: dict):
        """
        【未使用】创建消息记录（保留的功能，用于会话管理）
        
        这是原始设计中用于会话管理的功能，现在主要用create_commit_history。
        
        Args:
            conversation_id (str): 会话ID
            user_id (str): 用户ID
            input_message (dict): 输入消息内容
            
        Returns:
            dict/bool: 成功时返回数据库响应，失败时返回False
        """
        # 构建消息对象
        message = {
            'id': str(uuid.uuid4()),
            'type': 'message',
            'userId' : user_id,
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat(),
            'conversationId' : conversation_id,
            'role': input_message['role'],
            'content': input_message['content']
        }
        
        # 保存消息到数据库
        resp = self.container_client.upsert_item(message)  
        if resp:
            ## 更新父会话的updatedAt字段
            conversation = self.get_conversation(user_id, conversation_id)
            conversation['updatedAt'] = message['createdAt']
            self.upsert_conversation(conversation)
            return resp
        else:
            return False
    
    def create_conversation(self, user_id, title = ''):
        """
        【未使用】创建会话记录（保留的功能，用于会话管理）
        
        这是原始设计中用于会话管理的功能。
        
        Args:
            user_id (str): 用户ID
            title (str): 会话标题
            
        Returns:
            dict/bool: 成功时返回数据库响应，失败时返回False
        """
        # 构建会话对象
        conversation = {
            'id': str(uuid.uuid4()),  
            'type': 'conversation',
            'createdAt': datetime.utcnow().isoformat(),  
            'updatedAt': datetime.utcnow().isoformat(),  
            'userId': user_id,
            'title': title
        }
        ## TODO: 根据upsert_item调用的输出添加一些错误处理
        resp = self.container_client.upsert_item(conversation)  
        if resp:
            return resp
        else:
            return False
    
    def delete_conversation(self, user_id, conversation_id):
        """
        【未使用】删除会话记录（保留的功能）
        
        Args:
            user_id (str): 用户ID（分区键）
            conversation_id (str): 会话ID
            
        Returns:
            dict/bool: 删除结果
        """
        # 首先读取要删除的会话
        conversation = self.container_client.read_item(item=conversation_id, partition_key=user_id)        
        if conversation:
            # 如果会话存在，则删除它
            resp = self.container_client.delete_item(item=conversation_id, partition_key=user_id)
            return resp
        else:
            # 如果会话不存在，返回True（认为删除成功）
            return True

    def delete_messages(self, conversation_id, user_id):
        """
        【未使用】删除会话中的所有消息（保留的功能）
        
        Args:
            conversation_id (str): 会话ID
            user_id (str): 用户ID
            
        Returns:
            list: 删除操作的响应列表
        """
        ## 获取会话中的所有消息
        messages = self.get_messages(user_id, conversation_id)
        response_list = []
        if messages:
            # 逐个删除消息
            for message in messages:
                resp = self.container_client.delete_item(item=message['id'], partition_key=user_id)
                response_list.append(resp)
            return response_list
      
    def ensure(self):
        """
        【未使用】确保数据库连接正常
        
        检查CosmosDB客户端、数据库客户端和容器客户端是否正常工作。
        
        Returns:
            bool: 连接正常返回True，否则返回False
        """
        try:
            # 检查客户端是否已初始化
            if not self.cosmosdb_client or not self.database_client or not self.container_client:
                return False
            
            # 尝试读取容器信息来验证连接
            container_info = self.container_client.read()
            if not container_info:
                return False
            
            return True
        except:
            return False
        
    def get_conversations(self, user_id, sort_order = 'DESC'):
        """
        【未使用】获取用户的会话记录列表（保留的功能）
        
        查询指定用户的所有会话记录，按更新时间排序。
        这是原始设计中用于会话管理的功能。
        
        Args:
            user_id (str): 用户ID
            sort_order (str): 排序方式，默认降序
            
        Returns:
            list: 会话记录列表，如果没有则返回空列表
        """
        # 构建查询参数
        parameters = [
            {
                'name': '@userId',
                'value': user_id
            }
        ]
        
        # 查询用户的所有会话记录
        query = f"SELECT * FROM c where c.userId = @userId and c.type='conversation' order by c.updatedAt {sort_order}"
        conversations = list(self.container_client.query_items(query=query, parameters=parameters,
                                                                               enable_cross_partition_query =True))
        ## 如果没有找到会话，返回空列表
        if len(conversations) == 0:
            return []
        else:
            return conversations

    def get_conversation(self, user_id, conversation_id):
        """
        【未使用】获取指定的会话记录（保留的功能）
        
        根据用户ID和会话ID获取特定的会话记录。
        这是原始设计中用于会话管理的功能。
        
        Args:
            user_id (str): 用户ID
            conversation_id (str): 会话ID
            
        Returns:
            dict/None: 会话记录，如果没有找到则返回None
        """
        # 构建查询参数
        parameters = [
            {
                'name': '@conversationId',
                'value': conversation_id
            },
            {
                'name': '@userId',
                'value': user_id
            }
        ]
        
        # 查询特定的会话记录
        query = f"SELECT * FROM c where c.id = @conversationId and c.type='conversation' and c.userId = @userId"
        conversation = list(self.container_client.query_items(query=query, parameters=parameters,
                                                                               enable_cross_partition_query =True))
        ## 如果没有找到会话，返回None
        if len(conversation) == 0:
            return None
        else:
            return conversation[0]
 
    def get_messages(self, user_id, conversation_id):
        """
        【未使用】获取会话中的消息记录（保留的功能）
        
        获取指定会话中的所有消息记录，按时间戳排序。
        这是原始设计中用于会话管理的功能。
        
        Args:
            user_id (str): 用户ID
            conversation_id (str): 会话ID
            
        Returns:
            list: 消息记录列表，如果没有则返回空列表
        """
        # 构建查询参数
        parameters = [
            {
                'name': '@conversationId',
                'value': conversation_id
            },
            {
                'name': '@userId',
                'value': user_id
            }
        ]
        
        # 查询会话中的所有消息，按时间戳升序排列
        query = f"SELECT * FROM c WHERE c.conversationId = @conversationId AND c.type='message' AND c.userId = @userId ORDER BY c.timestamp ASC"
        messages = list(self.container_client.query_items(query=query, parameters=parameters,
                                                                     enable_cross_partition_query =True))
        ## 如果没有找到消息，返回空列表
        if len(messages) == 0:
            return []
        else:
            return messages

    def get_timestamp(self, name, start_time, end_time):
        """
        【未使用】获取时间范围内的主题统计信息
        
        查询指定时间范围内的所有主题，并进行分组统计。
        用于生成时间段内的主题分布报告。
        
        Args:
            name (str): 字段名称（当前未使用）
            start_time (str): 开始时间
            end_time (str): 结束时间
            
        Returns:
            list: 主题统计信息列表
        """
        # 构建查询语句，按主题分组
        query = f"""  
            SELECT c.topic
            FROM c  
            WHERE  
                c.commit_time >= "{start_time}" AND  
                c.commit_time <= "{end_time}"  
            GROUP BY c.topic  
            ORDER BY c.topic  
        """
        print(query)
        
        # 执行查询
        try:  
            results = list(self.container_client.query_items(  
                query=query,
                enable_cross_partition_query=True  
            ))  
            print(results)
        except exceptions.CosmosHttpResponseError as e:  
            print(f"查询时发生错误: {e.message}")

    def upsert_conversation(self, conversation):
        """
        【未使用】更新或插入会话记录（保留的功能）
        
        使用upsert操作更新或插入会话记录到数据库。
        这是原始设计中用于会话管理的功能。
        
        Args:
            conversation (dict): 会话记录对象
            
        Returns:
            dict/bool: 成功时返回数据库响应，失败时返回False
        """
        # 执行upsert操作
        resp = self.container_client.upsert_item(conversation)
        if resp:
            return resp
        else:
            return False
