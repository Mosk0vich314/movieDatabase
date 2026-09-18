const MovieDB = (() => {
  const DB_NAME = 'movieCatalogue';
  const DB_VERSION = 1;
  const STORE_NAME = 'movies';
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('tmdbId', 'tmdbId', { unique: false });
          store.createIndex('title', 'title', { unique: false });
          store.createIndex('rating', 'rating', { unique: false });
          store.createIndex('dateAdded', 'dateAdded', { unique: false });
          store.createIndex('year', 'year', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  function getStore(mode = 'readonly') {
    return open().then(db => {
      const tx = db.transaction(STORE_NAME, mode);
      return tx.objectStore(STORE_NAME);
    });
  }

  function addMovie(movie) {
    return getStore('readwrite').then(store => {
      return new Promise((resolve, reject) => {
        movie.dateAdded = new Date().toISOString();
        const request = store.add(movie);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  function updateMovie(movie) {
    return getStore('readwrite').then(store => {
      return new Promise((resolve, reject) => {
        const request = store.put(movie);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  function deleteMovie(id) {
    return getStore('readwrite').then(store => {
      return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }

  function getMovie(id) {
    return getStore().then(store => {
      return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  function getAllMovies() {
    return getStore().then(store => {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  function exportData() {
    return getAllMovies().then(movies => {
      return JSON.stringify(movies, null, 2);
    });
  }

  // Imported data comes from a file or a gist, i.e. from outside this app.
  // Scrub the URL-bearing fields at the boundary so a crafted backup cannot
  // smuggle a javascript:/data: URL or an attribute break-out into the DOM.
  // Every other field is left untouched — this must never silently drop data.
  function cleanUrl(u) {
    if (!u) return undefined;
    const s = String(u).trim();
    return /^https?:\/\/[^\s"'<>\\]+$/i.test(s) ? s : undefined;
  }

  function scrubMovie(movie) {
    if (!movie || typeof movie !== 'object') return null;
    if ('poster' in movie) movie.poster = cleanUrl(movie.poster);
    if ('backdrop' in movie) movie.backdrop = cleanUrl(movie.backdrop);
    if (Array.isArray(movie.cast)) {
      movie.cast.forEach(c => { if (c && typeof c === 'object') c.profileUrl = cleanUrl(c.profileUrl) || ''; });
    }
    return movie;
  }

  function importData(jsonString) {
    const parsed = JSON.parse(jsonString);
    if (!Array.isArray(parsed)) throw new Error('Invalid data format');
    const movies = parsed.map(scrubMovie).filter(Boolean);

    return getStore('readwrite').then(store => {
      return new Promise((resolve, reject) => {
        // Clear existing data first
        const clearReq = store.clear();
        clearReq.onsuccess = () => {
          let count = 0;
          if (movies.length === 0) return resolve(0);

          movies.forEach(movie => {
            // Remove old id so autoIncrement assigns new ones
            delete movie.id;
            const addReq = store.add(movie);
            addReq.onsuccess = () => {
              count++;
              if (count === movies.length) resolve(count);
            };
            addReq.onerror = () => reject(addReq.error);
          });
        };
        clearReq.onerror = () => reject(clearReq.error);
      });
    });
  }

  return { open, addMovie, updateMovie, deleteMovie, getMovie, getAllMovies, exportData, importData };
})();