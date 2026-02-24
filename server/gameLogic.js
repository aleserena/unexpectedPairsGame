/**
 * Resolves "valid movies" for a pair of roles: movies where at least one actor
 * who played role1 and at least one who played role2 appear together.
 */

import { getMovieIdsForPerson, getPersonMovieCredits, getPersonDetails } from './tmdb.js';
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
 * Returns {
 *   movieIds: Set,
 *   movieInfo: Map(id -> { id, title, original_title, poster_path }),
 *   movieToPersons: Map(id -> Set(personId))
 * }
 */
async function getMovieIdsForPersonList(personIds) {
  const allMovieIds = new Set();
  const allMovieInfo = new Map();
  const movieToPersons = new Map();
  for (const pid of personIds) {
    try {
      const { movieIds, movieInfo } = await getMovieIdsForPerson(pid);
      for (const id of movieIds) {
        allMovieIds.add(id);
        let people = movieToPersons.get(id);
        if (!people) {
          people = new Set();
          movieToPersons.set(id, people);
        }
        people.add(pid);
      }
      for (const [id, info] of movieInfo) allMovieInfo.set(id, info);
    } catch (err) {
      console.warn(`Failed to fetch credits for person ${pid}:`, err.message);
    }
  }
  return { movieIds: allMovieIds, movieInfo: allMovieInfo, movieToPersons };
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

  const {
    movieIds: set1,
    movieInfo: info1,
    movieToPersons: map1,
  } = await getMovieIdsForPersonList(ids1);
  const {
    movieIds: set2,
    movieInfo: info2,
    movieToPersons: map2,
  } = await getMovieIdsForPersonList(ids2);

  const intersection = [...set1].filter((id) => set2.has(id));
  const movieInfo = new Map([...info1, ...info2]);
  const result = [];

  for (const id of intersection) {
    const actors1 = map1.get(id) || new Set();
    const actors2 = map2.get(id) || new Set();

    // Validation: the same actor cannot be the only link between both roles.
    // Require at least one distinct person across roles.
    const hasDistinctActors = [...actors1].some((a1) => [...actors2].some((a2) => a1 !== a2));
    if (!hasDistinctActors) continue;

    const info = movieInfo.get(id) || {};
    const title = info.title || info.original_title || `Movie ${id}`;
    result.push({
      id,
      title,
      original_title: info.original_title || info.title || title,
      poster_path: info.poster_path || null,
    });
  }
  result.sort((a, b) => a.title.localeCompare(b.title, 'en'));
  return result;
}

/**
 * For a given movie and pair of roles, resolve which configured actors
 * actually appear in that movie, and return their names and roles.
 */
export async function getRoleActorsForMovie(role1, role2, movieId) {
  const roles = loadRoleToActors();
  const ids1 = roles[role1] || [];
  const ids2 = roles[role2] || [];
  const targetId = Number(movieId);

  async function collect(roleName, personIds) {
    const actors = [];
    for (const pid of personIds) {
      try {
        const credits = await getPersonMovieCredits(pid);
        const cast = credits.cast || [];
        const credit = cast.find((entry) => entry && entry.id === targetId);
        if (!credit) continue;
        const details = await getPersonDetails(pid);
        actors.push({
          personId: pid,
          name: details?.name || `Person ${pid}`,
          role: roleName,
          character: credit.character || null,
        });
      } catch (err) {
        console.warn('Failed to resolve actor for movie', {
          role: roleName,
          personId: pid,
          movieId: targetId,
          message: err?.message,
        });
      }
    }
    return actors;
  }

  const [role1Actors, role2Actors] = await Promise.all([collect(role1, ids1), collect(role2, ids2)]);

  return {
    role1Actors,
    role2Actors,
  };
}
