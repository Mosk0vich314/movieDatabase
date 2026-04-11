const App = (() => {
  let currentView = 'catalogue';
  let selectedRating = 0;
  let editingMovie = null;
  let acDebounce = null;
  let acResults = [];
  let acFocusIdx = -1;
  const _storedView = localStorage.getItem('viewMode');
  let viewMode = (['array', 'decades', 'library'].includes(_storedView) ? _storedView : null) || 'decades';
  let searchMode = 'movie';
  let selectedDirectorName = '';

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

  async function loadCatalogue() {
    const movies = (await MovieDB.getAllMovies()).filter(m => !m.watchlist);
    const grid = document.getElementById('movie-grid');
    const empty = document.getElementById('empty-catalogue');

    populateGenreFilter(movies);
    populateDirectorFilter(movies);

    document.getElementById('view-array-btn').classList.toggle('active', viewMode === 'array');
    document.getElementById('view-decades-btn').classList.toggle('active', viewMode === 'decades');
    document.getElementById('view-library-btn').classList.toggle('active', viewMode === 'library');

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

    // Pre-render detail view invisibly to measure the actual poster position.
    // We simulate the post-navigation layout (all views hidden, only detail visible)
    // so getBoundingClientRect matches where the poster actually lands after routing.
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

    // Restore all views to their original inline display values
    allViews.forEach((v, i) => { v.style.display = prevDisplays[i]; });
    detailSection.style.visibility = '';
    detailSection.style.pointerEvents = '';

    const tx = dest.left - rect.left;
    const ty = dest.top  - rect.top;
    const sx = dest.width  / rect.width;
    const sy = dest.height / rect.height;

    // Spine clone floats over the watchlist
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

    // Phase 1: Lift (150ms)
    el.style.transition = 'transform 0.15s ease-out';
    el.style.transform = `translate(0,-44px) scale(1,1) rotateY(0deg)`;
    await wait(160);

    // Phase 2: Glide to the real poster destination + expand (380ms)
    // ty + 44 because we lifted 44px up first
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

  async function loadWatchlist() {
    const movies = (await MovieDB.getAllMovies()).filter(m => m.watchlist);
    const container = document.getElementById('watchlist-grid');
    const empty = document.getElementById('empty-watchlist');

    if (movies.length === 0) {
      container.innerHTML = '';
      container.className = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    container.className = '';
    container.innerHTML = UI.renderBlurayShelf(movies);

    container.querySelectorAll('.bluray-case').forEach(caseEl => {
      caseEl.addEventListener('click', () => {
        const id = parseInt(caseEl.dataset.id);
        const movie = movies.find(m => m.id === id);
        if (movie) extractBluray(caseEl, movie);
      });
    });
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
      const header = `<div class="filmography-header">
        <button class="btn btn-secondary btn-back" id="filmography-back">&larr; ${UI.escapeHtml(personName)}</button>
        <span class="filmography-count">${directed.length} film${directed.length !== 1 ? 's' : ''}</span>
      </div>`;
      container.innerHTML = header + directed.map(f => UI.renderFilmographyResult(f, addedSet)).join('');
      document.getElementById('filmography-back').addEventListener('click', () => {
        selectedDirectorName = '';
        container.innerHTML = '';
        document.getElementById('tmdb-search').value = '';
        document.getElementById('tmdb-search').focus();
      });
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
        await MovieDB.addMovie(movie);
        UI.showToast('Movie added!');
      }
      editingMovie = null;
      updateWatchlistBadge();
      window.location.hash = '#catalogue';
    } catch (err) {
      UI.showToast('Error saving movie: ' + err.message);
    }
  }

  // --- Detail ---

  async function loadMovieDetail(id) {
    const movie = await MovieDB.getMovie(id);
    if (!movie) {
      UI.showToast('Movie not found');
      window.location.hash = '#catalogue';
      return;
    }

    // Backfill fields for movies saved before these fields existed
    if ((!movie.overview || !movie.cast || !movie.backdrop) && movie.tmdbId) {
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
        if (updated) await MovieDB.updateMovie(movie);
      } catch (_) { /* best-effort */ }
    }

    document.getElementById('movie-detail').innerHTML = UI.renderMovieDetail(movie);

    document.getElementById('detail-back').addEventListener('click', () => {
      window.location.hash = movie.watchlist ? '#watchlist' : '#catalogue';
    });

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
      if (searchMode === 'director') searchDirector(); else searchTMDB();
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
        } else {
          searchTMDB();
        }
      }
    });
    document.getElementById('tmdb-search').addEventListener('input', () => {
      if (searchMode === 'director') { closeAutocomplete(); return; }
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
      editingMovie = null;
      selectedDirectorName = '';
      closeAutocomplete();
      document.getElementById('tmdb-search').placeholder =
        searchMode === 'director' ? 'Search for a director...' : 'Search or paste a themoviedb.org URL...';
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
        loadFilmography(parseInt(personResult.dataset.personId), name);
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
