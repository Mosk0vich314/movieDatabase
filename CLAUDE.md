# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

There is no build step. To deploy changes:

```bash
python tools/deploy.py "Your commit message"
```

This script:
1. Bumps the version timestamp (`YYYY.MM.DD.HHMM`) in `index.html` (`?v=` cache-busting params) and `sw.js` (`CACHE_NAME`)
2. Commits all changes with the message formatted as `"Your commit message (vYYYY.MM.DD.HHMM)"`
3. Pushes to `main`, which auto-deploys via GitHub Pages

When modifying files manually without deploying, keep version strings consistent across `index.html` and `sw.js`.

## Architecture

This is a vanilla JS single-page PWA with no framework, no bundler, and no backend. All data lives in the browser's IndexedDB. Scripts are loaded in dependency order at the bottom of `index.html`.

Each JS file is an IIFE that exposes a single module object:

- **`js/db.js` → `MovieDB`**: IndexedDB wrapper. All persistence goes through here: `addMovie`, `updateMovie`, `deleteMovie`, `getMovie`, `getAllMovies`, `exportData`, `importData`.

- **`js/api.js` → `TMDB`**: Calls the TMDB REST API. The API key is hardcoded. `searchMovies(query)` returns results; `getMovieDetails(tmdbId)` fetches full details including `credits` (used to extract directors from `credits.crew`).

- **`js/ui.js` → `UI`**: Pure rendering — returns HTML strings from movie objects (`renderMovieCard`, `renderMovieDetail`, `renderSearchResult`, `renderDirectorGroup`). Also owns the custom `<select>` dropdown implementation (`initCustomSelects`) which wraps native selects with styled divs while keeping the native element in the DOM so existing `change` listeners work.

- **`js/stats.js` → `Stats`**: `compute(movies)` crunches an array of movies into stats; `render(stats)` returns the HTML.

- **`js/app.js` → `App`**: The main controller. Owns hash-based routing (`#catalogue`, `#add`, `#stats`, `#detail/:id`), all event listeners, filter/sort logic, and wires together `MovieDB`, `TMDB`, `UI`, and `Stats`.

- **`sw.js`**: Service worker. Caches all local assets at install. Network-first strategy for same-origin requests (falls back to cache offline). TMDB API/image requests bypass the cache entirely.

## Movie data shape

```js
{
  id,          // auto-incremented by IndexedDB
  tmdbId,      // TMDB movie ID
  title,
  year,        // string, e.g. "1999"
  genres,      // string[]
  directors,   // string[]
  poster,      // full TMDB image URL
  rating,      // 1–5 integer, or 0/undefined
  notes,       // string
  dateAdded,   // ISO string, set on add
}
```

## Hosting

Deployed to GitHub Pages at `https://<user>.github.io/movieDatabase/`. The `manifest.json` `start_url` and `scope` are set to `/movieDatabase/` to match this path.
