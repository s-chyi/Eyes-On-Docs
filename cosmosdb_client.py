# 导入必要的库
import os  # 系统环境变量操作
import datetime  # 时间处理库
import time  # 时间戳转换库
from azure.identity import ClientSecretCredential  # Azure身份认证库
from cosmosdbservice import CosmosConversationClient  # CosmosDB服务客户端
from logs import logger  # 日志记录器
from dotenv import load_dotenv  # 环境变量加载器

# 加载环境变量配置文件
load_dotenv(override=True)  # 允许覆盖环境变量

class CosmosDBHandler:  
    """
    CosmosDB数据库处理器
    
    这个类负责管理与Azure CosmosDB的连接和时间管理功能。
    主要功能包括：
    1. 初始化CosmosDB客户端连接
    2. 确定commit处理的起始时间点
    3. 管理本地时间文件的读写操作
    
    通过结合数据库中的最新记录和本地时间文件，智能确定下次处理的起始时间，
    避免重复处理已处理的commit。
    """
    def __init__(self):  
        """
        初始化CosmosDB处理器
        
        从环境变量中加载Azure CosmosDB的连接配置信息，
        包括数据库账户、认证信息等。
        """
        # 从环境变量获取CosmosDB配置信息
        self.database = os.getenv("AZURE_COSMOSDB_DATABASE")  # 数据库名称
        self.account = os.getenv("AZURE_COSMOSDB_ACCOUNT")  # CosmosDB账户名
        self.container = os.getenv("AZURE_COSMOSDB_CONVERSATIONS_CONTAINER")  # 容器名称
        self.account_key = os.getenv("AZURE_COSMOSDB_ACCOUNT_KEY")  # 账户密钥（备用）
        
        # Azure AD应用认证信息
        self.app_tenant_id = os.getenv("APP_TENANT_ID")  # 租户ID
        self.app_client_id = os.getenv("APP_CLIENT_ID")  # 客户端ID
        self.app_client_secret = os.getenv("APP_CLIENT_SECRET")  # 客户端密钥

    def initialize_cosmos_client(self):  
        """
        初始化CosmosDB客户端连接
        
        使用Azure AD服务主体认证方式连接CosmosDB，相比使用账户密钥更安全。
        如果连接成功，设置保存标志为True；失败则设置为False。
        
        Returns:
            CosmosConversationClient: 成功时返回CosmosDB客户端实例，失败时返回None
        """
        try:  
            # 构建CosmosDB的端点URL
            endpoint = f'https://{self.account}.documents.azure.com:443/'  

            # 废弃的认证方式（保留作为参考）
            # if not self.account_key:
            #     credential = DefaultAzureCredential()  # 使用默认Azure凭据
            # else:
            #     credential = self.account_key  # 使用账户密钥

            # 使用Azure AD服务主体认证（推荐方式）
            credential = ClientSecretCredential(
                tenant_id=self.app_tenant_id,
                client_id=self.app_client_id,
                client_secret=self.app_client_secret
            )

            # 创建CosmosDB客户端实例
            client = CosmosConversationClient(  
                cosmosdb_endpoint=endpoint,   
                credential=credential,   
                database_name=self.database,  
                container_name=self.container  
            )  
            logger.info("Successfully initialized the CosmosDB client!")  
            
            # 设置标志表示可以保存commit历史到数据库
            self.save_commit_history_to_cosmosdb = True
            return client  
        except Exception as e:  
            logger.exception("An exception occurred during CosmosDB initialization", e)  
            # 设置标志表示无法保存到数据库
            self.save_commit_history_to_cosmosdb = False
            return None  
   
    def get_start_time(self, lastest_commit_in_cosmosdb):  
        """
        获取commit处理的起始时间点
        
        这个方法通过比较数据库中的最新commit时间和本地时间文件，
        智能决定下次处理commit的起始时间点。避免重复处理已处理的commit。
        
        优先级逻辑：
        1. 如果都没有记录：使用当前时间，并写入本地文件
        2. 如果只有本地文件：使用本地文件时间
        3. 如果只有数据库记录：使用数据库时间
        4. 如果都有记录：使用较新的时间
        
        Args:
            lastest_commit_in_cosmosdb: 数据库中最新的commit记录
            
        Returns:
            datetime: 处理commit的起始时间点
        """
        # 从数据库记录中提取最新commit时间
        lastest_commit_time_in_cosmosdb = None  
        try:
            if lastest_commit_in_cosmosdb:
                # 提取commit时间字符串并转换为datetime对象
                lastest_commit_time_in_cosmosdb = lastest_commit_in_cosmosdb['commit_time']
                lastest_commit_time_in_cosmosdb = lastest_commit_time_in_cosmosdb.strip()
                lastest_commit_time_in_cosmosdb = datetime.datetime.strptime(
                    lastest_commit_time_in_cosmosdb, "%Y-%m-%d %H:%M:%S"
                )
        except Exception as e:  
            logger.exception("Exception in getting lastest_commit_time_in_cosmosdb", e)  
  
        # 从本地文件读取上次爬取时间
        time_in_last_crawl_time_txt = self.read_time()  
  
        # 获取当前时间并转换为UTC时间
        time_now = datetime.datetime.now()
        time_now_struct = time.mktime(time_now.timetuple())
        time_now_utc = datetime.datetime.utcfromtimestamp(time_now_struct)
  
        # 情况1：数据库和本地文件都没有记录
        if lastest_commit_time_in_cosmosdb is None and time_in_last_crawl_time_txt is None:
            # 使用当前时间作为起始时间，并写入本地文件保存
            self.write_time(time_now_utc)
            logger.warning(f"No Commit in cosmosdb! Use current time as start time: {time_now_utc}")
            return time_now
        # 情况2：只有本地文件有记录
        elif lastest_commit_time_in_cosmosdb == None and time_in_last_crawl_time_txt != None:
            logger.warning(f"No Commit in cosmosdb! Use last_crawl_time.txt as start time: {time_in_last_crawl_time_txt}")
            return time_in_last_crawl_time_txt  
        # 情况3：只有数据库有记录
        elif lastest_commit_time_in_cosmosdb != None and time_in_last_crawl_time_txt == None:
            logger.warning(f"Found Commits in cosmosdb! Use lastest_commit_time_in_cosmosdb as start time: {lastest_commit_time_in_cosmosdb}")
            return lastest_commit_time_in_cosmosdb  
        # 情况4：数据库和本地文件都有记录
        elif lastest_commit_time_in_cosmosdb != None and time_in_last_crawl_time_txt != None:
            # 一律用 Cosmos：txt 在 ACA container ephemeral fs、每次重啟變當下時間，
            # 若採「取較新」邏輯會讓 Cosmos checkpoint 永遠被今天覆蓋、PAT 過期期間的
            # commit 一旦補不回就永久跳過。Cosmos 是唯一 durable state。
            logger.warning(f"Use lastest_commit_time_in_cosmosdb as start time (ignoring ephemeral txt={time_in_last_crawl_time_txt}): {lastest_commit_time_in_cosmosdb}")
            return lastest_commit_time_in_cosmosdb
        
    def write_time(self, update_time):
        """
        将时间写入本地时间文件
        
        将指定的时间写入到'last_crawl_time.txt'文件中，
        用于记录上次处理commit的时间点。这个文件作为备份机制，
        当数据库不可用时可以使用文件中的时间作为起始点。
        
        Args:
            update_time (datetime): 要写入的时间
        """
        try:
            # 以写入模式打开文件，写入时间字符串
            with open('last_crawl_time.txt', 'w') as f:
                f.write(str(update_time))
            f.close()
            logger.warning(f"Update last_crawl_time.txt: {update_time}")
        except Exception as e:
            logger.exception("Exception in write_time", e)

    def read_time(self):
        """
        从本地时间文件读取时间
        
        从'last_crawl_time.txt'文件中读取上次记录的时间。
        如果文件不存在或格式错误，返回None。
        
        Returns:
            datetime: 文件中记录的时间，失败时返回None
        """
        try:
            # 打开文件并读取第一行内容
            with open('last_crawl_time.txt') as f:
                time_in_file_readline = f.readline().strip()
                # 将字符串转换为datetime对象
                time_in_file = datetime.datetime.strptime(
                    time_in_file_readline, "%Y-%m-%d %H:%M:%S"
                )
        except Exception as e:
            # logger.error(f"Error reading time from file: {e}")  # 注释掉的旧日志方式
            logger.exception("Exception in read_time", e)
            time_in_file = None
        return time_in_file
