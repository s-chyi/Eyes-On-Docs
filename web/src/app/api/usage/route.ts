import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { validateAdminPassword } from '@/lib/adminAuth';
import { getCosmosClient } from '@/lib/cosmos';

export async function GET(request: Request) {
  const client = getCosmosClient();
  const auth = validateAdminPassword(request.headers.get('x-admin-password'));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status }
    );
  }

  const { searchParams } = new URL(request.url);
  const startTime = searchParams.get('startTime') || new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const endTime = searchParams.get('endTime') || new Date().toISOString();
  const excludeUsers = searchParams.get('excludeUsers') || '';

  if (Number.isNaN(Date.parse(startTime)) || Number.isNaN(Date.parse(endTime))) {
    return NextResponse.json(
      { error: 'Invalid startTime or endTime' },
      { status: 400 }
    );
  }

  // 处理要排除的用户列表
  const excludeUsersList = excludeUsers.split(',').map(user => user.trim()).filter(Boolean);
  const userConditions = ['c.userInfo.name != @anonymousUser'];
  const sharedParameters = [
    { name: '@startTime', value: startTime },
    { name: '@endTime', value: endTime },
    { name: '@anonymousUser', value: 'anonymous' }
  ];

  excludeUsersList.forEach((user, index) => {
    const parameterName = `@excludeUser${index}`;
    userConditions.push(`c.userInfo.name != ${parameterName}`);
    sharedParameters.push({ name: parameterName, value: user });
  });
  const userFilterCondition = userConditions.join(' AND ');

  logger.info(`开始获取使用统计数据，时间范围: ${startTime} - ${endTime}，排除用户: ${excludeUsers}`);
  try {
    const database = client.database(process.env.AZURE_COSMOSDB_DATABASE!);
    const container = database.container(process.env.AZURE_COSMOSDB_USER_TRAFFIC_CONTAINER!);

    // 获取每个用户的历史访问次数统计
    const userStatsQuery = {
      query: `SELECT c.userInfo.name, COUNT(1) AS recordCount FROM c WHERE ${userFilterCondition} AND c.path = "/" AND c.timestamp >= @startTime AND c.timestamp <= @endTime GROUP BY c.userInfo.name`,
      parameters: sharedParameters
    };
    const { resources: userStats } = await container.items.query(userStatsQuery).fetchAll();

    // 获取每日访问统计
    const dailyStatsQuery = {
      query: `SELECT SUBSTRING(c.timestamp, 0, 10) as date, COUNT(1) as count FROM c WHERE ${userFilterCondition} AND c.path = "/" AND c.timestamp >= @startTime AND c.timestamp <= @endTime GROUP BY SUBSTRING(c.timestamp, 0, 10)`,
      parameters: sharedParameters
    };
    const { resources: dailyStats } = await container.items.query(dailyStatsQuery).fetchAll();

    // 获取产品每日访问统计
    const productDailyStatsQuery = {
      query: `SELECT SUBSTRING(c.timestamp, 0, 10) as date, c.searchParams.product, COUNT(1) as count FROM c WHERE ${userFilterCondition} AND c.path = "/" AND c.timestamp >= @startTime AND c.timestamp <= @endTime GROUP BY SUBSTRING(c.timestamp, 0, 10), c.searchParams.product`,
      parameters: sharedParameters
    };
    const { resources: productDailyStats } = await container.items.query(productDailyStatsQuery).fetchAll();

    // 获取用户每日访问统计
    const userDailyStatsQuery = {
      query: `SELECT SUBSTRING(c.timestamp, 0, 10) as date, c.userInfo.name as name, COUNT(1) as count FROM c WHERE ${userFilterCondition} AND c.path = "/" AND c.timestamp >= @startTime AND c.timestamp <= @endTime GROUP BY SUBSTRING(c.timestamp, 0, 10), c.userInfo.name`,
      parameters: sharedParameters
    };
    const { resources: userDailyStats } = await container.items.query(userDailyStatsQuery).fetchAll();

    // 获取用户首次访问日期
    const firstVisitQuery = {
      query: `SELECT c.userInfo.name, MIN(SUBSTRING(c.timestamp, 0, 10)) as firstVisitDate FROM c WHERE ${userFilterCondition} AND c.path = "/" AND c.timestamp >= @startTime AND c.timestamp <= @endTime GROUP BY c.userInfo.name`,
      parameters: sharedParameters
    };
    const { resources: firstVisitData } = await container.items.query(firstVisitQuery).fetchAll();

    // 按日期统计新增用户数
    const dailyNewUsers = firstVisitData.reduce((acc: { [key: string]: number }, curr) => {
      acc[curr.firstVisitDate] = (acc[curr.firstVisitDate] || 0) + 1;
      return acc;
    }, {});

    // 转换为数组格式并排序
    const sortedDailyData = Object.entries(dailyNewUsers)
      .map(([date, newUsers]) => ({ date, newUsers }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 计算累计用户数
    const userGrowthStats = sortedDailyData.reduce((acc: any[], curr) => {
      const prevTotal = acc.length > 0 ? acc[acc.length - 1].totalUsers : 0;
      acc.push({
        date: curr.date,
        totalUsers: prevTotal + curr.newUsers
      });
      return acc;
    }, []);

    const response = {
      userStats: userStats.sort((a, b) => b.recordCount - a.recordCount),
      dailyStats: dailyStats.sort((a, b) => a.date.localeCompare(b.date)),
      userGrowthStats,
      productDailyStats: productDailyStats.sort((a, b) => a.date.localeCompare(b.date)),
      userDailyStats: userDailyStats.sort((a, b) => a.date.localeCompare(b.date))
    };

    logger.info(`使用统计数据获取成功，用户统计数: ${userStats.length}, 每日统计数: ${dailyStats.length}, 用户增长统计数: ${userGrowthStats.length}, 产品每日统计数: ${productDailyStats.length}, 用户每日统计数: ${userDailyStats.length}`);
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store, must-revalidate',
        'Vary': '*'
      }
    });
  } catch (error) {
    logger.error(`获取使用统计数据失败: ${error instanceof Error ? error.message : String(error)}${error instanceof Error && error.stack ? '\n' + error.stack : ''}`);
    return NextResponse.json(
      { error: 'Failed to fetch usage statistics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// 添加配置选项以禁用缓存
export const dynamic = 'force-dynamic';
export const revalidate = 0;
