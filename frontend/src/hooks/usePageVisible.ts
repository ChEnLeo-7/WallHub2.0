import * as React from 'react';

export function usePageVisible() {
  const [visible, setVisible] = React.useState(() => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'));

  React.useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
    };
  }, []);

  return visible;
}
