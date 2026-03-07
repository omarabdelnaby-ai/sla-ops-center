const cache = new Map();
const FRESH_TTL = 45 * 1000;
const STALE_TTL = 5 * 60 * 1000;

export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return { data: null, fresh: false, stale: false };
  const age = Date.now() - entry.timestamp;
  if (age < FRESH_TTL) return { data: entry.data, fresh: true, stale: false, age };
  if (age < STALE_TTL) return { data: entry.data, fresh: false, stale: true, age };
  cache.delete(key);
  return { data: null, fresh: false, stale: false };
}

export function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

export function clearCache(key) {
  if (key) cache.delete(key);
  else cache.clear();
}

export function getCacheStats() {
  const stats = {};
  for (const [key, entry] of cache.entries()) {
    const age = Date.now() - entry.timestamp;
    stats[key] = { ageSeconds: Math.round(age / 1000), fresh: age < FRESH_TTL, stale: age < STALE_TTL };
  }
  return stats;
}