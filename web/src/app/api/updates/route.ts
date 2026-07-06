import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getCosmosClient } from '@/lib/cosmos';

export async function GET(request: Request) {
  const client = getCosmosClient();
  const { searchParams } = new URL(request.url);
  logger.info(`请求URL: ${request.url}`);
  const product = searchParams.get('product');
  const language = searchParams.get('language');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  const updateType = searchParams.get('updateType') || 'single';

  logger.debug(`收到请求参数：product=${product}, language=${language}, page=${page}, updateType=${updateType}`);

  try {
    let parameters = [];
    let conditions = [];
    let queryText = "";

    logger.debug(`初始查询文本: ${queryText}`);

    // Default to first product if not specified
    const defaultProduct = 'AOAI-V2';
    const defaultLanguage = 'Chinese';

    if (product) {
      conditions.push("c.topic = @product");
      parameters.push({ name: '@product', value: product });
      logger.debug(`添加产品过滤条件: ${product}`);
    } else {
      conditions.push("c.topic = @product");
      parameters.push({ name: '@product', value: defaultProduct });
      logger.debug(`添加默认产品过滤条件: ${defaultProduct}`);
    }

    if (language) {
      conditions.push("c.language = @language");
      parameters.push({ name: '@language', value: language });
      logger.debug(`添加语言过滤条件: ${language}`);
    } else {
      conditions.push("c.language = @language");
      parameters.push({ name: '@language', value: defaultLanguage });
      logger.debug(`添加默认语言过滤条件: ${defaultLanguage}`);
    }

    // 根据 updateType 调整查询条件
    const query = updateType === 'weekly' 
      ? 'SELECT * FROM c WHERE IS_DEFINED(c.gpt_weekly_summary_tokens) AND c.topic = @product AND c.language = @language AND NOT IS_NULL(c.teams_message_jsondata)'
      : 'SELECT * FROM c WHERE IS_DEFINED(c.gpt_title_response) AND c.status != "skip" AND NOT IS_DEFINED(c.gpt_weekly_summary_tokens) AND c.topic = @product AND c.language = @language';

    queryText = query;
    logger.debug(`更新后的查询文本: ${queryText}`);

    // 添加排序和分页
    queryText += " ORDER BY c.commit_time DESC OFFSET @offset LIMIT @limit";
    parameters.push(
      { name: '@offset', value: offset },
      { name: '@limit', value: pageSize }
    );
    logger.debug(`添加排序和分页参数：offset=${offset}, limit=${pageSize}`);

    logger.debug(`最终查询参数: ${JSON.stringify(parameters)}`);

    const { resources: updates } = await client.database(process.env.AZURE_COSMOSDB_DATABASE!).container(process.env.AZURE_COSMOSDB_CONVERSATIONS_CONTAINER!).items
      .query({ query: queryText, parameters })
      .fetchAll();

    logger.debug(`获取到${updates.length}条更新记录`);

    // 转换数据
    const transformedUpdates = updates
      .filter(update => {
        // 对于周总结，检查 teams_message_jsondata！！！ 
        if (updateType === 'weekly') {
          return update.teams_message_jsondata && 
                 update.teams_message_jsondata.title && 
                 update.teams_message_jsondata.text;
        }
        // 对于单个更新，保持原有逻辑
        return update.gpt_title_response && !update.gpt_title_response.startsWith('0');
      })
      .map(update => {
        let tag = '';
        let title = '';
        let gptSummary = '';

        if (updateType === 'weekly') {
          // 从 teams_message_jsondata 提取信息
          const teamsData = update.teams_message_jsondata;
          title = teamsData.title.replace(/\[Weekly Summary\]\s*/g, '').trim();
          gptSummary = teamsData.text;

          // 尝试从标题中提取标签
          const tagMatch = title.match(/^\[(.*?)\]/);
          if (tagMatch) {
            tag = tagMatch[1].trim();
          }
        } else {
          // 单个更新的原有逻辑  其实不用在前端处理 0,1, 后端已经处理好了，放在 teams_message_jsondata.title中了
          // 后端已经处理好了 teams_message_jsondata.text =  commit_time +   gpt_summary_response（这里没用）
          const extractTagAndTitle = (titleResponse: string) => {
            const titleWithoutNumber = titleResponse.replace(/^\d+\s*/, '');
            const tagMatch = titleWithoutNumber.match(/^\[(.*?)\]\s*(.+)$/);
            
            if (tagMatch) {
              return {
                tag: tagMatch[1].trim(),
                title: tagMatch[2].trim()
              };
            }
            
            return {
              tag: '',
              title: titleWithoutNumber.trim()
            };
          };

          const { tag: extractedTag, title: extractedTitle } = extractTagAndTitle(update.gpt_title_response);
          tag = extractedTag;
          title = extractedTitle;
          gptSummary = update.gpt_summary_response;
        }

        logger.debug(`单条更新字段: ${JSON.stringify({id: update.id,tag: tag,title: title,gptSummary: gptSummary})}`);

        return {
          id: update.id,
          tag: tag,
          title: title,
          gptSummary: gptSummary,
          timestamp: update.commit_time,
          commitUrl: update.commit_url,
          liveStatus: update.live_status ?? 'unknown',
          wentLiveAt: update.went_live_at ?? null,
        };
      });

        logger.debug(`Transformed ${transformedUpdates.length} updates`);

    // 获取总数的查询条件
    const getCountCondition = (updateType: string) => {
      switch (updateType) {
        case 'weekly':
          return 'IS_DEFINED(c.gpt_weekly_summary_tokens)';
        case 'single':
        default:
          return 'IS_DEFINED(c.gpt_title_response) AND c.status != "skip" AND NOT IS_DEFINED(c.gpt_weekly_summary_tokens)';
      }
    };

    // 获取总数
    const countQuery = {
      query: `SELECT VALUE COUNT(1) FROM c WHERE ${getCountCondition(updateType)} AND c.topic = @product AND c.language = @language`,
      parameters: parameters.filter(p => !['@offset', '@limit'].includes(p.name))
    };
    logger.debug(`计数查询: ${JSON.stringify(countQuery)}`);

    const { resources: [totalCount] } = await client.database(process.env.AZURE_COSMOSDB_DATABASE!).container(process.env.AZURE_COSMOSDB_CONVERSATIONS_CONTAINER!).items.query(countQuery).fetchAll();
    logger.debug(`更新记录总数: ${totalCount}`);

    // 计算总页数
    const totalPages = Math.ceil(totalCount / pageSize);

    const response = {
      updates: transformedUpdates,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalCount,
        pageSize: pageSize
      }
    };

    logger.debug(`最终响应: ${JSON.stringify(response, null, 2)}`);

    return NextResponse.json(response);
  } catch (error) {
    logger.error(`获取更新记录失败: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to fetch updates', details: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
