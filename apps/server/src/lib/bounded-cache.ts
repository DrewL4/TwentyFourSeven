export type TimestampedEntry<T> = {
  value: T;
  timestamp: number;
};

/** Remove entries older than ttlMs (by entry timestamp). */
export function evictExpired<K, V>(
  map: Map<K, TimestampedEntry<V>>,
  ttlMs: number,
  now: number = Date.now(),
): void {
  for (const [key, entry] of map.entries()) {
    if (now - entry.timestamp > ttlMs) {
      map.delete(key);
    }
  }
}

/** Cap map size by evicting oldest entries (LRU by timestamp). */
export function capSize<K, V>(
  map: Map<K, TimestampedEntry<V>>,
  maxEntries: number,
): void {
  if (map.size <= maxEntries) {
    return;
  }
  const sorted = [...map.entries()].sort(
    (a, b) => a[1].timestamp - b[1].timestamp,
  );
  const removeCount = map.size - maxEntries;
  for (let i = 0; i < removeCount; i++) {
    map.delete(sorted[i][0]);
  }
}

/** Evict by TTL then enforce max size. */
export function maintainBoundedMap<K, V>(
  map: Map<K, TimestampedEntry<V>>,
  options: { ttlMs: number; maxEntries: number },
  now: number = Date.now(),
): void {
  evictExpired(map, options.ttlMs, now);
  capSize(map, options.maxEntries);
}
