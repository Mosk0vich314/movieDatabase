const CloudSync = (() => {
  const KEY_TOKEN = 'gh_sync_token';
  const KEY_GIST = 'gh_sync_gist_id';
  const KEY_LAST = 'gh_sync_last';
  const FILENAME = 'movie-catalogue.json';

  function getToken() { return localStorage.getItem(KEY_TOKEN) || ''; }
  function setToken(t) { localStorage.setItem(KEY_TOKEN, t); }
  function getGistId() { return localStorage.getItem(KEY_GIST) || ''; }
  function setGistId(id) { localStorage.setItem(KEY_GIST, id); }
  function getLastSync() { return localStorage.getItem(KEY_LAST) || ''; }
  function isConfigured() { return !!(getToken() && getGistId()); }

  function headers() {
    return { 'Authorization': `token ${getToken()}`, 'Content-Type': 'application/json' };
  }

  async function push() {
    const token = getToken();
    if (!token) throw new Error('No GitHub token configured');

    const movies = await MovieDB.getAllMovies();
    const content = JSON.stringify(movies, null, 2);
    const gistId = getGistId();

    if (gistId) {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH', headers: headers(),
        body: JSON.stringify({ files: { [FILENAME]: { content } } }),
      });
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    } else {
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({
          description: 'Movie Catalogue Sync',
          public: false,
          files: { [FILENAME]: { content } },
        }),
      });
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const data = await res.json();
      setGistId(data.id);
    }
    localStorage.setItem(KEY_LAST, new Date().toISOString());
  }

  async function pull() {
    const token = getToken();
    const gistId = getGistId();
    if (!token || !gistId) throw new Error('Sync not configured');

    const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: headers() });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const data = await res.json();
    const file = data.files[FILENAME];
    if (!file) throw new Error('No movie data found in gist');

    const remoteMovies = JSON.parse(file.content);
    const localMovies = await MovieDB.getAllMovies();

    // Merge by tmdbId: union of both, newest dateAdded wins on conflict
    const localMap = new Map();
    localMovies.forEach(m => { if (m.tmdbId) localMap.set(String(m.tmdbId), m); });

    const merged = [];
    const seen = new Set();

    remoteMovies.forEach(rm => {
      const key = String(rm.tmdbId);
      seen.add(key);
      const lm = localMap.get(key);
      if (lm) {
        const ld = new Date(lm.dateAdded || 0).getTime();
        const rd = new Date(rm.dateAdded || 0).getTime();
        merged.push(rd >= ld ? rm : lm);
      } else {
        merged.push(rm);
      }
    });

    localMovies.forEach(lm => {
      if (lm.tmdbId && !seen.has(String(lm.tmdbId))) merged.push(lm);
    });

    const count = await MovieDB.importData(JSON.stringify(merged));
    localStorage.setItem(KEY_LAST, new Date().toISOString());
    return count;
  }

  async function sync() {
    await pull();
    await push();
  }

  function disconnect() {
    localStorage.removeItem(KEY_TOKEN);
    localStorage.removeItem(KEY_GIST);
    localStorage.removeItem(KEY_LAST);
  }

  return { getToken, setToken, getGistId, setGistId, getLastSync, isConfigured, push, pull, sync, disconnect };
})();
