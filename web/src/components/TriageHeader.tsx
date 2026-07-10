"use client";

import React from 'react';
import Link from 'next/link';
import { X, Plus } from 'lucide-react';
import { PRESETS, PresetKey, isoToLocalInput, localInputToIso } from '@/lib/triagePresets';
import { PRODUCT_LABELS, FALLBACK_PRODUCTS } from '@/lib/products';

interface TriageHeaderProps {
  preset: PresetKey | 'custom';
  since: string;
  until: string;
  products: string[];
  language: 'Chinese' | 'English';
  search: string;
  totalCount: number;
  unreadCount: number;
  starredCount: number;
  lastTriageAt?: string;
  onPresetChange: (p: PresetKey) => void;
  onSinceChange: (iso: string) => void;
  onUntilChange: (iso: string) => void;
  onProductsChange: (list: string[]) => void;
  onLanguageChange: (lang: 'Chinese' | 'English') => void;
  onSearchChange: (q: string) => void;
  onUseLastTriage: () => void;
}

export default function TriageHeader(props: TriageHeaderProps) {
  const {
    preset, since, until, products, language, search,
    totalCount, unreadCount, starredCount, lastTriageAt,
    onPresetChange, onSinceChange, onUntilChange, onProductsChange,
    onLanguageChange, onSearchChange, onUseLastTriage,
  } = props;

  const [addOpen, setAddOpen] = React.useState(false);
  const addable = FALLBACK_PRODUCTS.filter(p => !products.includes(p));

  const removeProduct = (p: string) => {
    onProductsChange(products.filter(x => x !== p));
  };
  const addProduct = (p: string) => {
    onProductsChange([...products, p]);
    setAddOpen(false);
  };

  return (
    <div className="flex flex-col gap-4 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="text-sm text-text-secondary hover:text-accent-secondary transition-colors"
          >
            ← Browse
          </Link>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400 ml-4">
            Triage
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {(['aoai', 'cognitive'] as PresetKey[]).map(k => (
            <button
              key={k}
              onClick={() => onPresetChange(k)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                preset === k
                  ? 'bg-accent-secondary text-background-primary'
                  : 'bg-background-secondary text-text-secondary hover:text-accent-secondary'
              }`}
            >
              {PRESETS[k].label}
            </button>
          ))}
          <div className="flex bg-background-secondary rounded-full p-1 ml-2">
            {(['Chinese', 'English'] as const).map(l => (
              <button
                key={l}
                onClick={() => onLanguageChange(l)}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${
                  language === l
                    ? 'bg-accent-secondary text-background-primary'
                    : 'text-text-secondary hover:text-accent-secondary'
                }`}
              >
                {l === 'Chinese' ? '中' : 'EN'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs text-text-secondary">Since</label>
        <input
          type="datetime-local"
          value={isoToLocalInput(since)}
          onChange={e => onSinceChange(localInputToIso(e.target.value))}
          className="bg-background-secondary text-text-primary px-2 py-1 rounded text-sm border border-transparent focus:border-accent-secondary outline-none"
        />
        <label className="text-xs text-text-secondary">Until</label>
        <input
          type="datetime-local"
          value={isoToLocalInput(until)}
          onChange={e => onUntilChange(localInputToIso(e.target.value))}
          className="bg-background-secondary text-text-primary px-2 py-1 rounded text-sm border border-transparent focus:border-accent-secondary outline-none"
        />
        {lastTriageAt && preset !== 'custom' && (
          <button
            onClick={onUseLastTriage}
            className="text-xs px-3 py-1 rounded-full bg-background-secondary text-text-secondary hover:text-accent-secondary transition-colors"
            title="Set 'since' to the last time you clicked Mark triage done"
          >
            Since last triage: {new Date(lastTriageAt).toLocaleString()}
          </button>
        )}
        <input
          type="text"
          placeholder="Search title/summary…"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="flex-1 min-w-[200px] bg-background-secondary text-text-primary px-3 py-1 rounded text-sm border border-transparent focus:border-accent-secondary outline-none"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {products.map(p => (
          <span
            key={p}
            className="flex items-center gap-1 bg-background-secondary text-text-primary text-xs px-2 py-1 rounded-full"
          >
            {PRODUCT_LABELS[p] ?? p}
            <button
              onClick={() => removeProduct(p)}
              className="hover:text-red-400 transition-colors"
              title="Remove"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <div className="relative">
          <button
            onClick={() => setAddOpen(o => !o)}
            className="flex items-center gap-1 bg-background-secondary text-text-secondary hover:text-accent-secondary text-xs px-2 py-1 rounded-full transition-colors"
            disabled={addable.length === 0}
          >
            <Plus size={12} /> Add
          </button>
          {addOpen && addable.length > 0 && (
            <div className="absolute z-10 mt-1 left-0 max-h-64 overflow-y-auto bg-background-secondary rounded-md shadow-lg border border-accent-secondary/30 min-w-[200px]">
              {addable.map(p => (
                <button
                  key={p}
                  onClick={() => addProduct(p)}
                  className="block w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-accent-secondary hover:text-background-primary"
                >
                  {PRODUCT_LABELS[p] ?? p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="text-sm text-text-secondary border-t border-accent-secondary/20 pt-3">
        <span className="text-text-primary font-medium">{totalCount}</span> updates ·{' '}
        <span className="text-yellow-300">{unreadCount}</span> unread ·{' '}
        <span className="text-yellow-400">{starredCount} ★</span>
      </div>
    </div>
  );
}
