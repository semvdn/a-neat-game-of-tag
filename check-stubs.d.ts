declare namespace React {
  type ReactNode = any;
  type FC<P = {}> = (props: P) => any;
  interface ChangeEvent<T = any> { target: T; }
  interface MouseEvent<T = any> { target: T; }
}
declare module 'react' {
  const ReactDefault: any;
  export default ReactDefault;
  export type ReactNode = React.ReactNode;
  export type FC<P = {}> = React.FC<P>;
  export type ChangeEvent<T = any> = React.ChangeEvent<T>;
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
  export function useMemo<T>(fn: () => T, deps: any[]): T;
  export function useRef<T>(initial: T): { current: T };
}
declare module 'react/jsx-runtime';
declare module 'react-dom/client';
declare module 'lucide-react';
declare module '@vitejs/plugin-react';
declare module 'vite';
declare module '@google/genai';
declare namespace JSX { interface IntrinsicElements { [elemName: string]: any; } }
declare module 'path' { const p: any; export default p; }
declare const __dirname: string;
declare namespace JSX { interface IntrinsicAttributes { key?: any; } }
