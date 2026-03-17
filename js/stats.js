const Stats = (() => {
  function tasteDNA(movies) {
    if (movies.length < 3) return null;

    const genreAbbrev = {
      'Science Fiction': 'Sci-Fi', 'Action': 'Action', 'Drama': 'Drama',
      'Comedy': 'Comedy', 'Thriller': 'Thriller', 'Horror': 'Horror',
      'Romance': 'Romance', 'Animation': 'Animation', 'Documentary': 'Documentary',
      'Crime': 'Crime', 'Fantasy': 'Fantasy', 'Adventure': 'Adventure',
      'Mystery': 'Mystery', 'Western': 'Western', 'War': 'War',
      'History': 'History', 'Music': 'Music', 'Family': 'Family',
    };

    const genreCounts = {};
    movies.forEach(m => (m.genres || []).forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; }));
    const topGenreEntry = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];
    const genreWord = topGenreEntry ? (genreAbbrev[topGenreEntry[0]] || topGenreEntry[0]) : 'Cinema';

    const directorCounts = {};
    movies.forEach(m => (m.directors || []).forEach(d => { directorCounts[d] = (directorCounts[d] || 0) + 1; }));
    const ratio = Object.keys(directorCounts).length / movies.length;
    const descriptor = ratio < 0.5 ? 'Loyalist' : ratio < 0.8 ? 'Explorer' : 'Pioneer';

    return `${genreWord} ${descriptor}`;
  }

  function compute(movies) {
    const total = movies.length;
    const avgRating = total > 0
      ? (movies.reduce((sum, m) => sum + (m.rating || 0), 0) / total).toFixed(1)
      : 0;

    // Genre distribution
    const genreCounts = {};
    movies.forEach(m => {
      (m.genres || []).forEach(g => {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      });
    });
    const genresSorted = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);

    // Director distribution
    const directorCounts = {};
    movies.forEach(m => {
      (m.directors || []).forEach(d => {
        directorCounts[d] = (directorCounts[d] || 0) + 1;
      });
    });
    const directorsSorted = Object.entries(directorCounts).sort((a, b) => b[1] - a[1]);
    const uniqueDirectors = directorsSorted.length;

    // Rating distribution
    const ratingDist = [0, 0, 0, 0, 0];
    movies.forEach(m => {
      if (m.rating >= 1 && m.rating <= 5) ratingDist[m.rating - 1]++;
    });

    // Top rated movies
    const topRated = [...movies].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 5);

    return { total, avgRating, genresSorted, directorsSorted, uniqueDirectors, ratingDist, topRated, dna: tasteDNA(movies) };
  }

  function render(stats) {
    const maxGenre = stats.genresSorted.length > 0 ? stats.genresSorted[0][1] : 1;
    const maxDirector = stats.directorsSorted.length > 0 ? stats.directorsSorted[0][1] : 1;

    return `
      <div class="stats-overview">
        <div class="stat-card">
          <div class="stat-number" data-count="${stats.total}">0</div>
          <div class="stat-label">Movies Watched</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-count="${stats.avgRating}">0</div>
          <div class="stat-label">Avg Rating</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-count="${stats.uniqueDirectors}">0</div>
          <div class="stat-label">Directors</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-count="${stats.genresSorted.length}">0</div>
          <div class="stat-label">Genres</div>
        </div>
      </div>

      ${stats.dna ? `
      <div class="taste-dna-card">
        <div class="taste-dna-label">Your Taste DNA</div>
        <div class="taste-dna-value">${stats.dna}</div>
      </div>` : ''}

      ${stats.total === 0 ? '<p class="stats-empty">Add some movies to see your stats!</p>' : `
        ${stats.directorsSorted.length > 0 ? `
          <div class="stats-section">
            <h3>Top Directors</h3>
            <div class="bar-chart">
              ${stats.directorsSorted.slice(0, 10).map(([director, count]) => `
                <div class="bar-row">
                  <span class="bar-label">${director}</span>
                  <div class="bar-track">
                    <div class="bar-fill" style="width: ${(count / maxDirector) * 100}%"></div>
                  </div>
                  <span class="bar-value">${count}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="stats-section">
          <h3>Genre Distribution</h3>
          <div class="bar-chart">
            ${stats.genresSorted.slice(0, 10).map(([genre, count]) => `
              <div class="bar-row">
                <span class="bar-label">${genre}</span>
                <div class="bar-track">
                  <div class="bar-fill" style="width: ${(count / maxGenre) * 100}%"></div>
                </div>
                <span class="bar-value">${count}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="stats-section">
          <h3>Rating Distribution</h3>
          <div class="bar-chart">
            ${stats.ratingDist.map((count, i) => `
              <div class="bar-row">
                <span class="bar-label">${'&#9733;'.repeat(i + 1)}</span>
                <div class="bar-track">
                  <div class="bar-fill" style="width: ${stats.total > 0 ? (count / stats.total) * 100 : 0}%"></div>
                </div>
                <span class="bar-value">${count}</span>
              </div>
            `).join('')}
          </div>
        </div>

        ${stats.topRated.length > 0 ? `
          <div class="stats-section">
            <h3>Top Rated</h3>
            <div class="top-list">
              ${stats.topRated.map((m, i) => `
                <div class="top-item">
                  <span class="top-rank">${i + 1}</span>
                  <span class="top-title">${m.title} (${m.year || 'N/A'})</span>
                  <span class="top-rating">${'&#9733;'.repeat(m.rating)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      `}
    `;
  }

  return { compute, render };
})();
