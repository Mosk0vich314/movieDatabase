const TMDB = (() => {
  const BASE_URL = 'https://api.themoviedb.org/3';
  const IMG_BASE = 'https://image.tmdb.org/t/p';

  function getApiKey() {
    return localStorage.getItem('tmdb_api_key') || '';
  }

  function setApiKey(key) {
    localStorage.setItem('tmdb_api_key', key);
  }

  async function searchMovies(query) {
    const key = getApiKey();
    if (!key) throw new Error('No TMDB API key set. Go to Settings to add one.');
    const url = `${BASE_URL}/search/movie?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}&include_adult=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
    const data = await res.json();
    return data.results || [];
  }

  async function getMovieDetails(tmdbId) {
    const key = getApiKey();
    if (!key) throw new Error('No TMDB API key set.');
    const url = `${BASE_URL}/movie/${tmdbId}?api_key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB detail failed: ${res.status}`);
    return res.json();
  }

  function posterUrl(path, size = 'w342') {
    if (!path) return '';
    return `${IMG_BASE}/${size}${path}`;
  }

  return { getApiKey, setApiKey, searchMovies, getMovieDetails, posterUrl };
})();