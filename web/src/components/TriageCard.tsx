"use client";

import React from 'react';
import { Star, Check } from 'lucide-react';
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
  isRead: boolean;
  isStarred: boolean;
  onToggleRead: () => void;
  onToggleStar: () => void;
}

export default function TriageCard(props: TriageCardProps) {
  const { isRead, isStarred, onToggleRead, onToggleStar, ...cardProps } = props;

  return (
    <div
      className={`flex gap-2 items-start w-full transition-opacity ${isRead ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-col items-center gap-2 pt-3 shrink-0">
        <button
          onClick={onToggleRead}
          className={`w-6 h-6 rounded border flex items-center justify-center transition-colors ${
            isRead
              ? 'bg-green-500 border-green-500 text-white'
              : 'border-text-secondary text-transparent hover:border-accent-secondary'
          }`}
          title={isRead ? 'Mark as unread' : 'Mark as read'}
        >
          <Check size={14} />
        </button>
        <button
          onClick={onToggleStar}
          className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
            isStarred
              ? 'text-yellow-400'
              : 'text-text-secondary hover:text-yellow-300'
          }`}
          title={isStarred ? 'Unstar' : 'Star for export'}
        >
          <Star size={18} fill={isStarred ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div
        className={`flex-1 min-w-0 rounded-md ${
          isStarred ? 'ring-2 ring-yellow-400' : ''
        }`}
      >
        <UpdateCard {...cardProps} />
      </div>
    </div>
  );
}
