import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { FALLBACK_PRODUCTS, PRODUCT_LABELS } from '@/lib/products';

interface TargetConfig {
  topic_name: string;
  language?: string;
  [key: string]: any;
}

export async function GET() {
  try {
    // ACA 容器內從環境變數讀 config path，預設為 image 內烤好的 /app/config/target_config.json
    // 本機 dev 時可覆寫成專案根目錄的 target_config.json（例如 ../target_config.json）
    const configPath = process.env.TARGET_CONFIG_PATH
      || path.join(process.cwd(), '..', 'target_config.json');

    // Check if file exists
    if (!fs.existsSync(configPath)) {
      console.error(`Config file not found at: ${configPath}, using fallback products`);
      return NextResponse.json({
        products: FALLBACK_PRODUCTS,
        labels: PRODUCT_LABELS,
        source: 'fallback',
        error: 'Config file not found'
      });
    }

    // Read and parse the config file
    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const config: TargetConfig[] = JSON.parse(fileContent);

    // Extract unique topic names while preserving order
    const seenTopics = new Set<string>();
    const products: string[] = [];

    for (const item of config) {
      if (item.topic_name && !seenTopics.has(item.topic_name)) {
        seenTopics.add(item.topic_name);
        products.push(item.topic_name);
      }
    }

    // If no products found, use fallback
    if (products.length === 0) {
      console.error('No topic_name found in config file, using fallback products');
      return NextResponse.json({ 
        products: FALLBACK_PRODUCTS,
        labels: PRODUCT_LABELS,
        source: 'fallback',
        error: 'No topics found in config'
      });
    }

    return NextResponse.json({ 
      products,
      labels: PRODUCT_LABELS,
      source: 'config',
      count: products.length
    });

  } catch (error) {
    console.error('Error reading target_config.json:', error);
    return NextResponse.json({
      products: FALLBACK_PRODUCTS,
      labels: PRODUCT_LABELS,
      source: 'fallback',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export const dynamic = 'force-dynamic';
