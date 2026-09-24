'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * Presentation modes. They describe how the screen is laid out, never the
 * state of an account or an order.
 */
export type ShellMode = 'companion' | 'workspace' | 'review';

export const FOCUS_PREFERENCE_KEY = 'markov.shell.focus';

export interface ShellModeContextValue {
  readonly mode: ShellMode;
  /** Focus preference: minimal perimeter and compact companion. Per-viewer, stored locally. */
  readonly focus: boolean;
  readonly setFocus: (value: boolean) => void;
  /** True once the stored preference has been read on the client. */
  readonly hydrated: boolean;
}

const ShellModeContext = createContext<ShellModeContextValue | null>(null);

function readStoredFocus(): boolean {
  try {
    return window.localStorage.getItem(FOCUS_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredFocus(value: boolean): void {
  try {
    if (value) {
      window.localStorage.setItem(FOCUS_PREFERENCE_KEY, 'true');
    } else {
      window.localStorage.removeItem(FOCUS_PREFERENCE_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the preference then lasts for the session only.
  }
}

export interface ShellModeProviderProps {
  readonly mode: ShellMode;
  readonly children: ReactNode;
}

export function ShellModeProvider({ mode, children }: ShellModeProviderProps) {
  const [focus, setFocusState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setFocusState(readStoredFocus());
    setHydrated(true);
  }, []);

  const setFocus = useCallback((value: boolean) => {
    setFocusState(value);
    writeStoredFocus(value);
  }, []);

  const value = useMemo(
    () => ({ mode, focus, setFocus, hydrated }),
    [mode, focus, setFocus, hydrated],
  );
  return <ShellModeContext.Provider value={value}>{children}</ShellModeContext.Provider>;
}

export function useShellMode(): ShellModeContextValue {
  const context = useContext(ShellModeContext);
  if (context === null) {
    throw new Error('useShellMode must be used inside ShellModeProvider');
  }
  return context;
}
