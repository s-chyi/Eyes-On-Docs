"use client";

import { useCallback, useEffect, useState } from 'react';
import type { PresetKey } from './triagePresets';

const KEY_READ = 'eod:triage:readIds';
const KEY_STARRED = 'eod:triage:starredIds';
const KEY_LAST = 'eod:triage:lastTriageAt';

type LastTriageMap = Partial<Record<PresetKey, string>>;

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
    /* ignore quota / privacy mode */
  }
}

function readLast(): LastTriageMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY_LAST);
    if (!raw) return {};
    return JSON.parse(raw) as LastTriageMap;
  } catch {
    return {};
  }
}

function writeLast(m: LastTriageMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY_LAST, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

export function useTriageState() {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [lastTriageAt, setLastTriageAt] = useState<LastTriageMap>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setReadIds(readSet(KEY_READ));
    setStarredIds(readSet(KEY_STARRED));
    setLastTriageAt(readLast());
    setHydrated(true);
  }, []);

  const isRead = useCallback((id: string) => readIds.has(id), [readIds]);
  const isStarred = useCallback((id: string) => starredIds.has(id), [starredIds]);

  const toggleRead = useCallback((id: string) => {
    setReadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeSet(KEY_READ, next);
      return next;
    });
  }, []);

  const toggleStar = useCallback((id: string) => {
    setStarredIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeSet(KEY_STARRED, next);
      return next;
    });
  }, []);

  const markAllRead = useCallback((ids: string[]) => {
    setReadIds(prev => {
      const next = new Set(prev);
      ids.forEach(i => next.add(i));
      writeSet(KEY_READ, next);
      return next;
    });
  }, []);

  const markTriageDone = useCallback((preset: PresetKey) => {
    setLastTriageAt(prev => {
      const next = { ...prev, [preset]: new Date().toISOString() };
      writeLast(next);
      return next;
    });
  }, []);

  return {
    hydrated,
    readIds,
    starredIds,
    isRead,
    isStarred,
    toggleRead,
    toggleStar,
    markAllRead,
    markTriageDone,
    lastTriageAt,
  };
}
