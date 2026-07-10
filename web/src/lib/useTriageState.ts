"use client";

import { useCallback, useEffect, useState } from 'react';

const KEY_SELECTED = 'eod:triage:selectedIds';

function readSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, s: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

export function useTriageState() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSelectedIds(readSet(KEY_SELECTED));
    setHydrated(true);
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeSet(KEY_SELECTED, next);
      return next;
    });
  }, []);

  const clearSelected = useCallback(() => {
    setSelectedIds(new Set());
    writeSet(KEY_SELECTED, new Set());
  }, []);

  return {
    hydrated,
    selectedIds,
    isSelected,
    toggleSelected,
    clearSelected,
  };
}
