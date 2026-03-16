const TMDB = (() => {
  const BASE_URL = 'https://api.themoviedb.org/3';
  const IMG_BASE = 'https://image.tmdb.org/t/p';

  const API_KEY = '3dadc2d1f1bf4bd38ef92969098e3051';

  function getApiKey() {
    return API_KEY;
  }

  function setApiKey() {
    // No-op: key is now built-in
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
    const url = `${BASE_URL}/movie/${tmdbId}?api_key=${encodeURIComponent(key)}&append_to_response=credits`;
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