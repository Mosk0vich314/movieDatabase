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

- **`js/ui.js` → `UI`**: Pure rendering — returns HTML strings from movie objects (`renderMovieCard`, `renderFilmCard`, `renderDecadeLanes`, `renderMovieDetail`, `renderSearchResult`, `renderDirectorGroup`). Also: `renderPersonResult(person)` renders a director search result row (uses `data-person-id`); `renderFilmographyResult(film, addedSet)` renders a filmography row with an "Added" label and `.search-result--added` class when the film's TMDB ID is in `addedSet`. Also owns the custom `<select>` dropdown implementation (`initCustomSelects`) which wraps native selects with styled divs while keeping the native element in the DOM so existing `change` listeners work. **`renderWatchlistCard` is dead code** — the watchlist view renders via `renderBlurayShelf` (library/default), `renderPosterGrid` (array), or `renderDecadeLanes` (decades); never call or edit `renderWatchlistCard`.

- **`js/stats.js` → `Stats`**: `compute(movies)` crunches an array of movies into stats including `tasteDNA`; `render(stats)` returns the HTML. Stat numbers use `data-count` attributes for animated counters.

- **`js/posters.js` → `Posters`**: Draws the **Top 10 poster set** on canvas (1080×1350). `generate(movie, rank)` returns a finished canvas — giant rank numeral filled with the film's own still (mask canvas + `source-in`), photo band across the bottom, title in a colour sampled from the image, grain and vignette. `pickTop(movies)` ranks rated catalogue films and reverses them into countdown order; `openTop10(movies)` builds the whole set and opens the swipeable deck modal. Standalone — it only touches `UI`/`TMDB`/`MovieDB` behind `typeof` guards.

- **`js/app.js` → `App`**: The main controller. Owns hash-based routing (`#catalogue`, `#add`, `#watchlist`, `#chart`, `#stats`, `#inventory`, `#detail/:id`, `#preview/:tmdbId`), all event listeners, filter/sort logic, and wires together `MovieDB`, `TMDB`, `UI`, and `Stats`. Also contains `animateCounters`, `updateWatchlistBadge`, and `spawnStarBurst`. Module-level `searchMode` (`'movie'|'director'|'actor'`) and `selectedDirectorName` track Add-view state; `searchDirector()` and `loadFilmography(personId, name)` handle the director/actor search flow. `setupPosterDrag(movie)` wires the drag-to-reveal people overlay and is called by both detail loaders.

- **`sw.js`**: Service worker. Caches all local assets at install. Network-first strategy for same-origin requests (falls back to cache offline). TMDB API/image requests bypass the cache entirely.

## Views & features

- **Catalogue** (`#catalogue`): Decade swim-lanes view. Movies are grouped by release decade (newest first) in horizontal scroll rows. Within each lane, cards are sorted by rating descending. Card size reflects rating: 5★ = `card-xl` (255×170px), 4★ = `card-lg` (215×143px), others = `card-sm` (180×120px). 5-star cards get a gold glow, 4-star a silver glow. Decade labels use Bebas Neue font. Filter panel (genre, director, rating, sort) is hidden behind a toggle button.
- **Add** (`#add`): A **Movie / Director** pill toggle (`#search-mode-toggle`, `.smt-btn`) switches between two search modes.
  - *Movie mode*: TMDB text search, or paste a `themoviedb.org/movie/<id>` URL to fetch a film directly by ID. Each result has a "+ Watchlist" quick-add button; tapping the row itself opens the **Preview** page. Returning from a preview does **not** reset the Add view — `navigate()` skips `resetAddView()` when the previous hash was a `#preview/`, so the search results survive both the Back button and hardware back.
  - *Director mode*: Search for a director by name → select a person → see their full filmography (sorted newest-first, deduplicated). Films already in the user's DB are greyed out (`.search-result--added`) with an "Added" label instead of the watchlist button. A "← Name" back button returns to the person list. Autocomplete is suppressed in director mode.
- **Watchlist** (`#watchlist`): Movies saved with `watchlist: true`. Each card has a "✓ Watched" button that pre-fills the add form so the user can rate and move it to the catalogue. Nav tab shows a live count badge. Pinned movies (`pinned: true`) appear in a dedicated `#watchlist-pinned` section rendered inline by `loadWatchlist()` — not via any UI.render function. The pinned section shows only a 📌 unpin button; no "Watched" button (user taps the item to open detail and mark as watched from there).
- **Stats** (`#stats`): Animated counters, Taste DNA card (top genre + director loyalty ratio), bar charts, top rated list, activity snapshot (this week/month), blind spot recommendations. Includes cloud sync, backup/restore, and danger zone. Stats exclude watchlist movies.
- **Top 10 posters**: A `.yir-launch-btn` (`#poster-launch`) in the Stats view opens `Posters.openTop10()` — a full-screen deck (`#poster-deck`, `.pd-*`) of ten generated posters, #10 first down to #1, with Share / Save / Save all. Only rendered when at least 3 films are rated. Posters are generated up front with a progress bar, kept as PNG blobs, and shown as `<img>` so ten full-size canvases never sit in memory at once.
- **Detail** (`#detail/:id`): Full movie info, rendered in the flyer layout — see Key patterns. Watchlist movies show "Mark as Watched" + Pin/Unpin button instead of "Edit". Watchlist movies also show a **Resume point** control (`#detail-resume`) for saving the timecode where the user stopped watching — see Key patterns.
- **Preview** (`#preview/:tmdbId`): The same page for a film that is **not** saved yet, built straight from TMDB by `loadMoviePreview()`. Every "I picked a film out of search" path routes here via `openPreview(tmdbId, backHash)` — search results, filmography rows, autocomplete, a pasted TMDB URL, catalogue suggestions, blind spots, and Complete-the-Director cards. Actions are "Add to watchlist" and "Rate & save" (which sets `pendingFormTmdbId` and hands off to the add form). If the film turns out to already be in the DB, it redirects to its real `#detail/:id`.

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
  rating,      // 1–10 number (slider), or 0/undefined (absent on watchlist movies)
  notes,       // string (absent on watchlist movies)
  tags,        // string[] (user-defined freeform tags)
  dateAdded,   // ISO string, set on add
  watchlist,   // true if on watchlist; absent/false for catalogue movies
  pinned,      // true if pinned to top of watchlist; absent/false otherwise
  resumeSeconds, // watchlist only: total seconds where the user stopped watching (absent if unset)
}
```

## Key patterns

- **Filter toggle**: The catalogue filter dropdowns are hidden by default. `#filter-panel` gets class `open` when `#filter-toggle` is clicked. A `filter-badge` span shows the count of active filters. A `#filter-clear-all` button (`.filter-clear-btn`) appears next to the toggle whenever filters are active; it resets all selects, `pendingPersonFilter`, and `dirFilterSetByJump` in one tap.
- **Director/person filter jump**: Clicking a `.director-link` or `.cast-name-link` calls `filterByPerson(name)`. If the name is in `#filter-director`'s options it sets `dirSelect.value` and `dirFilterSetByJump = true`; otherwise it sets module-level `pendingPersonFilter`. When not already on `#catalogue`, it sets `personFilterJump = true` before changing the hash so `navigate()` knows not to clear the filter on that load. On any subsequent catalogue navigation (back button, nav tap), `navigate()` clears `pendingPersonFilter` and resets the director select if `dirFilterSetByJump` is set.
- **Clear buttons**: Search inputs are wrapped in `.input-wrap`. The `.input-clear` button is shown/hidden purely via CSS using `input:not(:placeholder-shown) + .input-clear`.
- **Watchlist badge**: `updateWatchlistBadge()` in `app.js` must be called after any operation that adds or removes watchlist movies (addToWatchlist, saveMovie, deleteMovie, importData, clear-all).
- **Taste DNA**: Derived in `stats.js` from top genre + ratio of unique directors to total movies. Needs ≥ 3 movies to appear.
- **Star burst**: `spawnStarBurst(starEl)` in `app.js` spawns fixed-position CSS-animated particles. Only fires when rating === 5.
- **Decade swim-lanes**: `UI.renderDecadeLanes(movies)` groups movies by decade and renders horizontal scroll sections with mosaic-sized `film-card` elements. `UI.renderFilmCard(movie)` renders a poster-only card with a hover overlay showing title, year, and interactive `.fcs` quick-rate stars.
- **Quick-rate**: Clicking a `.fcs` star on a film card in the catalogue calls `App.quickRateMovie(id, rating, starEl)` — updates the rating in IndexedDB and reloads the catalogue. The click event is intercepted before card navigation. Star burst fires on 5★ quick-rates.
- **Direct TMDB URL entry**: In Movie mode, if the search input contains a `themoviedb.org/movie/<id>` URL, `searchTMDB()` extracts the ID and calls `selectSearchResult()` directly, bypassing the text search. Useful for obscure films that don't surface in popularity-ranked results.
- **Director filmography**: `#search-results` click handler checks `data-person-id` before `data-tmdb-id`, so person rows route to `loadFilmography()` while film rows route to `selectSearchResult()`. Already-added films use `pointer-events: none` via `.search-result--added` so they never fire click events.
- **Tags**: Stored as `string[]` on each movie. The add/edit form has a chip UI (`#tag-chip-area`, `.tag-chip`) with a text input (`#form-tags-input`) — press Enter or comma to add. `renderTagChips(tags)` renders chips, `getFormTags()` reads them back. `#filter-tag` select in the catalogue filter panel lets users filter by a single tag. `populateTagFilter(movies)` populates it.
- **Watchlist pin**: `movie.pinned = true` pins a movie. `loadWatchlist()` renders a dedicated `#watchlist-pinned` section above the main grid — inline HTML, not a UI render function. Pinned section shows only the 📌 unpin button. Pin/Unpin is also available on the detail view for watchlist movies.
- **Resume point**: Watchlist movies can store `resumeSeconds` (total seconds where the user stopped watching). On the detail view, `UI.renderResumeSection(movie)` renders either a "Set resume point" button or a "Stopped at H:MM:SS" display with Edit/Clear; `UI.renderResumeEditor(movie)` renders the inline input. `app.js` swaps the `#detail-resume` container between display/editor states and persists via `MovieDB.updateMovie`. `UI.parseTimecode(str)` parses `"H:MM:SS"`, `"MM:SS"`, or a plain minute number into seconds; `UI.formatTimecode(secs)` is the inverse. A small resume badge also appears on pinned watchlist items.
- **Activity snapshot & blind spots**: `Stats.computeRecentActivity(movies)` and `Stats.renderRecentActivity(recent)` power the this-week/this-month cards in the stats view. `loadBlindSpots(movies)` in `app.js` fetches acclaimed films in the user's top genres via `TMDB.discoverByGenres` (cached 24 h in localStorage) and renders them as a horizontal scroll.
- **Flyer detail page**: `UI.renderMovieDetail(movie, ctx)` wraps everything in `.dt` and renders a film-society-flyer layout: a `.dt-stage` holding the backdrop (`.detail-backdrop-wrap`, chevron-clipped via `clip-path`) with a rotated ink `.dt-band` struck across it carrying the Anton title and year/runtime tags; then a `.dt-lede` (taped, tilted poster + director/genres/context chips) and `.dt-sec` blocks with red Anton section marks (`.dt-sec-head`). `ctx.preview = true` swaps the edit/delete actions for the add actions and drops the owned-only bits (rating, notes, date added, ticket stub). `.dt-stage` must keep `overflow: hidden` — the band is deliberately wider than the viewport. Section head styling is scoped `.dt .dt-sec-head` so it beats the base `.cast-label` rule.
- **Poster palette**: `samplePalette(img)` in `posters.js` buckets the still's pixels by hue weighted by saturation and takes the strongest bucket as the accent — an average would come out muddy. The ground is that hue at ~7% lightness; the numeral's brightness/wash adapt to the still's mean luminance so a dark film still prints a readable glyph. Needs `crossOrigin = 'anonymous'` on the image or `getImageData`/`toBlob` throw — TMDB serves `Access-Control-Allow-Origin: *`.
- **Font**: Bebas Neue is used for decade labels; **Anton** for the detail-page title and section marks. App title uses Montserrat 800. The Google Fonts `@import` **must stay on the first line of `styles.css`** — an `@import` after any other rule is ignored by browsers.

## Hosting

Deployed to GitHub Pages at `https://<user>.github.io/movieDatabase/`. The `manifest.json` `start_url` and `scope` are set to `/movieDatabase/` to match this path. The PWA icon uses `"purpose": "any"` (not maskable) to avoid Android adaptive icon cropping.
