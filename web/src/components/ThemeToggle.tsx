"use client";

import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      onClick={toggle}
      className="
        inline-flex items-center justify-center
        w-9 h-9 rounded-full
        border border-border-color
        bg-background-secondary text-text-primary
        hover:opacity-80
        transition-opacity
      "
      title={`切換到${next === 'dark' ? '深色' : '淺色'}主題`}
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
