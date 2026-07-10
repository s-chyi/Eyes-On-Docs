"use client";

import React from 'react';
import { Check } from 'lucide-react';
import UpdateCard from './UpdateCard';

interface TriageCardProps {
  id: string;
  title: string;
  tag?: string;
  timestamp: string;
  commitUrl: string;
  gptSummary?: string;
  liveStatus?: 'pending' | 'live' | 'unknown';
  wentLiveAt?: string | null;
  isSelected: boolean;
  onToggleSelected: () => void;
}

export default function TriageCard(props: TriageCardProps) {
  const { isSelected, onToggleSelected, ...cardProps } = props;

  return (
    <div className="flex gap-3 items-start w-full">
      <button
        onClick={onToggleSelected}
        className={`mt-3 shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
          isSelected
            ? 'bg-sky-500 border-sky-500 text-white shadow-sm shadow-sky-500/50'
            : 'border-slate-500 hover:border-sky-400 text-transparent'
        }`}
        title={isSelected ? '取消選取' : '選取以複製'}
        aria-pressed={isSelected}
      >
        <Check size={16} strokeWidth={3} />
      </button>
      <div
        className={`flex-1 min-w-0 rounded-lg transition-all ${
          isSelected ? 'ring-2 ring-sky-400/60 ring-offset-2 ring-offset-slate-900' : ''
        }`}
      >
        <UpdateCard {...cardProps} />
      </div>
    </div>
  );
}
