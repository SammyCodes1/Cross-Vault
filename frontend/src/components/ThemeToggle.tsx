import React, { useState } from 'react';

const STORAGE_KEY = 'crossvault.theme';

function currentTheme(): 'light' | 'dark' {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore private mode */
  }
}

export const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(currentTheme);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="3.2" fill="currentColor" />
          <path
            d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="square"
            fill="none"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="M13.2 10.2A5.2 5.2 0 0 1 5.8 2.8 5.4 5.4 0 1 0 13.2 10.2Z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
};
