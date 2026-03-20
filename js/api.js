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

  async function searchMovies(query, quick = false) {
    const key = getApiKey();
    if (!key) throw new Error('No TMDB API key set. Go to Settings to add one.');
    const url = `${BASE_URL}/search/movie?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}&include_adult=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
    const data = await res.json();
    const tmdbResults = data.results || [];

    // If TMDB results are weak or none match the query title, try Wikipedia fallback
    // to find films by romanized/alternate titles that TMDB doesn't index
    const hasStrongMatch = tmdbResults.some(r => r.popularity > 5);
    const q = query.toLowerCase();
    const hasTitleMatch = tmdbResults.some(r =>
      r.title?.toLowerCase().includes(q) || r.original_title?.toLowerCase().includes(q)
    );
    if (!quick && (tmdbResults.length < 3 || !hasStrongMatch || !hasTitleMatch)) {
      try {
        const wikiResults = await _wikiSearchMovies(query, key);
        // Merge wiki results, skipping duplicates already in TMDB results
        const existingIds = new Set(tmdbResults.map(r => r.id));
        for (const wr of wikiResults) {
          if (!existingIds.has(wr.id)) {
            tmdbResults.push(wr);
            existingIds.add(wr.id);
          }
        }
      } catch (_) { /* fallback is best-effort */ }
    }

    return tmdbResults;
  }

  // Search Wikipedia for "{query} film", grab Wikidata TMDB IDs, fetch from TMDB
  async function _wikiSearchMovies(query, apiKey) {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(query + ' film')}&srlimit=5&format=json&origin=*`;
    const wikiRes = await fetch(wikiUrl);
    if (!wikiRes.ok) return [];
    const wikiData = await wikiRes.json();
    const pages = (wikiData.query?.search || [])
      .filter(p => /film|movie|cinema/i.test(p.snippet));
    if (pages.length === 0) return [];

    // Get Wikidata item IDs for these pages
    const titles = pages.map(p => p.title).join('|');
    const propsUrl = `https://en.wikipedia.org/w/api.php?action=query` +
      `&titles=${encodeURIComponent(titles)}&prop=pageprops&ppprop=wikibase_item&format=json&origin=*`;
    const propsRes = await fetch(propsUrl);
    if (!propsRes.ok) return [];
    const propsData = await propsRes.json();
    const wikidataIds = Object.values(propsData.query?.pages || {})
      .map(p => p.pageprops?.wikibase_item)
      .filter(Boolean);
    if (wikidataIds.length === 0) return [];

    // Fetch TMDB IDs from Wikidata
    const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities` +
      `&ids=${wikidataIds.join('|')}&props=claims&format=json&origin=*`;
    const wdRes = await fetch(wdUrl);
    if (!wdRes.ok) return [];
    const wdData = await wdRes.json();

    const tmdbIds = [];
    for (const entity of Object.values(wdData.entities || {})) {
      // P4947 = TMDB movie ID
      const claim = entity.claims?.P4947?.[0];
      if (claim) tmdbIds.push(claim.mainsnak?.datavalue?.value);
    }

    // Fetch each movie from TMDB by ID
    const results = [];
    for (const tmdbId of tmdbIds.filter(Boolean)) {
      try {
        const url = `${BASE_URL}/movie/${tmdbId}?api_key=${encodeURIComponent(apiKey)}`;
        const r = await fetch(url);
        if (r.ok) {
          const movie = await r.json();
          // Shape it like a search result
          results.push({
            id: movie.id,
            title: movie.title,
            original_title: movie.original_title,
            overview: movie.overview,
            poster_path: movie.poster_path,
            release_date: movie.release_date,
            genre_ids: (movie.genres || []).map(g => g.id),
            popularity: movie.popularity,
            vote_average: movie.vote_average,
            vote_count: movie.vote_count,
            original_language: movie.original_language,
          });
        }
      } catch (_) { /* skip individual failures */ }
    }
    return results;
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