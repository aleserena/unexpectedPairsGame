/**
 * API routes: game endpoints and movie lookup.
 */

import { getRoleNames, getValidMoviesForRoles } from './gameLogic.js';
import { searchMovies } from './tmdb.js';
import * as cache from './cache.js';

/**
 * Normalize guess for comparison: trim, lowercase, collapse spaces.
 */
function normalizeGuess(guess) {
  return String(guess || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Find the movie in validMovies that matches the normalized guess by
 * title or original_title. Returns the matching movie object or null.
 */
function findMatchingMovie(normalizedGuess, validMovies) {
  if (!normalizedGuess || !Array.isArray(validMovies) || validMovies.length === 0) return null;
  for (const m of validMovies) {
    const title = (m.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const original = (m.original_title || m.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (title === normalizedGuess || original === normalizedGuess) return m;
  }
  return null;
}

function ensureSessionShape(session) {
  if (!session) return null;
  if (!session.usedMovieIds || !(session.usedMovieIds instanceof Set)) {
    session.usedMovieIds = new Set();
  }
  if (typeof session.streak !== 'number') session.streak = 0;
  if (typeof session.bestStreak !== 'number') session.bestStreak = 0;
  return session;
}

// Hook for future leaderboard integration.
function recordFinishedStreak(sessionId, finalStreak, reason) {
  if (!finalStreak || finalStreak <= 0) return;
  // Placeholder: replace with persistent storage when leaderboard is implemented.
  console.log(`[streak] session=${sessionId} finished streak=${finalStreak} reason=${reason}`);
}

export function registerRoutes(app) {
  const roles = getRoleNames();
  if (roles.length < 2) {
    console.warn('Need at least 2 roles in data/role-to-actors.json');
  }

  app.get('/api/question', async (req, res) => {
    if (roles.length < 2) {
      return res.status(503).json({ error: 'Not enough roles configured' });
    }

    const session = ensureSessionShape(req.gameSession);

    // If there is no active streak, fall back to simple random selection.
    if (!session || !session.usedMovieIds || session.usedMovieIds.size === 0) {
      let i = Math.floor(Math.random() * roles.length);
      let j = Math.floor(Math.random() * roles.length);
      while (j === i) j = Math.floor(Math.random() * roles.length);
      const role1 = roles[i];
      const role2 = roles[j];
      return res.json({
        role1,
        role2,
        streak: session ? session.streak : 0,
        bestStreak: session ? session.bestStreak : 0,
      });
    }

    const MAX_ATTEMPTS = 20;
    const usedIds = session.usedMovieIds;
    let chosen = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let i = Math.floor(Math.random() * roles.length);
      let j = Math.floor(Math.random() * roles.length);
      while (j === i) j = Math.floor(Math.random() * roles.length);
      const role1 = roles[i];
      const role2 = roles[j];

      let validMovies = cache.get(role1, role2);
      if (!validMovies) {
        try {
          validMovies = await getValidMoviesForRoles(role1, role2);
          cache.set(role1, role2, validMovies);
        } catch (err) {
          console.error('getValidMoviesForRoles failed in /api/question:', err);
          continue;
        }
      }

      if (!Array.isArray(validMovies) || validMovies.length === 0) {
        continue;
      }

      const hasFreshMovie = validMovies.some((m) => !usedIds.has(m.id));
      if (hasFreshMovie) {
        chosen = { role1, role2 };
        break;
      }
    }

    // If we couldn't find any pair with at least one fresh movie, consider the streak finished
    // and fall back to a random pair while resetting the streak.
    if (!chosen) {
      const finishedStreak = session.streak;
      if (finishedStreak > 0) {
        recordFinishedStreak(req.sessionId, finishedStreak, 'exhausted-combos');
      }
      session.streak = 0;
      session.usedMovieIds.clear();

      let i = Math.floor(Math.random() * roles.length);
      let j = Math.floor(Math.random() * roles.length);
      while (j === i) j = Math.floor(Math.random() * roles.length);
      const role1 = roles[i];
      const role2 = roles[j];

      return res.json({
        role1,
        role2,
        streak: session.streak,
        bestStreak: session.bestStreak,
      });
    }

    return res.json({
      role1: chosen.role1,
      role2: chosen.role2,
      streak: session.streak,
      bestStreak: session.bestStreak,
    });
  });

  app.post('/api/check', async (req, res) => {
    const { role1, role2, guess } = req.body || {};
    if (!role1 || !role2) {
      return res.status(400).json({ error: 'role1 and role2 are required' });
    }
    let validMovies = cache.get(role1, role2);
    if (!validMovies) {
      try {
        validMovies = await getValidMoviesForRoles(role1, role2);
        cache.set(role1, role2, validMovies);
      } catch (err) {
        console.error('getValidMoviesForRoles failed:', err);
        return res.status(502).json({ error: 'Failed to resolve movies', details: err.message });
      }
    }

    const session = ensureSessionShape(req.gameSession);
    const normalizedGuess = normalizeGuess(guess);
    const matchedMovie = findMatchingMovie(normalizedGuess, validMovies);

    let correct = false;
    let duplicate = false;
    const titles = Array.isArray(validMovies) ? validMovies.map((m) => m.title) : [];

    const buildPosterUrl = (movie) => {
      if (!movie || !movie.poster_path) return null;
      const path = String(movie.poster_path).startsWith('/')
        ? movie.poster_path
        : `/${movie.poster_path}`;
      return `https://image.tmdb.org/t/p/w342${path}`;
    };

    if (!session) {
      // Fallback: behave like original logic if session is somehow missing.
      correct = !!matchedMovie;
      return res.json({
        correct,
        validMovies: titles,
        movie: matchedMovie
          ? {
              id: matchedMovie.id,
              title: matchedMovie.title,
              original_title: matchedMovie.original_title,
              posterUrl: buildPosterUrl(matchedMovie),
            }
          : null,
      });
    }

    if (!matchedMovie) {
      // Incorrect guess: streak ends.
      const finishedStreak = session.streak;
      if (finishedStreak > 0) {
        recordFinishedStreak(req.sessionId, finishedStreak, 'incorrect');
      }
      session.streak = 0;
      session.usedMovieIds.clear();
      correct = false;
    } else if (session.usedMovieIds.has(matchedMovie.id)) {
      // Duplicate movie during a streak: do not change the streak or used movies,
      // just signal that duplicates are not allowed so the client can ask again.
      correct = false;
      duplicate = true;
    } else {
      // New correct movie: advance streak.
      session.streak += 1;
      session.usedMovieIds.add(matchedMovie.id);
      session.bestStreak = Math.max(session.bestStreak, session.streak);
      correct = true;
    }

    const example =
      !matchedMovie && Array.isArray(validMovies) && validMovies.length > 0
        ? validMovies[0]
        : null;

    res.json({
      correct,
      validMovies: titles,
      streak: session.streak,
      bestStreak: session.bestStreak,
      duplicate,
      movie: matchedMovie
        ? {
            id: matchedMovie.id,
            title: matchedMovie.title,
            original_title: matchedMovie.original_title,
            posterUrl: buildPosterUrl(matchedMovie),
          }
        : null,
      exampleMovie: example
        ? {
            id: example.id,
            title: example.title,
            original_title: example.original_title,
            posterUrl: buildPosterUrl(example),
          }
        : null,
    });
  });

  app.get('/api/valid-movies', async (req, res) => {
    const { role1, role2 } = req.query || {};
    if (!role1 || !role2) {
      return res.status(400).json({ error: 'role1 and role2 query params are required' });
    }
    let validMovies = cache.get(role1, role2);
    if (!validMovies) {
      try {
        validMovies = await getValidMoviesForRoles(role1, role2);
        cache.set(role1, role2, validMovies);
      } catch (err) {
        console.error('getValidMoviesForRoles failed:', err);
        return res.status(502).json({ error: 'Failed to resolve movies', details: err.message });
      }
    }
    res.json({ validMovies: validMovies.map((m) => m.title) });
  });

  // Global movie search endpoint for typeahead (not restricted to valid answers)
  app.get('/api/search-movies', async (req, res) => {
    try {
      const q = (req.query?.q || '').trim();
      if (!q) {
        return res.json({ results: [] });
      }
      const results = await searchMovies(q, 1);
      res.json({
        results: results.map((m) => ({
          id: m.id,
          title: m.title,
          original_title: m.original_title,
          release_year: m.release_year,
        })),
      });
    } catch (err) {
      console.error('search-movies failed:', err);
      res.status(502).json({ error: 'Failed to search movies', details: err.message });
    }
  });

  // Simple stats endpoint to expose current session streaks.
  app.get('/api/stats', (req, res) => {
    const session = ensureSessionShape(req.gameSession);
    if (!session) {
      return res.json({ streak: 0, bestStreak: 0 });
    }
    res.json({
      streak: session.streak,
      bestStreak: session.bestStreak,
    });
  });
}
