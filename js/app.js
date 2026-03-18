const App = (() => {
  let currentView = 'catalogue';
  let selectedRating = 0;
  let editingMovie = null;

  function init() {
    MovieDB.open().then(() => {
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

    const filtered = applyFilters(movies);
    const sortVal = document.getElementById('sort-by').value;

    if (filtered.length === 0) {
      grid.innerHTML = '';
      grid.classList.add('movie-grid');
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';

      if (sortVal === 'director-asc') {
        grid.classList.remove('movie-grid');
        grid.innerHTML = renderGroupedByDirector(filtered);
        setupDirectorGroupToggles();
      } else {
        grid.classList.remove('movie-grid');
        grid.innerHTML = UI.renderDecadeLanes(filtered);
      }
    }
  }

  function renderGroupedByDirector(movies) {
    const groups = {};
    movies.forEach(m => {
      const dirs = (m.directors || []).length > 0 ? m.directors : ['Unknown Director'];
      dirs.forEach(d => {
        if (!groups[d]) groups[d] = [];
        groups[d].push(m);
      });
    });

    return Object.keys(groups).sort((a, b) => {
      if (a === 'Unknown Director') return 1;
      if (b === 'Unknown Director') return -1;
      return a.localeCompare(b);
    }).map(dir => UI.renderDirectorGroup(dir, groups[dir])).join('');
  }

  function setupDirectorGroupToggles() {
    document.querySelectorAll('.director-group-header').forEach(header => {
      header.addEventListener('click', () => {
        const grid = header.nextElementSibling;
        const toggle = header.querySelector('.director-group-toggle');
        grid.classList.toggle('collapsed');
        toggle.classList.toggle('collapsed');
      });
    });
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
    const sortVal = document.getElementById('sort-by').value;
    const search = document.getElementById('catalogue-search').value.toLowerCase().trim();

    let result = movies.filter(m => {
      if (genre && !(m.genres || []).includes(genre)) return false;
      if (director && !(m.directors || []).includes(director)) return false;
      if (minRating && (m.rating || 0) < minRating) return false;
      if (search && !m.title.toLowerCase().includes(search)) return false;
      return true;
    });

    if (sortVal !== 'director-asc') {
      const [sortField, sortDir] = sortVal.split('-');
      result.sort((a, b) => {
        let va, vb;
        switch (sortField) {
          case 'title': va = (a.title || '').toLowerCase(); vb = (b.title || '').toLowerCase(); break;
          case 'rating': va = a.rating || 0; vb = b.rating || 0; break;
          case 'year': va = a.year || 0; vb = b.year || 0; break;
          default: va = a.dateAdded || ''; vb = b.dateAdded || '';
        }
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }

  // --- Watchlist ---

  async function loadWatchlist() {
    const movies = (await MovieDB.getAllMovies()).filter(m => m.watchlist);
    const grid = document.getElementById('watchlist-grid');
    const empty = document.getElementById('empty-watchlist');
    if (movies.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      grid.innerHTML = movies.map(m => UI.renderWatchlistCard(m)).join('');
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
      await MovieDB.addMovie({
        tmdbId: details.id,
        title: details.title,
        year: details.release_date ? details.release_date.substring(0, 4) : '',
        genres: (details.genres || []).map(g => g.name),
        directors,
        poster: TMDB.posterUrl(details.poster_path),
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
    });
  }

  // --- Add Movie ---

  function resetAddView() {
    document.getElementById('tmdb-search').value = '';
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('movie-form').style.display = 'none';
    editingMovie = null;
    selectedRating = 0;
  }

  async function searchTMDB() {
    const query = document.getElementById('tmdb-search').value.trim();
    if (!query) return;

    if (!TMDB.getApiKey()) {
      UI.showToast('Please set your TMDB API key in Settings first.');
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

  async function selectSearchResult(tmdbId) {
    try {
      const details = await TMDB.getMovieDetails(tmdbId);
      const directors = (details.credits?.crew || [])
        .filter(c => c.job === 'Director')
        .map(c => c.name);
      populateForm({
        tmdbId: details.id,
        title: details.title,
        year: details.release_date ? details.release_date.substring(0, 4) : '',
        genres: (details.genres || []).map(g => g.name),
        directors,
        poster: TMDB.posterUrl(details.poster_path),
        overview: details.overview || '',
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

    if (editingMovie) {
      selectedRating = editingMovie.rating || 0;
      document.getElementById('form-notes').value = editingMovie.notes || '';
      document.getElementById('form-id').value = editingMovie.id;
    } else {
      selectedRating = 0;
      document.getElementById('form-notes').value = '';
      document.getElementById('form-id').value = '';
    }
    updateStarDisplay();
  }

  function updateStarDisplay(animate = false) {
    document.querySelectorAll('#star-rating .star').forEach(star => {
      const val = parseInt(star.dataset.value);
      const wasFilled = star.classList.contains('filled');
      const shouldFill = val <= selectedRating;
      star.classList.toggle('filled', shouldFill);
      if (animate && shouldFill && !wasFilled) {
        star.classList.remove('animate');
        void star.offsetWidth; // reflow
        star.classList.add('animate');
      }
    });
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

  async function quickRateMovie(id, rating, starEl) {
    const movie = await MovieDB.getMovie(id);
    if (!movie) return;
    await MovieDB.updateMovie({ ...movie, rating });
    if (rating === 5 && starEl) spawnStarBurst(starEl);
    UI.showToast(rating === 5 ? 'Masterpiece! ★★★★★' : `Rated ${rating} star${rating !== 1 ? 's' : ''}`);
    loadCatalogue();
  }

  // --- Detail ---

  async function loadMovieDetail(id) {
    const movie = await MovieDB.getMovie(id);
    if (!movie) {
      UI.showToast('Movie not found');
      window.location.hash = '#catalogue';
      return;
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
    document.getElementById('tmdb-search-btn').addEventListener('click', searchTMDB);
    document.getElementById('tmdb-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); searchTMDB(); }
    });

    document.getElementById('search-results').addEventListener('click', (e) => {
      const watchlistBtn = e.target.closest('.search-result-watchlist-btn');
      if (watchlistBtn) {
        e.stopPropagation();
        addToWatchlist(parseInt(watchlistBtn.dataset.tmdbId));
        return;
      }
      const result = e.target.closest('.search-result');
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

    document.getElementById('star-rating').addEventListener('click', (e) => {
      const star = e.target.closest('.star');
      if (star) {
        selectedRating = parseInt(star.dataset.value);
        updateStarDisplay(true);
        if (selectedRating === 5) spawnStarBurst(star);
      }
    });

    document.getElementById('star-rating').addEventListener('mouseover', (e) => {
      const star = e.target.closest('.star');
      if (star) {
        const val = parseInt(star.dataset.value);
        document.querySelectorAll('#star-rating .star').forEach(s => {
          s.classList.toggle('hovered', parseInt(s.dataset.value) <= val);
        });
      }
    });

    document.getElementById('star-rating').addEventListener('mouseleave', () => {
      document.querySelectorAll('#star-rating .star').forEach(s => s.classList.remove('hovered'));
    });

    document.getElementById('movie-form').addEventListener('submit', saveMovie);
    document.getElementById('form-cancel').addEventListener('click', () => {
      document.getElementById('movie-form').style.display = 'none';
      editingMovie = null;
    });

    document.getElementById('movie-grid').addEventListener('click', async (e) => {
      const star = e.target.closest('.fcs');
      if (star) {
        e.stopPropagation();
        const card = star.closest('.film-card');
        if (card) await quickRateMovie(parseInt(card.dataset.id), parseInt(star.dataset.value), star);
        return;
      }
      const card = e.target.closest('.movie-card, .film-card');
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
      ].filter(Boolean).length + (document.getElementById('sort-by').value !== 'dateAdded-desc' ? 1 : 0);
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
