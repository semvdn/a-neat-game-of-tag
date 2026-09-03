import { useEffect, useRef } from 'react';

export const useGameLoop = (callback: (deltaTime: number) => void) => {
  // FIX: `useRef` was called without an initial value. Provide `undefined` as the initial value and update the type to `number | undefined`.
  const requestRef = useRef<number | undefined>(undefined);
  // FIX: `useRef` was called without an initial value. Provide `undefined` as the initial value and update the type to `number | undefined`.
  const previousTimeRef = useRef<number | undefined>(undefined);

  const loop = (time: number) => {
    if (previousTimeRef.current !== undefined) {
      const deltaTime = time - previousTimeRef.current;
      callback(deltaTime);
    }
    previousTimeRef.current = time;
    requestRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(loop);
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callback]);
};
