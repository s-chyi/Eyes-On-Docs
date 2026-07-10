"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'eod:theme';

interface Ctx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeCtx = createContext<Ctx>({ theme: 'dark', setTheme: () => {}, toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY) as Theme | null;
      if (saved === 'dark' || saved === 'light') {
        setThemeState(saved);
        document.documentElement.setAttribute('data-theme', saved);
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    } catch {
      /* SSR / privacy mode */
    }
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(KEY, t);
      document.documentElement.setAttribute('data-theme', t);
    } catch { /* ignore */ }
  };
  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return <ThemeCtx.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}
