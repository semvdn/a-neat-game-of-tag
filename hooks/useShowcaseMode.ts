import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { isShowcaseRequested } from '../services/runtimeRecovery';

function writeShowcaseUrl(enabled: boolean): void {
  const url = new URL(window.location.href);
  if (enabled) {
    url.searchParams.set('showcase', '1');
    url.searchParams.delete('exhibit');
  } else {
    url.searchParams.delete('showcase');
    url.searchParams.delete('exhibit');
  }
  window.history.replaceState({}, '', url);
}

/** Showcase controls affect presentation only; policy state and workers stay independent. */
export function useShowcaseMode() {
  const [showcase, setShowcaseState] = useState(isShowcaseRequested);
  const showcaseRef = useRef(showcase);
  showcaseRef.current = showcase;
  const [controlsVisible, setControlsVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setShowcase = useCallback((value: SetStateAction<boolean>) => {
    setShowcaseState(previous => {
      const next = typeof value === 'function' ? value(previous) : value;
      writeShowcaseUrl(next);
      return next;
    });
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setControlsVisible(false), 2500);
  }, []);

  useEffect(() => {
    if (showcase) revealControls();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [showcase, revealControls]);

  useEffect(() => {
    const onPopState = () => setShowcaseState(isShowcaseRequested());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key.toLowerCase() === 'g') setShowcase(value => !value);
      if (event.key === 'Escape') setShowcase(false);
      if (event.key.toLowerCase() === 'f' && showcaseRef.current) {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setShowcase]);

  return { showcase, setShowcase, controlsVisible, revealControls };
}
