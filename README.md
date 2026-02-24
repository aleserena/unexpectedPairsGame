# Unexpected Pairs – Movie Guessing Game

A web game where you guess the movie based on two "famous role" clues (e.g. *Batman* and *Hulk*). The answer is any movie where **any** actor who played one of those roles worked with **any** actor who played the other—so multiple answers can be correct (e.g. Mickey 17 for Robert Pattinson’s Batman + Mark Ruffalo’s Hulk).

## Setup

### 1. TMDB API key

Get a free API key at [The Movie Database – API Settings](https://www.themoviedb.org/settings/api). Create a file named `.env` in the project root (or in `server/`) with:

```
TMDB_API_KEY=your_api_key_here
```

Do not commit `.env` or your API key.

### 2. Install and run

**Backend (Express)**

```bash
cd server
npm install
npm run dev
```

Server runs at `http://localhost:3001`.

**Frontend (Vite + React)**

```bash
cd client
npm install
npm run dev
```

App runs at `http://localhost:5173` and proxies `/api` to the backend.

### 3. Play

Open `http://localhost:5173`, get a random pair of roles, type a movie title, and submit. You’ll see whether you’re correct and the full list of valid answers.

## Adding roles and actors

The game uses a curated mapping from **role name** to **TMDB person IDs** in `data/role-to-actors.json`:

```json
{
  "Batman": [11288, 3894, 3896, 64],
  "Hulk": [103, 8197, 6162],
  "Joker": [73421, 5292],
  "Iron Man": [3223]
}
```

- **Role name**: Any string (e.g. `"Batman"`, `"Joker"`). These are the clues shown in the game.
- **Person IDs**: TMDB person IDs (numbers). Only these are used; names are not stored here.

To find a person’s TMDB ID:

1. Search on [TMDB](https://www.themoviedb.org/) or use the API:  
   `GET https://api.themoviedb.org/3/search/person?query=Robert%20Pattinson&api_key=YOUR_KEY`
2. From the result, take the `id` of the correct person.
3. Add that `id` to the array for the right role in `data/role-to-actors.json`.

Restart the server after editing the JSON. New role pairs will appear in the next “New question” draw.

## API

- **GET /api/question** – Returns `{ role1, role2 }` for the current round.
- **POST /api/check** – Body: `{ role1, role2, guess }`. Returns `{ correct, validMovies }`.
- **GET /api/valid-movies?role1=…&role2=…** – Returns `{ validMovies }` without submitting a guess.

## Tech

- **Frontend**: React 18, Vite 5
- **Backend**: Node (ES modules), Express, CORS
- **Data**: TMDB API (person movie credits) + `data/role-to-actors.json` (no database)
