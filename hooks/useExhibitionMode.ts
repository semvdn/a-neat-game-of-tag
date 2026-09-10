import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { isExhibitionRequested } from '../services/runtimeRecovery';

function writeExhibitionUrl(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.set('exhibit', '1');
  else {
    url.searchParams.delete('exhibit');
    url.searchParams.delete('train');
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/** Exhibition controls affect presentation only; policy state and workers stay independent. */
export function useExhibitionMode() {
  const [exhibition, setExhibitionState] = useState(isExhibitionRequested);
  const exhibitionRef = useRef(exhibition);
  exhibitionRef.current = exhibition;
  const [controlsVisible, setControlsVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setExhibition = useCallback((value: SetStateAction<boolean>) => {
    setExhibitionState(previous => {
      const next = typeof value === 'function' ? value(previous) : value;
      writeExhibitionUrl(next);
      return next;
    });
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setControlsVisible(false), 2500);
  }, []);

  useEffect(() => {
    if (exhibition) revealControls();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [exhibition, revealControls]);

  useEffect(() => {
    const onPopState = () => setExhibitionState(isExhibitionRequested());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key.toLowerCase() === 'g') setExhibition(value => !value);
      if (event.key === 'Escape') setExhibition(false);
      if (event.key.toLowerCase() === 'f' && exhibitionRef.current) {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setExhibition]);

  return { exhibition, setExhibition, controlsVisible, revealControls };
}
