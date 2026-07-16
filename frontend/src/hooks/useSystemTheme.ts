import * as React from 'react';

export function useSystemTheme() {
  const [systemTheme, setSystemTheme] = React.useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  React.useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => setSystemTheme(query.matches ? 'light' : 'dark');
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  return systemTheme;
}
