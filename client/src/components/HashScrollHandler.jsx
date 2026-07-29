import { useEffect } from 'react';
import { useLocation } from 'react-router';

const HASH_ALIASES = {
  technology: 'capabilities',
};

const getHashTargetId = (hash) => {
  let targetId;
  try {
    targetId = decodeURIComponent(hash.slice(1));
  } catch {
    targetId = hash.slice(1);
  }

  return HASH_ALIASES[targetId] || targetId;
};

const scrollToHashTarget = (hash) => {
  if (!hash || typeof document === 'undefined') return;

  const targetId = getHashTargetId(hash);
  const target = targetId ? document.getElementById(targetId) : null;
  if (typeof target?.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

const HashScrollHandler = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash || typeof document === 'undefined') return undefined;

    let cancelled = false;
    const scrollToTarget = () => {
      if (cancelled) return;
      scrollToHashTarget(hash);
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

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const handleSameHashClick = (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = event.target.closest?.('a[href]');
      const href = anchor?.getAttribute('href');
      const browserWindow = document.defaultView;
      if (!href || !browserWindow) return;

      let destination;
      try {
        destination = new browserWindow.URL(href, browserWindow.location.href);
      } catch {
        return;
      }

      if (destination.pathname === pathname && destination.hash === hash && hash) {
        scrollToHashTarget(hash);
      }
    };

    document.addEventListener('click', handleSameHashClick);
    return () => document.removeEventListener('click', handleSameHashClick);
  }, [pathname, hash]);

  return null;
};

export default HashScrollHandler;
