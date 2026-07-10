import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getCosmosClient } from '@/lib/cosmos';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;

export async function GET(request: Request) {
  const client = getCosmosClient();
  const { searchParams } = new URL(request.url);
  logger.info(`请求URL: ${request.url}`);
  const product = searchParams.get('product');
  const productsParam = searchParams.get('products');
  const language = searchParams.get('language');
  const since = searchParams.get('since');
  const until = searchParams.get('until');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSizeParam = parseInt(searchParams.get('pageSize') || '', 10);
  const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0
    ? Math.min(pageSizeParam, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;
  const updateType = searchParams.get('updateType') || 'single';

  logger.debug(`收到请求参数：product=${product}, products=${productsParam}, language=${language}, since=${since}, until=${until}, page=${page}, pageSize=${pageSize}, updateType=${updateType}`);

  try {
    const parameters: { name: string; value: any }[] = [];

    const defaultProduct = 'AOAI-V2';
    const defaultLanguage = 'Chinese';

    // Product / products filter
    let productClause = '';
    const productsList = productsParam
      ? productsParam.split(',').map(s => s.trim()).filter(Boolean)
      : null;

    if (productsList && productsList.length > 0) {
      productClause = 'ARRAY_CONTAINS(@products, c.topic)';
      parameters.push({ name: '@products', value: productsList });
      logger.debug(`添加多产品过滤条件: ${JSON.stringify(productsList)}`);
    } else if (product) {
      productClause = 'c.topic = @product';
      parameters.push({ name: '@product', value: product });
      logger.debug(`添加产品过滤条件: ${product}`);
    } else {
      productClause = 'c.topic = @product';
      parameters.push({ name: '@product', value: defaultProduct });
      logger.debug(`添加默认产品过滤条件: ${defaultProduct}`);
    }

    // Language filter
    const languageValue = language || defaultLanguage;
    parameters.push({ name: '@language', value: languageValue });
    logger.debug(`语言过滤条件: ${languageValue}`);

    // Time range filters
    let timeClause = '';
    if (since) {
      timeClause += ' AND c.commit_time >= @since';
      parameters.push({ name: '@since', value: since });
    }
    if (until) {
      timeClause += ' AND c.commit_time <= @until';
      parameters.push({ name: '@until', value: until });
    }

    // Base WHERE per updateType
    const baseWhere = updateType === 'weekly'
      ? `IS_DEFINED(c.gpt_weekly_summary_tokens) AND ${productClause} AND c.language = @language AND NOT IS_NULL(c.teams_message_jsondata)`
      : `IS_DEFINED(c.gpt_title_response) AND c.status != "skip" AND NOT IS_DEFINED(c.gpt_weekly_summary_tokens) AND ${productClause} AND c.language = @language`;

    let queryText = `SELECT * FROM c WHERE ${baseWhere}${timeClause}`;
    queryText += ' ORDER BY c.commit_time DESC OFFSET @offset LIMIT @limit';
    parameters.push(
      { name: '@offset', value: offset },
      { name: '@limit', value: pageSize }
    );
    logger.debug(`最终查询文本: ${queryText}`);
    logger.debug(`最终查询参数: ${JSON.stringify(parameters)}`);

    const { resources: updates } = await client.database(process.env.AZURE_COSMOSDB_DATABASE!).container(process.env.AZURE_COSMOSDB_CONVERSATIONS_CONTAINER!).items
      .query({ query: queryText, parameters })
      .fetchAll();

    logger.debug(`获取到${updates.length}条更新记录`);

    const transformedUpdates = updates
      .filter(update => {
        if (updateType === 'weekly') {
          return update.teams_message_jsondata &&
                 update.teams_message_jsondata.title &&
                 update.teams_message_jsondata.text;
        }
        return update.gpt_title_response && !update.gpt_title_response.startsWith('0');
      })
      .map(update => {
        let tag = '';
        let title = '';
        let gptSummary = '';

        if (updateType === 'weekly') {
          const teamsData = update.teams_message_jsondata;
          title = teamsData.title.replace(/\[Weekly Summary\]\s*/g, '').trim();
          gptSummary = teamsData.text;
          const tagMatch = title.match(/^\[(.*?)\]/);
          if (tagMatch) {
            tag = tagMatch[1].trim();
          }
        } else {
          const extractTagAndTitle = (titleResponse: string) => {
            const titleWithoutNumber = titleResponse.replace(/^\d+\s*/, '');
            const tagMatch = titleWithoutNumber.match(/^\[(.*?)\]\s*(.+)$/);
            if (tagMatch) {
              return { tag: tagMatch[1].trim(), title: tagMatch[2].trim() };
            }
            return { tag: '', title: titleWithoutNumber.trim() };
          };
          const { tag: extractedTag, title: extractedTitle } = extractTagAndTitle(update.gpt_title_response);
          tag = extractedTag;
          title = extractedTitle;
          gptSummary = update.gpt_summary_response;
        }

        return {
          id: update.id,
          topic: update.topic,
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

    // Count query mirrors the same WHERE (minus offset/limit)
    const countBaseWhere = updateType === 'weekly'
      ? `IS_DEFINED(c.gpt_weekly_summary_tokens) AND ${productClause} AND c.language = @language`
      : `IS_DEFINED(c.gpt_title_response) AND c.status != "skip" AND NOT IS_DEFINED(c.gpt_weekly_summary_tokens) AND ${productClause} AND c.language = @language`;
    const countQuery = {
      query: `SELECT VALUE COUNT(1) FROM c WHERE ${countBaseWhere}${timeClause}`,
      parameters: parameters.filter(p => !['@offset', '@limit'].includes(p.name))
    };
    logger.debug(`计数查询: ${JSON.stringify(countQuery)}`);

    const { resources: [totalCount] } = await client.database(process.env.AZURE_COSMOSDB_DATABASE!).container(process.env.AZURE_COSMOSDB_CONVERSATIONS_CONTAINER!).items.query(countQuery).fetchAll();
    logger.debug(`更新记录总数: ${totalCount}`);

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
