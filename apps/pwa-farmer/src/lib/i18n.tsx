'use client';
/**
 * Small hand-written i18n. To add a language: add a line to messages/languages.json and add messages/<code>.json.
 * No code changes: the import below is a pattern that the bundler expands to every file in messages/, each as its own
 * chunk, so that a phone downloads only the language in use.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import languages from '../../messages/languages.json';
import { Skeleton } from '@agrimate/ui';

export const LANGUAGES = languages as { code: string; label: string }[];
const STORAGE_KEY = 'agrimate.farmer.language';
type Messages = Record<string, string>;
export type Vars = Record<string, string | number>;
export type T = (key: string, vars?: Vars) => string;

const loadMessages = (code: string): Promise<Messages> => import(`../../messages/${code}.json`).then((m) => m.default as Messages);
const isKnown = (code: string | null | undefined): code is string => !!code && LANGUAGES.some((l) => l.code === code);

function initialLanguage(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (isKnown(saved)) return saved;
  const device = navigator.language?.slice(0, 2).toLowerCase();
  return isKnown(device) ? device : 'en';
}

interface I18n {
  lang: string;
  t: T;
  /** For keys built at run time, such as `grade.PADDY.A`, where an admin may have added something with no translation. */
  has: (key: string) => boolean;
  /** Resolves false if the language could not be downloaded (offline, and never used on this phone). */
  setLanguage: (code: string) => Promise<boolean>;
}
const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState('en');
  const [messages, setMessages] = useState<Messages | null>(null);

  useEffect(() => {
    const start = initialLanguage();
    loadMessages(start).catch(() => loadMessages('en')).then((m) => { setLang(start); setMessages(m); });
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLanguage = useCallback(async (code: string) => {
    if (!isKnown(code)) return false;
    try {
      const m = await loadMessages(code);
      localStorage.setItem(STORAGE_KEY, code);
      setMessages(m);
      setLang(code);
      return true;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo<I18n>(() => ({
    lang,
    setLanguage,
    has: (key) => !!messages && key in messages,
    t: (key, vars) => {
      const s = messages?.[key] ?? key;
      return vars ? s.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all)) : s;
    },
  }), [lang, messages, setLanguage]);

  // No text can be drawn before the language is known, so the pre-rendered page is a skeleton.
  if (!messages) return <div className="space-y-4 p-4"><Skeleton className="h-14 w-full" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useI18n needs I18nProvider');
  return c;
}
