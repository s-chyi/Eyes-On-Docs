import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getCosmosClient } from '@/lib/cosmos';

export async function POST(request: Request) {
  try {
    const visitInfo = await request.json();
    const client = getCosmosClient();
    await client
      .database(process.env.AZURE_COSMOSDB_DATABASE!)
      .container(process.env.AZURE_COSMOSDB_USER_TRAFFIC_CONTAINER!)
      .items.create(visitInfo);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error(`Failed to log visit info to Cosmos DB: ${error instanceof Error ? error.message : String(error)}`);
    if (process.env.LOG_ERROR_WEBHOOK_URL) {
      try {
        await fetch(process.env.LOG_ERROR_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Text: `错误: ${error instanceof Error ? error.message : String(error)}\n时间: ${new Date().toISOString()}\n来源: api/visit\n操作: log_visit_info`
          })
        });
      } catch (webhookError) {
        logger.error(`Failed to send error to webhook: ${webhookError instanceof Error ? webhookError.message : String(webhookError)}`);
      }
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
