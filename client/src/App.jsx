import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api';

const MIN_SEARCH_CHARS = 2;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

// In-memory cache for movie search titles, keyed by normalized query.
const searchCache = new Map();

const normalizeSearchQuery = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const getCachedPrefixResult = (normalized) => {
  const now = Date.now();
  for (let len = normalized.length; len >= MIN_SEARCH_CHARS; len -= 1) {
    const prefix = normalized.slice(0, len);
    const entry = searchCache.get(prefix);
    if (entry && now - entry.timestamp <= CACHE_TTL_MS) {
      return entry;
    }
  }
  return null;
};

const setSearchCache = (normalized, titles) => {
  const now = Date.now();
  searchCache.set(normalized, { titles, timestamp: now });
  if (searchCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey !== undefined) {
      searchCache.delete(oldestKey);
    }
  }
};

function App() {
  const [role1, setRole1] = useState(null);
  const [role2, setRole2] = useState(null);
  const [guess, setGuess] = useState('');
  const [movieOptions, setMovieOptions] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suppressSuggestions, setSuppressSuggestions] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [duplicateMessage, setDuplicateMessage] = useState('');

  const fetchQuestion = useCallback(async () => {
    setError(null);
    setResult(null);
    setDuplicateMessage('');
    setGuess('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/question`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRole1(data.role1);
      setRole2(data.role2);
      if (typeof data.streak === 'number') {
        setStreak(data.streak);
      }
      if (typeof data.bestStreak === 'number') {
        setBestStreak(data.bestStreak);
      }
    } catch (err) {
      setError(err.message);
      setRole1(null);
      setRole2(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuestion();
  }, [fetchQuestion]);

  const handleGuessChange = (e) => {
    if (result) return;
    const value = e.target.value;
    setGuess(value);
    setResult(null);
    setDuplicateMessage('');
  };

  // Debounced movie search for typeahead
  useEffect(() => {
    // Do not show or update suggestions once a result exists; wait for a new question.
    if (result) {
      setSuggestions([]);
      setShowSuggestions(false);
      setMovieOptions([]);
      return;
    }

    if (suppressSuggestions) {
      setSuggestions([]);
      setShowSuggestions(false);
      setMovieOptions([]);
      setSuppressSuggestions(false);
      return;
    }

    const trimmed = guess.trim();
    // Require at least MIN_SEARCH_CHARS characters before searching to avoid noisy,
    // laggy lookups on mobile for very short input.
    if (!trimmed || trimmed.length < MIN_SEARCH_CHARS) {
      setSuggestions([]);
      setShowSuggestions(false);
      setMovieOptions([]);
      return;
    }

    const normalized = normalizeSearchQuery(guess);
    const cached = getCachedPrefixResult(normalized);

    if (cached && Array.isArray(cached.titles) && cached.titles.length > 0) {
      const filteredTitles = cached.titles
        .filter((t) => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim())
        .filter((t) => t.toLowerCase().includes(normalized));
      const uniqueFiltered = Array.from(new Set(filteredTitles));
      const matches = uniqueFiltered.slice(0, 6);
      setMovieOptions(uniqueFiltered);
      setSuggestions(matches);
      setShowSuggestions(matches.length > 0);
      return;
    }

    const controller = new AbortController();
    // Shorter debounce for snappier feel on mobile.
    const timeoutId = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/search-movies?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setMovieOptions([]);
          setSuggestions([]);
          setShowSuggestions(false);
          return;
        }
        const data = await res.json();
        const titles = Array.isArray(data.results)
          ? data.results
              .map((m) => m && (m.title || m.original_title))
              .filter((t) => typeof t === 'string' && t.trim().length > 0)
          : [];
        const uniqueTitles = Array.from(new Set(titles));
        setSearchCache(normalized, uniqueTitles);
        const filteredTitles = uniqueTitles.filter((t) =>
          t.toLowerCase().includes(normalized),
        );
        // Fewer suggestions keeps the list lighter on small screens.
        const matches = filteredTitles.slice(0, 6);
        setMovieOptions(filteredTitles);
        setSuggestions(matches);
        setShowSuggestions(matches.length > 0);
      } catch {
        setMovieOptions([]);
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 2000);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [guess, suppressSuggestions, result]);

  const submitGuess = useCallback(
    async (rawTitle) => {
      if (!role1 || !role2) return;

      const title = String(rawTitle || '').trim();
      if (!title) return;

      setSubmitting(true);
      setError(null);
      setDuplicateMessage('');
      try {
        const res = await fetch(`${API_BASE}/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role1, role2, guess: title }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.details || `HTTP ${res.status}`);
        if (data.duplicate) {
          setResult(null);
          setDuplicateMessage('No movie duplicates can be used. Try a different movie.');
          if (typeof data.streak === 'number') {
            setStreak(data.streak);
          }
          if (typeof data.bestStreak === 'number') {
            setBestStreak(data.bestStreak);
          }
          setGuess('');
        } else {
          setResult(data);
          if (typeof data.streak === 'number') {
            setStreak(data.streak);
          }
          if (typeof data.bestStreak === 'number') {
            setBestStreak(data.bestStreak);
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setSubmitting(false);
      }
    },
    [role1, role2],
  );

  const handleSubmitOrNewQuestion = async (e) => {
    e.preventDefault();
    // Always hide and suppress suggestions on submit so the typeahead
    // doesn't re-open after the guess is submitted.
    setShowSuggestions(false);
    setSuggestions([]);
    setSuppressSuggestions(true);

    // If we already have a result, this click starts a new question instead
    if (result) {
      fetchQuestion();
      return;
    }

    const trimmed = guess.trim();
    if (!trimmed) {
      setError('Please enter a movie title.');
      return;
    }

    await submitGuess(trimmed);
  };

  if (loading) {
    return (
      <div className="app">
        <p className="loading">Loading question…</p>
      </div>
    );
  }

  if (error && !role1 && !role2) {
    return (
      <div className="app">
        <p className="error">{error}</p>
        <button type="button" className="btn btn-secondary" onClick={fetchQuestion}>
          Try again
        </button>
      </div>
    );
  }

  const isCorrect = result && result.correct;
  const posterMovie =
    result && isCorrect
      ? result.movie
      : result && !isCorrect
      ? result.exampleMovie
      : null;
  const incorrectTitle =
    !isCorrect && posterMovie && (posterMovie.title || posterMovie.original_title)
      ? `Not quite. One of the movies was ${posterMovie.title || posterMovie.original_title}`
      : 'Not quite. That was an easy one';

  return (
    <div className="app">
      <h1>Unexpected Pairs</h1>
      <p className="subtitle">Guess the movie where these two were together</p>

      <div className="streaks">
        <div className="streaks-label">Streak</div>
        <div className="streaks-values">
          <span className="streaks-current">{streak}</span>
          {bestStreak > 0 && (
            <span className="streaks-best">
              Best <strong>{bestStreak}</strong>
            </span>
          )}
        </div>
      </div>

      {role1 && role2 && (
        <p className="prompt">
          A movie where <strong>{role1}</strong> and <strong>{role2}</strong> were together
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {duplicateMessage && <p className="error">{duplicateMessage}</p>}

      <form className="form" onSubmit={handleSubmitOrNewQuestion}>
        <div className="typeahead-wrapper">
          <input
            type="text"
            className="input"
            placeholder="Movie title"
            value={guess}
            onChange={handleGuessChange}
            disabled={submitting || !!result}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />
          {showSuggestions && suggestions.length > 0 && !result && (
            <ul className="typeahead-list">
            {suggestions.map((title) => (
              <li
                key={title}
                className="typeahead-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const selectedTitle = title;
                  setGuess(selectedTitle);
                  setShowSuggestions(false);
                  setSuggestions([]);
                  setSuppressSuggestions(true);
                  submitGuess(selectedTitle);
                }}
              >
                {title}
              </li>
            ))}
            </ul>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {result ? 'New question' : submitting ? 'Checking…' : 'Submit'}
        </button>
      </form>

      {result && (
        <div className={`result ${isCorrect ? 'correct' : 'incorrect'}`}>
          <div className="result-title">
            {isCorrect ? 'Correct!' : incorrectTitle}
          </div>
          {posterMovie && posterMovie.posterUrl && (
            <div className="result-poster">
              <img
                src={posterMovie.posterUrl}
                alt={posterMovie.title || posterMovie.original_title || 'Movie poster'}
              />
            </div>
          )}
          {posterMovie && result?.actorsByRole && (
            <div className="result-actors">
              <p>In this movie:</p>
              <ul>
                {Array.isArray(result.actorsByRole.role1Actors) &&
                  result.actorsByRole.role1Actors.map((actor) => (
                    <li key={`r1-${actor.personId}`}>
                      {actor.name}
                      {actor.character || actor.role ? ` as ${actor.character || actor.role}` : ''}
                    </li>
                  ))}
                {Array.isArray(result.actorsByRole.role2Actors) &&
                  result.actorsByRole.role2Actors.map((actor) => (
                    <li key={`r2-${actor.personId}`}>
                      {actor.name}
                      {actor.character || actor.role ? ` as ${actor.character || actor.role}` : ''}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
