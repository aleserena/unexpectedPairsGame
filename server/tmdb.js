import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * TMDB API client. Uses person movie_credits to get movies per actor,
 * person details for names, and search API for global movie lookup.
 * Requires TMDB_API_KEY in environment.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';

// Movies that should never be used as answers or in typeahead.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BLOCKED_MOVIES_PATH = path.resolve(__dirname, '../data/blocked-movies.json');

let BLOCKED_MOVIE_IDS = new Set([126314]);

try {
  const raw = fs.readFileSync(BLOCKED_MOVIES_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    const ids = parsed
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length > 0) {
      BLOCKED_MOVIE_IDS = new Set(ids);
    }
  }
} catch {
  // If the JSON file is missing or invalid, fall back to the default set.
}

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 200;

// In-memory cache for TMDB movie search results, keyed by normalized query + page.
const searchMoviesCache = new Map();

// Simple in-memory cache for person details to avoid repeated lookups.
const personDetailsCache = new Map();

export async function getPersonMovieCredits(personId) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('TMDB_API_KEY is not set');
  const url = `${TMDB_BASE}/person/${personId}/movie_credits?api_key=${apiKey}&language=en-US`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB API error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Returns a Set of TMDB movie IDs that the given person has acted in (movies only).
 * Each movie is represented as { id, title, original_title, poster_path } for matching;
 * we use id for set logic.
 */
export async function getMovieIdsForPerson(personId) {
  const data = await getPersonMovieCredits(personId);
  const cast = data.cast || [];
  const movieIds = new Set();
  const movieInfo = new Map(); // id -> { id, title, original_title, poster_path }
  for (const entry of cast) {
    if (!entry.id || entry.media_type === 'tv' || BLOCKED_MOVIE_IDS.has(entry.id)) continue;
    movieIds.add(entry.id);
    if (!movieInfo.has(entry.id)) {
      movieInfo.set(entry.id, {
        id: entry.id,
        title: entry.title || '',
        original_title: entry.original_title || entry.title || '',
        poster_path: entry.poster_path || null,
      });
    }
  }
  return { movieIds, movieInfo };
}

/**
 * Fetch basic person details (currently just name), with a small in-memory cache.
 */
export async function getPersonDetails(personId) {
  const id = Number(personId);
  if (Number.isNaN(id)) {
    throw new Error(`Invalid personId: ${personId}`);
  }
  if (personDetailsCache.has(id)) {
    return personDetailsCache.get(id);
  }
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('TMDB_API_KEY is not set');
  const url = `${TMDB_BASE}/person/${id}?api_key=${apiKey}&language=en-US`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const basic = {
    id: data.id,
    name: data.name || `Person ${id}`,
  };
  personDetailsCache.set(id, basic);
  return basic;
}

/**
 * Global movie search by title using TMDB search API.
 * Returns a list of { id, title, original_title, release_year }.
 */
export async function searchMovies(query, page = 1) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('TMDB_API_KEY is not set');
  const q = String(query || '').trim();
  if (!q) return [];

  const normalized = q.toLowerCase();
  const cacheKey = `${normalized}|${page}`;
  const now = Date.now();
  const cached = searchMoviesCache.get(cacheKey);

  if (cached && now - cached.timestamp <= SEARCH_CACHE_TTL_MS) {
    return cached.results;
  }

  const url = `${TMDB_BASE}/search/movie?api_key=${apiKey}&language=en-US&query=${encodeURIComponent(
    q,
  )}&include_adult=false&page=${page}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const results = (Array.isArray(data.results) ? data.results : [])
    .filter((r) => r && r.id && !BLOCKED_MOVIE_IDS.has(r.id) && (r.title || r.original_title))
    .map((r) => ({
      id: r.id,
      title: r.title || r.original_title || '',
      original_title: r.original_title || r.title || '',
      release_year: r.release_date ? String(r.release_date).slice(0, 4) : '',
    }));

  searchMoviesCache.set(cacheKey, { results, timestamp: now });
  if (searchMoviesCache.size > MAX_SEARCH_CACHE_ENTRIES) {
    const oldestKey = searchMoviesCache.keys().next().value;
    if (oldestKey !== undefined) {
      searchMoviesCache.delete(oldestKey);
    }
  }

  return results;
}
