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

- **`js/api.js` → `TMDB`**: Calls the TMDB REST API. The API key is hardcoded. `searchMovies(query)` returns results; `getMovieDetails(tmdbId)` fetches full details including `credits` (used to extract directors from `credits.crew`). `searchPerson(query)` searches for directors by name (filters to `known_for_department === 'Directing'`). `getPersonMovieCredits(personId)` returns the full crew credits for a person. `profileUrl(path)` is the person-photo equivalent of `posterUrl`.

- **`js/ui.js` → `UI`**: Pure rendering — returns HTML strings from movie objects (`renderMovieCard`, `renderFilmCard`, `renderDecadeLanes`, `renderWatchlistCard`, `renderMovieDetail`, `renderSearchResult`, `renderDirectorGroup`). Also: `renderPersonResult(person)` renders a director search result row (uses `data-person-id`); `renderFilmographyResult(film, addedSet)` renders a filmography row with an "Added" label and `.search-result--added` class when the film's TMDB ID is in `addedSet`. Also owns the custom `<select>` dropdown implementation (`initCustomSelects`) which wraps native selects with styled divs while keeping the native element in the DOM so existing `change` listeners work.

- **`js/stats.js` → `Stats`**: `compute(movies)` crunches an array of movies into stats including `tasteDNA`; `render(stats)` returns the HTML. Stat numbers use `data-count` attributes for animated counters.

- **`js/app.js` → `App`**: The main controller. Owns hash-based routing (`#catalogue`, `#add`, `#watchlist`, `#stats`, `#detail/:id`), all event listeners, filter/sort logic, and wires together `MovieDB`, `TMDB`, `UI`, and `Stats`. Also contains `animateCounters`, `updateWatchlistBadge`, and `spawnStarBurst`. Module-level `searchMode` (`'movie'|'director'`) and `selectedDirectorName` track Add-view state; `searchDirector()` and `loadFilmography(personId, name)` handle the director search flow.

- **`sw.js`**: Service worker. Caches all local assets at install. Network-first strategy for same-origin requests (falls back to cache offline). TMDB API/image requests bypass the cache entirely.

## Views & features

- **Catalogue** (`#catalogue`): Decade swim-lanes view. Movies are grouped by release decade (newest first) in horizontal scroll rows. Within each lane, cards are sorted by rating descending. Card size reflects rating: 5★ = `card-xl` (255×170px), 4★ = `card-lg` (215×143px), others = `card-sm` (180×120px). 5-star cards get a gold glow, 4-star a silver glow. Decade labels use Bebas Neue font. Filter panel (genre, director, rating, sort) is hidden behind a toggle button.
- **Add** (`#add`): A **Movie / Director** pill toggle (`#search-mode-toggle`, `.smt-btn`) switches between two search modes.
  - *Movie mode*: TMDB text search, or paste a `themoviedb.org/movie/<id>` URL to fetch a film directly by ID. Each result has a "+ Watchlist" quick-add button.
  - *Director mode*: Search for a director by name → select a person → see their full filmography (sorted newest-first, deduplicated). Films already in the user's DB are greyed out (`.search-result--added`) with an "Added" label instead of the watchlist button. A "← Name" back button returns to the person list. Autocomplete is suppressed in director mode.
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
- **Decade swim-lanes**: `UI.renderDecadeLanes(movies)` groups movies by decade and renders horizontal scroll sections with mosaic-sized `film-card` elements. `UI.renderFilmCard(movie)` renders a poster-only card with a hover overlay showing title, year, and interactive `.fcs` quick-rate stars.
- **Quick-rate**: Clicking a `.fcs` star on a film card in the catalogue calls `App.quickRateMovie(id, rating, starEl)` — updates the rating in IndexedDB and reloads the catalogue. The click event is intercepted before card navigation. Star burst fires on 5★ quick-rates.
- **Direct TMDB URL entry**: In Movie mode, if the search input contains a `themoviedb.org/movie/<id>` URL, `searchTMDB()` extracts the ID and calls `selectSearchResult()` directly, bypassing the text search. Useful for obscure films that don't surface in popularity-ranked results.
- **Director filmography**: `#search-results` click handler checks `data-person-id` before `data-tmdb-id`, so person rows route to `loadFilmography()` while film rows route to `selectSearchResult()`. Already-added films use `pointer-events: none` via `.search-result--added` so they never fire click events.
- **Font**: Bebas Neue (Google Fonts, imported in CSS) is used for decade labels only. App title uses Montserrat 800.

## Hosting

Deployed to GitHub Pages at `https://<user>.github.io/movieDatabase/`. The `manifest.json` `start_url` and `scope` are set to `/movieDatabase/` to match this path. The PWA icon uses `"purpose": "any"` (not maskable) to avoid Android adaptive icon cropping.
