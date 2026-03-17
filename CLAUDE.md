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

- **`js/ui.js` → `UI`**: Pure rendering — returns HTML strings from movie objects (`renderMovieCard`, `renderWatchlistCard`, `renderMovieDetail`, `renderSearchResult`, `renderDirectorGroup`). Also owns the custom `<select>` dropdown implementation (`initCustomSelects`) which wraps native selects with styled divs while keeping the native element in the DOM so existing `change` listeners work.

- **`js/stats.js` → `Stats`**: `compute(movies)` crunches an array of movies into stats including `tasteDNA`; `render(stats)` returns the HTML. Stat numbers use `data-count` attributes for animated counters.

- **`js/app.js` → `App`**: The main controller. Owns hash-based routing (`#catalogue`, `#add`, `#watchlist`, `#stats`, `#detail/:id`), all event listeners, filter/sort logic, and wires together `MovieDB`, `TMDB`, `UI`, and `Stats`. Also contains `animateCounters`, `updateWatchlistBadge`, and `spawnStarBurst`.

- **`sw.js`**: Service worker. Caches all local assets at install. Network-first strategy for same-origin requests (falls back to cache offline). TMDB API/image requests bypass the cache entirely.

## Views & features

- **Catalogue** (`#catalogue`): Movie grid with filter panel (genre, director, rating, sort) hidden behind a toggle button. Shows only non-watchlist movies. 5-star cards get a gold glow, 4-star a silver glow.
- **Add** (`#add`): TMDB search → select result to open the rate/notes form. Each search result also has a "+ Watchlist" quick-add button.
- **Watchlist** (`#watchlist`): Movies saved with `watchlist: true`. Each card has a "✓ Watched" button that pre-fills the add form so the user can rate and move it to the catalogue. Nav tab shows a live count badge.
- **Stats** (`#stats`): Animated counters, Taste DNA card (top genre + director loyalty ratio), bar charts, top rated list. Includes backup/restore and danger zone. Stats exclude watchlist movies.
- **Detail** (`#detail/:id`): Full movie info. Watchlist movies show "Mark as Watched" instead of "Edit".

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
  rating,      // 1–5 integer, or 0/undefined (absent on watchlist movies)
  notes,       // string (absent on watchlist movies)
  dateAdded,   // ISO string, set on add
  watchlist,   // true if on watchlist; absent/false for catalogue movies
}
```

## Key patterns

- **Filter toggle**: The catalogue filter dropdowns are hidden by default. `#filter-panel` gets class `open` when `#filter-toggle` is clicked. A `filter-badge` span shows the count of active filters.
- **Clear buttons**: Search inputs are wrapped in `.input-wrap`. The `.input-clear` button is shown/hidden purely via CSS using `input:not(:placeholder-shown) + .input-clear`.
- **Watchlist badge**: `updateWatchlistBadge()` in `app.js` must be called after any operation that adds or removes watchlist movies (addToWatchlist, saveMovie, deleteMovie, importData, clear-all).
- **Taste DNA**: Derived in `stats.js` from top genre + ratio of unique directors to total movies. Needs ≥ 3 movies to appear.
- **Star burst**: `spawnStarBurst(starEl)` in `app.js` spawns fixed-position CSS-animated particles. Only fires when rating === 5.

## Hosting

Deployed to GitHub Pages at `https://<user>.github.io/movieDatabase/`. The `manifest.json` `start_url` and `scope` are set to `/movieDatabase/` to match this path. The PWA icon uses `"purpose": "any"` (not maskable) to avoid Android adaptive icon cropping.
