const App = (() => {
  let currentView = 'catalogue';
  let selectedRating = 0;
  let editingMovie = null;

  function init() {
    MovieDB.open().then(() => {
      setupRouting();
      setupEventListeners();
      navigate(window.location.hash || '#catalogue');
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
      '#stats': 'stats',
      '#settings': 'settings',
    };

    // Handle detail view with id: #detail/123
    if (hash.startsWith('#detail/')) {
      const id = parseInt(hash.split('/')[1], 10);
      showView('detail');
      loadMovieDetail(id);
      return;
    }

    const view = viewMap[hash] || 'catalogue';
    showView(view);

    if (view === 'catalogue') loadCatalogue();
    if (view === 'stats') loadStats();
    if (view === 'settings') loadSettings();
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
    const movies = await MovieDB.getAllMovies();
    const grid = document.getElementById('movie-grid');
    const empty = document.getElementById('empty-catalogue');

    populateGenreFilter(movies);

    const filtered = applyFilters(movies);

    if (filtered.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      grid.innerHTML = filtered.map(m => UI.renderMovieCard(m)).join('');
    }
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

  function applyFilters(movies) {
    const genre = document.getElementById('filter-genre').value;
    const minRating = parseInt(document.getElementById('filter-rating').value) || 0;
    const sortVal = document.getElementById('sort-by').value;
    const search = document.getElementById('catalogue-search').value.toLowerCase().trim();

    let result = movies.filter(m => {
      if (genre && !(m.genres || []).includes(genre)) return false;
      if (minRating && (m.rating || 0) < minRating) return false;
      if (search && !m.title.toLowerCase().includes(search)) return false;
      return true;
    });

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

    return result;
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
    document.getElementById('form-directors').textContent = (data.directors || []).length > 0
      ? 'Directed by ' + (data.directors || []).join(', ')
      : '';

    const posterEl = document.getElementById('form-poster');
    if (data.poster) {
      posterEl.src = data.poster;
      posterEl.style.display = 'block';
    } else {
      posterEl.style.display = 'none';
    }

    // Store form data on the form element
    form.dataset.title = data.title;
    form.dataset.year = data.year;
    form.dataset.genres = JSON.stringify(data.genres || []);
    form.dataset.directors = JSON.stringify(data.directors || []);
    form.dataset.poster = data.poster || '';

    // Reset rating & notes
    if (editingMovie) {
      selectedRating = editingMovie.rating || 0;
      document.getElementById('form-notes').value = editingMovie.notes || '';
      document.getElementById('form-date-watched').value = editingMovie.dateWatched ? editingMovie.dateWatched.substring(0, 10) : '';
      document.getElementById('form-id').value = editingMovie.id;
    } else {
      selectedRating = 0;
      document.getElementById('form-notes').value = '';
      document.getElementById('form-date-watched').value = new Date().toISOString().substring(0, 10);
      document.getElementById('form-id').value = '';
    }
    updateStarDisplay();
  }

  function updateStarDisplay() {
    document.querySelectorAll('#star-rating .star').forEach(star => {
      const val = parseInt(star.dataset.value);
      star.classList.toggle('filled', val <= selectedRating);
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
      dateWatched: document.getElementById('form-date-watched').value || null,
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
    document.getElementById('movie-detail').innerHTML = UI.renderMovieDetail(movie);

    document.getElementById('detail-back').addEventListener('click', () => {
      window.location.hash = '#catalogue';
    });

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

    document.getElementById('detail-delete').addEventListener('click', async () => {
      if (confirm('Delete this movie from your catalogue?')) {
        await MovieDB.deleteMovie(movie.id);
        UI.showToast('Movie deleted');
        window.location.hash = '#catalogue';
      }
    });
  }

  // --- Stats ---

  async function loadStats() {
    const movies = await MovieDB.getAllMovies();
    const stats = Stats.compute(movies);
    document.getElementById('stats-container').innerHTML = Stats.render(stats);
  }

  // --- Settings ---

  function loadSettings() {
    document.getElementById('tmdb-api-key').value = TMDB.getApiKey();
  }

  // --- Event Listeners ---

  function setupEventListeners() {
    // TMDB search
    document.getElementById('tmdb-search-btn').addEventListener('click', searchTMDB);
    document.getElementById('tmdb-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); searchTMDB(); }
    });

    // Search result click
    document.getElementById('search-results').addEventListener('click', (e) => {
      const result = e.target.closest('.search-result');
      if (result) selectSearchResult(parseInt(result.dataset.tmdbId));
    });

    // Star rating
    document.getElementById('star-rating').addEventListener('click', (e) => {
      const star = e.target.closest('.star');
      if (star) {
        selectedRating = parseInt(star.dataset.value);
        updateStarDisplay();
      }
    });

    // Movie form
    document.getElementById('movie-form').addEventListener('submit', saveMovie);
    document.getElementById('form-cancel').addEventListener('click', () => {
      document.getElementById('movie-form').style.display = 'none';
      editingMovie = null;
    });

    // Movie grid click -> detail
    document.getElementById('movie-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.movie-card');
      if (card) window.location.hash = `#detail/${card.dataset.id}`;
    });

    // Filters
    document.getElementById('filter-genre').addEventListener('change', loadCatalogue);
    document.getElementById('filter-rating').addEventListener('change', loadCatalogue);
    document.getElementById('sort-by').addEventListener('change', loadCatalogue);
    document.getElementById('catalogue-search').addEventListener('input', loadCatalogue);

    // Settings
    document.getElementById('save-api-key').addEventListener('click', () => {
      const key = document.getElementById('tmdb-api-key').value.trim();
      TMDB.setApiKey(key);
      UI.showToast(key ? 'API key saved!' : 'API key cleared.');
    });

    // Export
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

    // Import
    document.getElementById('import-data').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const count = await MovieDB.importData(text);
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