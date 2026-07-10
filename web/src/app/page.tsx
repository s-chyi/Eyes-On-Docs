"use client";

import React, { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Filters from '@/components/Filters';
import { Pagination } from '@/components/Pagination';
import UpdateCard from '@/components/UpdateCard';
import Link from 'next/link';
import { Target } from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import { DEFAULT_PRODUCT, FALLBACK_PRODUCTS, PRODUCT_LABELS } from '@/lib/products';
import ThemeToggle from '@/components/ThemeToggle';

async function getProducts() {
  try {
    const response = await fetch('/api/products', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch products, using fallback');
      return {
        products: FALLBACK_PRODUCTS,
        labels: PRODUCT_LABELS
      };
    }

    const data = await response.json();
    
    if (data.source === 'fallback') {
      console.warn('Products API returned fallback:', data.error);
    }
    
    return {
      products: data.products || FALLBACK_PRODUCTS,
      labels: data.labels || PRODUCT_LABELS
    };
  } catch (error) {
    console.error('Error fetching products:', error);
    return {
      products: FALLBACK_PRODUCTS,
      labels: PRODUCT_LABELS
    };
  }
}

async function getUpdates(product: string, language: string, page: number, updateType: 'single' | 'weekly') {
  try {
    const params = new URLSearchParams({
      product: product || DEFAULT_PRODUCT,
      language: language || 'Chinese',
      page: page.toString(),
      updateType: updateType
    });

    const response = await fetch(`/api/updates?${params}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch updates');
    }

    const data = await response.json();
    
    // Log the received data
    // console.log('Received updates data:', JSON.stringify(data, null, 2));

    // Transform the API response to match the existing Update interface
    const transformedUpdates = data.updates.map((update: any) => {
      // console.log('Transforming update:', JSON.stringify(update, null, 2));
      return {
        id: update.id,
        topic: update.product,
        language: update.language,
        title: update.title,
        timestamp: update.timestamp,
        commitUrl: update.commitUrl,
        gptSummary: update.gptSummary, // Explicitly pass gptSummary
        tag: update.tag, // Add tag property
        liveStatus: update.liveStatus,
        wentLiveAt: update.wentLiveAt,
      };
    });

    return {
      updates: transformedUpdates,
      total: data.pagination.totalItems,
      page: data.pagination.currentPage,
      pageSize: 20
    };
  } catch (error) {
    console.error('Error fetching updates:', error);
    return {
      updates: [],
      total: 0,
      page: page,
      pageSize: 20
    };
  }
}

interface Update {
  id: string;
  topic: string;
  language: string;
  title: string;
  timestamp: string;
  commitUrl: string;
  gptSummary?: string;
  tag?: string; // Add tag property
  liveStatus?: 'pending' | 'live' | 'unknown';
  wentLiveAt?: string | null;
}

export default function Home({ searchParams }: { searchParams: { product?: string; language?: string; page?: string; updateType?: string } }) {
  const language = searchParams.language || 'Chinese';
  const page = parseInt(searchParams.page || '1', 10);
  const updateType = searchParams.updateType || 'single';

  const [updates, setUpdates] = React.useState<Update[]>([]);
  const [products, setProducts] = React.useState<string[]>(FALLBACK_PRODUCTS);
  const [productLabels, setProductLabels] = React.useState<Record<string, string>>(PRODUCT_LABELS);
  const [currentProduct, setCurrentProduct] = React.useState<string>(searchParams.product || FALLBACK_PRODUCTS[0]);
  const [pagination, setPagination] = React.useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    pageSize: 20
  });
  const [isLoading, setIsLoading] = React.useState(true);
  const { data: session } = useSession();
  const [userId, setUserId] = useState<string>('Guest');
  const router = useRouter();

  useEffect(() => {
    if (session?.user?.id) {
      setUserId(session.user.id);
      // 设置GA4用户ID
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('set', 'user_id', session.user.id);
        window.gtag('set', 'userName', session.user.name || 'Guest');
      }
    }
  }, [session]);

  // Fetch products on mount
  React.useEffect(() => {
    async function fetchProducts() {
      const { products: productList, labels } = await getProducts();
      setProducts(productList);
      setProductLabels(labels);
      
      // If no product in URL, set default to first product from config
      if (!searchParams.product && productList.length > 0) {
        setCurrentProduct(productList[0]);
        // Update URL with the default product
        const params = new URLSearchParams(window.location.search);
        params.set('product', productList[0]);
        router.push(`/?${params.toString()}`);
      }
    }
    fetchProducts();
  }, []);

  // Update currentProduct when searchParams.product changes
  React.useEffect(() => {
    if (searchParams.product) {
      setCurrentProduct(searchParams.product);
    }
  }, [searchParams.product]);

  const toggleUpdateType = (type: 'single' | 'weekly') => {
    const params = new URLSearchParams(window.location.search);
    params.set('updateType', type);
    params.set('page', '1');
    window.location.search = params.toString();
  };

  React.useEffect(() => {
    async function fetchUpdates() {
      setIsLoading(true);
      try {
        const data = await getUpdates(currentProduct, language, page, updateType as 'single' | 'weekly');
        setUpdates(data.updates);
        setPagination({
          currentPage: data.page,
          totalPages: Math.ceil(data.total / 20),
          totalItems: data.total,
          pageSize: 20
        });
      } catch (error) {
        console.error('Failed to fetch updates:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchUpdates();
  }, [currentProduct, language, page, updateType]);

  return (
    <main className="min-h-screen p-6 md:p-12 bg-background-primary text-text-primary">
      <div className="max-w-4xl mx-auto">
        <h1 className="mt-5 mb-4 text-center text-8xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400 animate-pulse whitespace-nowrap">
          Eyes On Docs
        </h1>

        <div className="flex justify-between items-center mb-4">
          <Filters 
            products={products}
            productLabels={productLabels}
            languages={['Chinese', 'English']}
          />
          <div className="flex items-center justify-end">
            <div 
              className="
                relative flex w-72 bg-background-secondary rounded-full p-1 cursor-pointer
                transition-all duration-300
                hover:scale-[1.02]
                hover:shadow-md
              "
              onClick={() => toggleUpdateType(updateType === 'single' ? 'weekly' : 'single')}
            >
              {/* 滑动背景 */}
              <div 
                className={`
                  absolute top-1 bottom-1 w-1/2 bg-accent-secondary rounded-full 
                  transition-all duration-300 ease-in-out
                  ${updateType === 'single' ? 'left-1' : 'left-1/2'}
                  shadow-md
                `}
              />
              
              {/* 文字按钮 */}
              <div className="flex w-full z-10">
                <div 
                  className={`
                    w-1/2 text-center py-2 rounded-full 
                    transition-colors duration-300
                    ${updateType === 'single' ? 'text-background-primary' : 'text-text-secondary hover:text-accent-secondary'}
                  `}
                >
                  Single Update
                </div>
                <div 
                  className={`
                    w-1/2 text-center py-2 rounded-full 
                    transition-colors duration-300
                    ${updateType === 'weekly' ? 'text-background-primary' : 'text-text-secondary hover:text-accent-secondary'}
                  `}
                >
                  Weekly Summary
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center mx-2 gap-2">
            <ThemeToggle />
            <Link
              href="/triage"
              className="
                inline-flex items-center gap-1.5
                px-4 py-2
                bg-background-secondary text-text-primary
                border border-border-color
                rounded-full
                hover:opacity-80
                transition-opacity
                text-sm
                font-medium
                whitespace-nowrap
              "
              title="Triage meeting view"
            >
              <Target size={15} />
              Triage
            </Link>
          </div>
          <div className="flex items-center mx-4">
            <button
              onClick={() => signOut({ callbackUrl: '/auth' })}
              className="
                group
                relative
                px-4 py-2
                bg-accent-secondary
                text-background-primary
                rounded-full
                hover:bg-accent-secondary/90
                transition-colors
                duration-300
                text-sm
                font-medium
              "
            >
              Ni Hao {userId} 
              <div className="
                absolute
                left-1/2
                -translate-x-1/2
                -bottom-10
                px-3 py-1
                bg-background-secondary
                text-text-primary
                rounded
                text-sm
                opacity-0
                group-hover:opacity-100
                transition-opacity
                duration-300
                whitespace-nowrap
                z-10
              ">
                sign out
              </div>
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center text-text-secondary">Loading...</div>
        ) : updates.length === 0 ? (
          <div className="text-center text-text-secondary">No updates found</div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-1 gap-4 w-full">
              {updates.map((update) => (
                <UpdateCard
                  key={update.id}
                  id={update.id}
                  title={update.title}
                  tag={update.tag}
                  timestamp={update.timestamp}
                  commitUrl={update.commitUrl}
                  gptSummary={update.gptSummary}
                  liveStatus={update.liveStatus}
                  wentLiveAt={update.wentLiveAt}
                />
              ))}
            </div>
            <div className="mt-8 flex justify-center">
              <Pagination 
                currentPage={pagination.currentPage} 
                totalPages={pagination.totalPages}
                totalItems={pagination.totalItems}
                pageSize={20}
                onPageChange={(newPage) => {
                  const params = new URLSearchParams(window.location.search);
                  params.set('page', newPage.toString());
                  window.location.search = params.toString();
                }}
              />
            </div>
          </>
        )}
      </div>
      {/* 作者信息 */}
      <footer className="mt-12 text-center text-text-secondary text-sm">
        <div className="border-t border-accent-secondary/30 pt-6">
          <p>
            🚀 Created by <span className="font-bold text-accent-secondary">Nick Shieh</span> •
            <a
              href="mailto:nickshieh@microsoft.com"
              className="
                ml-2
                hover:text-accent-secondary
                transition-colors
                duration-300
                underline
                hover:no-underline
              "
            >
              nickshieh@microsoft.com
            </a>
            {' • '}
            <span className="font-bold text-accent-secondary">Joey Zeng</span> •
            <a
              href="mailto:zehua@microsoft.com"
              className="
                ml-2
                hover:text-accent-secondary
                transition-colors
                duration-300
                underline
                hover:no-underline
              "
            >
              zehua@microsoft.com
            </a>
          </p>
        </div>
      </footer>
    </main>
  );
}
