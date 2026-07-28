import { useEffect } from 'react';
import { useLocation } from 'react-router';

const HashScrollHandler = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash || typeof document === 'undefined') return undefined;

    let targetId;
    try {
      targetId = decodeURIComponent(hash.slice(1));
    } catch {
      targetId = hash.slice(1);
    }

    if (!targetId) return undefined;

    let cancelled = false;
    const scrollToTarget = () => {
      if (cancelled) return;

      const target = document.getElementById(targetId);
      if (typeof target?.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    const browserWindow = document.defaultView;
    if (typeof browserWindow?.requestAnimationFrame === 'function') {
      const frameId = browserWindow.requestAnimationFrame(scrollToTarget);
      return () => {
        cancelled = true;
        browserWindow.cancelAnimationFrame?.(frameId);
      };
    }

    const timerId = setTimeout(scrollToTarget, 0);
    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [pathname, hash]);

  return null;
};

export default HashScrollHandler;
