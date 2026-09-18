# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

Hosting is GitHub Pages serving the **`main` branch at repo root** — there is no workflow file and no build step; pushing to `main` is the deploy. `tools/deploy.py` bumps the version, commits and pushes in one step.

How an update reaches a device: the push triggers GitHub's `pages-build-deployment` (~30-60s, plus CDN propagation). The service worker is network-first, so **one reload of the page picks up the new build** — verified by simulating a deploy against a live worker: one refresh swaps the build, the old cache is purged on activate, and offline still serves the new version. The catch is that an **installed PWA resumed from the home screen often does not reload at all**; it restores the previous page. Force a reload (pull-to-refresh, or swipe the app away and reopen) or wait for the “New version ready” toast, which fires when a new worker activates under the running page.

To deploy changes:

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

- **`js/ui.js` → `UI`**: Pure rendering — returns HTML strings from movie objects (`renderMovieCard`, `renderFilmCard`, `renderDecadeLanes`, `renderMovieDetail`, `renderSearchResult`, `renderDirectorGroup`). Also: `renderPersonResult(person)` renders a director search result row (uses `data-person-id`); `renderFilmographyResult(film, addedSet)` renders a filmography row with an "Added" label and `.search-result--added` class when the film's TMDB ID is in `addedSet`. `renderTop10Builder(entries)`, `renderTop10Picker(slot, movies, chosenIds)` and `renderTop10PickerRows(movies, chosenIds)` render the hand-ranked Top 10 sub-tab and its picker; `renderDuelIntro(count, est, tierLine, replaces)` and `renderDuelMatch(left, right, done, est, placed, total)` render Rank by Duel (the match screen reuses the `.tournament-*` classes). Also owns the custom `<select>` dropdown implementation (`initCustomSelects`) which wraps native selects with styled divs while keeping the native element in the DOM so existing `change` listeners work. **Dead renderers** — `renderWatchlistCard`, `renderMovieCard`, `renderDirectorGroup`, `renderRatingLanes`, `renderTitleLanes` and `renderDirectorLanes` are exported but have no callers anywhere in the repo (`renderMovieCard` is reached only from `renderDirectorGroup`, which is itself dead). The watchlist renders via `renderBlurayShelf` (library/default), `renderPosterGrid` (array) or `renderDecadeLanes` (decades). Never call or edit these six.

- **`js/stats.js` → `Stats`**: `compute(movies)` crunches an array of movies into stats including `tasteDNA`; `render(stats)` returns the HTML. Stat numbers use `data-count` attributes for animated counters.

- **`js/posters.js` → `Posters`**: Draws the **Top 10 poster set** on canvas (1080×1350). `generate(movie, rank)` returns a finished canvas — giant rank numeral filled with the film's own still (mask canvas + `source-in`), photo band across the bottom, title in a colour sampled from the image, grain and vignette. `pickTop(movies)` picks the ten the deck prints and reverses them into countdown order — it uses the hand-ranked `localStorage.manualTop10` when that list resolves to ≥ 3 films (ids of deleted films are dropped), and only falls back to ranking by score when it doesn't; `manualTop10(movies)` is that resolution on its own, exposed so `loadStats()` can label the launch banner with the list it will actually print; `openTop10(movies)` builds the whole set and opens the swipeable deck modal. It also draws the **hand-ranked Top 10 board**: `generateBoard(entries)` returns one 1080×1920 print carrying the whole list — hero still from #1 (its palette colours the page), "MY TOP N" masthead, then a numbered row per film with a poster chip, title and credits; `openBoard(entries)` prints it into the same `.pd-*` modal with Share / Save. Standalone — it only touches `UI`/`TMDB`/`MovieDB` behind `typeof` guards.

- **`js/app.js` → `App`**: The main controller. Owns hash-based routing (`#catalogue`, `#add`, `#watchlist`, `#chart`, `#stats`, `#inventory`, `#detail/:id`, `#preview/:tmdbId`), all event listeners, filter/sort logic, and wires together `MovieDB`, `TMDB`, `UI`, and `Stats`. Also contains `animateCounters`, `updateWatchlistBadge`, and `spawnStarBurst`. Module-level `searchMode` (`'movie'|'director'|'actor'`) and `selectedDirectorName` track Add-view state; `searchDirector()` and `loadFilmography(personId, name)` handle the director/actor search flow. `setupPosterDrag(movie)` wires the drag-to-reveal people overlay and is called by both detail loaders.

- **`sw.js`**: Service worker. Precaches local assets at install — **one `cache.add()` per asset, never `cache.addAll()`**: addAll is atomic, so a single bad path in `ASSETS` would fail the install, the worker would never activate or claim clients, and offline support would vanish with nothing logged. Network-first for same-origin requests (falls back to cache offline, matching with `ignoreSearch` because the page requests `?v=`-stamped URLs). TMDB/Wikipedia/GitHub requests bypass the cache entirely. `registerServiceWorker()` in `app.js` logs registration failures and toasts “New version ready” when a new build activates under a running page.

## Views & features

- **Catalogue** (`#catalogue`): Decade swim-lanes view. Movies are grouped by release decade (newest first) in horizontal scroll rows. Within each lane, cards are sorted by rating descending. Card size reflects rating: 5★ = `card-xl` (255×170px), 4★ = `card-lg` (215×143px), others = `card-sm` (180×120px). 5-star cards get a gold glow, 4-star a silver glow. Decade labels use Bebas Neue font. Filter panel (genre, director, rating, sort) is hidden behind a toggle button. A `#scale-toggle` button in the top bar flips the rating scale between /10 and Letterboxd-style half stars.
- **Add** (`#add`): A **Movie / Director** pill toggle (`#search-mode-toggle`, `.smt-btn`) switches between two search modes.
  - *Movie mode*: TMDB text search, or paste a `themoviedb.org/movie/<id>` URL to fetch a film directly by ID. Each result has a "+ Watchlist" quick-add button; tapping the row itself opens the **Preview** page. Returning from a preview does **not** reset the Add view — `navigate()` skips `resetAddView()` when the previous hash was a `#preview/`, so the search results survive both the Back button and hardware back.
  - *Director mode*: Search for a director by name → select a person → see their full filmography (sorted newest-first, deduplicated). Films already in the user's DB are greyed out (`.search-result--added`) with an "Added" label instead of the watchlist button. A "← Name" back button returns to the person list. Autocomplete is suppressed in director mode.
- **Watchlist** (`#watchlist`): Movies saved with `watchlist: true`. Each card has a "✓ Watched" button that pre-fills the add form so the user can rate and move it to the catalogue. Nav tab shows a live count badge. Pinned movies (`pinned: true`) appear in a dedicated `#watchlist-pinned` section rendered inline by `loadWatchlist()` — not via any UI.render function. The pinned section shows only a 📌 unpin button; no "Watched" button (user taps the item to open detail and mark as watched from there).
- **Chart** (`#chart`): Two sub-tabs (`#chart-tabs`, `.chart-tab`) — **Ranked** (`#chart-list`: the score-ordered top 30, Movie Tournament, King of the Hill, external top-list links) and **My Top 10** (`#chart-top10`: the hand-ranked list). The tab choice is remembered in `localStorage.chartTab`. Flipping tabs never re-renders the ranked pane while a tournament or KOTH run is in progress. In **star mode** the first tab is relabelled “Five Star” and `loadRankedChart()` renders `UI.renderFiveStarClub()` instead of `UI.renderChart()` — see Key patterns.
- **My Top 10** (Chart sub-tab): A hand-ordered list of up to 10 films, because two films rated 9 don't settle which is better. Stored in `localStorage.manualTop10` as an array of movie ids, #1 first, and self-heals when a film is deleted. Ten slots; tapping an empty one opens a searchable catalogue picker (`.t10-picker`), filled rows have ▲ ▼ ✕ and open the detail page on tap. "Fill from ratings" seeds it with the top 10 by score as a starting point; "⚔ Rank by duel" builds it by head-to-head (see Key patterns); "Make the poster" calls `Posters.openBoard()`.
- **Stats** (`#stats`): Animated counters, Taste DNA card (top genre + director loyalty ratio), bar charts, top rated list, activity snapshot (this week/month), blind spot recommendations. Includes cloud sync, backup/restore, and danger zone. Stats exclude watchlist movies.
- **Top 10 posters**: A `.yir-launch-btn` (`#poster-launch`) in the Stats view opens `Posters.openTop10()` — a full-screen deck (`#poster-deck`, `.pd-*`) of generated posters, #N first down to #1, with Share / Save / Save all. It prints the hand-ranked **My Top 10** when the user has built one (≥ 3 films) and the score ranking otherwise — a wall of 10s, or of ★★★★★, leaves the score order meaningless. The banner's subtitle names whichever list it will print. Rendered when at least 3 films are rated or the hand-ranked list has at least 3. Posters are generated up front with a progress bar, kept as PNG blobs, and shown as `<img>` so ten full-size canvases never sit in memory at once.
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
- **Decade swim-lanes**: `UI.renderDecadeLanes(movies)` groups movies by decade and renders horizontal scroll sections with mosaic-sized `film-card` elements. `UI.renderFilmCard(movie)` renders a poster-only card with a hover overlay showing title, year and the rating badge. (A `.fcs` quick-rate star UI existed once; only a stray haptic selector in `app.js` still references it.)
- **Direct TMDB URL entry**: In Movie mode, if the search input contains a `themoviedb.org/movie/<id>` URL, `searchTMDB()` extracts the ID and calls `selectSearchResult()` directly, bypassing the text search. Useful for obscure films that don't surface in popularity-ranked results.
- **Director filmography**: `#search-results` click handler checks `data-person-id` before `data-tmdb-id`, so person rows route to `loadFilmography()` while film rows route to `selectSearchResult()`. Already-added films use `pointer-events: none` via `.search-result--added` so they never fire click events.
- **Tags**: Stored as `string[]` on each movie. The add/edit form has a chip UI (`#tag-chip-area`, `.tag-chip`) with a text input (`#form-tags-input`) — press Enter or comma to add. `renderTagChips(tags)` renders chips, `getFormTags()` reads them back. `#filter-tag` select in the catalogue filter panel lets users filter by a single tag. `populateTagFilter(movies)` populates it.
- **Watchlist pin**: `movie.pinned = true` pins a movie. `loadWatchlist()` renders a dedicated `#watchlist-pinned` section above the main grid — inline HTML, not a UI render function. Pinned section shows only the 📌 unpin button. Pin/Unpin is also available on the detail view for watchlist movies.
- **Resume point**: Watchlist movies can store `resumeSeconds` (total seconds where the user stopped watching). On the detail view, `UI.renderResumeSection(movie)` renders either a "Set resume point" button or a "Stopped at H:MM:SS" display with Edit/Clear; `UI.renderResumeEditor(movie)` renders the inline input. `app.js` swaps the `#detail-resume` container between display/editor states and persists via `MovieDB.updateMovie`. `UI.parseTimecode(str)` parses `"H:MM:SS"`, `"MM:SS"`, or a plain minute number into seconds; `UI.formatTimecode(secs)` is the inverse. A small resume badge also appears on pinned watchlist items.
- **Activity snapshot & blind spots**: `Stats.computeRecentActivity(movies)` and `Stats.renderRecentActivity(recent)` power the this-week/this-month cards in the stats view. `loadBlindSpots(movies)` in `app.js` fetches acclaimed films in the user's top genres via `TMDB.discoverByGenres` (cached 24 h in localStorage) and renders them as a horizontal scroll.
- **Flyer detail page**: `UI.renderMovieDetail(movie, ctx)` wraps everything in `.dt` and renders a film-society-flyer layout: a `.dt-stage` holding the backdrop (`.detail-backdrop-wrap`, chevron-clipped via `clip-path`) with a rotated ink `.dt-band` struck across it carrying the Anton title and year/runtime tags; then a `.dt-lede` (taped, tilted poster + director/genres/context chips) and `.dt-sec` blocks with red Anton section marks (`.dt-sec-head`). `ctx.preview = true` swaps the edit/delete actions for the add actions and drops the owned-only bits (rating, notes, date added, ticket stub). `.dt-stage` must keep `overflow: hidden` — the band is deliberately wider than the viewport. Section head styling is scoped `.dt .dt-sec-head` so it beats the base `.cast-label` rule.
- **Top 10 board layout**: `generateBoard` sizes itself to the list — row height is capped at 150px and whatever vertical slack a short list leaves is handed to the hero still (`heroH` grows up to +340px), so a top 4 and a top 10 are equally balanced. Row titles shrink to a floor (~64% of the max) and then wrap to two lines rather than being set microscopically; `wrapSpaced`/`clipToWidth` handle the overflow.
- **Poster palette**: `samplePalette(img)` in `posters.js` buckets the still's pixels by hue weighted by saturation and takes the strongest bucket as the accent — an average would come out muddy. The ground is that hue at ~7% lightness; the numeral's brightness/wash adapt to the still's mean luminance so a dark film still prints a readable glyph. Needs `crossOrigin = 'anonymous'` on the image or `getImageData`/`toBlob` throw — TMDB serves `Access-Control-Allow-Origin: *`.
- **Rank by duel**: `#t10-duel` in the My Top 10 tab builds the list by asking. `startDuel()` takes a pool from `duelPool(movies)` — every film whose rating rounds to 10, stepping the threshold down to 6 until at least 4 films qualify — shuffles it, and shows `UI.renderDuelIntro()` with `estimateDuels(n)` so the user sees the cost before starting. The run itself is a **binary insertion sort with the user as the comparator**: module-level `duel` holds `sorted` (the running order), `cur` (the contender) and the `lo`/`hi` window being halved; `advanceDuel()` pulls contenders and renders, `pickDuel(id)` narrows the window on each answer, `placeDuelCurrent()` splices the contender in and **trims `sorted` to ten** — anything that loses to the current #10 drops out and is never asked about again, which is what caps any film at four questions however big the pool is (verified by simulation: exact top 10 at every pool size, never over the estimate). `finishDuel(early)` writes the result through `saveTop10()`; “Finish now” keeps the correct top 10 of the films seen so far. A duel in progress survives chart sub-tab flips (`setChartTab` only calls `loadTop10()` when `!duel`) and is cleared on leaving the chart view. Card selectors are scoped to `#chart-top10` because a tournament left running in the ranked tab has `.tournament-card` elements earlier in the document.
- **Five Star Club**: On the 5-star scale the top of the range is a plateau — every rating that rounds to 10 prints the same ★★★★★ — so a numbered chart would be ordering those films by nothing. When `UI.isFiveStar()`, the chart's first tab renders `UI.renderFiveStarClub(movies)`: an unranked hall of fame (`.fs-head`, `.fs-list`, `.fs-card`) of every film with `Math.round(rating) === 10`, newest `dateAdded` first, each row a gold-railed plaque with a poster chip and the film's own backdrop bled in behind the type. The tournament / KOTH / top-list buttons below are unchanged — they're what settles an order. `.fs-card[data-id]` routes to the detail page via the same `#chart-list` click handler as `.top-item`. The tab label is swapped in `syncRatingScaleUI()`.
- **Rating scale toggle**: Ratings are always stored 1-10; `#scale-toggle` in the catalogue top bar only changes how they print. `UI.setRatingScale('five'|'ten')` persists the choice in `localStorage.ratingScale` and puts `scale-five` on `<body>` (CSS tightens the type wherever a star string is wider than a number). `UI.formatRating(r)` is the choke point — it returns `'8'` or `'★★★★'` (`formatStars` maps 1-10 onto the ten half-star steps); `UI.ratingText(r)` adds the `/10` suffix for prose and canvas; `UI.formatScore(r)` is the always-numeric one for outside scores (TMDb/IMDb badges must use it). `syncRatingScaleUI()` in `app.js` repaints what carries the scale in its own markup: the button, the `#filter-rating` option labels (rebuilt via `innerHTML` so the custom select's MutationObserver relabels too) and the `.rating-slider` step (1 in star mode, so the slider lands on whole half-stars).
- **Fonts**: two faces, both **self-hosted** in `fonts/` as subset woff2 and declared via `@font-face` at the top of `styles.css`. **Staatliches** (`--font-display`) for every display string — app title, film titles, decade labels, section marks, stat numerals. **Montserrat** (`--font-text`, variable 100–900) for everything else. There is no Google Fonts request: the files are precached by the service worker so typography survives offline, and `index.html` preloads both. Subset to Latin + Latin Extended-A so accented titles render. Do not add an `@import` or a Google Fonts `<link>`.

## Design system

`styles.css` ends with a design-system block that the rest of the file defers to. Two rules decide the look:

1. **Controls are pills, surfaces are rounded rectangles.** Buttons, toggles, chips and inputs take `--r-pill`; cards and panels take `--r-lg`.
2. **Colour is information, and there is one accent.** Amber (`--accent` #fbb809) carries both the actions and the headings; **form** tells them apart — a *filled* amber pill is an action, amber *type* is a heading. There is no second accent: `--gold` is an alias of `--accent`, and honours are signalled by weight and by the bone card stock instead of by another hue.

   Two rules, both measured, both hard:
   - **Never white on amber** (1.76:1). Type on an amber fill uses `--ink` #0a0a12 (11.2:1).
   - **Never amber on bone** (1.57:1). Amber that has to sit on `--bone` #eff2fb uses `--amber-deep` #8f5e00 (5.0:1).

   The palette is sampled from the reference the user supplied: ground #050611, amber #fbb809, pill fill #fab823, card stock #eff2fb.

- **Tokens**: type (`--fs-*`, two font tokens), shape (`--r-xs/sm/md/lg/pill`), space (`--s-1`…`--s-6`), elevation (`--e-1/2/3`), surfaces (`--surface-1/2/3`) and colour. Use a token, never a raw value — the file had 30 border-radii, 56 font sizes and 77 shadows before this was imposed.
- **Palette is swappable from `:root` alone.** ~200 rules use `rgba(...)` with alpha, so the hues are exposed as channel tokens (`--accent-rgb`, `--gold-rgb`, `--bg-rgb`) and those rules read the channels. Changing the scheme means editing the palette block, not hunting hex codes.
- **Two violets on purpose**: `--accent` (#c084fc) for text, borders and links; `--accent-fill` (#7e22ce) for button backgrounds. One purple cannot clear AA both as text on charcoal and as a fill under white labels.
- **Buttons resolve to five recipes** (primary, secondary, danger, icon, quiet) plus one segmented-control recipe. ~67 legacy class names map onto them; do not invent a sixth look.
- **Rating ramp** (`UI.ratingColor`) runs yellow → neutral lavender → dusty rose, not green → red: a green/red ramp was a third colour family. `UI.ratingInk()` picks dark or light ink per band; every band clears AA.

## Film decor

Three motifs, each on the one surface where it *means* something — never sprinkled. Adding a fourth needs the same justification.

- **Perforations** (`.decade-header::after`) — the catalogue is a strip of decades, so each decade header sits on sprocket holes. The holes are punched with `mask-image`, not painted over with the background colour: painting renders one solid bar.
- **The ticket** (`.tonight-screening`) — a dark card carrying the film's **poster bleeding off the right edge** (`.ts-poster`, masked so it fades into the card) with the text column padded clear of it, and a dashed tear line carried by `.ts-actions`' `border-top`. It was briefly printed on bone card stock: that was wrong, because it made the only light surface in the entire app, and with no artwork it was an empty slab sitting above a Just Added card that leads with its backdrop. The tear line lives on the actions row on purpose — an absolutely-positioned one crossed the showtime text, and stub notches were clipped by the card's own `overflow: hidden`. The card sizes to its content (`height: auto`); it was a fixed 200px from before it had a tear line, actions and a poster gutter, which clipped the title.
- **Letterboxing** (`.dt-stage::before/::after`) — the detail hero is a frame, so it gets black bars. Registration corners were tried and cut: they fight the chevron `clip-path` on `.detail-backdrop-wrap` and only one corner ever shows.

`GENRE_PALETTE` in `ui.js` is **one warm ramp** (ember → brass → bone), not eighteen hues. It was a crimson/teal/cobalt/violet rainbow, which is three colour families fighting the theme; genres still read as distinct without leaving black/amber/bone.

## Invariants worth not breaking

- **URL sanitising**: movie records can arrive from an imported backup or a pulled gist, so `poster`, `backdrop` and `cast[].profileUrl` are untrusted. Anything interpolated into `src=""` goes through `UI.imgSrc()`; anything going into a CSS `url()` goes through `UI.cssUrl()`. `MovieDB.importData` also scrubs those three fields at the boundary (it never drops any other field). Adding a new `<img src="${...}">` without `imgSrc()` reopens an XSS path — and `localStorage` holds a GitHub PAT.
- **Rating badge ink**: `renderRatingBadge`/`renderFilmCard` set `background` *and* `color` inline, the colour coming from `UI.ratingInk()` — dark ink on the four light bands, white on the low-end red. The art-deco `.rating-badge` rule near the end of `styles.css` sets gold text that is unreadable on those backgrounds; `.rating-badge--tone` exists to suppress its text-shadow and frame. Do not remove the inline `color`.
- **Custom select is the control**: `.filter-select` is `display: none`, so `.custom-select-trigger` carries `role="combobox"`, `tabindex="0"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`, and handles Enter/Space/arrows/Home/End/Escape/Tab itself. The options are `role="option"`. If you touch `initCustomSelects`, keep all of that — without it every filter in the app becomes keyboard- and screen-reader-inaccessible.
- **Reduced motion**: the blanket rule at the end of `styles.css` uses `animation-duration: 0.01ms`, never `animation: none`. `app.js` removes star-burst particles and the people overlay on `animationend`/`transitionend`; `none` would never fire those and the nodes would leak.
- **Scroll memory**: `navigate()` records `window.scrollY` against the outgoing hash in `viewScroll` and `restoreScroll(hash)` reapplies it after the view's async load resolves. The `load*` functions must keep returning their promise.
- **Line endings**: `.gitattributes` sets `* text=auto`; the repo stores LF. Run `tools/deploy.py` with a Python whose text-mode newline matches, or just let git normalise — do not commit a CRLF flip.

## Hosting

Deployed to GitHub Pages at `https://<user>.github.io/movieDatabase/`. The `manifest.json` `start_url` and `scope` are set to `/movieDatabase/` to match this path. The PWA icon uses `"purpose": "any"` (not maskable) to avoid Android adaptive icon cropping.
