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

  function renderDirectorBadge(directors) {
    if (!directors || directors.length === 0) return '';
    const names = directors.map(d => escapeHtml(d)).join(', ');
    return `<div class="director-badge"><span class="director-badge-icon">&#127916;</span> ${names}</div>`;
  }

  function renderMovieCard(movie) {
    const poster = movie.poster
      ? `<img src="${movie.poster}" alt="${escapeHtml(movie.title)}" loading="lazy">`
      : `<div class="no-poster">${escapeHtml(movie.title)}</div>`;

    const directorLine = (movie.directors || []).length > 0
      ? `<p class="movie-card-director">${escapeHtml(movie.directors[0])}</p>`
      : '';

    return `
      <div class="movie-card" data-id="${movie.id}">
        <div class="movie-card-poster">${poster}</div>
        <div class="movie-card-info">
          <h3 class="movie-card-title">${escapeHtml(movie.title)}</h3>
          <p class="movie-card-year">${movie.year || 'N/A'}</p>
          ${directorLine}
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
          <div class="detail-directors">${renderDirectorBadge(movie.directors)}</div>
          <div class="detail-rating">
            <label>Your Rating:</label>
            ${renderStars(movie.rating)}
          </div>
          ${movie.dateWatched ? `<p class="detail-date">&#128197; Watched: ${new Date(movie.dateWatched).toLocaleDateString()}</p>` : ''}
          ${movie.notes ? `<div class="detail-notes"><label>Notes</label><p>${escapeHtml(movie.notes)}</p></div>` : ''}
          <div class="detail-actions">
            <button class="btn btn-primary" id="detail-edit" data-id="${movie.id}">Edit</button>
            <button class="btn btn-danger" id="detail-delete" data-id="${movie.id}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderDirectorGroup(directorName, movies) {
    const cards = movies.map(m => renderMovieCard(m)).join('');
    return `
      <div class="director-group">
        <div class="director-group-header" data-director="${escapeHtml(directorName)}">
          <span class="director-group-name">${escapeHtml(directorName)}</span>
          <span class="director-group-count">${movies.length} film${movies.length !== 1 ? 's' : ''}</span>
          <span class="director-group-toggle">&#9660;</span>
        </div>
        <div class="director-group-grid">${cards}</div>
      </div>
    `;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // --- Custom Dropdown ---
  // Wraps native <select> elements with styled custom dropdowns
  // The native select stays in the DOM (hidden) so existing change listeners work.

  function initCustomSelects() {
    document.querySelectorAll('.filter-select').forEach(select => {
      if (select.dataset.customized) return;
      select.dataset.customized = 'true';

      const wrapper = document.createElement('div');
      wrapper.className = 'custom-select';

      const trigger = document.createElement('div');
      trigger.className = 'custom-select-trigger';
      trigger.innerHTML = `<span class="custom-select-label">${select.options[select.selectedIndex]?.text || ''}</span><span class="custom-select-arrow">&#9660;</span>`;

      const optionsContainer = document.createElement('div');
      optionsContainer.className = 'custom-select-options';

      function buildOptions() {
        optionsContainer.innerHTML = '';
        Array.from(select.options).forEach(opt => {
          const item = document.createElement('div');
          item.className = 'custom-select-option' + (opt.selected ? ' selected' : '');
          item.textContent = opt.text;
          item.dataset.value = opt.value;
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            select.value = opt.value;
            select.dispatchEvent(new Event('change'));
            trigger.querySelector('.custom-select-label').textContent = opt.text;
            optionsContainer.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
            item.classList.add('selected');
            wrapper.classList.remove('open');
          });
          optionsContainer.appendChild(item);
        });
      }

      buildOptions();

      // Observe the native select for options changes (genre/director filters get rebuilt)
      const observer = new MutationObserver(() => {
        buildOptions();
        trigger.querySelector('.custom-select-label').textContent = select.options[select.selectedIndex]?.text || '';
      });
      observer.observe(select, { childList: true });

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close any other open dropdowns
        document.querySelectorAll('.custom-select.open').forEach(s => {
          if (s !== wrapper) s.classList.remove('open');
        });
        wrapper.classList.toggle('open');
      });

      select.parentNode.insertBefore(wrapper, select);
      wrapper.appendChild(trigger);
      wrapper.appendChild(optionsContainer);
      wrapper.appendChild(select);
    });

    // Close dropdowns on outside click
    document.addEventListener('click', () => {
      document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
    });
  }

  return { showToast, renderStars, renderDirectorBadge, renderMovieCard, renderSearchResult, renderMovieDetail, renderDirectorGroup, initCustomSelects, escapeHtml };
})();
