from typing import Any, Optional
import httpx
from mcp.server.fastmcp import FastMCP
import os

# 初始化FastMCP服务器
# host/port 走 env var（FASTMCP_HOST / FASTMCP_PORT），在 ACA 內綁 0.0.0.0:8000 讓 ingress 進得來
mcp = FastMCP(
    "doc_updates",
    host=os.environ.get("FASTMCP_HOST", "0.0.0.0"),
    port=int(os.environ.get("FASTMCP_PORT", "8000")),
)

# 常量
API_BASE = os.environ.get("API_BASE", "https://docs.westiedoubao.com/api")
USER_AGENT = "doc-updates-app/1.0"
DEFAULT_PRODUCTS = [
    "Microsoft-Foundry",
    "AI-Foundry",
    "AOAI-V2",
    "Agent-Service",
    "Model-Inference",
    "AML",
    "Cog-speech-service",
    "Cog-content-understanding",
    "Cog-computer-vision",
    "Cog-content-safety",
    "Cog-custom-vision-service",
    "Cog-document-intelligence",
    "Cog-language-service",
    "Cog-translator",
    "IoT-iot-central",
    "IoT-iot-develop",
    "IoT-iot-dps",
    "IoT-iot-edge",
    "IoT-iot-hub-device-update",
    "IoT-iot-hub",
]

async def make_api_request(url: str, extra_headers: Optional[dict[str, str]] = None) -> dict[str, Any] | None:
    """向API发送请求，并进行适当的错误处理。"""
    print(f"[mcp outbound] GET {url}", flush=True)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json"
    }
    if extra_headers:
        headers.update(extra_headers)
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, headers=headers, timeout=30.0)
            response.raise_for_status()
            # print("DEBUG: data from API:", response.json())
            return response.json()
        except Exception as e:
            # print("DEBUG: exception:", e)
            return {"error": str(e)}

def _format_live_status(update: dict) -> str:
    """把 live_status/wentLiveAt 轉為人可讀的一行文字。"""
    status = update.get("liveStatus")
    if status == "live":
        went = update.get("wentLiveAt")
        if went:
            return f"已发布到 learn.microsoft.com (自 {went})"
        return "已发布到 learn.microsoft.com"
    if status == "pending":
        return "尚未发布到 learn.microsoft.com（仅已 merge 到文档 staging 分支）"
    return "发布状态未知"


def format_update(update: dict) -> str:
    """将更新数据格式化为可读字符串。"""
    return f"""
标签: {update.get('tag', '无标签')}
标题: {update.get('title', '无标题')}
时间: {update.get('timestamp', '未知时间')}
发布状态: {_format_live_status(update)}
摘要: {update.get('gptSummary', '无摘要')}
提交链接: {update.get('commitUrl', '无链接')}
"""

def format_search_update(product: str, update: dict) -> str:
    """将搜索结果格式化为包含 fetch id 的可读字符串。"""
    update_id = update.get("id", "")
    return f"""
ID: {product}:{update_id}
产品: {product}
标签: {update.get('tag', '无标签')}
标题: {update.get('title', '无标题')}
时间: {update.get('timestamp', '未知时间')}
发布状态: {_format_live_status(update)}
摘要: {update.get('gptSummary', '无摘要')}
提交链接: {update.get('commitUrl', '无链接')}
"""

async def get_products() -> list[str]:
    """从 Web API 获取产品列表，失败时使用本地 fallback。"""
    data = await make_api_request(f"{API_BASE}/products")
    if data and isinstance(data.get("products"), list):
        return data["products"]
    return DEFAULT_PRODUCTS

@mcp.tool()
async def get_doc_updates(
    product: str = "AOAI-V2", 
    language: str = "Chinese", 
    page: int = 1, 
    update_type: str = "single"
) -> str:
    """
    本工具用于获取 Azure AI 相关产品的文档更新信息。

    Args:
        product: 产品名称。可选值如下（区分大小写）：
            - Microsoft-Foundry
            - AOAI-V2
            - AI-Foundry
            - Agent-Service
            - Model-Inference
            - AML
            - Cog-speech-service
            - Cog-document-intelligence
            - Cog-language-service
            - Cog-translator
            - Cog-content-safety
            - Cog-computer-vision
            - Cog-custom-vision-service
            - IoT-iot-hub
            - IoT-iot-edge
            - IoT-iot-dps
            - IoT-iot-central
            - IoT-iot-hub-device-update
          默认为 "AOAI-V2"。
        language: 语言。可选值："Chinese"、"English"，默认为 "Chinese"。
        page: 页码，正整数，默认为 1。
        update_type: 更新类型，可选值：
            - "single"：单条更新（每次提交的独立变更，适合追踪具体文档的每次修改）
            - "weekly"：周总结（每周的文档变更摘要，适合快速了解本周主要变更）
          默认为 "single"。

    注意事项：
    - 参数必须严格按照上述可选值填写，否则可能导致无结果或报错。
    - 单条更新（single）返回每次文档提交的详细信息，适合细粒度追踪。
    - 周总结（weekly）返回每周的汇总摘要，内容更为概括。
    - 若未找到数据，将返回提示信息。

    示例：
        get_doc_updates(product="AOAI-V2", language="Chinese", page=1, update_type="single")
    """
    url = f"{API_BASE}/updates?product={product}&language={language}&page={page}&updateType={update_type}"
    data = await make_api_request(url)

    if not data or "updates" not in data:
        return "无法获取更新数据或未找到更新。"

    if not data["updates"]:
        return f"没有找到符合条件的更新：产品={product}，语言={language}，页码={page}，更新类型={update_type}"

    # 格式化分页信息
    pagination = data.get("pagination", {})
    pagination_info = f"""
==== 分页信息 ====
当前页: {pagination.get('currentPage', 1)}
总页数: {pagination.get('totalPages', 0)}
总条目: {pagination.get('totalItems', 0)}
每页条数: {pagination.get('pageSize', 20)}
"""

    # 格式化更新列表
    updates_formatted = [format_update(update) for update in data["updates"]]
    updates_text = "\n==== 更新分割线 ====\n".join(updates_formatted)

    return f"{pagination_info}\n\n{updates_text}"

@mcp.tool()
async def get_usage_stats(
    start_time: Optional[str] = None, 
    end_time: Optional[str] = None, 
    exclude_users: str = ""
) -> str:
    """
    本工具用于获取 docs.westiedoubao.com（Azure AI 文档更新追踪网站）的使用统计数据。

    Args:
        start_time: 开始时间，ISO日期时间格式，如"2023-05-01T00:00:00Z"
        end_time: 结束时间，ISO日期时间格式，如"2023-05-31T23:59:59Z"
        exclude_users: 要排除的用户列表，用逗号分隔
    """
    # 从环境变量获取管理员密码
    password = os.environ.get("DOCS_USAGE_ADMIN_PASSWORD", "")
    if not password:
        return "错误：需要在环境变量 DOCS_USAGE_ADMIN_PASSWORD 中设置管理员密码才能访问使用统计数据。"
    
    auth_url = f"{API_BASE}/usage/auth"
    async with httpx.AsyncClient() as client:
        try:
            auth_response = await client.post(
                auth_url, 
                json={"password": password},
                headers={"Content-Type": "application/json"},
                timeout=30.0
            )
            auth_response.raise_for_status()
        except Exception as e:
            return f"认证失败：{str(e)}"

    # 构建查询参数
    params = []
    if start_time:
        params.append(f"startTime={start_time}")
    if end_time:
        params.append(f"endTime={end_time}")
    if exclude_users:
        params.append(f"excludeUsers={exclude_users}")
    
    query_string = "&".join(params)
    url = f"{API_BASE}/usage"
    if query_string:
        url = f"{url}?{query_string}"
    
    data = await make_api_request(url, extra_headers={"x-admin-password": password})
    
    if not data or "error" in data:
        return f"无法获取使用统计数据：{data.get('error', '未知错误')}"
    
    # 格式化用户统计数据
    user_stats = data.get("userStats", [])
    user_stats_text = "==== 用户访问统计 ====\n"
    for stat in user_stats[:10]:  # 只显示前10个用户
        user_stats_text += f"用户: {stat.get('name', '匿名')} - 访问次数: {stat.get('recordCount', 0)}\n"
    
    # 格式化每日统计数据
    daily_stats = data.get("dailyStats", [])
    daily_stats_text = "\n==== 每日访问统计 ====\n"
    for stat in daily_stats[-7:]:  # 只显示最近7天
        daily_stats_text += f"日期: {stat.get('date', '未知')} - 访问次数: {stat.get('count', 0)}\n"
    
    # 格式化用户增长统计
    growth_stats = data.get("userGrowthStats", [])
    growth_stats_text = "\n==== 用户增长统计 ====\n"
    for stat in growth_stats[-7:]:  # 只显示最近7天
        growth_stats_text += f"日期: {stat.get('date', '未知')} - 累计用户数: {stat.get('totalUsers', 0)}\n"
    
    # 格式化产品每日统计
    product_stats = data.get("productDailyStats", [])
    product_stats_text = "\n==== 产品每日访问统计 ====\n"
    product_summary = {}
    for stat in product_stats:
        product = stat.get('product', '未知产品')
        count = stat.get('count', 0)
        if product in product_summary:
            product_summary[product] += count
        else:
            product_summary[product] = count
    
    for product, count in sorted(product_summary.items(), key=lambda x: x[1], reverse=True):
        product_stats_text += f"产品: {product} - 总访问次数: {count}\n"
    
    return f"{user_stats_text}{daily_stats_text}{growth_stats_text}{product_stats_text}"

@mcp.tool()
async def search_updates(
    keyword: str, 
    product: str = "AOAI-V2", 
    language: str = "Chinese"
) -> str:
    """
    本工具用于检索 Azure AI 相关产品的文档更新信息。

    参数说明：
        keyword: 要搜索的关键词，支持模糊匹配。
        product: 产品名称。可选值如下（区分大小写）：
            - Microsoft-Foundry
            - AOAI-V2
            - AI-Foundry
            - Agent-Service
            - Model-Inference
            - AML
            - Cog-speech-service
            - Cog-document-intelligence
            - Cog-language-service
            - Cog-translator
            - Cog-content-safety
            - Cog-computer-vision
            - Cog-custom-vision-service
            - IoT-iot-hub
            - IoT-iot-edge
            - IoT-iot-dps
            - IoT-iot-central
            - IoT-iot-hub-device-update
          默认为 "AOAI-V2"。
        language: 语言。可选值："Chinese"、"English"，默认为 "Chinese"。

    注意事项：
    - 参数必须严格按照上述可选值填写，否则可能导致无结果或报错。
    - 仅搜索单条更新（single），不包含周总结。
    - 只会返回前 3 页的匹配结果，最多显示 5 条。

    示例：
        search_updates(keyword="API", product="AOAI-V2", language="Chinese")
    """
    # 搜索多页结果
    found_updates = []
    for page in range(1, 4):  # 只搜索前3页
        url = f"{API_BASE}/updates?product={product}&language={language}&page={page}&updateType=single"
        data = await make_api_request(url)
        
        if not data or "updates" not in data or not data["updates"]:
            break
            
        # 筛选包含关键词的更新
        for update in data["updates"]:
            update_text = update.get('title', '') + ' ' + update.get('gptSummary', '')
            if keyword.lower() in update_text.lower():
                found_updates.append(update)
    
    if not found_updates:
        return f"未找到包含关键词 '{keyword}' 的更新。"
    
    # 格式化搜索结果
    updates_formatted = [format_update(update) for update in found_updates[:5]]  # 只显示前5个结果
    updates_text = "\n==== 结果分割线 ====\n".join(updates_formatted)
    
    return f"找到 {len(found_updates)} 条包含关键词 '{keyword}' 的更新，显示前 {min(5, len(found_updates))} 条：\n\n{updates_text}"

@mcp.tool()
async def search(query: str) -> str:
    """
    Search Azure AI documentation updates across tracked products.
    
    Args:
        query: Keyword to search in update titles and summaries.
    """
    query = query.strip()
    if not query:
        return "请输入要搜索的关键词。"

    products = await get_products()
    found_updates = []

    for product in products:
        for page in range(1, 4):
            url = f"{API_BASE}/updates?product={product}&language=Chinese&page={page}&updateType=single"
            data = await make_api_request(url)

            if not data or "updates" not in data or not data["updates"]:
                break

            for update in data["updates"]:
                update_text = update.get("title", "") + " " + update.get("gptSummary", "")
                if query.lower() in update_text.lower():
                    found_updates.append((product, update))

    if not found_updates:
        return f"未找到包含关键词 '{query}' 的文档更新。"

    formatted = [
        format_search_update(product, update)
        for product, update in found_updates[:10]
    ]
    return f"找到 {len(found_updates)} 条包含关键词 '{query}' 的更新，显示前 {min(10, len(found_updates))} 条：\n\n" + "\n==== 结果分割线 ====\n".join(formatted)

@mcp.tool()
async def fetch(id: str) -> str:
    """
    Retrieve a documentation update by ID returned from search.

    Args:
        id: The update ID. Must use the "product:update_id" format returned by search.
    """
    update_id = id.strip()
    if not update_id:
        return "请输入要获取的更新 ID。"

    # 沒有 product prefix 直接拒絕，避免 fanning out 到 20 products × 10 pages × 30s timeout（超過 ACA 240s idle）
    if ":" not in update_id:
        return "无效的 ID 格式。请使用 search 回傳的 \"product:update_id\" 格式。"

    requested_product, update_id = update_id.split(":", 1)
    products = [requested_product]

    for product in products:
        for page in range(1, 4):  # 最多 3 頁，配合 ACA idle timeout
            url = f"{API_BASE}/updates?product={product}&language=Chinese&page={page}&updateType=single"
            data = await make_api_request(url)

            if not data or "updates" not in data or not data["updates"]:
                break

            for update in data["updates"]:
                if update.get("id") == update_id:
                    return format_search_update(product, update)

    return f"未找到更新：产品={requested_product}，ID={update_id}。"

if __name__ == "__main__":
    # 运行 HTTP streamable 服务器
    # 这是推荐的 web 部署方式，适合通过网络访问
    mcp.run(transport="streamable-http")
    # mcp.run(transport='stdio')
