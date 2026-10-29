// Tiny in-memory cache for read-heavy screens. Everything here only changes
// when metrics are recalculated (nightly sync or a settings save), so a single
// version number invalidates it all.
let version = 0;
const store = new Map<string, { version: number; value: unknown }>();

export function bumpCacheVersion() {
  version++;
  store.clear();
}

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.version === version) return hit.value as T;
  const value = await load();
  store.set(key, { version, value });
  return value;
}
