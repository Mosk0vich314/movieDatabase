const App = (() => {
  let currentView = 'catalogue';
  let selectedRating = 0;
  let editingMovie = null;
  let acDebounce = null;
  let acResults = [];
  let acFocusIdx = -1;
  const _storedView = localStorage.getItem('viewMode');
  let viewMode = (['array', 'decades', 'library'].includes(_storedView) ? _storedView : null) || 'decades';
  const _storedWLView = localStorage.getItem('watchlistViewMode');
  let watchlistViewMode = (['array', 'decades', 'library'].includes(_storedWLView) ? _storedWLView : null) || 'library';
  let searchMode = 'movie';
  let selectedDirectorName = '';
  let pendingPersonSearch = null;
  let recentPickIds = [];
  let currentFilmography = null;
  // Pulls suggestions from local storage if they exist
  let pendingSuggestions = JSON.parse(localStorage.getItem('savedSuggestions') || 'null');

  // Hidden Gems lens — high personal ratings, low TMDB vote counts
  let gemsLens = localStorage.getItem('gemsLens') === '1';
  const GEM_RATING_MIN = 7;
  const GEM_VOTE_MAX = 5000;
  function isGem(m) {
    if ((m.rating || 0) < GEM_RATING_MIN) return false;
    const vc = m.voteCount || 0;
    return vc > 0 && vc <= GEM_VOTE_MAX;
  }

  // Haptic helper — silent no-op on unsupported devices
  function haptic(pattern = 8) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) {}
  }

  // ---- Tonight's Screening: one daily-pinned watchlist pick ----
  const TONIGHT_KEY = 'tonightScreening';

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  }

  async function pickTonightsScreening(force = false) {
    const movies = (await MovieDB.getAllMovies()).filter(m => m.watchlist);
    if (movies.length === 0) {
      localStorage.removeItem(TONIGHT_KEY);
      return null;
    }
    const stored = JSON.parse(localStorage.getItem(TONIGHT_KEY) || 'null');
    const today = todayKey();
    if (!force && stored && stored.date === today) {
      const stillExists = movies.find(m => m.id === stored.id);
      if (stillExists) return stillExists;
    }
    const candidate = movies[Math.floor(Math.random() * movies.length)];
    localStorage.setItem(TONIGHT_KEY, JSON.stringify({ date: today, id: candidate.id }));
    return candidate;
  }

  async function renderTonightsScreening() {
    const wrap = document.getElementById('tonight-wrap');
    if (!wrap) return;
    const movie = await pickTonightsScreening(false);
    if (!movie) { wrap.innerHTML = ''; return; }
    const backdrop = movie.backdrop || movie.poster || '';
    const dirLine = (movie.directors || []).length > 0
      ? `<div class="ts-director">${UI.escapeHtml(movie.directors[0])}</div>` : '';
    const yearLine = movie.year ? `<span class="ts-year">${movie.year}</span>` : '';
    const showtime = '20:00'; // Doors open at 8pm
    wrap.innerHTML = `
      <div class="tonight-screening" data-id="${movie.id}">
        ${backdrop ? `<img src="${backdrop}" class="ts-backdrop" alt="">` : ''}
        <div class="ts-overlay"></div>
        <div class="ts-content">
          <div class="ts-label">
            <span class="ts-bulb"></span> TONIGHT'S SCREENING <span class="ts-bulb"></span>
          </div>
          <div class="ts-title">${UI.escapeHtml(movie.title)} ${yearLine}</div>
          ${dirLine}
          <div class="ts-meta">
            <span class="ts-showtime">Doors open at ${showtime}</span>
            <span class="ts-countdown" id="ts-countdown"></span>
          </div>
          <div class="ts-actions">
            <button class="btn btn-primary ts-watched" type="button">&#10003; I watched it</button>
            <button class="btn btn-secondary ts-reroll" type="button" title="New pick">&#8634;</button>
          </div>
        </div>
      </div>`;
    const card = wrap.querySelector('.tonight-screening');
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      window.location.hash = `#detail/${movie.id}`;
    });
    wrap.querySelector('.ts-watched').addEventListener('click', async (e) => {
      e.stopPropagation();
      haptic([10, 30, 10]);
      await markAsWatched(movie.id);
      localStorage.removeItem(TONIGHT_KEY);
    });
    wrap.querySelector('.ts-reroll').addEventListener('click', async (e) => {
      e.stopPropagation();
      haptic(8);
      await pickTonightsScreening(true);
      renderTonightsScreening();
    });
    startCountdownTicker();
  }

  let countdownIv = null;
  function startCountdownTicker() {
    if (countdownIv) clearInterval(countdownIv);
    const tick = () => {
      const el = document.getElementById('ts-countdown');
      if (!el) { clearInterval(countdownIv); countdownIv = null; return; }
      const now = new Date();
      const target = new Date();
      target.setHours(20, 0, 0, 0);
      let diff = target - now;
      if (diff <= 0) { el.textContent = '· Showing now'; return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = `· in ${h ? h + 'h ' : ''}${m}m ${h ? '' : s + 's'}`.trim();
    };
    tick();
    countdownIv = setInterval(tick, 1000);
  }

  function migrateRatings() {
    if (localStorage.getItem('ratingMigrated10')) return Promise.resolve();
    return MovieDB.getAllMovies().then(movies => {
      const toUpdate = movies.filter(m => m.rating >= 1 && m.rating <= 5);
      return Promise.all(toUpdate.map(m => {
        m.rating = m.rating * 2;
        return MovieDB.updateMovie(m);
      }));
    }).then(() => { localStorage.setItem('ratingMigrated10', '1'); });
  }

  function init() {
    MovieDB.open().then(() => migrateRatings()).then(() => {
      setupRouting();
      setupEventListeners();
      setupImageLoader();
      setupHaptics();
      UI.initCustomSelects();
      navigate(window.location.hash || '#catalogue');
      updateWatchlistBadge();
      registerServiceWorker();
    });
  }

  // Delegated, lightweight haptic feedback on key UI surfaces
  function setupHaptics() {
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('.nav-link')) return haptic(6);
      if (t.closest('.btn-primary')) return haptic(10);
      if (t.closest('.btn, .filter-toggle-btn, .view-toggle-btn, .smt-btn')) return haptic(5);
      if (t.closest('.movie-card, .film-card, .now-playing, .tonight-screening')) return haptic(4);
      if (t.closest('.fcs')) return haptic(8);
    }, true);
  }

  // Marks <img> elements with .loaded once decoded so CSS can fade them in
  // over the skeleton shimmer on their parent.
  function setupImageLoader() {
    const attach = (img) => {
      if (img.classList.contains('loaded')) return;
      if (img.complete && img.naturalHeight > 0) {
        img.classList.add('loaded');
        return;
      }
      img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
      img.addEventListener('error', () => img.classList.add('loaded'), { once: true });
    };
    document.querySelectorAll('img').forEach(attach);
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IMG') attach(n);
          else if (n.querySelectorAll) n.querySelectorAll('img').forEach(attach);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // --- Routing ---

  function setupRouting() {
    window.addEventListener('hashchange', () => {
      navigate(window.location.hash);
    });
  }

  function navigate(hash) {
    const viewMap = {
      '#catalogue': 'catalogue',
      '#add': 'add',
      '#watchlist': 'watchlist',
      '#chart': 'chart',
      '#inventory': 'inventory',
      '#stats': 'stats',
    };

    if (hash.startsWith('#detail/')) {
      const id = parseInt(hash.split('/')[1], 10);
      showView('detail');
      loadMovieDetail(id);
      return;
    }

    const view = viewMap[hash] || 'catalogue';
    showView(view);

    if (view === 'catalogue') loadCatalogue();
    if (view === 'watchlist') loadWatchlist();
    if (view === 'chart') loadChart();
    if (view !== 'chart') tournament = null;
    if (view === 'stats') loadStats();
    if (view === 'inventory') loadInventory();
    if (view === 'add') {
      resetAddView();
      if (pendingPersonSearch) {
        const { mode, query } = pendingPersonSearch;
        pendingPersonSearch = null;
        searchMode = mode;
        document.querySelectorAll('.smt-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        const inp = document.getElementById('tmdb-search');
        inp.value = query;
        inp.placeholder = mode === 'director' ? 'Search for a director...' : 'Search for an actor...';
        if (mode === 'director') searchDirector();
        else if (mode === 'actor') searchActor();
      }
    }
  }

  function showView(name) {
    currentView = name;
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const el = document.getElementById(`view-${name}`);
    if (el) el.style.display = 'block';

    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.view === name);
    });
  }

  // --- Catalogue ---

  function lazyLoadCasePosters(container) {
    const cases = container.querySelectorAll('.bluray-case[data-poster]');
    if (!cases.length) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          el.style.setProperty('--poster', `url('${el.dataset.poster}')`);
          observer.unobserve(el);
        }
      });
    }, { rootMargin: '200px' });
    cases.forEach(el => observer.observe(el));
  }

  function celebrateMilestone(count) {
    UI.showToast(`\uD83C\uDFAC Milestone — ${count} films catalogued!`);
    const title = document.querySelector('.app-title') || document.body;
    [0, 130, 260, 390].forEach(delay => setTimeout(() => spawnStarBurst(title), delay));
  }

  async function loadCatalogue() {
    const pending = localStorage.getItem('pendingMilestone');
    if (pending) {
      localStorage.removeItem('pendingMilestone');
      setTimeout(() => celebrateMilestone(parseInt(pending)), 500);
    }

    const movies = (await MovieDB.getAllMovies()).filter(m => !m.watchlist);
    const grid = document.getElementById('movie-grid');
    const empty = document.getElementById('empty-catalogue');

    populateGenreFilter(movies);
    populateDirectorFilter(movies);

    document.getElementById('view-array-btn').classList.toggle('active', viewMode === 'array');
    document.getElementById('view-decades-btn').classList.toggle('active', viewMode === 'decades');
    document.getElementById('view-library-btn').classList.toggle('active', viewMode === 'library');

    renderTonightsScreening();

    // Now Playing banner — most recently added/watched film
    const npWrap = document.getElementById('now-playing-wrap');
    if (movies.length > 0) {
      const newest = [...movies].sort((a, b) => {
        const da = a.dateAdded || '';
        const db = b.dateAdded || '';
        return db > da ? 1 : db < da ? -1 : (b.id || 0) - (a.id || 0);
      })[0];
      npWrap.innerHTML = UI.renderNowPlaying(newest);
      npWrap.querySelector('.now-playing').addEventListener('click', () => {
        window.location.hash = `#detail/${newest.id}`;
      });
    } else {
      npWrap.innerHTML = '';
    }

    // Similar suggestions panel
    if (pendingSuggestions) {
      renderSuggestionsInPlace();
    } else {
      const sugWrap = document.getElementById('suggestions-wrap');
      if (sugWrap) sugWrap.innerHTML = '';
    }

    const filtered = applyFilters(movies);
    const sortVal = document.getElementById('sort-by').value;

    if (filtered.length === 0) {
      grid.innerHTML = '';
      grid.classList.add('movie-grid');
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    grid.classList.remove('movie-grid');

    if (viewMode === 'array') {
      grid.innerHTML = UI.renderPosterGrid(sortForGrid(filtered, sortVal));
    } else if (viewMode === 'library') {
      grid.innerHTML = UI.renderBlurayShelf(filtered);
      lazyLoadCasePosters(grid);
      grid.querySelectorAll('.bluray-case').forEach(caseEl => {
        caseEl.addEventListener('click', () => {
          const id = parseInt(caseEl.dataset.id);
          const movie = filtered.find(m => m.id === id);
          if (movie) extractBluray(caseEl, movie);
        });
      });
    } else {
      // decades (default)
      grid.innerHTML = UI.renderDecadeLanes(filtered, 'desc');
    }

    // Gems lens: highlight matching cards, dim others — no filtering
    const catalogueView = document.getElementById('view-catalogue');
    catalogueView.classList.toggle('gems-lens', gemsLens);
    if (gemsLens) {
      const gemIds = new Set(movies.filter(isGem).map(m => String(m.id)));
      grid.querySelectorAll('[data-id]').forEach(el => {
        el.classList.toggle('gem', gemIds.has(el.dataset.id));
      });
    }
  }

  function sortForGrid(movies, sortVal) {
    const copy = [...movies];
    switch (sortVal) {
      case 'title-asc':    return copy.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      case 'title-desc':   return copy.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
      case 'rating-desc':  return copy.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      case 'rating-asc':   return copy.sort((a, b) => (a.rating || 0) - (b.rating || 0));
      case 'year-desc':    return copy.sort((a, b) => (b.year || 0) - (a.year || 0));
      case 'year-asc':     return copy.sort((a, b) => (a.year || 0) - (b.year || 0));
      default:             return copy.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
    }
  }

  function setViewMode(mode) {
    viewMode = mode;
    localStorage.setItem('viewMode', mode);
    loadCatalogue();
  }


  function populateGenreFilter(movies) {
    const genres = new Set();
    movies.forEach(m => (m.genres || []).forEach(g => genres.add(g)));
    const select = document.getElementById('filter-genre');
    const current = select.value;
    select.innerHTML = '<option value="">All Genres</option>';
    [...genres].sort().forEach(g => {
      select.innerHTML += `<option value="${g}"${g === current ? ' selected' : ''}>${g}</option>`;
    });
  }

  function populateDirectorFilter(movies) {
    const directors = new Set();
    movies.forEach(m => (m.directors || []).forEach(d => directors.add(d)));
    const select = document.getElementById('filter-director');
    const current = select.value;
    select.innerHTML = '<option value="">All Directors</option>';
    [...directors].sort().forEach(d => {
      select.innerHTML += `<option value="${d}"${d === current ? ' selected' : ''}>${d}</option>`;
    });
  }

  function applyFilters(movies) {
    const genre = document.getElementById('filter-genre').value;
    const director = document.getElementById('filter-director').value;
    const minRating = parseInt(document.getElementById('filter-rating').value) || 0;
    const search = document.getElementById('catalogue-search').value.toLowerCase().trim();

    return movies.filter(m => {
      if (genre && !(m.genres || []).includes(genre)) return false;
      if (director && !(m.directors || []).includes(director)) return false;
      if (minRating && (m.rating || 0) < minRating) return false;
      if (search && !m.title.toLowerCase().includes(search)) return false;
      return true;
    });
  }

  // --- Watchlist ---

  async function extractBluray(caseEl, movie) {
    const rect = caseEl.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // Measure at scrollY=0 so dest is always a fixed viewport-top-anchored position.
    // All of this is synchronous — no paint happens until the first await.
    const savedScrollY = window.scrollY;
    if (savedScrollY > 0) window.scrollTo(0, 0);

    const detailSection = document.getElementById('view-detail');
    const detailContent = document.getElementById('movie-detail');
    detailContent.innerHTML = UI.renderMovieDetail(movie);

    const allViews = Array.from(document.querySelectorAll('.view'));
    const prevDisplays = allViews.map(v => v.style.display);
    allViews.forEach(v => { v.style.display = 'none'; });
    detailSection.style.visibility = 'hidden';
    detailSection.style.pointerEvents = 'none';
    detailSection.style.display = 'block';

    const detailImg = detailSection.querySelector('img.detail-poster');
    let dest;
    if (detailImg) {
      dest = detailImg.getBoundingClientRect();
    } else {
      const fw = Math.min(150, Math.floor(vw * 0.4)), fh = Math.round(fw * 1.48);
      dest = { left: (vw - fw) / 2, top: (vh - fh) / 2, width: fw, height: fh };
    }

    allViews.forEach((v, i) => { v.style.display = prevDisplays[i]; });
    detailSection.style.visibility = '';
    detailSection.style.pointerEvents = '';

    // Restore scroll so the user sees the shelf where they were
    if (savedScrollY > 0) window.scrollTo(0, savedScrollY);

    const tx = dest.left - rect.left;
    const ty = dest.top  - rect.top;
    const sx = dest.width  / rect.width;
    const sy = dest.height / rect.height;

    // Spine clone floats over the shelf
    const sc = caseEl.style.getPropertyValue('--sc') || '#0d1520';
    const ac = caseEl.style.getPropertyValue('--ac') || '#304468';
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;left:${rect.left}px;top:${rect.top}px;
      width:${rect.width}px;height:${rect.height}px;
      background:${sc};border-radius:2px 3px 3px 2px;
      box-shadow:inset -3px 0 8px rgba(0,0,0,0.45),inset 1px 0 4px rgba(255,255,255,0.07),2px 0 6px rgba(0,0,0,0.4);
      transform-origin:top left;transform:translate(0,0) scale(1,1) rotateY(0deg);
      z-index:9001;pointer-events:none;overflow:hidden;
    `;
    el.innerHTML = `<div style="position:absolute;top:0;left:0;right:0;height:3px;background:${ac};border-radius:2px 3px 0 0;"></div>`;
    document.body.appendChild(el);
    caseEl.style.opacity = '0';

    // Phase 1: Lift (150ms) — still at savedScrollY
    el.style.transition = 'transform 0.15s ease-out';
    el.style.transform = `translate(0,-44px) scale(1,1) rotateY(0deg)`;
    await wait(160);

    // Scroll to top now — book is "in the air", page snaps to top so dest is valid
    if (savedScrollY > 0) window.scrollTo(0, 0);

    // Phase 2: Glide to dest (measured at scroll=0) + expand (380ms)
    el.style.transition = 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';
    el.style.transform = `translate(${tx}px,${ty + 44}px) scale(${sx},${sy}) rotateY(0deg)`;
    await wait(390);

    // Phase 3: Flip spine away (110ms)
    el.style.transition = 'transform 0.11s ease-in, opacity 0.11s ease-in';
    el.style.transform = `translate(${tx}px,${ty + 44}px) scale(${sx},${sy}) rotateY(-90deg)`;
    el.style.opacity = '0';

    // Poster cover appears at exact detail-page position
    const cover = document.createElement('div');
    cover.style.cssText = `
      position:fixed;left:${dest.left}px;top:${dest.top}px;
      width:${dest.width}px;height:${dest.height}px;
      z-index:9002;pointer-events:none;
      border-radius:4px;overflow:hidden;
      opacity:0;transform:scale(0.96);
      box-shadow:0 20px 60px rgba(0,0,0,0.8),0 0 0 1px rgba(255,255,255,0.07);
      transition:opacity 0.13s ease-out,transform 0.13s ease-out;
    `;
    if (movie.poster) cover.innerHTML = `<img src="${movie.poster}" style="width:100%;height:100%;object-fit:cover;display:block;" alt="">`;
    document.body.appendChild(cover);
    await wait(55);
    cover.style.opacity = '1';
    cover.style.transform = 'scale(1)';
    await wait(180);

    // Navigate — cover stays visible and sits exactly over the detail poster
    window.location.hash = `#detail/${movie.id}`;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Cover fades out revealing detail page; poster is in the same spot
    cover.style.transition = 'opacity 0.25s ease-in';
    cover.style.opacity = '0';
    await wait(270);

    el.remove();
    cover.remove();
    caseEl.style.opacity = '';
  }

  function setWatchlistViewMode(mode) {
    watchlistViewMode = mode;
    localStorage.setItem('watchlistViewMode', mode);
    loadWatchlist();
  }

  async function loadWatchlist() {
    const allMovies = (await MovieDB.getAllMovies()).filter(m => m.watchlist);
    const container = document.getElementById('watchlist-grid');
    const empty = document.getElementById('empty-watchlist');

    document.getElementById('wl-view-array-btn').classList.toggle('active', watchlistViewMode === 'array');
    document.getElementById('wl-view-decades-btn').classList.toggle('active', watchlistViewMode === 'decades');
    document.getElementById('wl-view-library-btn').classList.toggle('active', watchlistViewMode === 'library');

    if (allMovies.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    const q = (document.getElementById('watchlist-search').value || '').toLowerCase().trim();
    const movies = q ? allMovies.filter(m => m.title.toLowerCase().includes(q)) : allMovies;

    if (movies.length === 0) {
      container.innerHTML = '<p class="stats-empty">No matches.</p>';
      return;
    }

    if (watchlistViewMode === 'array') {
      container.innerHTML = UI.renderPosterGrid(movies);
    } else if (watchlistViewMode === 'decades') {
      container.innerHTML = UI.renderDecadeLanes(movies, 'desc');
    } else {
      container.innerHTML = UI.renderBlurayShelf(movies);
      lazyLoadCasePosters(container);
      container.querySelectorAll('.bluray-case').forEach(caseEl => {
        caseEl.addEventListener('click', () => {
          const id = parseInt(caseEl.dataset.id);
          const movie = allMovies.find(m => m.id === id);
          if (movie) extractBluray(caseEl, movie);
        });
      });
    }
  }

  async function addToWatchlist(tmdbId) {
    haptic(12);
    if (!TMDB.getApiKey()) {
      UI.showToast('No TMDB API key configured.');
      return;
    }
    try {
      const details = await TMDB.getMovieDetails(tmdbId);
      const directors = (details.credits?.crew || [])
        .filter(c => c.job === 'Director')
        .map(c => c.name);
      const cast = (details.credits?.cast || []).slice(0, 6).map(c => ({
        name: c.name,
        character: c.character,
        profileUrl: c.profile_path ? TMDB.posterUrl(c.profile_path, 'w185') : '',
      }));
      await MovieDB.addMovie({
        tmdbId: details.id,
        title: details.title,
        year: details.release_date ? details.release_date.substring(0, 4) : '',
        genres: (details.genres || []).map(g => g.name),
        directors,
        poster: TMDB.posterUrl(details.poster_path),
        backdrop: details.backdrop_path ? TMDB.posterUrl(details.backdrop_path, 'w1280') : '',
        overview: details.overview || '',
        cast,
        runtime: details.runtime || 0,
        watchlist: true,
      });
      updateWatchlistBadge();
      UI.showToast(`"${details.title}" added to watchlist!`);
    } catch (err) {
      UI.showToast(err.message);
    }
  }

  async function markAsWatched(id) {
    const movie = await MovieDB.getMovie(id);
    if (!movie) return;
    editingMovie = movie;
    showView('add');
    document.getElementById('tmdb-search').value = '';
    document.getElementById('search-results').innerHTML = '';
    populateForm({
      tmdbId: movie.tmdbId,
      title: movie.title,
      year: movie.year,
      genres: movie.genres,
      directors: movie.directors,
      poster: movie.poster,
      backdrop: movie.backdrop || '',
      overview: movie.overview || '',
      cast: movie.cast || [],
      runtime: movie.runtime || 0,
    });
  }

  // --- Add Movie ---

  function resetAddView() {
    document.getElementById('tmdb-search').value = '';
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('movie-form').style.display = 'none';
    const _fn = document.getElementById('filmography-nav');
    _fn.style.display = 'none'; _fn.innerHTML = '';
    editingMovie = null;
    selectedRating = 0;
    closeAutocomplete();
    searchMode = 'movie';
    selectedDirectorName = '';
    currentFilmography = null;
    document.querySelectorAll('.smt-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === 'movie')
    );
    document.getElementById('tmdb-search').placeholder = 'Search or paste a themoviedb.org URL...';
  }

  // --- Autocomplete ---

  async function fetchAutocomplete(q) {
    if (!TMDB.getApiKey()) return;
    try {
      const results = await TMDB.searchMovies(q, true);
      acResults = results.slice(0, 6);
      renderAutocomplete();
    } catch (_) { closeAutocomplete(); }
  }

  function renderAutocomplete() {
    const container = document.getElementById('search-autocomplete');
    if (acResults.length === 0) { closeAutocomplete(); return; }
    acFocusIdx = -1;
    container.innerHTML = acResults.map((r, i) => {
      const year = r.release_date ? r.release_date.substring(0, 4) : '';
      const thumb = r.poster_path ? TMDB.posterUrl(r.poster_path, 'w92') : '';
      const title = r.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="search-autocomplete-item" data-idx="${i}">
        ${thumb ? `<img src="${thumb}" alt="">` : '<div class="ac-thumb-placeholder"></div>'}
        <div><div class="ac-title">${title}</div>${year ? `<div class="ac-year">${year}</div>` : ''}</div>
      </div>`;
    }).join('');
    container.style.display = 'block';
  }

  function closeAutocomplete() {
    const container = document.getElementById('search-autocomplete');
    if (container) { container.innerHTML = ''; container.style.display = 'none'; }
    acResults = [];
    acFocusIdx = -1;
    clearTimeout(acDebounce);
  }

  function acMoveFocus(dir) {
    const container = document.getElementById('search-autocomplete');
    const items = container.querySelectorAll('.search-autocomplete-item');
    if (!items.length) return;
    if (acFocusIdx >= 0) items[acFocusIdx].classList.remove('ac-focused');
    acFocusIdx = Math.max(0, Math.min(acResults.length - 1, acFocusIdx + dir));
    items[acFocusIdx].classList.add('ac-focused');
  }

  async function searchTMDB() {
    const query = document.getElementById('tmdb-search').value.trim();
    closeAutocomplete();
    if (!query) return;

    if (!TMDB.getApiKey()) {
      UI.showToast('Please set your TMDB API key in Settings first.');
      return;
    }

    // Direct TMDB URL or numeric ID lookup — bypasses search entirely
    const tmdbUrlMatch = query.match(/themoviedb\.org\/movie\/(\d+)/);
    const directId = tmdbUrlMatch ? parseInt(tmdbUrlMatch[1]) : null;
    if (directId) {
      selectSearchResult(directId);
      return;
    }

    try {
      const results = await TMDB.searchMovies(query);
      const container = document.getElementById('search-results');
      if (results.length === 0) {
        container.innerHTML = '<p class="no-results">No movies found.</p>';
      } else {
        container.innerHTML = results.slice(0, 10).map(r => UI.renderSearchResult(r)).join('');
      }
    } catch (err) {
      UI.showToast(err.message);
    }
  }

  async function searchDirector() {
    const query = document.getElementById('tmdb-search').value.trim();
    closeAutocomplete();
    if (!query) return;
    try {
      const results = await TMDB.searchPerson(query);
      const container = document.getElementById('search-results');
      if (results.length === 0) {
        container.innerHTML = '<p class="no-results">No directors found.</p>';
      } else {
        container.innerHTML = results.slice(0, 8).map(r => UI.renderPersonResult(r)).join('');
      }
    } catch (err) {
      UI.showToast(err.message);
    }
  }

  function _showFilmographyNav(personName, count) {
    const nav = document.getElementById('filmography-nav');
    nav.style.display = '';
    nav.innerHTML = `<div class="filmography-header">
      <button class="search-back-btn" id="filmography-back"><span class="search-back-arrow">&#8249;</span> ${UI.escapeHtml(personName)}</button>
      <span class="filmography-count">${count} film${count !== 1 ? 's' : ''}</span>
    </div>`;
    document.getElementById('filmography-back').addEventListener('click', () => {
      const form = document.getElementById('movie-form');
      // If the film form is open, back returns to the filmography list
      if (form.style.display !== 'none' && currentFilmography) {
        form.style.display = 'none';
        editingMovie = null;
        const { personId, personName, mode } = currentFilmography;
        if (mode === 'actor') loadActorFilmography(personId, personName);
        else loadFilmography(personId, personName);
        return;
      }
      // Otherwise, exit the filmography and return to the person search
      selectedDirectorName = '';
      currentFilmography = null;
      nav.style.display = 'none';
      nav.innerHTML = '';
      document.getElementById('search-results').innerHTML = '';
      document.getElementById('tmdb-search').value = '';
      document.getElementById('tmdb-search').focus();
    });
  }

  async function loadFilmography(personId, personName) {
    selectedDirectorName = personName;
    currentFilmography = { personId, personName, mode: 'director' };
    const container = document.getElementById('search-results');
    container.innerHTML = '<p class="no-results">Loading filmography...</p>';
    try {
      const [credits, allMovies] = await Promise.all([
        TMDB.getPersonMovieCredits(personId),
        MovieDB.getAllMovies(),
      ]);
      const addedSet = new Set(allMovies.map(m => String(m.tmdbId)));
      const seen = new Set();
      const directed = (credits.crew || [])
        .filter(c => c.job === 'Director' && c.release_date && !seen.has(c.id) && seen.add(c.id))
        .sort((a, b) => b.release_date.localeCompare(a.release_date));

      if (directed.length === 0) {
        container.innerHTML = '<p class="no-results">No directed films found.</p>';
        return;
      }
      _showFilmographyNav(personName, directed.length);
      container.innerHTML = directed.map(f => UI.renderFilmographyResult(f, addedSet)).join('');
    } catch (err) {
      UI.showToast(err.message);
    }
  }

  async function searchActor() {
    const query = document.getElementById('tmdb-search').value.trim();
    closeAutocomplete();
    if (!query) return;
    try {
      const results = await TMDB.searchActor(query);
      const container = document.getElementById('search-results');
      if (results.length === 0) {
        container.innerHTML = '<p class="no-results">No actors found.</p>';
      } else {
        container.innerHTML = results.slice(0, 8).map(r => UI.renderPersonResult(r, 'Actor')).join('');
      }
    } catch (err) {
      UI.showToast(err.message);
    }
  }

  async function loadActorFilmography(personId, personName) {
    selectedDirectorName = personName;
    currentFilmography = { personId, personName, mode: 'actor' };
    const container = document.getElementById('search-results');
    container.innerHTML = '<p class="no-results">Loading filmography...</p>';
    try {
      const [credits, allMovies] = await Promise.all([
        TMDB.getPersonMovieCredits(personId),
        MovieDB.getAllMovies(),
      ]);
      const addedSet = new Set(allMovies.map(m => String(m.tmdbId)));
      const seen = new Set();
      const acted = (credits.cast || [])
        .filter(c => c.release_date && !seen.has(c.id) && seen.add(c.id))
        .sort((a, b) => b.release_date.localeCompare(a.release_date));

      if (acted.length === 0) {
        container.innerHTML = '<p class="no-results">No acting credits found.</p>';
        return;
      }
      _showFilmographyNav(personName, acted.length);
      container.innerHTML = acted.map(f => UI.renderFilmographyResult(f, addedSet, f.character ? `as ${f.character}` : null)).join('');
    } catch (err) {
      UI.showToast(err.message);
    }
  }

  async function selectSearchResult(tmdbId) {
    try {
      const details = await TMDB.getMovieDetails(tmdbId);
      const directors = (details.credits?.crew || [])
        .filter(c => c.job === 'Director')
        .map(c => c.name);
      const cast = (details.credits?.cast || []).slice(0, 6).map(c => ({
        name: c.name,
        character: c.character,
        profileUrl: c.profile_path ? TMDB.posterUrl(c.profile_path, 'w185') : '',
      }));
      const omdb = await TMDB.fetchOmdbData(details.imdb_id);
      populateForm({
        tmdbId: details.id,
        title: details.title,
        year: details.release_date ? details.release_date.substring(0, 4) : '',
        genres: (details.genres || []).map(g => g.name),
        directors,
        poster: TMDB.posterUrl(details.poster_path),
        backdrop: details.backdrop_path ? TMDB.posterUrl(details.backdrop_path, 'w1280') : '',
        overview: details.overview || '',
        cast,
        runtime: details.runtime || 0,
        voteAverage: details.vote_average || 0,
        voteCount: details.vote_count || 0,
        imdbId: details.imdb_id || '',
        imdbRating: omdb?.imdbRating || 0,
        imdbVotes: omdb?.imdbVotes || '',
        rtScore: omdb?.rtScore || '',
      });
    } catch (err) {
      UI.showToast(err.message);
    }
  }

  function populateForm(data) {
    document.getElementById('search-results').innerHTML = '';
    const form = document.getElementById('movie-form');
    form.style.display = 'block';

    document.getElementById('form-tmdb-id').value = data.tmdbId || '';
    document.getElementById('form-title').textContent = data.title;
    document.getElementById('form-year').textContent = data.year;
    document.getElementById('form-genres').textContent = (data.genres || []).join(', ');

    const directorsEl = document.getElementById('form-directors');
    directorsEl.innerHTML = UI.renderDirectorBadge(data.directors || []);

    const overviewEl = document.getElementById('form-overview');
    overviewEl.textContent = data.overview || '';
    overviewEl.style.display = data.overview ? 'block' : 'none';

    const posterEl = document.getElementById('form-poster');
    if (data.poster) {
      posterEl.src = data.poster;
      posterEl.style.display = 'block';
    } else {
      posterEl.style.display = 'none';
    }

    form.dataset.title = data.title;
    form.dataset.year = data.year;
    form.dataset.genres = JSON.stringify(data.genres || []);
    form.dataset.directors = JSON.stringify(data.directors || []);
    form.dataset.poster = data.poster || '';
    form.dataset.overview = data.overview || '';
    form.dataset.backdrop = data.backdrop || '';
    form.dataset.cast = JSON.stringify(data.cast || []);
    form.dataset.runtime = data.runtime || 0;
    form.dataset.voteAverage = data.voteAverage || 0;
    form.dataset.voteCount = data.voteCount || 0;
    form.dataset.imdbId = data.imdbId || '';
    form.dataset.imdbRating = data.imdbRating || 0;
    form.dataset.imdbVotes = data.imdbVotes || '';
    form.dataset.rtScore = data.rtScore || '';

    document.getElementById('form-ext-ratings').innerHTML = UI.buildExtBadgesHtml(data);

    document.getElementById('form-watchlist-btn').style.display = editingMovie ? 'none' : '';

    if (editingMovie) {
      selectedRating = editingMovie.rating || 0;
      document.getElementById('form-notes').value = editingMovie.notes || '';
      document.getElementById('form-id').value = editingMovie.id;
    } else {
      selectedRating = 0;
      document.getElementById('form-notes').value = '';
      document.getElementById('form-id').value = '';
    }
    updateRatingDisplay();
  }

  function updateRatingDisplay() {
    const slider = document.getElementById('rating-slider');
    const valueEl = document.getElementById('rating-display-value');
    const maxEl = document.getElementById('rating-display-max');
    const clearBtn = document.getElementById('rating-clear');

    if (selectedRating > 0) {
      const color = UI.ratingColor(selectedRating);
      valueEl.textContent = UI.formatRating(selectedRating);
      valueEl.style.color = color;
      maxEl.textContent = '/10';
      slider.value = selectedRating;
      clearBtn.style.display = '';
      const pct = ((selectedRating - 1) / 9) * 100;
      slider.style.background = `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, var(--star-empty) ${pct}%, var(--star-empty) 100%)`;
    } else {
      valueEl.textContent = '-';
      valueEl.style.color = '';
      maxEl.textContent = '';
      slider.value = 5;
      clearBtn.style.display = 'none';
      slider.style.background = '';
    }
    document.getElementById('form-rating').value = selectedRating;
  }

  async function saveMovie(e) {
    e.preventDefault();
    haptic([10, 30, 10]);
    const form = document.getElementById('movie-form');

    const movie = {
      tmdbId: document.getElementById('form-tmdb-id').value,
      title: form.dataset.title,
      year: form.dataset.year,
      genres: JSON.parse(form.dataset.genres),
      directors: JSON.parse(form.dataset.directors || '[]'),
      poster: form.dataset.poster,
      backdrop: form.dataset.backdrop || '',
      overview: form.dataset.overview || '',
      cast: JSON.parse(form.dataset.cast || '[]'),
      runtime: parseInt(form.dataset.runtime) || 0,
      voteAverage: parseFloat(form.dataset.voteAverage) || 0,
      voteCount: parseInt(form.dataset.voteCount) || 0,
      imdbId: form.dataset.imdbId || '',
      imdbRating: parseFloat(form.dataset.imdbRating) || 0,
      imdbVotes: form.dataset.imdbVotes || '',
      rtScore: form.dataset.rtScore || '',
      rating: selectedRating,
      notes: document.getElementById('form-notes').value.trim(),
    };

    try {
      const existingId = document.getElementById('form-id').value;
      const isWatchlistConversion = (editingMovie && editingMovie.watchlist);

      if (existingId) {
        movie.id = parseInt(existingId);
        movie.dateAdded = isWatchlistConversion ? new Date().toISOString() : editingMovie.dateAdded;
        await MovieDB.updateMovie(movie);
        UI.showToast('Movie updated!');
      } else {
        await MovieDB.addMovie(movie);
        UI.showToast('Movie added!');
      }

      // AWAIT the suggestions fetch BEFORE we reload the catalogue
      if ((!existingId || isWatchlistConversion) && movie.tmdbId) {
        await fetchSimilarSuggestions(movie.title, movie.tmdbId);
      }

      editingMovie = null;
      updateWatchlistBadge();

      // Force UI refresh even if the URL hash hasn't changed
      if (window.location.hash === '#catalogue') {
        loadCatalogue();
        showView('catalogue');
      } else {
        window.location.hash = '#catalogue';
      }
    } catch (err) {
      UI.showToast('Error saving movie: ' + err.message);
    }
  }

  // --- Chart ---

  let tournament = null;

  async function loadChart() {
    const movies = (await MovieDB.getAllMovies()).filter(m => !m.watchlist && m.rating > 0);
    const top30 = [...movies].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 30);
    const allCatalogue = (await MovieDB.getAllMovies()).filter(m => !m.watchlist);
    const chartHtml = UI.renderChart(top30);
    const tournamentBtn = allCatalogue.length >= 2
      ? `<button class="btn btn-primary tournament-launch-btn" id="launch-tournament">&#127942; Movie Tournament</button>`
      : '';
    const topListsHtml = `<div class="chart-toplists">
      <div class="chart-toplists-label">Explore top lists</div>
      <div class="chart-toplists-row">
        <a href="https://letterboxd.com/films/popular/" target="_blank" rel="noopener" class="ext-badge ext-badge--lb chart-toplist-btn">
          <span class="ext-badge-logo">LBxd</span>
          <span class="chart-toplist-name">Popular</span>
          <span class="ext-badge-arrow">&#8599;</span>
        </a>
        <a href="https://www.themoviedb.org/movie/top-rated" target="_blank" rel="noopener" class="ext-badge ext-badge--tmdb chart-toplist-btn">
          <span class="ext-badge-logo">TMDb</span>
          <span class="chart-toplist-name">Top Rated</span>
          <span class="ext-badge-arrow">&#8599;</span>
        </a>
        <a href="https://www.imdb.com/chart/top/" target="_blank" rel="noopener" class="ext-badge ext-badge--imdb chart-toplist-btn">
          <span class="ext-badge-logo">IMDb</span>
          <span class="chart-toplist-name">Top 250</span>
          <span class="ext-badge-arrow">&#8599;</span>
        </a>
      </div>
    </div>`;
    document.getElementById('chart-list').innerHTML = chartHtml + tournamentBtn + topListsHtml;
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getRoundName(remainingInRound, totalMovies) {
    if (remainingInRound === 2) return 'Final';
    if (remainingInRound === 4) return 'Semi-Finals';
    if (remainingInRound === 8) return 'Quarter-Finals';
    if (remainingInRound === 16) return 'Round of 16';
    if (remainingInRound === 32) return 'Round of 32';
    return `Round of ${remainingInRound}`;
  }

  async function startTournament() {
    const allCatalogue = (await MovieDB.getAllMovies()).filter(m => !m.watchlist);
    if (allCatalogue.length < 2) { UI.showToast('Need at least 2 films!'); return; }

    const shuffled = shuffle(allCatalogue);

    // Simple pairing — no power-of-2 padding needed
    const firstRound = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 < shuffled.length) {
        firstRound.push({ a: shuffled[i], b: shuffled[i + 1], winner: null });
      } else {
        // Odd movie gets a bye
        firstRound.push({ a: shuffled[i], b: null, winner: shuffled[i] });
      }
    }

    // Count total real matches across all rounds for progress tracking
    let totalMatches = 0;
    let n = firstRound.filter(m => m.b !== null).length;
    let survivors = firstRound.length;   // winners after this round
    totalMatches += n;
    while (survivors > 1) {
      const pairs = Math.floor(survivors / 2);
      totalMatches += pairs;
      survivors = pairs + (survivors % 2);
    }

    tournament = {
      rounds: [firstRound],
      currentRound: 0,
      currentMatchIdx: 0,
      eliminated: [],
      allMovieCount: allCatalogue.length,
      totalMatches,
      matchesDone: 0,
      picking: false,
    };

    showNextMatch();
  }

  function showNextMatch() {
    const container = document.getElementById('chart-list');
    const round = tournament.rounds[tournament.currentRound];

    // Skip byes
    while (tournament.currentMatchIdx < round.length && round[tournament.currentMatchIdx].winner) {
      tournament.currentMatchIdx++;
    }

    if (tournament.currentMatchIdx >= round.length) {
      // Round complete — collect winners and build next round
      const winners = round.map(m => m.winner);
      if (winners.length <= 1) {
        // Tournament over
        const rankings = [winners[0], ...tournament.eliminated.reverse()];
        container.innerHTML = UI.renderTournamentResults(rankings);
        tournament = null;
        setTimeout(spawnConfetti, 300);
        return;
      }

      const nextRound = [];
      for (let i = 0; i < winners.length; i += 2) {
        if (i + 1 < winners.length) {
          nextRound.push({ a: winners[i], b: winners[i + 1], winner: null });
        } else {
          nextRound.push({ a: winners[i], b: null, winner: winners[i] });
        }
      }
      tournament.rounds.push(nextRound);
      tournament.currentRound++;
      tournament.currentMatchIdx = 0;
      showNextMatch();
      return;
    }

    const match = round[tournament.currentMatchIdx];
    const realMatchesInRound = round.filter(m => m.b !== null);
    const roundSize = realMatchesInRound.length * 2;
    // Add byes to get the "logical" round size for naming
    const logicalSize = round.length * 2;
    const roundName = getRoundName(logicalSize, tournament.allMovieCount);
    const matchNum = realMatchesInRound.indexOf(match) + 1;

    container.innerHTML = UI.renderTournamentMatch(
      match.a, match.b, matchNum, realMatchesInRound.length, roundName,
      tournament.matchesDone, tournament.totalMatches
    );
    tournament.picking = false;
  }

  function pickTournamentWinner(movieId) {
    if (!tournament || tournament.picking) return;
    tournament.picking = true;

    const round = tournament.rounds[tournament.currentRound];
    const match = round[tournament.currentMatchIdx];
    if (!match) return;

    const winnerCard = document.querySelector(`.tournament-card[data-id="${movieId}"]`);
    const loserId = match.a.id === movieId ? match.b.id : match.a.id;
    const loserCard = document.querySelector(`.tournament-card[data-id="${loserId}"]`);
    const vsBadge = document.querySelector('.tournament-vs-badge');

    // Animate: winner zooms forward, loser fades out
    if (winnerCard) winnerCard.classList.add('tournament-pick-winner');
    if (loserCard) loserCard.classList.add('tournament-pick-loser');
    if (vsBadge) vsBadge.classList.add('tournament-vs-hide');

    setTimeout(() => {
      const winner = match.a.id === movieId ? match.a : match.b;
      const loser = match.a.id === movieId ? match.b : match.a;
      match.winner = winner;
      tournament.eliminated.push(loser);
      tournament.currentMatchIdx++;
      tournament.matchesDone++;
      showNextMatch();
    }, 650);
  }

  // --- Detail ---

  async function loadMovieDetail(id) {
    const [movie, allMovies] = await Promise.all([MovieDB.getMovie(id), MovieDB.getAllMovies()]);
    if (!movie) {
      UI.showToast('Movie not found');
      window.location.hash = '#catalogue';
      return;
    }

    // Backfill fields for movies saved before these fields existed
    if ((!movie.overview || !movie.cast || !movie.backdrop || !movie.voteAverage) && movie.tmdbId) {
      try {
        const details = await TMDB.getMovieDetails(movie.tmdbId);
        let updated = false;
        if (!movie.overview && details.overview) { movie.overview = details.overview; updated = true; }
        if (!movie.cast && details.credits?.cast?.length) {
          movie.cast = details.credits.cast.slice(0, 6).map(c => ({
            name: c.name, character: c.character,
            profileUrl: c.profile_path ? TMDB.posterUrl(c.profile_path, 'w185') : '',
          }));
          updated = true;
        }
        if (!movie.backdrop && details.backdrop_path) {
          movie.backdrop = TMDB.posterUrl(details.backdrop_path, 'w1280');
          updated = true;
        }
        if (!movie.runtime && details.runtime) { movie.runtime = details.runtime; updated = true; }
        if (!movie.voteAverage && details.vote_average) { movie.voteAverage = details.vote_average; updated = true; }
        if (!movie.voteCount && details.vote_count) { movie.voteCount = details.vote_count; updated = true; }
        if (!movie.imdbId && details.imdb_id) { movie.imdbId = details.imdb_id; updated = true; }
        if (updated) await MovieDB.updateMovie(movie);
      } catch (_) { /* best-effort */ }
    }
    // Backfill IMDb/RT ratings from OMDB
    if (movie.imdbId && !movie.imdbRating) {
      try {
        const omdb = await TMDB.fetchOmdbData(movie.imdbId);
        if (omdb) {
          let updated = false;
          if (!movie.imdbRating && omdb.imdbRating) { movie.imdbRating = omdb.imdbRating; updated = true; }
          if (!movie.imdbVotes && omdb.imdbVotes) { movie.imdbVotes = omdb.imdbVotes; updated = true; }
          if (!movie.rtScore && omdb.rtScore) { movie.rtScore = omdb.rtScore; updated = true; }
          if (updated) await MovieDB.updateMovie(movie);
        }
      } catch (_) { /* best-effort */ }
    }

    const ctx = { allMovies: allMovies.filter(m => !m.watchlist) };
    document.getElementById('movie-detail').innerHTML = UI.renderMovieDetail(movie, ctx);

    setupTrailerButton(movie);

    document.getElementById('detail-back').addEventListener('click', () => {
      window.location.hash = movie.watchlist ? '#watchlist' : '#catalogue';
    });

    document.querySelectorAll('.mlt-item[data-id]').forEach(item => {
      item.addEventListener('click', () => {
        window.location.hash = `#detail/${item.dataset.id}`;
      });
    });

    if (!movie.watchlist) {
      const rewatchBtn = document.getElementById('detail-rewatch');
      if (rewatchBtn) {
        rewatchBtn.addEventListener('click', async () => {
          movie.rewatches = (movie.rewatches || 0) + 1;
          await MovieDB.updateMovie(movie);
          UI.showToast(`&#8634; Rewatch #${movie.rewatches} logged!`);
          const rewatchDisplay = document.querySelector('.detail-rewatches');
          if (rewatchDisplay) {
            rewatchDisplay.innerHTML = `&#8634; Rewatched ${movie.rewatches}&#215;`;
          } else {
            const actionsEl = document.querySelector('.detail-actions');
            if (actionsEl) {
              const div = document.createElement('div');
              div.className = 'detail-rewatches';
              div.innerHTML = `&#8634; Rewatched ${movie.rewatches}&#215;`;
              actionsEl.before(div);
            }
          }
        });
      }
    }

    if (movie.watchlist) {
      document.getElementById('detail-mark-watched').addEventListener('click', () => {
        markAsWatched(movie.id);
      });
    } else {
      document.getElementById('detail-edit').addEventListener('click', () => {
        editingMovie = movie;
        showView('add');
        document.getElementById('view-add').style.display = 'block';
        populateForm({
          tmdbId: movie.tmdbId,
          title: movie.title,
          year: movie.year,
          genres: movie.genres,
          directors: movie.directors,
          poster: movie.poster,
          backdrop: movie.backdrop || '',
          overview: movie.overview || '',
          cast: movie.cast || [],
          runtime: movie.runtime || 0,
        });
      });
    }

    const ticketBtn = document.getElementById('detail-ticket');
    if (ticketBtn) {
      ticketBtn.addEventListener('click', async () => {
        haptic(12);
        await openTicketStub(movie);
      });
    }

    document.getElementById('detail-delete').addEventListener('click', async () => {
      const msg = movie.watchlist
        ? 'Remove this movie from your watchlist?'
        : 'Delete this movie from your catalogue?';
      if (confirm(msg)) {
        await MovieDB.deleteMovie(movie.id);
        updateWatchlistBadge();
        UI.showToast('Movie deleted');
        window.location.hash = movie.watchlist ? '#watchlist' : '#catalogue';
      }
    });

    // Drag-to-reveal people overlay
    const dragEl = document.getElementById('detail-poster-drag');
    if (dragEl) {
      const directorPhotos = {};
      // Pre-fetch director photos in background
      (movie.directors || []).forEach(async name => {
        try {
          const results = await TMDB.searchPerson(name);
          const person = (results || []).find(p => p.known_for_department === 'Directing') || results[0];
          if (person?.profile_path) directorPhotos[name] = TMDB.profileUrl(person.profile_path);
        } catch (_) {}
      });

      function buildBubbleHtml(p, i) {
        const initials = p.name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const photoHtml = p.photoUrl
          ? `<img src="${p.photoUrl}" alt="${UI.escapeHtml(p.name)}">`
          : `<span>${initials}</span>`;
        return `<div class="people-bubble" style="--i:${i}" data-person-name="${UI.escapeHtml(p.name)}" data-person-mode="${p.mode}">
          <div class="people-bubble-photo">${photoHtml}</div>
          <span class="people-bubble-role">${UI.escapeHtml(p.role)}</span>
          <span class="people-bubble-name">${UI.escapeHtml(p.name)}</span>
        </div>`;
      }

      function showPeopleOverlay() {
        if (document.getElementById('people-overlay')) return;
        const people = [];
        (movie.directors || []).forEach(name => people.push({ name, mode: 'director', role: 'Director', photoUrl: directorPhotos[name] || '' }));
        (movie.cast || []).slice(0, 5).forEach(c => people.push({ name: c.name, mode: 'actor', role: c.character || 'Actor', photoUrl: c.profileUrl || '' }));

        const overlay = document.createElement('div');
        overlay.id = 'people-overlay';
        overlay.className = 'people-overlay';
        overlay.innerHTML = `<div class="people-overlay-inner">${people.map(buildBubbleHtml).join('')}</div>`;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', e => {
          const bubble = e.target.closest('.people-bubble');
          if (bubble) {
            pendingPersonSearch = { mode: bubble.dataset.personMode, query: bubble.dataset.personName };
            dismissOverlay();
            window.location.hash = '#add';
          } else {
            dismissOverlay();
          }
        });
      }

      function dismissOverlay() {
        const overlay = document.getElementById('people-overlay');
        if (!overlay) return;
        overlay.classList.add('people-overlay--out');
        overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
      }

      let touchX0 = 0, touchY0 = 0, tracking = false, dragging = false, maxDx = 0;
      const THRESHOLD = 40;

      function getMaxDrag() {
        const rect = dragEl.getBoundingClientRect();
        return Math.max(0, window.innerWidth - rect.left - 20);
      }

      function springBack(dx) {
        dragEl.style.willChange = '';
        dragEl.style.transition = 'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)';
        dragEl.style.transform = 'translateX(0)';
        if (dx >= THRESHOLD) {
          dragEl.addEventListener('transitionend', function handler() {
            dragEl.removeEventListener('transitionend', handler);
            showPeopleOverlay();
          });
        }
      }

      dragEl.addEventListener('touchstart', e => {
        touchX0 = e.touches[0].clientX;
        touchY0 = e.touches[0].clientY;
        tracking = true;
        dragging = false;
        maxDx = getMaxDrag();
      }, { passive: true });

      dragEl.addEventListener('touchmove', e => {
        if (!tracking) return;
        const dx = e.touches[0].clientX - touchX0;
        const dy = e.touches[0].clientY - touchY0;
        // Direction not yet decided — wait for ~8px of motion, then commit
        if (!dragging) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (Math.abs(dy) > Math.abs(dx)) {
            // Vertical intent — release the gesture so the page scrolls normally
            tracking = false;
            return;
          }
          // Horizontal intent — claim the gesture
          dragging = true;
          dragEl.style.transition = 'none';
          dragEl.style.willChange = 'transform';
        }
        e.preventDefault();
        const clamped = Math.max(0, Math.min(dx, maxDx));
        dragEl.style.transform = `translateX(${clamped}px)`;
      }, { passive: false });

      dragEl.addEventListener('touchend', e => {
        if (!tracking && !dragging) return;
        tracking = false;
        if (!dragging) return;
        dragging = false;
        const dx = Math.max(0, e.changedTouches[0].clientX - touchX0);
        springBack(dx);
      });

      dragEl.addEventListener('touchcancel', () => {
        if (!dragging) { tracking = false; return; }
        tracking = false;
        dragging = false;
        springBack(0);
      });
    }
  }

  async function setupTrailerButton(movie) {
    if (!movie.tmdbId) return;
    const wrap = document.querySelector('.detail-backdrop-wrap') || document.querySelector('.detail-poster-wrap') || document.querySelector('.detail-poster-drag');
    if (!wrap) return;
    let videos = [];
    try { videos = await TMDB.getMovieVideos(movie.tmdbId); } catch (_) { return; }
    const trailer = TMDB.pickBestTrailer(videos);
    if (!trailer) return;
    const btn = document.createElement('button');
    btn.className = 'trailer-play-btn';
    btn.type = 'button';
    btn.innerHTML = '<span class="tpb-icon">&#9654;</span> Play Trailer';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic(15);
      openTrailerModal(trailer.key, movie.title);
    });
    wrap.appendChild(btn);
  }

  function openTrailerModal(youtubeKey, title) {
    if (document.getElementById('trailer-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'trailer-modal';
    modal.className = 'trailer-modal';
    modal.innerHTML = `
      <div class="trailer-modal-backdrop"></div>
      <div class="trailer-modal-frame">
        <button class="trailer-modal-close" aria-label="Close">&times;</button>
        <div class="trailer-modal-title">${UI.escapeHtml(title || 'Trailer')}</div>
        <div class="trailer-modal-iframe-wrap">
          <iframe
            src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeKey)}?autoplay=1&rel=0&modestbranding=1"
            frameborder="0"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowfullscreen></iframe>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => {
      modal.classList.add('trailer-modal--out');
      setTimeout(() => modal.remove(), 200);
    };
    modal.querySelector('.trailer-modal-close').addEventListener('click', close);
    modal.querySelector('.trailer-modal-backdrop').addEventListener('click', close);
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });
  }

  // ---- Ticket Stub generator ----
  function _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function _ticketSerial(movie) {
    const id = (movie.id || 0).toString().padStart(5, '0');
    const yr = movie.year || '----';
    return `№ ${yr}-${id}`;
  }

  async function generateTicketStub(movie) {
    const W = 1100, H = 460;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Body
    const bodyGrad = ctx.createLinearGradient(0, 0, 0, H);
    bodyGrad.addColorStop(0, '#f5e3bd');
    bodyGrad.addColorStop(1, '#e6cd95');
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(0, 0, W, H);

    // Soft texture (cross-hatch noise)
    ctx.save();
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#5a3a18' : '#3a2510';
      ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    }
    ctx.restore();

    // Inner double border
    ctx.strokeStyle = '#5a3a18';
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, W - 36, H - 36);
    ctx.lineWidth = 1;
    ctx.strokeRect(28, 28, W - 56, H - 56);

    // Perforation line
    const perfX = W - 220;
    ctx.save();
    ctx.strokeStyle = '#5a3a18';
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(perfX, 28);
    ctx.lineTo(perfX, H - 28);
    ctx.stroke();
    ctx.restore();

    // Half-circle perforations top/bottom of perf line
    ctx.fillStyle = '#0a0a14';
    ctx.beginPath(); ctx.arc(perfX, 0, 12, 0, Math.PI); ctx.fill();
    ctx.beginPath(); ctx.arc(perfX, H, 12, Math.PI, 2 * Math.PI); ctx.fill();

    // Poster
    if (movie.poster) {
      try {
        const img = await _loadImage(movie.poster);
        const pH = H - 80;
        const pW = pH * (2 / 3);
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 4;
        roundedRect(ctx, 50, 40, pW, pH, 8);
        ctx.clip();
        ctx.drawImage(img, 50, 40, pW, pH);
        ctx.restore();
      } catch (_) {}
    }

    // Text block
    const tx = 50 + (H - 80) * (2 / 3) + 28;

    ctx.fillStyle = '#5a3a18';
    ctx.font = '600 14px "Cinzel", serif';
    ctx.textBaseline = 'top';
    ctx.fillText('CINEMA · ADMIT ONE', tx, 50);

    ctx.fillStyle = '#1a0e02';
    ctx.font = '700 48px "Cinzel", "Times New Roman", serif';
    const titleLines = wrapText(ctx, movie.title || 'Untitled', perfX - tx - 20);
    let yCursor = 80;
    for (let i = 0; i < Math.min(2, titleLines.length); i++) {
      ctx.fillText(titleLines[i], tx, yCursor);
      yCursor += 54;
    }

    ctx.fillStyle = '#5a3a18';
    ctx.font = '400 22px "Cinzel", serif';
    ctx.fillText(movie.year || '', tx, yCursor + 4);
    yCursor += 40;

    // Director
    if ((movie.directors || []).length) {
      ctx.font = 'italic 18px serif';
      ctx.fillStyle = '#3a2510';
      ctx.fillText(`directed by ${movie.directors[0]}`, tx, yCursor);
      yCursor += 30;
    }

    // Rating — large
    yCursor = Math.max(yCursor, 240);
    ctx.font = '800 26px "Cinzel", serif';
    ctx.fillStyle = '#5a3a18';
    ctx.fillText('YOUR RATING', tx, yCursor);
    yCursor += 32;
    ctx.font = '900 86px "Cinzel", serif';
    ctx.fillStyle = '#c0392b';
    ctx.fillText(UI.formatRating(movie.rating || 0) + '/10', tx, yCursor);

    // Date watched (bottom)
    const dateStr = movie.dateAdded
      ? new Date(movie.dateAdded).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
      : '';
    ctx.font = '600 16px "Cinzel", serif';
    ctx.fillStyle = '#3a2510';
    ctx.fillText(dateStr, tx, H - 70);
    ctx.font = '400 12px monospace';
    ctx.fillStyle = '#5a3a18';
    ctx.fillText(_ticketSerial(movie), tx, H - 46);

    // Stub side
    const sx = perfX + 110;
    ctx.save();
    ctx.translate(sx, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = '900 56px "Cinzel", serif';
    ctx.fillStyle = '#1a0e02';
    ctx.fillText('ADMIT ONE', 0, -40);
    ctx.font = '600 16px "Cinzel", serif';
    ctx.fillStyle = '#5a3a18';
    ctx.fillText(_ticketSerial(movie), 0, 12);
    ctx.font = '400 12px monospace';
    ctx.fillStyle = '#5a3a18';
    ctx.fillText('— ROW A · SEAT 1 —', 0, 38);
    ctx.restore();

    return canvas;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(ctx, text, maxWidth) {
    const words = (text || '').split(' ');
    const lines = []; let current = '';
    for (const w of words) {
      const test = current ? current + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current); current = w;
      } else current = test;
    }
    if (current) lines.push(current);
    return lines;
  }

  async function openTicketStub(movie) {
    if (document.getElementById('ticket-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'ticket-modal';
    modal.className = 'ticket-modal';
    modal.innerHTML = `
      <div class="ticket-modal-backdrop"></div>
      <div class="ticket-modal-content">
        <button class="ticket-modal-close" aria-label="Close">&times;</button>
        <div class="ticket-canvas-wrap">
          <div class="ticket-loading">Printing your stub…</div>
        </div>
        <div class="ticket-actions">
          <button class="btn btn-primary ticket-download" type="button" disabled>&#11015; Download</button>
          <button class="btn btn-secondary ticket-share" type="button" disabled>Share</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.add('ticket-modal--out');
      setTimeout(() => modal.remove(), 200);
    };
    modal.querySelector('.ticket-modal-close').addEventListener('click', close);
    modal.querySelector('.ticket-modal-backdrop').addEventListener('click', close);

    let canvas;
    try {
      canvas = await generateTicketStub(movie);
    } catch (e) {
      modal.querySelector('.ticket-canvas-wrap').innerHTML = '<div class="ticket-error">Could not generate ticket. The poster may not allow downloads.</div>';
      return;
    }
    canvas.classList.add('ticket-canvas');
    const wrap = modal.querySelector('.ticket-canvas-wrap');
    wrap.innerHTML = '';
    wrap.appendChild(canvas);

    const dlBtn = modal.querySelector('.ticket-download');
    const shareBtn = modal.querySelector('.ticket-share');
    dlBtn.disabled = false;
    shareBtn.disabled = false;

    dlBtn.addEventListener('click', () => {
      haptic(10);
      const link = document.createElement('a');
      link.download = `ticket-${(movie.title || 'movie').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    });

    shareBtn.addEventListener('click', async () => {
      haptic(10);
      try {
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        if (!blob) throw new Error('blob fail');
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'ticket.png', { type: 'image/png' })] })) {
          await navigator.share({
            files: [new File([blob], `ticket-${movie.title}.png`, { type: 'image/png' })],
            title: `Ticket Stub — ${movie.title}`,
            text: `Just watched ${movie.title} (${movie.year}) — ${UI.formatRating(movie.rating)}/10`,
          });
        } else {
          dlBtn.click();
        }
      } catch (_) {}
    });
  }

  // ---- Year in Review ----
  function computeYearInReview(allMovies, year) {
    const inYear = allMovies.filter(m => {
      if (m.watchlist) return false;
      if (!m.dateAdded) return false;
      return new Date(m.dateAdded).getFullYear() === year;
    });

    const totalCount = inYear.length;
    const totalMinutes = inYear.reduce((s, m) => s + (m.runtime || 0), 0);
    const totalHours = Math.round(totalMinutes / 60);

    const ratedOnly = inYear.filter(m => (m.rating || 0) > 0);
    const avgRating = ratedOnly.length > 0
      ? (ratedOnly.reduce((s, m) => s + m.rating, 0) / ratedOnly.length)
      : 0;

    const genreCounts = {};
    inYear.forEach(m => (m.genres || []).forEach(g => genreCounts[g] = (genreCounts[g] || 0) + 1));
    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0] || null;

    const dirCounts = {};
    inYear.forEach(m => (m.directors || []).forEach(d => dirCounts[d] = (dirCounts[d] || 0) + 1));
    const topDir = Object.entries(dirCounts).sort((a, b) => b[1] - a[1])[0] || null;

    const decadeCounts = {};
    inYear.forEach(m => {
      if (!m.year) return;
      const dec = Math.floor(parseInt(m.year) / 10) * 10;
      decadeCounts[dec] = (decadeCounts[dec] || 0) + 1;
    });
    const topDecade = Object.entries(decadeCounts).sort((a, b) => b[1] - a[1])[0] || null;

    const hiddenGems = inYear
      .filter(m => (m.rating || 0) >= 8 && m.voteCount && m.voteCount < 5000)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 1);

    const rewatched = inYear.filter(m => m.rewatches > 0).sort((a, b) => b.rewatches - a.rewatches).slice(0, 1);
    const best = [...inYear].sort((a, b) => (b.rating || 0) - (a.rating || 0))[0] || null;

    return {
      year, totalCount, totalHours, totalMinutes, avgRating,
      topGenre, topDir, topDecade, hiddenGems, rewatched, best,
    };
  }

  function renderYearInReviewSlides(s) {
    const slides = [];
    slides.push({
      title: `${s.year}`,
      subtitle: 'YOUR YEAR IN CINEMA',
      kind: 'intro',
    });
    slides.push({
      title: s.totalCount.toString(),
      subtitle: s.totalCount === 1 ? 'film logged' : 'films logged',
      kind: 'stat',
    });
    if (s.totalHours > 0) {
      const days = (s.totalMinutes / 60 / 24).toFixed(1);
      slides.push({
        title: `${s.totalHours}h`,
        subtitle: `that's ${days} days in the dark`,
        kind: 'stat',
      });
    }
    if (s.avgRating > 0) {
      slides.push({
        title: s.avgRating.toFixed(1),
        subtitle: 'your average rating',
        kind: 'stat',
      });
    }
    if (s.topGenre) {
      slides.push({
        title: s.topGenre[0],
        subtitle: `your top genre · ${s.topGenre[1]} films`,
        kind: 'genre',
      });
    }
    if (s.topDir) {
      slides.push({
        title: s.topDir[0],
        subtitle: `most-watched auteur · ${s.topDir[1]} films`,
        kind: 'director',
      });
    }
    if (s.topDecade) {
      slides.push({
        title: `'${(s.topDecade[0] % 100).toString().padStart(2, '0')}s`,
        subtitle: `your favourite decade · ${s.topDecade[1]} films`,
        kind: 'decade',
      });
    }
    if (s.best) {
      slides.push({
        title: s.best.title,
        subtitle: `your highest rated · ${UI.formatRating(s.best.rating)}/10`,
        kind: 'movie',
        movie: s.best,
      });
    }
    if (s.hiddenGems.length) {
      slides.push({
        title: s.hiddenGems[0].title,
        subtitle: `hidden gem of the year`,
        kind: 'movie',
        movie: s.hiddenGems[0],
      });
    }
    if (s.rewatched.length) {
      slides.push({
        title: s.rewatched[0].title,
        subtitle: `most rewatched · ${s.rewatched[0].rewatches}× rewound`,
        kind: 'movie',
        movie: s.rewatched[0],
      });
    }
    slides.push({
      title: 'THE END',
      subtitle: `until next year`,
      kind: 'outro',
    });
    return slides;
  }

  function openYearInReview(allMovies, year) {
    if (document.getElementById('yir-modal')) return;
    const stats = computeYearInReview(allMovies, year);
    if (stats.totalCount === 0) {
      UI.showToast(`No films logged in ${year} yet`);
      return;
    }
    const slides = renderYearInReviewSlides(stats);

    const modal = document.createElement('div');
    modal.id = 'yir-modal';
    modal.className = 'yir-modal';
    modal.innerHTML = `
      <div class="yir-progress">
        ${slides.map((_, i) => `<div class="yir-progress-seg" data-idx="${i}"><div class="yir-progress-fill"></div></div>`).join('')}
      </div>
      <button class="yir-close" aria-label="Close">&times;</button>
      <div class="yir-stage" id="yir-stage"></div>
      <div class="yir-tap-zones">
        <div class="yir-tap-prev"></div>
        <div class="yir-tap-next"></div>
      </div>
    `;
    document.body.appendChild(modal);

    let idx = 0;
    const SLIDE_MS = 3800;
    let timer = null;

    function showSlide(i) {
      idx = i;
      const slide = slides[i];
      const stage = document.getElementById('yir-stage');
      const movie = slide.movie;
      const backdrop = movie?.backdrop || movie?.poster || '';
      stage.innerHTML = `
        <div class="yir-slide yir-slide--${slide.kind}">
          ${backdrop ? `<img src="${backdrop}" class="yir-slide-bg" alt="">` : ''}
          <div class="yir-slide-content">
            <div class="yir-slide-subtitle">${UI.escapeHtml(slide.subtitle || '')}</div>
            <div class="yir-slide-title">${UI.escapeHtml(slide.title || '')}</div>
          </div>
        </div>`;
      modal.querySelectorAll('.yir-progress-seg').forEach((seg, j) => {
        const fill = seg.querySelector('.yir-progress-fill');
        if (j < i) { fill.style.width = '100%'; fill.style.transition = 'none'; }
        else if (j === i) {
          fill.style.transition = 'none';
          fill.style.width = '0%';
          fill.offsetWidth;
          fill.style.transition = `width ${SLIDE_MS}ms linear`;
          fill.style.width = '100%';
        } else { fill.style.width = '0%'; fill.style.transition = 'none'; }
      });
      haptic(6);
      clearTimeout(timer);
      timer = setTimeout(next, SLIDE_MS);
    }
    function next() {
      if (idx < slides.length - 1) showSlide(idx + 1);
      else close();
    }
    function prev() { showSlide(Math.max(0, idx - 1)); }
    function close() {
      clearTimeout(timer);
      modal.classList.add('yir-modal--out');
      setTimeout(() => modal.remove(), 250);
    }

    modal.querySelector('.yir-close').addEventListener('click', close);
    modal.querySelector('.yir-tap-prev').addEventListener('click', prev);
    modal.querySelector('.yir-tap-next').addEventListener('click', next);
    document.addEventListener('keydown', function onKey(e) {
      if (!document.getElementById('yir-modal')) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    });

    showSlide(0);
  }

  async function fetchSimilarSuggestions(movieTitle, tmdbId) {
    try {
      const [recs, allMovies] = await Promise.all([
        TMDB.getMovieRecommendations(tmdbId),
        MovieDB.getAllMovies(),
      ]);
      const ownedIds = new Set(allMovies.map(m => String(m.tmdbId)));
      const filtered = recs.filter(r => !ownedIds.has(String(r.id))).slice(0, 8);
      if (filtered.length >= 3) {
        pendingSuggestions = { movieTitle, results: filtered };
        localStorage.setItem('savedSuggestions', JSON.stringify(pendingSuggestions)); // Saves them!
        // If the user is already on catalogue when the fetch completes, inject directly
        if (currentView === 'catalogue') renderSuggestionsInPlace();
      }
    } catch (_) {}
  }

  function renderSuggestionsInPlace() {
    const sugWrap = document.getElementById('suggestions-wrap');
    if (!sugWrap || !pendingSuggestions) return;
    sugWrap.innerHTML = UI.renderSuggestionsPanel(pendingSuggestions.movieTitle, pendingSuggestions.results);
    sugWrap.querySelector('.suggestions-dismiss').addEventListener('click', () => {
      pendingSuggestions = null;
      localStorage.removeItem('savedSuggestions'); // Clears the save when dismissed
      sugWrap.innerHTML = '';
    });
    sugWrap.querySelectorAll('.suggestion-wl-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        addToWatchlist(parseInt(btn.dataset.tmdbId));
        btn.textContent = '✓';
        btn.disabled = true;
      });
    });
    sugWrap.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.classList.contains('suggestion-wl-btn')) return;
        selectSearchResult(parseInt(item.dataset.tmdbId));
        showView('add');
      });
    });
  }

  async function randomPick() {
    const allMovies = (await MovieDB.getAllMovies()).filter(m => m.watchlist);
    if (allMovies.length === 0) { UI.showToast('Watchlist is empty!'); return; }
    if (allMovies.length === 1) {
      window.location.hash = `#detail/${allMovies[0].id}`;
      return;
    }

    const genreCounts = new Map();
    allMovies.forEach(m => (m.genres || []).forEach(g => {
      genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
    }));
    const genres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    // Duration slider bounds — derived from the actual watchlist runtimes.
    const knownRuntimes = allMovies.filter(m => m.runtime).map(m => m.runtime);
    const hasRuntimes = knownRuntimes.length > 0;
    const minRun = hasRuntimes ? Math.max(30, Math.floor(Math.min(...knownRuntimes) / 5) * 5) : 60;
    const maxRun = hasRuntimes ? Math.ceil(Math.max(...knownRuntimes) / 5) * 5 : 240;
    const showSlider = hasRuntimes && maxRun - minRun >= 15;

    const state = { selectedGenres: new Set(), maxDuration: 0 };

    const escape = UI.escapeHtml;
    const genreChipsHtml = genres.map(([g, c]) => {
      const accent = UI.getGenreAccent(g);
      const style = accent ? ` style="--g:${accent}"` : '';
      return `<button class="rp-chip rp-genre-chip" data-genre="${escape(g)}"${style}>${escape(g)}<span class="rp-chip-count">${c}</span></button>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'random-pick-overlay';
    overlay.innerHTML = `
      <div class="random-pick-sheet">
        <button class="rp-close" aria-label="Close">&times;</button>
        <h3 class="rp-title">&#127922; Roll from watchlist</h3>
        <div class="rp-section">
          <div class="rp-section-head">
            <span class="rp-section-label">Genres</span>
            <button class="rp-clear-btn" id="rp-clear-genres" type="button">Clear</button>
          </div>
          <div class="rp-chips">${genreChipsHtml}</div>
        </div>
        ${showSlider ? `
        <div class="rp-section">
          <div class="rp-section-head">
            <span class="rp-section-label">Max length</span>
            <span class="rp-duration-value" id="rp-duration-value">Any length</span>
          </div>
          <input type="range" class="rp-slider" id="rp-duration-slider" min="${minRun}" max="${maxRun}" step="5" value="${maxRun}">
          <div class="rp-slider-range">
            <span>${fmtDur(minRun)}</span>
            <span>${fmtDur(maxRun)}</span>
          </div>
        </div>` : ''}
        <div class="rp-footer">
          <div class="rp-count" id="rp-count">${allMovies.length} films match</div>
          <button class="btn btn-primary rp-roll-btn" id="rp-roll-btn">Roll &#127922;</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const close = () => {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 260);
    };

    const computePool = () => allMovies.filter(m => {
      if (state.selectedGenres.size > 0) {
        const mg = m.genres || [];
        if (!mg.some(g => state.selectedGenres.has(g))) return false;
      }
      if (state.maxDuration > 0) {
        if (!m.runtime || m.runtime > state.maxDuration) return false;
      }
      return true;
    });

    const countEl = overlay.querySelector('#rp-count');
    const rollBtn = overlay.querySelector('#rp-roll-btn');
    const updateCount = () => {
      const pool = computePool();
      countEl.textContent = `${pool.length} film${pool.length === 1 ? '' : 's'} match`;
      rollBtn.disabled = pool.length === 0;
      rollBtn.classList.toggle('rp-roll-btn--disabled', pool.length === 0);
    };

    overlay.querySelector('.rp-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelectorAll('.rp-genre-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = btn.dataset.genre;
        if (state.selectedGenres.has(g)) {
          state.selectedGenres.delete(g);
          btn.classList.remove('rp-chip--active');
        } else {
          state.selectedGenres.add(g);
          btn.classList.add('rp-chip--active');
        }
        updateCount();
      });
    });

    overlay.querySelector('#rp-clear-genres').addEventListener('click', () => {
      state.selectedGenres.clear();
      overlay.querySelectorAll('.rp-genre-chip').forEach(b => b.classList.remove('rp-chip--active'));
      updateCount();
    });

    const slider = overlay.querySelector('#rp-duration-slider');
    const durValue = overlay.querySelector('#rp-duration-value');
    if (slider && durValue) {
      const syncSlider = () => {
        const v = parseInt(slider.value, 10);
        const atMax = v >= maxRun;
        state.maxDuration = atMax ? 0 : v;
        durValue.textContent = atMax ? 'Any length' : `Under ${fmtDur(v)}`;
        durValue.classList.toggle('rp-duration-value--active', !atMax);
        const pct = ((v - minRun) / (maxRun - minRun)) * 100;
        slider.style.setProperty('--fill', `${pct}%`);
      };
      slider.addEventListener('input', () => { syncSlider(); updateCount(); });
      syncSlider();
    }

    overlay.querySelector('#rp-roll-btn').addEventListener('click', () => {
      const pool = computePool();
      if (pool.length === 0) return;
      const label = buildRollLabel(state);
      close();
      setTimeout(() => rollWatchlistPick(pool, label), 300);
    });
  }

  function buildRollLabel(state) {
    const parts = [];
    if (state.selectedGenres.size > 0) {
      const gs = [...state.selectedGenres];
      parts.push(gs.length <= 2 ? gs.join(' / ') : `${gs.length} genres`);
    }
    if (state.maxDuration > 0) {
      parts.push(`under ${fmtDur(state.maxDuration)}`);
    }
    return parts.join(' · ');
  }

  function fmtDur(m) {
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r === 0 ? `${h}h` : `${h}h ${r}m`;
  }

  async function rollWatchlistPick(pool, genreLabel) {
    if (pool.length === 0) { UI.showToast('No films match that genre'); return; }
    // Deduplicate by tmdbId so a film accidentally added twice doesn't get double probability
    const seen = new Set();
    const deduped = pool.filter(m => {
      const key = m.tmdbId || m.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (deduped.length === 1) {
      recentPickIds = [deduped[0].id];
      window.location.hash = `#detail/${deduped[0].id}`;
      return;
    }

    // Exclude the last 3 picks when possible so the same film can't dominate a short session
    const RECENT_WINDOW = Math.min(3, Math.floor(deduped.length / 2));
    const pickPool = recentPickIds.length > 0
      ? deduped.filter(m => !recentPickIds.includes(m.id))
      : deduped;
    const effectivePool = pickPool.length > 0 ? pickPool : deduped;
    const winner = effectivePool[Math.floor(Math.random() * effectivePool.length)];
    recentPickIds = [winner.id, ...recentPickIds].slice(0, RECENT_WINDOW);
    const poolIds = new Set(pool.map(m => m.id));

    // If library mode, do slot-machine animation through matching cases
    if (watchlistViewMode === 'library') {
      const allCases = [...document.querySelectorAll('#watchlist-grid .bluray-case')];
      const cases = allCases.filter(c => poolIds.has(parseInt(c.dataset.id)));
      const winnerCase = cases.find(c => parseInt(c.dataset.id) === winner.id);
      if (winnerCase && cases.length > 1) {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const totalFlashes = 24 + (cases.length < 8 ? cases.length * 3 : cases.length);
        let cur = Math.floor(Math.random() * cases.length);

        for (let i = 0; i < totalFlashes; i++) {
          cases.forEach(c => c.classList.remove('case-pick-highlight'));
          if (i >= totalFlashes - cases.length) {
            const winIdx = cases.indexOf(winnerCase);
            const remaining = totalFlashes - i;
            cur = (winIdx - remaining + cases.length * 100) % cases.length;
          }
          cases[cur % cases.length].classList.add('case-pick-highlight');
          cur++;
          const progress = i / totalFlashes;
          const delay = 40 + Math.pow(progress, 1.8) * 380;
          await wait(delay);
        }

        cases.forEach(c => c.classList.remove('case-pick-highlight'));
        winnerCase.classList.add('case-pick-highlight');
        winnerCase.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await wait(600);
        winnerCase.classList.remove('case-pick-highlight');
        extractBluray(winnerCase, winner);
        return;
      }
    }

    const toastPrefix = genreLabel ? `\u{1F3B2} ${genreLabel}: ` : '\u{1F3B2} Picked: ';
    UI.showToast(`${toastPrefix}${winner.title}`);
    setTimeout(() => { window.location.hash = `#detail/${winner.id}`; }, 800);
  }

  // --- Inventory ---

  let inventoryQueue = [];
  let inventoryIndex = 0;

  async function loadInventory() {
    const all = (await MovieDB.getAllMovies()).filter(m => !m.watchlist);
    const content = document.getElementById('inventory-content');
    if (all.length === 0) {
      content.innerHTML = '<p class="inventory-empty">Your catalogue is empty. Add some films first.</p>';
      document.getElementById('inventory-progress').textContent = '';
      return;
    }

    const valid = new Set(all.map(m => m.id));
    inventoryQueue = inventoryQueue.filter(id => valid.has(id));
    if (inventoryQueue.length === 0) {
      inventoryQueue = shuffle(all.map(m => m.id));
      inventoryIndex = 0;
    }
    if (inventoryIndex >= inventoryQueue.length) inventoryIndex = 0;

    renderInventory(all);
  }

  function renderInventory(allMovies) {
    const focusId = inventoryQueue[inventoryIndex];
    const focus = allMovies.find(m => m.id === focusId);
    if (!focus) return;

    const focusGenres = new Set(focus.genres || []);
    const others = allMovies.filter(m => m.id !== focus.id);
    const sameGenre = others.filter(m => (m.genres || []).some(g => focusGenres.has(g)));
    const candidates = sameGenre.length > 0 ? sameGenre : others;

    const focusRating = focus.rating || 5;
    const neighbors = candidates
      .map(m => ({ m, d: Math.abs((m.rating || focusRating) - focusRating) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map(x => x.m);

    const progress = document.getElementById('inventory-progress');
    progress.textContent = `${inventoryIndex + 1} / ${inventoryQueue.length}`;

    const content = document.getElementById('inventory-content');
    content.innerHTML = `
      <div class="inventory-focus">${renderInventoryItem(focus, true)}</div>
      ${neighbors.length > 0 ? `
        <div class="inventory-neighbors-label">Compare with</div>
        <div class="inventory-neighbors">
          ${neighbors.map(m => renderInventoryItem(m, false)).join('')}
        </div>
      ` : ''}
    `;

    content.querySelectorAll('.inv-slider').forEach(slider => {
      const id = parseInt(slider.dataset.id, 10);
      const item = slider.closest('.inventory-item');
      const valueEl = item.querySelector('.inv-rating-value');
      const paint = () => {
        const v = parseFloat(slider.value);
        const color = UI.ratingColor(v);
        valueEl.textContent = UI.formatRating(v);
        valueEl.style.color = color;
        const pct = ((v - 1) / 9) * 100;
        slider.style.background = `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, var(--star-empty) ${pct}%, var(--star-empty) 100%)`;
      };
      paint();
      slider.addEventListener('input', paint);
      slider.addEventListener('change', async () => {
        const v = parseFloat(slider.value);
        await updateInventoryRating(id, v);
      });
    });

    content.querySelectorAll('.inv-clear').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        await updateInventoryRating(id, 0);
        const fresh = (await MovieDB.getAllMovies()).filter(m => !m.watchlist);
        renderInventory(fresh);
      });
    });

    content.querySelectorAll('.inv-poster').forEach(el => {
      el.addEventListener('click', () => {
        window.location.hash = `#detail/${el.dataset.id}`;
      });
    });
  }

  function renderInventoryItem(movie, isFocus) {
    const escape = UI.escapeHtml;
    const r = movie.rating || 0;
    const sliderVal = r > 0 ? r : 5;
    const valDisplay = r > 0 ? UI.formatRating(r) : '-';
    const valColor = r > 0 ? UI.ratingColor(r) : '';
    const poster = movie.poster
      ? `<img src="${movie.poster}" alt="" class="inv-poster" data-id="${movie.id}" loading="lazy">`
      : `<div class="inv-poster inv-poster-empty" data-id="${movie.id}"></div>`;
    return `
      <div class="inventory-item${isFocus ? ' inventory-item--focus' : ''}" data-id="${movie.id}">
        ${poster}
        <div class="inv-body">
          <div class="inv-title">${escape(movie.title)}</div>
          <div class="inv-meta">${escape(movie.year || '')}${movie.directors && movie.directors.length ? ' &middot; ' + escape(movie.directors[0]) : ''}</div>
          <div class="inv-rating">
            <span class="inv-rating-value" style="color:${valColor}">${valDisplay}</span>
            <span class="inv-rating-max">/10</span>
          </div>
          <input type="range" class="inv-slider rating-slider" min="1" max="10" step="0.1" value="${sliderVal}" data-id="${movie.id}">
          ${r > 0 ? `<button class="btn-link inv-clear" data-id="${movie.id}">Clear rating</button>` : ''}
        </div>
      </div>
    `;
  }

  async function updateInventoryRating(id, rating) {
    const movie = await MovieDB.getMovie(id);
    if (!movie) return;
    movie.rating = rating > 0 ? Math.round(rating * 10) / 10 : 0;
    await MovieDB.updateMovie(movie);
  }

  function inventoryNext() {
    if (inventoryQueue.length === 0) return;
    inventoryIndex = (inventoryIndex + 1) % inventoryQueue.length;
    loadInventory();
  }

  function inventoryPrev() {
    if (inventoryQueue.length === 0) return;
    inventoryIndex = (inventoryIndex - 1 + inventoryQueue.length) % inventoryQueue.length;
    loadInventory();
  }

  function inventoryReshuffle() {
    inventoryQueue = [];
    inventoryIndex = 0;
    loadInventory();
  }

  // --- Stats ---

  async function loadStats() {
    const allMovies = await MovieDB.getAllMovies();
    const movies = allMovies.filter(m => !m.watchlist);
    const stats = Stats.compute(movies);
    const container = document.getElementById('stats-container');
    const currentYear = new Date().getFullYear();
    const yirBanner = `
      <button class="yir-launch-btn" id="yir-launch" type="button">
        <span class="yir-launch-icon">&#127916;</span>
        <span class="yir-launch-text">
          <span class="yir-launch-title">${currentYear} · Year in Review</span>
          <span class="yir-launch-sub">A Wrapped-style retrospective of your year in cinema</span>
        </span>
        <span class="yir-launch-arrow">&#10095;</span>
      </button>`;
    container.innerHTML = yirBanner + Stats.render(stats);
    animateCounters(container);
    loadDirectorMarathons(allMovies);

    const yirBtn = document.getElementById('yir-launch');
    if (yirBtn) {
      yirBtn.addEventListener('click', () => {
        haptic(15);
        openYearInReview(allMovies, currentYear);
      });
    }
  }

  // ---- Complete the Director: filmography lanes for favorite directors ----
  const DIR_FILMO_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  const DIR_FILMO_CACHE_VER = 'v3'; // bump to invalidate old caches
  const DIR_FAV_RATING = 8;

  function findFavoriteDirectors(movies) {
    const counts = new Map(); // director -> {films: Set<tmdbId>, highCount: number}
    for (const m of movies) {
      if (m.watchlist) continue;
      for (const d of (m.directors || [])) {
        if (!counts.has(d)) counts.set(d, { films: new Set(), highCount: 0 });
        const entry = counts.get(d);
        entry.films.add(String(m.tmdbId));
        if ((m.rating || 0) >= DIR_FAV_RATING) entry.highCount++;
      }
    }
    return [...counts.entries()]
      .filter(([, info]) => info.highCount >= 2)
      .sort((a, b) => b[1].highCount - a[1].highCount)
      .map(([name, info]) => ({ name, ownedTmdbIds: info.films, highCount: info.highCount }));
  }

  async function getDirectorFilmography(name) {
    const cacheKey = `dirFilmo_${DIR_FILMO_CACHE_VER}:${name}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && Date.now() - cached.t < DIR_FILMO_CACHE_TTL) return cached.data;
    } catch (_) {}
    try {
      const persons = await TMDB.searchPerson(name);
      const person = (persons || []).find(p => p.known_for_department === 'Directing') || (persons || [])[0];
      if (!person) return null;
      const credits = await TMDB.getPersonMovieCredits(person.id);
      // Filter to director credits only, deduplicate by id, require ≥500 votes
      // (shorts, behind-the-scenes, and featurettes rarely exceed this threshold)
      const seen = new Set();
      const directed = (credits.crew || [])
        .filter(c => c.job === 'Director' && c.id && !seen.has(c.id) && seen.add(c.id))
        .filter(c => (c.vote_count || 0) >= 500 && c.release_date && c.title);
      const data = {
        personId: person.id,
        profileUrl: person.profile_path ? TMDB.profileUrl(person.profile_path) : '',
        films: directed.map(f => ({
          id: f.id,
          title: f.title,
          year: f.release_date ? f.release_date.slice(0, 4) : '',
          poster: f.poster_path ? TMDB.posterUrl(f.poster_path, 'w154') : '',
          voteCount: f.vote_count || 0,
          voteAverage: f.vote_average || 0,
          releaseDate: f.release_date || '',
        })),
      };
      try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), data })); } catch (_) {}
      return data;
    } catch (_) { return null; }
  }

  async function loadDirectorMarathons(allMovies) {
    const wrap = document.getElementById('director-marathons-wrap');
    if (!wrap) return;
    const favorites = findFavoriteDirectors(allMovies);
    if (favorites.length === 0) { wrap.innerHTML = ''; return; }

    const ownedAll = new Set(allMovies.filter(m => !m.watchlist).map(m => String(m.tmdbId)));
    const onWatchlist = new Set(allMovies.filter(m => m.watchlist).map(m => String(m.tmdbId)));
    wrap.innerHTML = `<div class="director-marathons">
      <div class="dm-section-label"><span class="dm-icon">&#127916;</span> Complete the Director</div>
      <div class="dm-section-sub">Films from auteurs you've rated highly</div>
      <div class="dm-list" id="dm-list"><div class="dm-loading">Loading filmographies…</div></div>
    </div>`;

    const list = wrap.querySelector('#dm-list');
    list.innerHTML = '';

    // Track which favorites indices are currently occupying a slot
    const shownSet = new Set();

    function buildDirectorEl(fav, filmo, favIndex) {
      const now = new Date();
      const released = filmo.films.filter(f => f.releaseDate && new Date(f.releaseDate) <= now);
      const total = released.length;
      const owned = released.filter(f => ownedAll.has(String(f.id))).length;
      const unwatched = released
        .filter(f => !ownedAll.has(String(f.id)))
        .sort((a, b) => (b.voteAverage * Math.log10(b.voteCount + 10)) - (a.voteAverage * Math.log10(a.voteCount + 10)))
        .slice(0, 12);
      if (unwatched.length === 0) return null;

      const photoHtml = filmo.profileUrl
        ? `<img src="${filmo.profileUrl}" alt="${UI.escapeHtml(fav.name)}" class="dm-photo">`
        : `<div class="dm-photo dm-photo-placeholder">${UI.escapeHtml(fav.name).split(' ').map(w => w[0]).join('').slice(0, 2)}</div>`;

      const filmsHtml = unwatched.map(f => {
        const alreadyQueued = onWatchlist.has(String(f.id));
        const btn = alreadyQueued
          ? `<button class="dm-add-btn dm-add-btn--added" data-tmdb-id="${f.id}" type="button" disabled>&#10003; Added</button>`
          : `<button class="dm-add-btn" data-tmdb-id="${f.id}" type="button">+ Watchlist</button>`;
        return `
        <div class="dm-film" data-tmdb-id="${f.id}">
          ${f.poster
            ? `<img src="${f.poster}" class="dm-film-poster" alt="${UI.escapeHtml(f.title)}" loading="lazy">`
            : `<div class="dm-film-poster dm-film-poster-empty"></div>`}
          <div class="dm-film-title">${UI.escapeHtml(f.title)}</div>
          <div class="dm-film-year">${f.year || ''}</div>
          ${btn}
        </div>`;
      }).join('');

      const dirEl = document.createElement('div');
      dirEl.className = 'dm-director';
      dirEl.dataset.favIndex = favIndex;
      dirEl.innerHTML = `
        <div class="dm-header">
          ${photoHtml}
          <div class="dm-meta">
            <div class="dm-name-row">
              <div class="dm-name">${UI.escapeHtml(fav.name)}</div>
              <button class="dm-refresh-btn" title="Show another director" type="button">&#8635;</button>
            </div>
            <div class="dm-progress-row">
              <div class="dm-progress-bar"><div class="dm-progress-fill" style="width:${(owned / Math.max(total, 1)) * 100}%"></div></div>
              <div class="dm-progress-text">${owned}/${total} watched</div>
            </div>
          </div>
        </div>
        <div class="dm-films-scroll">${filmsHtml}</div>
      `;
      return dirEl;
    }

    function attachCardListeners(dirEl) {
      dirEl.querySelectorAll('.dm-add-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.tmdbId);
          haptic(10);
          btn.disabled = true;
          btn.textContent = 'Adding…';
          try {
            await addToWatchlist(id);
            btn.textContent = '✓ Added';
            btn.classList.add('dm-add-btn--added');
            const card = btn.closest('.dm-film');
            if (card) setTimeout(() => card.remove(), 500);
          } catch (_) {
            btn.disabled = false;
            btn.textContent = '+ Watchlist';
          }
        });
      });
      dirEl.querySelectorAll('.dm-film').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.dm-add-btn')) return;
          const id = parseInt(card.dataset.tmdbId);
          window.location.hash = '#add';
          setTimeout(() => {
            const input = document.getElementById('tmdb-search');
            if (input) {
              input.value = `https://www.themoviedb.org/movie/${id}`;
              document.getElementById('tmdb-search-btn').click();
            }
          }, 80);
        });
      });

      const refreshBtn = dirEl.querySelector('.dm-refresh-btn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          haptic(10);
          const currentIndex = parseInt(dirEl.dataset.favIndex);
          refreshBtn.classList.add('dm-refresh-btn--spinning');
          refreshBtn.disabled = true;
          let nextEl = null;
          let nextIndex = (currentIndex + 1) % favorites.length;
          for (let attempts = 0; attempts < favorites.length; attempts++) {
            if (!shownSet.has(nextIndex)) {
              const filmo = await getDirectorFilmography(favorites[nextIndex].name);
              if (filmo && filmo.films) {
                nextEl = buildDirectorEl(favorites[nextIndex], filmo, nextIndex);
              }
              if (nextEl) break;
            }
            nextIndex = (nextIndex + 1) % favorites.length;
          }
          refreshBtn.classList.remove('dm-refresh-btn--spinning');
          if (!nextEl) {
            refreshBtn.disabled = true;
            refreshBtn.title = 'No more candidates';
            return;
          }
          shownSet.delete(currentIndex);
          shownSet.add(nextIndex);
          attachCardListeners(nextEl);
          dirEl.replaceWith(nextEl);
        });
      }
    }

    let loaded = 0;
    for (let i = 0; i < favorites.length && loaded < 3; i++) {
      const filmo = await getDirectorFilmography(favorites[i].name);
      if (!filmo || !filmo.films) continue;
      const dirEl = buildDirectorEl(favorites[i], filmo, i);
      if (!dirEl) continue;
      shownSet.add(i);
      attachCardListeners(dirEl);
      list.appendChild(dirEl);
      loaded++;
    }

    if (!list.children.length) wrap.innerHTML = '';
  }

  function animateCounters(container) {
    container.querySelectorAll('[data-count]').forEach(el => {
      const target = parseFloat(el.dataset.count);
      const isFloat = el.dataset.count.includes('.');
      const duration = 700;
      const start = performance.now();
      function step(now) {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = isFloat ? (target * eased).toFixed(1) : Math.floor(target * eased);
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = el.dataset.count;
      }
      requestAnimationFrame(step);
    });
  }

  async function updateWatchlistBadge() {
    const movies = await MovieDB.getAllMovies();
    const count = movies.filter(m => m.watchlist).length;
    const badge = document.getElementById('watchlist-nav-badge');
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  function spawnStarBurst(triggerEl) {
    const rect = triggerEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colors = ['#f5c518', '#f5c518', '#fff', '#e94560', '#7c5cfc', '#f5c518'];
    for (let i = 0; i < 10; i++) {
      const p = document.createElement('span');
      p.className = 'star-burst-particle';
      const angle = (i / 10) * 2 * Math.PI;
      const dist = 28 + Math.random() * 26;
      const size = 4 + Math.random() * 5;
      p.style.cssText = `left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;background:${colors[i % colors.length]};--dx:${(Math.cos(angle) * dist).toFixed(1)}px;--dy:${(Math.sin(angle) * dist).toFixed(1)}px;animation-duration:${(0.45 + Math.random() * 0.2).toFixed(2)}s;`;
      document.body.appendChild(p);
      p.addEventListener('animationend', () => p.remove(), { once: true });
    }
  }

  function spawnConfetti() {
    const colors = ['#f5c518', '#e94560', '#7c5cfc', '#21d07a', '#fff', '#ff6b35', '#00d4ff'];
    const shapes = ['square', 'rect', 'circle'];
    const vw = window.innerWidth;
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('span');
      p.className = 'confetti-particle';
      const color = colors[Math.floor(Math.random() * colors.length)];
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      const x = Math.random() * vw;
      const drift = (Math.random() - 0.5) * 160;
      const size = shape === 'rect' ? `width:${4 + Math.random() * 4}px;height:${8 + Math.random() * 8}px;` :
                   shape === 'circle' ? `width:${5 + Math.random() * 5}px;height:${5 + Math.random() * 5}px;border-radius:50%;` :
                   `width:${5 + Math.random() * 5}px;height:${5 + Math.random() * 5}px;`;
      const dur = 1.2 + Math.random() * 1.8;
      const delay = Math.random() * 0.6;
      const spin = (Math.random() - 0.5) * 720;
      p.style.cssText = `left:${x}px;top:-12px;${size}background:${color};--drift:${drift}px;--spin:${spin}deg;animation-duration:${dur}s;animation-delay:${delay}s;`;
      document.body.appendChild(p);
      p.addEventListener('animationend', () => p.remove(), { once: true });
    }
  }

  // --- Event Listeners ---

  function setupEventListeners() {
    document.getElementById('tmdb-search-btn').addEventListener('click', () => {
      if (searchMode === 'director') searchDirector();
      else if (searchMode === 'actor') searchActor();
      else searchTMDB();
    });
    document.getElementById('tmdb-search').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); acMoveFocus(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acMoveFocus(-1); return; }
      if (e.key === 'Escape') { closeAutocomplete(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (acFocusIdx >= 0 && acResults[acFocusIdx]) {
          const r = acResults[acFocusIdx];
          closeAutocomplete();
          selectSearchResult(r.id);
        } else if (searchMode === 'director') {
          searchDirector();
        } else if (searchMode === 'actor') {
          searchActor();
        } else {
          searchTMDB();
        }
      }
    });
    document.getElementById('tmdb-search').addEventListener('input', () => {
      if (searchMode === 'director' || searchMode === 'actor') { closeAutocomplete(); return; }
      clearTimeout(acDebounce);
      const q = document.getElementById('tmdb-search').value.trim();
      if (q.length < 2) { closeAutocomplete(); return; }
      acDebounce = setTimeout(() => fetchAutocomplete(q), 300);
    });
    document.getElementById('tmdb-search').addEventListener('blur', () => {
      setTimeout(closeAutocomplete, 150);
    });
    document.getElementById('search-autocomplete').addEventListener('mousedown', (e) => {
      const item = e.target.closest('.search-autocomplete-item');
      if (!item) return;
      const r = acResults[parseInt(item.dataset.idx)];
      if (r) { closeAutocomplete(); selectSearchResult(r.id); }
    });

    document.getElementById('search-mode-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.smt-btn');
      if (!btn || btn.classList.contains('active')) return;
      searchMode = btn.dataset.mode;
      document.querySelectorAll('.smt-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === searchMode)
      );
      document.getElementById('tmdb-search').value = '';
      document.getElementById('search-results').innerHTML = '';
      document.getElementById('movie-form').style.display = 'none';
      const fn = document.getElementById('filmography-nav');
      fn.style.display = 'none'; fn.innerHTML = '';
      editingMovie = null;
      selectedDirectorName = '';
      currentFilmography = null;
      closeAutocomplete();
      document.getElementById('tmdb-search').placeholder =
        searchMode === 'director' ? 'Search for a director...' :
        searchMode === 'actor' ? 'Search for an actor...' :
        'Search or paste a themoviedb.org URL...';
      document.getElementById('tmdb-search').focus();
    });

    document.getElementById('search-results').addEventListener('click', (e) => {
      const watchlistBtn = e.target.closest('.search-result-watchlist-btn');
      if (watchlistBtn) {
        e.stopPropagation();
        addToWatchlist(parseInt(watchlistBtn.dataset.tmdbId));
        return;
      }
      const personResult = e.target.closest('.search-result[data-person-id]');
      if (personResult) {
        const name = personResult.querySelector('h4').textContent;
        if (searchMode === 'actor') {
          loadActorFilmography(parseInt(personResult.dataset.personId), name);
        } else {
          loadFilmography(parseInt(personResult.dataset.personId), name);
        }
        return;
      }
      const result = e.target.closest('.search-result[data-tmdb-id]');
      if (result) selectSearchResult(parseInt(result.dataset.tmdbId));
    });

    document.getElementById('watchlist-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('.watchlist-card-btn');
      if (btn) {
        e.stopPropagation();
        markAsWatched(parseInt(btn.dataset.id));
        return;
      }
      const card = e.target.closest('.movie-card');
      if (card) window.location.hash = `#detail/${card.dataset.id}`;
    });

    let sliderWasTen = false;
    let lastTickRating = -1;
    document.getElementById('rating-slider').addEventListener('input', (e) => {
      const v = parseFloat(parseFloat(e.target.value).toFixed(1));
      const tick = Math.round(v);
      if (tick !== lastTickRating) { haptic(5); lastTickRating = tick; }
      selectedRating = v;
      updateRatingDisplay();
    });
    document.getElementById('rating-slider').addEventListener('change', (e) => {
      const val = parseFloat(parseFloat(e.target.value).toFixed(1));
      if (val === 10 && !sliderWasTen) { spawnStarBurst(document.getElementById('rating-display-value')); haptic([20, 40, 60]); }
      sliderWasTen = val === 10;
    });
    document.getElementById('rating-clear').addEventListener('click', () => {
      selectedRating = 0;
      updateRatingDisplay();
    });

    document.getElementById('movie-form').addEventListener('submit', saveMovie);
    document.getElementById('form-watchlist-btn').addEventListener('click', () => {
      const tmdbId = parseInt(document.getElementById('form-tmdb-id').value);
      if (tmdbId) {
        addToWatchlist(tmdbId);
        document.getElementById('movie-form').style.display = 'none';
        editingMovie = null;
        if (currentFilmography) {
          const { personId, personName, mode } = currentFilmography;
          if (mode === 'actor') loadActorFilmography(personId, personName);
          else loadFilmography(personId, personName);
        }
      }
    });
    document.getElementById('form-cancel').addEventListener('click', () => {
      document.getElementById('movie-form').style.display = 'none';
      editingMovie = null;
      if (currentFilmography) {
        const { personId, personName, mode } = currentFilmography;
        if (mode === 'actor') loadActorFilmography(personId, personName);
        else loadFilmography(personId, personName);
      }
    });

    document.getElementById('movie-grid').addEventListener('click', async (e) => {
      const reshuffleBtn = e.target.closest('.decade-reshuffle-btn');
      if (reshuffleBtn) {
        e.stopPropagation();
        UI.reshuffleDecade(reshuffleBtn.dataset.decade);
        loadCatalogue();
        return;
      }

      const downloadBtn = e.target.closest('.decade-download-btn');
      if (downloadBtn) {
        e.stopPropagation();
        const btnOriginalText = downloadBtn.innerHTML;
        downloadBtn.innerHTML = 'Saving...';
        downloadBtn.style.opacity = '0.6';
        downloadBtn.style.pointerEvents = 'none';

        try {
          if (!window.html2canvas) {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            document.head.appendChild(script);
            await new Promise(r => script.onload = r);
          }

          const originalContainer = downloadBtn.closest('.decade-section').querySelector('.decade-mosaic');
          const clone = originalContainer.cloneNode(true);
          
          const rect = originalContainer.getBoundingClientRect();
          clone.style.position = 'absolute';
          clone.style.top = '-9999px'; 
          clone.style.left = '0';
          clone.style.width = rect.width + 'px'; 
          clone.style.height = rect.height + 'px';
          document.body.appendChild(clone);

          // Remove the ratings completely so they don't appear in the download
          const ratings = clone.querySelectorAll('.mosaic-rating, .poster-rating, .rating-badge'); 
          ratings.forEach(r => r.remove());

          // Convert images directly to Base64 to bypass all Canvas CORS constraints
          const images = clone.querySelectorAll('img');
          const imagePromises = Array.from(images).map(async (img) => {
            // FORCE VISIBILITY: Overrides any lazy-load CSS hiding the clone's posters
            img.style.opacity = '1';
            img.style.visibility = 'visible';
            img.classList.add('loaded');

            if (img.src && img.src.startsWith('http')) {
              try {
                // CACHE BUSTER: Forces the browser to ignore its tainted cache and ask for fresh permissions
                const url = new URL(img.src);
                url.searchParams.append('nocache', Date.now());
                const res = await fetch(url.toString(), { cache: 'no-store' });
                const blob = await res.blob();
                const base64 = await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result);
                  reader.readAsDataURL(blob);
                });
                img.src = base64; 
              } catch (err) {
                console.error('Failed to convert image to base64', err);
              }
            }
          });

          await Promise.all(imagePromises);
          
          // Let the Base64 images settle
          await new Promise(r => setTimeout(r, 150));

          const canvas = await html2canvas(clone, {
            useCORS: true,
            backgroundColor: '#0a0a14', 
            scale: 2,
            width: rect.width,
            height: rect.height
          });

          clone.remove(); 

          const link = document.createElement('a');
          link.download = `My-${downloadBtn.dataset.decade}-Mosaic.jpg`;
          link.href = canvas.toDataURL('image/jpeg', 0.9);
          link.click();
        } catch (err) {
          console.error(err);
          UI.showToast('Failed to save image.');
        } finally {
          downloadBtn.innerHTML = btnOriginalText;
          downloadBtn.style.opacity = '1';
          downloadBtn.style.pointerEvents = 'auto';
        }
        return;
      }

      // Normal movie card clicking
      const card = e.target.closest('.movie-card, .film-card, .poster-card, .mosaic-item');
      if (card) window.location.hash = `#detail/${card.dataset.id}`;
    });

    document.getElementById('chart-list').addEventListener('click', (e) => {
      // Tournament launch
      if (e.target.closest('#launch-tournament')) {
        startTournament();
        return;
      }
      // Tournament match pick
      const card = e.target.closest('.tournament-card[data-id]');
      if (card && tournament) {
        pickTournamentWinner(parseInt(card.dataset.id));
        return;
      }
      // Tournament restart
      if (e.target.closest('#tournament-restart-btn')) {
        startTournament();
        return;
      }
      // Tournament result row → detail
      const trRow = e.target.closest('.tr-row[data-id]');
      if (trRow) {
        window.location.hash = `#detail/${trRow.dataset.id}`;
        return;
      }
      const item = e.target.closest('.top-item[data-id]');
      if (item) window.location.hash = `#detail/${item.dataset.id}`;
    });

    document.getElementById('filter-toggle').addEventListener('click', () => {
      const panel = document.getElementById('filter-panel');
      const btn = document.getElementById('filter-toggle');
      panel.classList.toggle('open');
      btn.classList.toggle('open');
    });

    const gemsBtn = document.getElementById('gems-toggle');
    if (gemsBtn) {
      gemsBtn.classList.toggle('active', gemsLens);
      gemsBtn.addEventListener('click', () => {
        gemsLens = !gemsLens;
        localStorage.setItem('gemsLens', gemsLens ? '1' : '0');
        gemsBtn.classList.toggle('active', gemsLens);
        haptic(8);
        loadCatalogue();
        if (gemsLens) UI.showToast('✦ Gems highlighted — your discoveries the world hasn’t found yet');
        else UI.showToast('Gem highlights off');
      });
    }

    function updateFilterBadge() {
      const active = [
        document.getElementById('filter-genre').value,
        document.getElementById('filter-director').value,
        document.getElementById('filter-rating').value,
      ].filter(Boolean).length;
      const badge = document.getElementById('filter-badge');
      const btn = document.getElementById('filter-toggle');
      badge.textContent = active;
      badge.style.display = active > 0 ? 'inline' : 'none';
      btn.classList.toggle('active', active > 0);
    }

    function onFilterChange() { loadCatalogue(); updateFilterBadge(); }

    document.getElementById('filter-genre').addEventListener('change', onFilterChange);
    document.getElementById('filter-director').addEventListener('change', onFilterChange);
    document.getElementById('filter-rating').addEventListener('change', onFilterChange);
    document.getElementById('sort-by').addEventListener('change', onFilterChange);
    document.getElementById('view-array-btn').addEventListener('click', () => setViewMode('array'));
    document.getElementById('view-decades-btn').addEventListener('click', () => setViewMode('decades'));
    document.getElementById('view-library-btn').addEventListener('click', () => setViewMode('library'));
    document.getElementById('catalogue-search').addEventListener('input', loadCatalogue);

    // Expanding search bar — iOS style
    const catSearchInput = document.getElementById('catalogue-search');
    const catTopBar = document.querySelector('#view-catalogue .catalogue-top-bar');
    const catCancelBtn = document.getElementById('catalogue-search-cancel');
    catSearchInput.addEventListener('focus', () => catTopBar.classList.add('search-active'));
    catSearchInput.addEventListener('blur', () => catTopBar.classList.remove('search-active'));
    catSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') catSearchInput.blur(); });
    catCancelBtn.addEventListener('click', () => {
      catSearchInput.value = '';
      catSearchInput.blur();
      loadCatalogue();
    });

    document.getElementById('wl-view-array-btn').addEventListener('click', () => setWatchlistViewMode('array'));
    document.getElementById('wl-view-decades-btn').addEventListener('click', () => setWatchlistViewMode('decades'));
    document.getElementById('wl-view-library-btn').addEventListener('click', () => setWatchlistViewMode('library'));
    document.getElementById('wl-random-pick').addEventListener('click', randomPick);
    document.getElementById('inventory-next').addEventListener('click', inventoryNext);
    document.getElementById('inventory-prev').addEventListener('click', inventoryPrev);
    document.getElementById('inventory-shuffle').addEventListener('click', inventoryReshuffle);
    document.getElementById('watchlist-search').addEventListener('input', loadWatchlist);
    document.getElementById('watchlist-search-clear').addEventListener('click', () => {
      document.getElementById('watchlist-search').value = '';
      loadWatchlist();
    });
    document.getElementById('watchlist-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.film-card, .poster-card');
      if (card) window.location.hash = `#detail/${card.dataset.id}`;
    });
    document.getElementById('catalogue-search-clear').addEventListener('click', () => {
      const input = document.getElementById('catalogue-search');
      input.value = '';
      input.focus();
      loadCatalogue();
    });

    document.getElementById('tmdb-search-clear').addEventListener('click', () => {
      const input = document.getElementById('tmdb-search');
      input.value = '';
      input.focus();
      document.getElementById('search-results').innerHTML = '';
      document.getElementById('movie-form').style.display = 'none';
      editingMovie = null;
      closeAutocomplete();
    });


    // --- Cloud Sync ---
    function updateSyncUI() {
      const hasToken = !!CloudSync.getToken();
      const gistId = CloudSync.getGistId();
      document.getElementById('sync-setup').style.display = hasToken ? 'none' : '';
      document.getElementById('sync-controls').style.display = hasToken ? '' : 'none';
      document.getElementById('sync-pull').disabled = !gistId;
      // Show gist ID prominently so user can copy it to other devices
      const gistDisplay = document.getElementById('sync-gist-display');
      if (gistId) {
        gistDisplay.style.display = '';
        document.getElementById('sync-gist-value').textContent = gistId;
      } else {
        gistDisplay.style.display = 'none';
      }
      const last = CloudSync.getLastSync();
      document.getElementById('sync-status').textContent = last
        ? `Last synced: ${new Date(last).toLocaleString()}`
        : 'Not yet synced. Push to create your cloud backup.';
    }
    updateSyncUI();

    document.getElementById('sync-save').addEventListener('click', () => {
      const token = document.getElementById('sync-token').value.trim();
      if (!token) { UI.showToast('Please enter a GitHub token'); return; }
      CloudSync.setToken(token);
      const gistId = document.getElementById('sync-gist-id').value.trim();
      if (gistId) CloudSync.setGistId(gistId);
      updateSyncUI();
      UI.showToast('Sync settings saved!');
    });

    async function runSync(action, label) {
      const btns = document.querySelectorAll('#sync-controls .btn, #sync-controls .btn-primary, #sync-controls .btn-secondary');
      btns.forEach(b => b.disabled = true);
      document.getElementById('sync-status').textContent = `${label}...`;
      try {
        await action();
        updateWatchlistBadge();
        if (currentView === 'stats') loadStats();
        updateSyncUI();
        UI.showToast(`${label} complete!`);
      } catch (err) {
        UI.showToast(`Sync failed: ${err.message}`);
        document.getElementById('sync-status').textContent = `Error: ${err.message}`;
      }
      btns.forEach(b => b.disabled = false);
    }

    document.getElementById('sync-copy-gist').addEventListener('click', () => {
      const gistId = CloudSync.getGistId();
      if (gistId) {
        navigator.clipboard.writeText(gistId).then(() => UI.showToast('Gist ID copied!'));
      }
    });

    document.getElementById('sync-push').addEventListener('click', () => runSync(() => CloudSync.push(), 'Push'));
    document.getElementById('sync-pull').addEventListener('click', () => runSync(() => CloudSync.pull(), 'Pull'));
    document.getElementById('sync-now').addEventListener('click', () => runSync(() => CloudSync.sync(), 'Sync'));

    document.getElementById('sync-disconnect-2').addEventListener('click', () => {
      CloudSync.disconnect();
      updateSyncUI();
      UI.showToast('Sync disconnected');
    });

    document.getElementById('clear-all-data').addEventListener('click', async () => {
      if (confirm('Are you sure? This will permanently delete ALL your movies.')) {
        await MovieDB.importData('[]');
        updateWatchlistBadge();
        UI.showToast('All data cleared.');
        loadStats();
      }
    });

    document.getElementById('export-data').addEventListener('click', async () => {
      const json = await MovieDB.exportData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `movie-catalogue-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      UI.showToast('Data exported!');
    });

    document.getElementById('import-data').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const count = await MovieDB.importData(text);
        updateWatchlistBadge();
        UI.showToast(`Imported ${count} movies!`);
        if (currentView === 'catalogue') loadCatalogue();
      } catch (err) {
        UI.showToast('Import failed: ' + err.message);
      }
      e.target.value = '';
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
