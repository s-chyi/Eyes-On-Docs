"use client";

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import TriageCard from './TriageCard';
import { PRODUCT_LABELS } from '@/lib/products';

interface TriageItem {
  id: string;
  topic: string;
  title: string;
  tag?: string;
  timestamp: string;
  commitUrl: string;
  gptSummary?: string;
  liveStatus?: 'pending' | 'live' | 'unknown';
  wentLiveAt?: string | null;
}

interface TriageGroupProps {
  topic: string;
  items: TriageItem[];
  isSelected: (id: string) => boolean;
  onToggleSelected: (id: string) => void;
  defaultCollapsed?: boolean;
}

export default function TriageGroup({
  topic, items, isSelected, onToggleSelected, defaultCollapsed,
}: TriageGroupProps) {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed ?? items.length === 0);
  const label = PRODUCT_LABELS[topic] ?? topic;
  const selected = items.filter(i => isSelected(i.id)).length;

  return (
    <section className="mb-5">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between py-2.5 px-4 bg-slate-800/60 hover:bg-slate-800 rounded-lg transition-colors border border-slate-700/50"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
          <span className="text-base font-semibold text-slate-100">{label}</span>
          <span className="text-sm text-slate-400">({items.length})</span>
        </div>
        {selected > 0 && (
          <span className="text-xs text-sky-300 bg-sky-500/10 border border-sky-400/30 px-2 py-0.5 rounded-full">
            已選 {selected}
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="mt-3 flex flex-col gap-3">
          {items.length === 0 ? (
            <div className="text-slate-500 text-sm px-4 py-2">此時段內無更新</div>
          ) : (
            items.map(item => (
              <TriageCard
                key={item.id}
                id={item.id}
                title={item.title}
                tag={item.tag}
                timestamp={item.timestamp}
                commitUrl={item.commitUrl}
                gptSummary={item.gptSummary}
                liveStatus={item.liveStatus}
                wentLiveAt={item.wentLiveAt}
                isSelected={isSelected(item.id)}
                onToggleSelected={() => onToggleSelected(item.id)}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}
