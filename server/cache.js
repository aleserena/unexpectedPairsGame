/**
 * In-memory cache for valid movies per (role1, role2).
 * Key is normalized so (Batman, Hulk) and (Hulk, Batman) share the same entry.
 */

const cache = new Map();
const TTL_MS = 60 * 60 * 1000; // 1 hour
const keyTimestamps = new Map();

function cacheKey(role1, role2) {
  const a = String(role1).trim().toLowerCase();
  const b = String(role2).trim().toLowerCase();
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function get(role1, role2) {
  const key = cacheKey(role1, role2);
  const ts = keyTimestamps.get(key);
  if (ts && Date.now() - ts > TTL_MS) {
    cache.delete(key);
    keyTimestamps.delete(key);
    return undefined;
  }
  return cache.get(key);
}

export function set(role1, role2, validMovies) {
  const key = cacheKey(role1, role2);
  cache.set(key, validMovies);
  keyTimestamps.set(key, Date.now());
}
