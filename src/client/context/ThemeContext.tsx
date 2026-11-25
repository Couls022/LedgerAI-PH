import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setTheme: (newTheme: ThemeMode, syncToBackend?: boolean) => Promise<void>;
  toggleTheme: () => void;
  isSyncing: boolean;
  syncSuccess: boolean;
  syncError: string | null;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode; initialTheme?: ThemeMode }> = ({ 
  children, 
  initialTheme 
}) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (initialTheme && ['light', 'dark', 'system'].includes(initialTheme)) {
      return initialTheme;
    }
    try {
      const saved = localStorage.getItem('ledger_theme') as ThemeMode | null;
      if (saved && ['light', 'dark', 'system'].includes(saved)) {
        return saved;
      }
    } catch (e) {
      console.warn('LocalStorage access blocked in theme initialization:', e);
    }
    return 'light';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Apply theme class to HTML element
  useEffect(() => {
    const root = document.documentElement;
    let computedTheme: 'light' | 'dark' = 'light';

    if (theme === 'dark') {
      computedTheme = 'dark';
    } else if (theme === 'light') {
      computedTheme = 'light';
    } else if (theme === 'system') {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      computedTheme = systemDark ? 'dark' : 'light';
    }

    if (computedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    setResolvedTheme(computedTheme);
    try {
      localStorage.setItem('ledger_theme', theme);
    } catch (e) {
      console.warn('LocalStorage write blocked in theme effect:', e);
    }
  }, [theme]);

  // Listen for system theme changes if mode is 'system'
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      const root = document.documentElement;
      if (e.matches) {
        root.classList.add('dark');
        setResolvedTheme('dark');
      } else {
        root.classList.remove('dark');
        setResolvedTheme('light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = useCallback(async (newTheme: ThemeMode, syncToBackend: boolean = true) => {
    setThemeState(newTheme);
    setSyncError(null);
    setSyncSuccess(false);

    if (syncToBackend) {
      setIsSyncing(true);
      try {
        const res = await fetch('/api/auth/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: newTheme })
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Failed to save theme setting');
        }

        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 3000);
      } catch (err: any) {
        console.warn('Theme preference sync warning:', err.message);
        setSyncError(err.message || 'Failed to sync with server');
      } finally {
        setIsSyncing(false);
      }
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme, isSyncing, syncSuccess, syncError }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
