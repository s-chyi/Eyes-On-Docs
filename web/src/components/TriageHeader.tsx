"use client";

import React from 'react';
import Link from 'next/link';
import { X, Plus, Calendar, Search } from 'lucide-react';
import { PRESETS, PresetKey, isoToDateInput, dateInputToIsoStart, dateInputToIsoEnd } from '@/lib/triagePresets';
import { PRODUCT_LABELS, FALLBACK_PRODUCTS } from '@/lib/products';

interface TriageHeaderProps {
  preset: PresetKey | 'custom';
  since: string;
  until: string;
  products: string[];
  language: 'Chinese' | 'English';
  search: string;
  totalCount: number;
  selectedCount: number;
  onPresetChange: (p: PresetKey) => void;
  onSinceChange: (iso: string) => void;
  onUntilChange: (iso: string) => void;
  onProductsChange: (list: string[]) => void;
  onLanguageChange: (lang: 'Chinese' | 'English') => void;
  onSearchChange: (q: string) => void;
}

export default function TriageHeader(props: TriageHeaderProps) {
  const {
    preset, since, until, products, language, search,
    totalCount, selectedCount,
    onPresetChange, onSinceChange, onUntilChange, onProductsChange,
    onLanguageChange, onSearchChange,
  } = props;

  const [addOpen, setAddOpen] = React.useState(false);
  const addable = FALLBACK_PRODUCTS.filter(p => !products.includes(p));

  return (
    <div className="flex flex-col gap-4 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-sm text-slate-400 hover:text-sky-300 transition-colors"
          >
            ← Browse
          </Link>
          <h1 className="text-2xl font-semibold text-slate-100">Triage</h1>
        </div>
        <div className="flex items-center gap-2">
          {(['aoai', 'cognitive'] as PresetKey[]).map(k => (
            <button
              key={k}
              onClick={() => onPresetChange(k)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                preset === k
                  ? 'bg-sky-500/90 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100'
              }`}
            >
              {PRESETS[k].label}
            </button>
          ))}
          <div className="flex bg-slate-800 rounded-md p-0.5 ml-1">
            {(['Chinese', 'English'] as const).map(l => (
              <button
                key={l}
                onClick={() => onLanguageChange(l)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  language === l
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {l === 'Chinese' ? '中' : 'EN'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap bg-slate-800/40 border border-slate-700/40 rounded-lg px-3 py-2">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Calendar size={14} />
          <span className="text-xs">從</span>
        </div>
        <input
          type="date"
          value={isoToDateInput(since)}
          onChange={e => onSinceChange(dateInputToIsoStart(e.target.value))}
          className="bg-slate-900/60 text-slate-100 px-2.5 py-1 rounded text-sm border border-slate-700 focus:border-sky-500 outline-none [color-scheme:dark]"
        />
        <span className="text-xs text-slate-400">到</span>
        <input
          type="date"
          value={isoToDateInput(until)}
          onChange={e => onUntilChange(dateInputToIsoEnd(e.target.value))}
          className="bg-slate-900/60 text-slate-100 px-2.5 py-1 rounded text-sm border border-slate-700 focus:border-sky-500 outline-none [color-scheme:dark]"
        />
        <div className="flex items-center gap-1.5 ml-auto flex-1 min-w-[180px] max-w-md">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="搜尋標題 / 摘要…"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full bg-slate-900/60 text-slate-100 placeholder-slate-500 px-2.5 py-1 rounded text-sm border border-slate-700 focus:border-sky-500 outline-none"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {products.map(p => (
          <span
            key={p}
            className="flex items-center gap-1.5 bg-slate-800 text-slate-200 text-xs px-2.5 py-1 rounded-md border border-slate-700"
          >
            {PRODUCT_LABELS[p] ?? p}
            <button
              onClick={() => onProductsChange(products.filter(x => x !== p))}
              className="text-slate-400 hover:text-rose-400 transition-colors"
              title="移除"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <div className="relative">
          <button
            onClick={() => setAddOpen(o => !o)}
            className="flex items-center gap-1 bg-slate-800/60 border border-dashed border-slate-600 text-slate-400 hover:text-sky-300 hover:border-sky-500/50 text-xs px-2.5 py-1 rounded-md transition-colors"
            disabled={addable.length === 0}
          >
            <Plus size={12} /> 加入產品
          </button>
          {addOpen && addable.length > 0 && (
            <div className="absolute z-10 mt-1 left-0 max-h-72 overflow-y-auto bg-slate-800 rounded-md shadow-xl border border-slate-700 min-w-[220px]">
              {addable.map(p => (
                <button
                  key={p}
                  onClick={() => { onProductsChange([...products, p]); setAddOpen(false); }}
                  className="block w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-sky-500/20 hover:text-sky-200"
                >
                  {PRODUCT_LABELS[p] ?? p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="text-sm text-slate-400 border-t border-slate-700/50 pt-3 flex items-center gap-4">
        <span>
          <span className="text-slate-100 font-medium">{totalCount}</span> 筆更新
        </span>
        <span className="text-slate-600">·</span>
        <span>
          已選 <span className="text-sky-300 font-medium">{selectedCount}</span>
        </span>
      </div>
    </div>
  );
}
