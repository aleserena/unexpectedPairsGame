/**
 * TMDB API client. Uses person movie_credits to get movies per actor,
 * person details for names, and search API for global movie lookup.
 * Requires TMDB_API_KEY in environment.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';

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
    if (!entry.id || entry.media_type === 'tv') continue;
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
  const url = `${TMDB_BASE}/search/movie?api_key=${apiKey}&language=en-US&query=${encodeURIComponent(
    q,
  )}&include_adult=false&page=${page}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const results = Array.isArray(data.results) ? data.results : [];
  return results
    .filter((r) => r && r.id && (r.title || r.original_title))
    .map((r) => ({
      id: r.id,
      title: r.title || r.original_title || '',
      original_title: r.original_title || r.title || '',
      release_year: r.release_date ? String(r.release_date).slice(0, 4) : '',
    }));
}
