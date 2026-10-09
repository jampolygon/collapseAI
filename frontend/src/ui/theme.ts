import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem('cai.theme');
      return stored === 'dark' ? 'dark' : 'light';
    } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#151515' : '#fafafa');
  }, [theme]);
  const selectTheme = (value: Theme) => {
    try { localStorage.setItem('cai.theme', value); } catch { /* session theme still works */ }
    setTheme(value);
  };
  return [theme, selectTheme] as const;
}

export function useMobile() {
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width: 760px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return mobile;
}
