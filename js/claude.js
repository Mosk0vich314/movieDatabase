const Claude = (() => {
  async function suggest(movies, query) {
    const API_KEY = localStorage.getItem('gemini_api_key');
    if (!API_KEY) throw new Error('No Gemini API key set — add it in the Stats tab.');
    const watched = movies.filter(m => !m.watchlist && m.rating);

    const fiveStars = watched.filter(m => m.rating === 5).map(m => m.title);
    const fourStars  = watched.filter(m => m.rating === 4).map(m => m.title);
    const allSeen    = movies.filter(m => !m.watchlist).map(m => m.title);

    const genreCounts = {};
    watched.forEach(m => (m.genres || []).forEach(g => {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    }));
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g]) => g);

    const dirCounts = {};
    watched.forEach(m => (m.directors || []).forEach(d => {
      dirCounts[d] = (dirCounts[d] || 0) + 1;
    }));
    const topDirectors = Object.entries(dirCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d]) => d);

    const system = `You are a personal film curator with encyclopedic knowledge of cinema. \
Suggest films the user has not seen yet, based strictly on their taste profile.

Respond ONLY with a valid JSON array — no other text, no markdown fences. Format:
[{"title":"...","year":"...","reason":"..."}]

Rules:
- "reason" must be exactly one punchy sentence — reference their actual ★★★★★ or ★★★★ films or directors by name
- Never suggest any film from the "Already seen" list
- Give exactly 6 suggestions`;

    const profile = [
      fiveStars.length    ? `★★★★★ loved: ${fiveStars.join(', ')}`           : null,
      fourStars.length    ? `★★★★ liked: ${fourStars.join(', ')}`             : null,
      topGenres.length    ? `Top genres: ${topGenres.join(', ')}`             : null,
      topDirectors.length ? `Favourite directors: ${topDirectors.join(', ')}` : null,
      allSeen.length      ? `Already seen (never suggest): ${allSeen.join(', ')}` : null,
    ].filter(Boolean).join('\n');

    const userMessage = `${profile}\n\n${query || 'Suggest me something great based on my taste.'}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: { maxOutputTokens: 1024 },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Could not parse response');
    }
  }

  return { suggest };
})();
