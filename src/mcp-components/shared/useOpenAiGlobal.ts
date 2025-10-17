import { useSyncExternalStore } from 'preact/compat';
import { SET_GLOBALS_EVENT_TYPE, SetGlobalsEvent, OpenAiGlobals } from './types';

/**
 * Hook to subscribe to a single global value from window.openai
 * Based on ChatGPT Apps SDK documentation
 */
export function useOpenAiGlobal<K extends keyof OpenAiGlobals>(
  key: K
): OpenAiGlobals[K] {
  return useSyncExternalStore(
    (onChange) => {
      const handleSetGlobal = (event: SetGlobalsEvent) => {
        const value = event.detail.globals[key];
        if (value === undefined) {
          return;
        }

        onChange();
      };

      window.addEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobal, {
        passive: true,
      });

      return () => {
        window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobal);
      };
    },
    () => window.openai?.[key]
  );
}

/**
 * Hook to get toolOutput data
 */
export function useToolOutput<T = any>(): T | null {
  return useOpenAiGlobal('toolOutput') as T | null;
}

/**
 * Hook to get toolInput data
 */
export function useToolInput<T = any>(): T {
  return useOpenAiGlobal('toolInput') as T;
}

/**
 * Hook to get tool response metadata
 */
export function useToolResponseMetadata<T = any>(): T | null {
  return useOpenAiGlobal('toolResponseMetadata') as T | null;
}

/**
 * Hook to get current display mode
 */
export function useDisplayMode(): 'inline' | 'fullscreen' | 'pip' {
  return useOpenAiGlobal('displayMode');
}

/**
 * Hook to get current theme
 */
export function useTheme(): 'light' | 'dark' {
  return useOpenAiGlobal('theme');
}

/**
 * Hook to get maxHeight
 */
export function useMaxHeight(): number {
  return useOpenAiGlobal('maxHeight');
}








