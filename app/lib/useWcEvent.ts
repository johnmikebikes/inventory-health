import { useEffect, type RefObject } from "react";

/**
 * React 18 doesn't wire custom events on web components, so Polaris fields
 * (s-select, s-checkbox, s-search-field) need a real event listener.
 */
export function useWcEvent<T extends HTMLElement>(
  ref: RefObject<T | null>,
  event: string,
  handler: (el: T, e: Event) => void,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: Event) => handler(el, e);
    el.addEventListener(event, h);
    return () => el.removeEventListener(event, h);
  }, [ref, event, handler]);
}
