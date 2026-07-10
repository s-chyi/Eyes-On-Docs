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
  isRead: (id: string) => boolean;
  isStarred: (id: string) => boolean;
  onToggleRead: (id: string) => void;
  onToggleStar: (id: string) => void;
  defaultCollapsed?: boolean;
}

export default function TriageGroup({
  topic, items, isRead, isStarred, onToggleRead, onToggleStar, defaultCollapsed,
}: TriageGroupProps) {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed ?? items.length === 0);
  const label = PRODUCT_LABELS[topic] ?? topic;
  const unread = items.filter(i => !isRead(i.id)).length;
  const starred = items.filter(i => isStarred(i.id)).length;

  return (
    <section className="mb-6">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between py-2 px-3 bg-background-secondary rounded-md hover:bg-background-secondary/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
          <span className="text-lg font-semibold text-accent-secondary">{label}</span>
          <span className="text-sm text-text-secondary">({items.length})</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-secondary">
          <span>{unread} unread</span>
          {starred > 0 && <span className="text-yellow-400">{starred} ★</span>}
        </div>
      </button>
      {!collapsed && (
        <div className="mt-3 flex flex-col gap-3">
          {items.length === 0 ? (
            <div className="text-text-secondary text-sm px-3 py-2">No updates in range.</div>
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
                isRead={isRead(item.id)}
                isStarred={isStarred(item.id)}
                onToggleRead={() => onToggleRead(item.id)}
                onToggleStar={() => onToggleStar(item.id)}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}
