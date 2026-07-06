import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getCosmosClient } from '@/lib/cosmos';

export async function middleware(request: NextRequest) {
  const client = getCosmosClient();
  // 获取用户会话信息
  const token = await getToken({ req: request as any });
  const isAuthPage = request.nextUrl.pathname.startsWith('/auth');

  // 记录访问信息
  const url = new URL(request.url);
  const visitInfo = {
    timestamp: new Date().toISOString(),
    path: url.pathname,
    searchParams: {
      product: url.searchParams.get('product') || 'AOAI-V2',
      language: url.searchParams.get('language') || 'Chinese',
      page: url.searchParams.get('page') || '1',
      updateType: url.searchParams.get('updateType') || 'single'
    },
    userInfo: {
      name: token?.name || 'anonymous'
    }
  };

  // console.log(visitInfo);
  const response = NextResponse.next();

  // 设置全局的缓存控制头
  response.headers.set('Cache-Control', 'no-store, must-revalidate');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');

  // 将访问信息写入Cosmos DB
  try {
    await client
      .database(process.env.AZURE_COSMOSDB_DATABASE!)
      .container(process.env.AZURE_COSMOSDB_USER_TRAFFIC_CONTAINER!)
      .items.create(visitInfo);
  } catch (error) {
    console.error('Failed to log visit info to Cosmos DB:', error);
    // 发送错误信息到webhook
    if (process.env.LOG_ERROR_WEBHOOK_URL) {
      console.log('Sending error to webhook:');
      try {
        await fetch(process.env.LOG_ERROR_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Text: `错误: ${error instanceof Error ? error.message : String(error)}\n时间: ${new Date().toISOString()}\n来源: middleware.ts\n操作: log_visit_info`
          })
        });
      } catch (webhookError) {
        console.error('Failed to send error to webhook:', webhookError);
      }
    }
  }

  // 身份验证逻辑
  if (!token && !isAuthPage) {
    return NextResponse.redirect(new URL('/auth', request.url));
  }

  if (token && isAuthPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};

// 明確宣告走 Node.js runtime（Cosmos SDK + ClientSecretCredential 需要，Edge runtime 跑不起來）
export const runtime = 'nodejs';