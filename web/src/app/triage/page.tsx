"use client";

import React, { Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { PRESETS, PresetKey, inferSince } from '@/lib/triagePresets';
import { useTriageState } from '@/lib/useTriageState';
import { buildOneNoteHtml, buildMarkdown, copyToClipboard, TriageItem } from '@/lib/triageExport';
import TriageHeader from '@/components/TriageHeader';
import TriageGroup from '@/components/TriageGroup';

export default function TriagePageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 text-slate-400 p-8 text-center">Loading…</div>}>
      <TriagePage />
    </Suspense>
  );
}

function TriagePage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialPreset = (searchParams.get('preset') as PresetKey) || 'aoai';
  const initialLanguage = (searchParams.get('language') as 'Chinese' | 'English') || 'Chinese';
  const validPreset: PresetKey = initialPreset in PRESETS ? initialPreset : 'aoai';

  const [preset, setPreset] = useState<PresetKey>(validPreset);
  const [language, setLanguage] = useState<'Chinese' | 'English'>(initialLanguage);
  const [products, setProducts] = useState<string[]>(() => {
    const fromUrl = searchParams.get('products');
    if (fromUrl) return fromUrl.split(',').map(s => s.trim()).filter(Boolean);
    return [...PRESETS[validPreset].products];
  });
  const [since, setSince] = useState<string>(() => searchParams.get('since') || inferSince(validPreset));
  const [until, setUntil] = useState<string>(() => searchParams.get('until') || new Date().toISOString());
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<TriageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);

  const state = useTriageState();

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('preset', preset);
    params.set('language', language);
    params.set('products', products.join(','));
    params.set('since', since);
    params.set('until', until);
    router.replace(`/triage?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, language, products.join(','), since, until]);

  const handlePresetChange = (p: PresetKey) => {
    setPreset(p);
    setProducts([...PRESETS[p].products]);
    setSince(inferSince(p));
    setUntil(new Date().toISOString());
  };

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (products.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const p = new URLSearchParams({
          products: products.join(','),
          language,
          since,
          until,
          pageSize: '200',
        });
        const res = await fetch(`/api/updates?${p.toString()}`);
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.json();
        if (!cancelled) setItems(data.updates || []);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          toast.error('載入失敗');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [products.join(','), language, since, until]);

  const filteredByProduct = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? items.filter(i =>
          (i.title || '').toLowerCase().includes(q) ||
          (i.gptSummary || '').toLowerCase().includes(q)
        )
      : items;
    const groups = new Map<string, TriageItem[]>();
    for (const p of products) groups.set(p, []);
    for (const it of filtered) {
      if (!groups.has(it.topic)) groups.set(it.topic, []);
      groups.get(it.topic)!.push(it);
    }
    return groups;
  }, [items, search, products.join(',')]);

  const totalCount = items.length;
  const selectedCount = items.filter(i => state.isSelected(i.id)).length;

  const handleCopy = useCallback(async () => {
    const subset = items.filter(i => state.isSelected(i.id));
    if (subset.length === 0) {
      toast.warning('請先勾選要複製的項目');
      return;
    }
    const orderIndex: Record<string, number> = {};
    products.forEach((p, i) => { orderIndex[p] = i; });
    const sorted = [...subset].sort((a, b) => {
      const ai = orderIndex[a.topic] ?? 999;
      const bi = orderIndex[b.topic] ?? 999;
      if (ai !== bi) return ai - bi;
      return (b.timestamp || '').localeCompare(a.timestamp || '');
    });

    setCopying(true);
    try {
      const html = buildOneNoteHtml(sorted, 'product');
      const md = buildMarkdown(sorted, 'product');
      await copyToClipboard(html, md);
      toast.success(`已複製 ${sorted.length} 則到剪貼簿`);
    } catch (e) {
      console.error(e);
      toast.error('複製失敗，Markdown 已印在 console');
      console.log('---- Triage Markdown Fallback ----\n' + buildMarkdown(sorted, 'product'));
    } finally {
      setCopying(false);
    }
  }, [items, products, state]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 pb-24">
      <div className="max-w-5xl mx-auto">
        <TriageHeader
          preset={preset}
          since={since}
          until={until}
          products={products}
          language={language}
          search={search}
          totalCount={totalCount}
          selectedCount={selectedCount}
          onPresetChange={handlePresetChange}
          onSinceChange={setSince}
          onUntilChange={setUntil}
          onProductsChange={setProducts}
          onLanguageChange={setLanguage}
          onSearchChange={setSearch}
        />

        {loading ? (
          <div className="text-center text-slate-400 py-12">Loading…</div>
        ) : totalCount === 0 ? (
          <div className="text-center text-slate-500 py-12 border border-dashed border-slate-700 rounded-lg">
            此時段內無更新。試試調整日期或加入更多產品。
          </div>
        ) : (
          <div>
            {products.map(topic => {
              const list = filteredByProduct.get(topic) || [];
              return (
                <TriageGroup
                  key={topic}
                  topic={topic}
                  items={list}
                  isSelected={state.isSelected}
                  onToggleSelected={state.toggleSelected}
                  defaultCollapsed={list.length === 0}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur border-t border-slate-700/60 py-3 z-20">
        <div className="max-w-5xl mx-auto flex justify-between items-center px-4">
          <div className="text-sm text-slate-400">
            {selectedCount > 0
              ? <>已選 <span className="text-sky-300 font-medium">{selectedCount}</span> 則,按複製後可貼進 OneNote</>
              : <span className="text-slate-500">勾選左側方塊來選取要複製的項目</span>}
          </div>
          <div className="flex items-center gap-2">
            {selectedCount > 0 && (
              <button
                onClick={state.clearSelected}
                className="px-3 py-2 rounded-md text-slate-400 hover:text-slate-200 text-sm transition-colors"
              >
                清除選取
              </button>
            )}
            <button
              onClick={handleCopy}
              disabled={selectedCount === 0 || copying}
              className={`px-4 py-2 rounded-md font-medium text-sm transition-all flex items-center gap-2 ${
                selectedCount === 0
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-sky-500 hover:bg-sky-400 text-white shadow-md shadow-sky-500/30'
              }`}
            >
              <Copy size={15} />
              {copying ? '複製中…' : `複製 ${selectedCount || ''}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
