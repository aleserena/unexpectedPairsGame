/**
 * Resolves "valid movies" for a pair of roles: movies where at least one actor
 * who played role1 and at least one who played role2 appear together.
 */

import { getMovieIdsForPerson } from './tmdb.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'data', 'role-to-actors.json');

let roleToActors = null;

function loadRoleToActors() {
  if (roleToActors) return roleToActors;
  const raw = readFileSync(DATA_PATH, 'utf-8');
  roleToActors = JSON.parse(raw);
  return roleToActors;
}

/**
 * Get all role names (keys from role-to-actors.json).
 */
export function getRoleNames() {
  return Object.keys(loadRoleToActors());
}

/**
 * Get TMDB person IDs for a role.
 */
export function getPersonIdsForRole(roleName) {
  const roles = loadRoleToActors();
  const ids = roles[roleName];
  if (!ids || !Array.isArray(ids)) return [];
  return ids;
}

/**
 * Fetch all movie IDs (and title info) for every person in the given list.
 * Returns { movieIds: Set, movieInfo: Map(id -> { id, title, original_title, poster_path }) }
 */
async function getMovieIdsForPersonList(personIds) {
  const allMovieIds = new Set();
  const allMovieInfo = new Map();
  for (const pid of personIds) {
    try {
      const { movieIds, movieInfo } = await getMovieIdsForPerson(pid);
      for (const id of movieIds) allMovieIds.add(id);
      for (const [id, info] of movieInfo) allMovieInfo.set(id, info);
    } catch (err) {
      console.warn(`Failed to fetch credits for person ${pid}:`, err.message);
    }
  }
  return { movieIds: allMovieIds, movieInfo: allMovieInfo };
}

/**
 * Returns list of valid movies for (role1, role2): each item
 * { id, title, original_title, poster_path }.
 * Uses intersection of "movies with any role1 actor" and "movies with any role2 actor".
 */
export async function getValidMoviesForRoles(role1, role2) {
  const ids1 = getPersonIdsForRole(role1);
  const ids2 = getPersonIdsForRole(role2);
  if (ids1.length === 0 || ids2.length === 0) return [];

  const { movieIds: set1, movieInfo: info1 } = await getMovieIdsForPersonList(ids1);
  const { movieIds: set2, movieInfo: info2 } = await getMovieIdsForPersonList(ids2);

  const intersection = [...set1].filter((id) => set2.has(id));
  const movieInfo = new Map([...info1, ...info2]);
  const result = intersection.map((id) => {
    const info = movieInfo.get(id) || {};
    const title = info.title || info.original_title || `Movie ${id}`;
    return {
      id,
      title,
      original_title: info.original_title || info.title || title,
      poster_path: info.poster_path || null,
    };
  });
  result.sort((a, b) => a.title.localeCompare(b.title, 'en'));
  return result;
}
