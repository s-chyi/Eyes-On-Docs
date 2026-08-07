import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
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

  const response = NextResponse.next();

  // 设置全局的缓存控制头
  response.headers.set('Cache-Control', 'no-store, must-revalidate');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');

  // fire-and-forget 送到 /api/visit（Node runtime）写 Cosmos，避免 Edge runtime 的 @azure/identity 限制
  const visitUrl = new URL('/api/visit', request.url);
  fetch(visitUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(visitInfo),
    keepalive: true,
  }).catch(() => {
    // 忽略：不阻塞请求；失败由 /api/visit 内部记录
  });

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
