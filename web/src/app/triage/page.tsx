"use client";

import React, { Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PRESETS, PresetKey, inferSince } from '@/lib/triagePresets';
import { useTriageState } from '@/lib/useTriageState';
import { buildOneNoteHtml, buildMarkdown, copyToClipboard, TriageItem } from '@/lib/triageExport';
import TriageHeader from '@/components/TriageHeader';
import TriageGroup from '@/components/TriageGroup';

type ExportScope = 'starred' | 'unread' | 'all';

export default function TriagePageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background-primary text-text-secondary p-8 text-center">Loading…</div>}>
      <TriagePage />
    </Suspense>
  );
}

function TriagePage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialPreset = (searchParams.get('preset') as PresetKey) || 'aoai';
  const initialLanguage = (searchParams.get('language') as 'Chinese' | 'English') || 'Chinese';

  const [preset, setPreset] = useState<PresetKey>(initialPreset in PRESETS ? initialPreset : 'aoai');
  const [language, setLanguage] = useState<'Chinese' | 'English'>(initialLanguage);
  const [products, setProducts] = useState<string[]>(() => {
    const fromUrl = searchParams.get('products');
    if (fromUrl) return fromUrl.split(',').map(s => s.trim()).filter(Boolean);
    return [...PRESETS[initialPreset in PRESETS ? initialPreset : 'aoai'].products];
  });
  const [since, setSince] = useState<string>(() => {
    return searchParams.get('since') || inferSince(initialPreset in PRESETS ? initialPreset : 'aoai');
  });
  const [until, setUntil] = useState<string>(() => searchParams.get('until') || new Date().toISOString());
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<TriageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportScope, setExportScope] = useState<ExportScope>('starred');
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);

  const state = useTriageState();

  // Sync URL when preset/products/since/until/language changes.
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

  // When preset changes, reset products + since (unless URL held override on mount).
  const handlePresetChange = (p: PresetKey) => {
    setPreset(p);
    setProducts([...PRESETS[p].products]);
    setSince(inferSince(p));
    setUntil(new Date().toISOString());
  };

  // Fetch
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
        if (!cancelled) {
          setItems(data.updates || []);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          toast.error('Failed to load updates');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [products.join(','), language, since, until]);

  // Client-side search + group by topic in preset order.
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
  const unreadCount = items.filter(i => !state.isRead(i.id)).length;
  const starredCount = items.filter(i => state.isStarred(i.id)).length;

  const handleExport = useCallback(async () => {
    let subset: TriageItem[];
    if (exportScope === 'starred') subset = items.filter(i => state.isStarred(i.id));
    else if (exportScope === 'unread') subset = items.filter(i => !state.isRead(i.id));
    else subset = items;

    if (subset.length === 0) {
      toast.warning('Nothing to export in current scope');
      return;
    }
    // Preserve preset product order in export.
    const orderIndex: Record<string, number> = {};
    products.forEach((p, i) => { orderIndex[p] = i; });
    subset = [...subset].sort((a, b) => {
      const ai = orderIndex[a.topic] ?? 999;
      const bi = orderIndex[b.topic] ?? 999;
      if (ai !== bi) return ai - bi;
      return (b.timestamp || '').localeCompare(a.timestamp || '');
    });

    const html = buildOneNoteHtml(subset, 'product');
    const md = buildMarkdown(subset, 'product');
    try {
      await copyToClipboard(html, md);
      toast.success(`Copied ${subset.length} items to clipboard — paste into OneNote`);
    } catch (e) {
      console.error(e);
      toast.error('Clipboard write failed — see console for markdown fallback');
      console.log('---- Triage Markdown Fallback ----\n' + md);
    }
  }, [items, exportScope, products, state]);

  const useLastTriagePointer = () => {
    const last = state.lastTriageAt[preset];
    if (last) setSince(last);
  };

  return (
    <main className="min-h-screen p-4 md:p-8 bg-background-primary text-text-primary pb-24">
      <div className="max-w-5xl mx-auto">
        <TriageHeader
          preset={preset}
          since={since}
          until={until}
          products={products}
          language={language}
          search={search}
          totalCount={totalCount}
          unreadCount={unreadCount}
          starredCount={starredCount}
          lastTriageAt={state.lastTriageAt[preset]}
          onPresetChange={handlePresetChange}
          onSinceChange={setSince}
          onUntilChange={setUntil}
          onProductsChange={setProducts}
          onLanguageChange={setLanguage}
          onSearchChange={setSearch}
          onUseLastTriage={useLastTriagePointer}
        />

        {loading ? (
          <div className="text-center text-text-secondary py-12">Loading…</div>
        ) : totalCount === 0 ? (
          <div className="text-center text-text-secondary py-12">
            No updates in this window. Try widening the date range or adding products.
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
                  isRead={state.isRead}
                  isStarred={state.isStarred}
                  onToggleRead={state.toggleRead}
                  onToggleStar={state.toggleStar}
                  defaultCollapsed={list.length === 0}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-background-secondary border-t border-accent-secondary/30 p-3 flex justify-between items-center z-20">
        <div className="max-w-5xl w-full mx-auto flex justify-between items-center px-4">
          <div className="relative flex items-center gap-2">
            <button
              onClick={handleExport}
              className="px-4 py-2 rounded-md bg-accent-secondary text-background-primary font-medium hover:opacity-90 transition-opacity"
            >
              Export {exportScope === 'starred' ? `${starredCount} starred` :
                exportScope === 'unread' ? `${unreadCount} unread` :
                `all ${totalCount}`}
            </button>
            <button
              onClick={() => setScopeMenuOpen(o => !o)}
              className="px-2 py-2 rounded-md bg-background-primary text-text-secondary hover:text-accent-secondary text-xs"
            >
              ▾
            </button>
            {scopeMenuOpen && (
              <div className="absolute bottom-full mb-2 left-0 bg-background-primary border border-accent-secondary/30 rounded-md shadow-lg overflow-hidden z-30">
                {(['starred', 'unread', 'all'] as ExportScope[]).map(s => (
                  <button
                    key={s}
                    onClick={() => { setExportScope(s); setScopeMenuOpen(false); }}
                    className={`block w-full text-left px-3 py-2 text-xs hover:bg-accent-secondary hover:text-background-primary ${
                      exportScope === s ? 'text-accent-secondary' : 'text-text-primary'
                    }`}
                  >
                    Export {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              state.markTriageDone(preset);
              toast.success('Marked triage done for ' + PRESETS[preset].label);
            }}
            className="px-4 py-2 rounded-md bg-background-primary text-text-secondary hover:text-accent-secondary border border-accent-secondary/40 text-sm"
          >
            Mark triage done
          </button>
        </div>
      </div>
    </main>
  );
}
