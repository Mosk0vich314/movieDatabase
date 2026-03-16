const UI = (() => {
  function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  }

  function renderStars(rating, interactive = false) {
    let html = '<div class="star-display">';
    for (let i = 1; i <= 5; i++) {
      const cls = i <= rating ? 'star filled' : 'star';
      const attrs = interactive ? `data-value="${i}" role="button" tabindex="0"` : '';
      html += `<span class="${cls}" ${attrs}>&#9733;</span>`;
    }
    html += '</div>';
    return html;
  }

  function renderMovieCard(movie) {
    const poster = movie.poster
      ? `<img src="${movie.poster}" alt="${escapeHtml(movie.title)}" loading="lazy">`
      : `<div class="no-poster">${escapeHtml(movie.title)}</div>`;

    return `
      <div class="movie-card" data-id="${movie.id}">
        <div class="movie-card-poster">${poster}</div>
        <div class="movie-card-info">
          <h3 class="movie-card-title">${escapeHtml(movie.title)}</h3>
          <p class="movie-card-year">${movie.year || 'N/A'}</p>
          ${renderStars(movie.rating)}
        </div>
      </div>
    `;
  }

  function renderSearchResult(result) {
    const year = result.release_date ? result.release_date.substring(0, 4) : 'N/A';
    const poster = result.poster_path
      ? `<img src="${TMDB.posterUrl(result.poster_path, 'w92')}" alt="${escapeHtml(result.title)}">`
      : `<div class="no-poster-sm">No Poster</div>`;

    return `
      <div class="search-result" data-tmdb-id="${result.id}">
        <div class="search-result-poster">${poster}</div>
        <div class="search-result-info">
          <h4>${escapeHtml(result.title)}</h4>
          <p>${year}</p>
          <p class="search-result-overview">${escapeHtml((result.overview || '').substring(0, 120))}${result.overview && result.overview.length > 120 ? '...' : ''}</p>
        </div>
      </div>
    `;
  }

  function renderMovieDetail(movie) {
    const poster = movie.poster
      ? `<img src="${movie.poster}" alt="${escapeHtml(movie.title)}" class="detail-poster">`
      : `<div class="no-poster-lg">${escapeHtml(movie.title)}</div>`;

    const genres = (movie.genres || []).map(g => `<span class="genre-tag">${escapeHtml(g)}</span>`).join('');

    return `
      <div class="detail-header">
        <button class="btn btn-secondary btn-back" id="detail-back">&larr; Back</button>
      </div>
      <div class="detail-content">
        <div class="detail-poster-wrap">${poster}</div>
        <div class="detail-info">
          <h2>${escapeHtml(movie.title)} <span class="detail-year">(${movie.year || 'N/A'})</span></h2>
          <div class="detail-genres">${genres}</div>
          ${(movie.directors || []).length > 0 ? `<p class="detail-directors">Directed by ${(movie.directors || []).map(d => escapeHtml(d)).join(', ')}</p>` : ''}
          <div class="detail-rating">
            <label>Your Rating:</label>
            ${renderStars(movie.rating)}
          </div>
          ${movie.dateWatched ? `<p class="detail-date">Watched: ${new Date(movie.dateWatched).toLocaleDateString()}</p>` : ''}
          ${movie.notes ? `<div class="detail-notes"><label>Notes:</label><p>${escapeHtml(movie.notes)}</p></div>` : ''}
          <div class="detail-actions">
            <button class="btn btn-primary" id="detail-edit" data-id="${movie.id}">Edit</button>
            <button class="btn btn-danger" id="detail-delete" data-id="${movie.id}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  return { showToast, renderStars, renderMovieCard, renderSearchResult, renderMovieDetail, escapeHtml };
})();