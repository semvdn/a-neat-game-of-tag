import { useCallback, useEffect, useRef, useState } from 'react';

/** Exhibition controls affect presentation only; policy state and workers stay independent. */
export function useExhibitionMode() {
  const [exhibition, setExhibition] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key.toLowerCase() === 'g') setExhibition(value => !value);
      if (event.key === 'Escape') setExhibition(false);
      if (event.key.toLowerCase() === 'f' && exhibition) {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exhibition]);
  return { exhibition, setExhibition, controlsVisible, revealControls };
}
