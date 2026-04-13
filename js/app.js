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
  let pendingSuggestions = null;

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
      UI.initCustomSelects();
      navigate(window.location.hash || '#catalogue');
      updateWatchlistBadge();
      registerServiceWorker();
    });
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
    if (view === 'stats') loadStats();
    if (view === 'add') resetAddView();
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

    // Now Playing banner — most recently added film
    const npWrap = document.getElementById('now-playing-wrap');
    if (movies.length > 0) {
      const newest = [...movies].sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0))[0];
      npWrap.innerHTML = UI.renderNowPlaying(newest);
      npWrap.querySelector('.now-playing').addEventListener('click', () => {
        window.location.hash = `#detail/${newest.id}`;
      });
    } else {
      npWrap.innerHTML = '';
    }

    // Similar suggestions panel
    const sugWrap = document.getElementById('suggestions-wrap');
    if (pendingSuggestions) {
      sugWrap.innerHTML = UI.renderSuggestionsPanel(pendingSuggestions.movieTitle, pendingSuggestions.results);
      sugWrap.querySelector('.suggestions-dismiss').addEventListener('click', () => {
        pendingSuggestions = null;
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
    } else {
      sugWrap.innerHTML = '';
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
      selectedDirectorName = '';
      nav.style.display = 'none';
      nav.innerHTML = '';
      document.getElementById('search-results').innerHTML = '';
      document.getElementById('tmdb-search').value = '';
      document.getElementById('tmdb-search').focus();
    });
  }

  async function loadFilmography(personId, personName) {
    selectedDirectorName = personName;
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
      if (existingId) {
        movie.id = parseInt(existingId);
        movie.dateAdded = editingMovie.dateAdded;
        await MovieDB.updateMovie(movie);
        UI.showToast('Movie updated!');
      } else {
        const before = (await MovieDB.getAllMovies()).filter(m => !m.watchlist).length;
        await MovieDB.addMovie(movie);
        const after = before + 1;
        const hit = Stats.MILESTONE_VALUES.find(m => before < m && after >= m);
        if (hit) localStorage.setItem('pendingMilestone', hit);
        UI.showToast('Movie added!');
        // Fetch similar suggestions in the background
        if (movie.tmdbId) fetchSimilarSuggestions(movie.title, movie.tmdbId);
      }
      editingMovie = null;
      updateWatchlistBadge();
      window.location.hash = '#catalogue';
    } catch (err) {
      UI.showToast('Error saving movie: ' + err.message);
    }
  }

  // --- Chart ---

  async function loadChart() {
    const movies = (await MovieDB.getAllMovies()).filter(m => !m.watchlist && m.rating > 0);
    const top30 = [...movies].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 30);
    document.getElementById('chart-list').innerHTML = UI.renderChart(top30);
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

    document.getElementById('detail-back').addEventListener('click', () => {
      window.location.hash = movie.watchlist ? '#watchlist' : '#catalogue';
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
  }

  async function fetchSimilarSuggestions(movieTitle, tmdbId) {
    try {
      const [recs, allMovies] = await Promise.all([
        TMDB.getMovieRecommendations(tmdbId),
        MovieDB.getAllMovies(),
      ]);
      const ownedIds = new Set(allMovies.map(m => String(m.tmdbId)));
      const filtered = recs.filter(r => !ownedIds.has(String(r.id))).slice(0, 8);
      if (filtered.length >= 3) pendingSuggestions = { movieTitle, results: filtered };
    } catch (_) {}
  }

  async function randomPick() {
    const allMovies = (await MovieDB.getAllMovies()).filter(m => m.watchlist);
    if (allMovies.length === 0) { UI.showToast('Watchlist is empty!'); return; }
    if (allMovies.length === 1) {
      const only = allMovies[0];
      window.location.hash = `#detail/${only.id}`;
      return;
    }

    const winner = allMovies[Math.floor(Math.random() * allMovies.length)];

    // If library mode, do slot-machine animation
    if (watchlistViewMode === 'library') {
      const cases = [...document.querySelectorAll('#watchlist-grid .bluray-case')];
      const winnerCase = cases.find(c => parseInt(c.dataset.id) === winner.id);
      if (winnerCase && cases.length > 1) {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const totalFlashes = 24 + (cases.length < 8 ? cases.length * 3 : cases.length);
        let cur = Math.floor(Math.random() * cases.length);

        for (let i = 0; i < totalFlashes; i++) {
          cases.forEach(c => c.classList.remove('case-pick-highlight'));
          // On last several flashes, navigate toward winner
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

        // Land on winner
        cases.forEach(c => c.classList.remove('case-pick-highlight'));
        winnerCase.classList.add('case-pick-highlight');
        winnerCase.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await wait(600);
        winnerCase.classList.remove('case-pick-highlight');
        extractBluray(winnerCase, winner);
        return;
      }
    }

    // Non-library mode or fallback: just navigate
    UI.showToast(`🎲 Picked: ${winner.title}`);
    setTimeout(() => { window.location.hash = `#detail/${winner.id}`; }, 800);
  }

  // --- Stats ---

  async function loadStats() {
    const movies = (await MovieDB.getAllMovies()).filter(m => !m.watchlist);
    const stats = Stats.compute(movies);
    const container = document.getElementById('stats-container');
    container.innerHTML = Stats.render(stats);
    animateCounters(container);
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
    document.getElementById('rating-slider').addEventListener('input', (e) => {
      selectedRating = parseFloat(parseFloat(e.target.value).toFixed(1));
      updateRatingDisplay();
    });
    document.getElementById('rating-slider').addEventListener('change', (e) => {
      const val = parseFloat(parseFloat(e.target.value).toFixed(1));
      if (val === 10 && !sliderWasTen) spawnStarBurst(document.getElementById('rating-display-value'));
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
      }
    });
    document.getElementById('form-cancel').addEventListener('click', () => {
      document.getElementById('movie-form').style.display = 'none';
      editingMovie = null;
    });

    document.getElementById('movie-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.movie-card, .film-card, .poster-card');
      if (card) window.location.hash = `#detail/${card.dataset.id}`;
    });

    document.getElementById('chart-list').addEventListener('click', (e) => {
      const item = e.target.closest('.top-item[data-id]');
      if (item) window.location.hash = `#detail/${item.dataset.id}`;
    });

    document.getElementById('filter-toggle').addEventListener('click', () => {
      const panel = document.getElementById('filter-panel');
      const btn = document.getElementById('filter-toggle');
      panel.classList.toggle('open');
      btn.classList.toggle('open');
    });

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

    document.getElementById('wl-view-array-btn').addEventListener('click', () => setWatchlistViewMode('array'));
    document.getElementById('wl-view-decades-btn').addEventListener('click', () => setWatchlistViewMode('decades'));
    document.getElementById('wl-view-library-btn').addEventListener('click', () => setWatchlistViewMode('library'));
    document.getElementById('wl-random-pick').addEventListener('click', randomPick);
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
