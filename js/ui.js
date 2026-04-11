const UI = (() => {
  function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  }

  function ratingColor(r) {
    if (r >= 9) return '#21d07a';
    if (r >= 7) return '#6bbd40';
    if (r >= 5) return '#ccb833';
    if (r >= 3) return '#d97c2e';
    return '#db2360';
  }

  function ratingColorRGB(r) {
    if (r >= 9) return '33,208,122';
    if (r >= 7) return '107,189,64';
    if (r >= 5) return '204,184,51';
    if (r >= 3) return '217,124,46';
    return '219,35,96';
  }

  function formatRating(r) {
    if (!r) return '-';
    const s = r.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  }

  function renderRatingBadge(rating) {
    if (!rating) return '<span class="rating-badge rating-na">-</span>';
    return `<span class="rating-badge" style="background:${ratingColor(rating)}">${formatRating(rating)}</span>`;
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

    const rcAttr = movie.rating ? ` style="--rc:${ratingColorRGB(movie.rating)}"` : '';
    const ratedClass = movie.rating ? ' rated' : '';

    return `
      <div class="movie-card${ratedClass}"${rcAttr} data-id="${movie.id}">
        <div class="movie-card-poster">${poster}</div>
        <div class="movie-card-info">
          <h3 class="movie-card-title">${escapeHtml(movie.title)}</h3>
          <p class="movie-card-year">${movie.year || 'N/A'}</p>
          ${directorLine}
          ${renderRatingBadge(movie.rating)}
        </div>
      </div>
    `;
  }

  function renderSearchResult(result) {
    const year = result.release_date ? result.release_date.substring(0, 4) : 'N/A';
    const poster = result.poster_path
      ? `<img src="${TMDB.posterUrl(result.poster_path, 'w92')}" alt="${escapeHtml(result.title)}">`
      : `<div class="no-poster-sm">No Poster</div>`;

    const origTitle = result.original_title && result.original_title !== result.title
      ? `<p class="search-result-orig-title">${escapeHtml(result.original_title)}</p>`
      : '';

    return `
      <div class="search-result" data-tmdb-id="${result.id}">
        <div class="search-result-poster">${poster}</div>
        <div class="search-result-info">
          <h4>${escapeHtml(result.title)}</h4>
          ${origTitle}
          <p>${year}</p>
          <p class="search-result-overview">${escapeHtml((result.overview || '').substring(0, 120))}${result.overview && result.overview.length > 120 ? '...' : ''}</p>
        </div>
        <button class="search-result-watchlist-btn" data-tmdb-id="${result.id}" title="Add to Watchlist">+ Watchlist</button>
      </div>
    `;
  }

  function renderWatchlistCard(movie) {
    const poster = movie.poster
      ? `<img src="${movie.poster}" alt="${escapeHtml(movie.title)}" loading="lazy">`
      : `<div class="no-poster">${escapeHtml(movie.title)}</div>`;

    const directorLine = (movie.directors || []).length > 0
      ? `<p class="movie-card-director">${escapeHtml(movie.directors[0])}</p>`
      : '';

    const overviewLine = movie.overview
      ? `<p class="movie-card-overview">${escapeHtml(movie.overview.substring(0, 120))}${movie.overview.length > 120 ? '...' : ''}</p>`
      : '';

    return `
      <div class="movie-card watchlist-card" data-id="${movie.id}">
        <div class="movie-card-poster">${poster}</div>
        <div class="movie-card-info">
          <h3 class="movie-card-title">${escapeHtml(movie.title)}</h3>
          <p class="movie-card-year">${movie.year || 'N/A'}</p>
          ${directorLine}
          ${overviewLine}
          <button class="watchlist-card-btn" data-id="${movie.id}">&#10003; Watched</button>
        </div>
      </div>
    `;
  }

  function renderMovieDetail(movie) {
    const poster = movie.poster
      ? `<img src="${movie.poster}" alt="${escapeHtml(movie.title)}" class="detail-poster">`
      : `<div class="no-poster-lg">${escapeHtml(movie.title)}</div>`;

    const genres = (movie.genres || []).map(g => `<span class="genre-tag">${escapeHtml(g)}</span>`).join('');

    const backdropHtml = movie.backdrop
      ? `<div class="detail-backdrop-wrap">
          <img src="${movie.backdrop}" class="detail-backdrop-img" alt="">
          <div class="detail-backdrop-overlay"></div>
        </div>`
      : '';

    const runtimeHtml = movie.runtime
      ? `<div class="detail-runtime">&#9201; ${movie.runtime >= 60 ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : `${movie.runtime}m`}</div>`
      : '';

    const castHtml = (movie.cast && movie.cast.length > 0)
      ? `<div class="detail-cast">
          <div class="cast-label">Cast</div>
          <div class="cast-scroll">
            ${movie.cast.map(c => `
              <div class="cast-member">
                ${c.profileUrl
                  ? `<img src="${c.profileUrl}" class="cast-photo" alt="${escapeHtml(c.name)}" loading="lazy">`
                  : `<div class="cast-photo-placeholder"></div>`}
                <div class="cast-name">${escapeHtml(c.name)}</div>
                <div class="cast-char">${escapeHtml(c.character || '')}</div>
              </div>
            `).join('')}
          </div>
        </div>`
      : '';

    return `
      ${backdropHtml}
      <div class="detail-header">
        <button class="btn btn-secondary btn-back" id="detail-back">&larr; Back</button>
      </div>
      <div class="detail-content">
        <div class="detail-poster-wrap">${poster}</div>
        <div class="detail-info">
          <h2>${escapeHtml(movie.title)} <span class="detail-year">(${movie.year || 'N/A'})</span></h2>
          ${runtimeHtml}
          <div class="detail-genres">${genres}</div>
          <div class="detail-directors">${renderDirectorBadge(movie.directors)}</div>
          ${movie.overview ? `<p class="detail-overview">${escapeHtml(movie.overview)}</p>` : ''}
          <div class="detail-rating">
            <label>Your Rating:</label>
            ${renderRatingBadge(movie.rating)}
          </div>
          ${movie.notes ? `<div class="detail-notes"><label>Notes</label><p>${escapeHtml(movie.notes)}</p></div>` : ''}
          <div class="detail-actions">
            ${movie.watchlist
              ? `<button class="btn btn-primary" id="detail-mark-watched">&#10003; Mark as Watched</button>`
              : `<button class="btn btn-primary" id="detail-edit" data-id="${movie.id}">Edit</button>`
            }
            <button class="btn btn-danger" id="detail-delete" data-id="${movie.id}">Delete</button>
          </div>
        </div>
      </div>
      ${castHtml}
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

  function renderFilmCard(movie) {
    const poster = movie.poster
      ? `<img src="${movie.poster}" alt="${escapeHtml(movie.title)}" loading="lazy">`
      : `<div class="no-poster-lane">${escapeHtml(movie.title)}</div>`;

    const sizeClass = movie.rating >= 9 ? 'card-xl' : (movie.rating >= 7 ? 'card-lg' : 'card-sm');
    const ratedClass = movie.rating ? ' rated' : '';
    const rcAttr = movie.rating ? ` style="--rc:${ratingColorRGB(movie.rating)}"` : '';
    const ratingBadge = movie.rating
      ? `<span class="film-card-rating" style="background:${ratingColor(movie.rating)}">${formatRating(movie.rating)}</span>`
      : '';

    return `
      <div class="film-card ${sizeClass}${ratedClass}"${rcAttr} data-id="${movie.id}">
        ${poster}
        <div class="film-card-overlay">
          ${ratingBadge}
          <span class="film-card-title">${escapeHtml(movie.title)}</span>
          <span class="film-card-year">${movie.year || ''}</span>
        </div>
      </div>
    `;
  }

  function renderLanes(sections) {
    return `<div class="decade-lanes">${
      sections.map(({ label, films }) => `
        <div class="decade-section">
          <div class="decade-header">
            <span class="decade-label">${label}</span>
            <span class="decade-count">${films.length} film${films.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="decade-scroll">${films.map(m => renderFilmCard(m)).join('')}</div>
        </div>
      `).join('')
    }</div>`;
  }

  function renderDecadeLanes(movies, dir = 'desc') {
    const groups = {};
    movies.forEach(m => {
      const yr = parseInt(m.year);
      const decade = !isNaN(yr) ? Math.floor(yr / 10) * 10 : null;
      const key = decade !== null ? `${decade}s` : 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });

    const keys = Object.keys(groups).sort((a, b) => {
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      return dir === 'asc' ? parseInt(a) - parseInt(b) : parseInt(b) - parseInt(a);
    });

    return renderLanes(keys.map(k => ({
      label: k,
      films: [...groups[k]].sort((a, b) => (b.rating || 0) - (a.rating || 0))
    })));
  }

  function renderRatingLanes(movies, dir = 'desc') {
    const labels = { 5: '9-10', 4: '7-8', 3: '5-6', 2: '3-4', 1: '1-2', 0: 'Unrated' };
    const groups = { 5: [], 4: [], 3: [], 2: [], 1: [], 0: [] };
    movies.forEach(m => {
      const r = m.rating >= 1 && m.rating <= 10 ? Math.ceil(m.rating / 2) : 0;
      groups[r].push(m);
    });
    const order = dir === 'desc' ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];
    return renderLanes(
      order.filter(r => groups[r].length > 0).map(r => ({
        label: labels[r],
        films: [...groups[r]].sort((a, b) => (b.year || 0) - (a.year || 0))
      }))
    );
  }

  function renderTitleLanes(movies, dir = 'asc') {
    const groups = {};
    movies.forEach(m => {
      const first = (m.title || '#')[0].toUpperCase();
      const key = /[A-Z]/.test(first) ? first : '#';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });
    const keys = Object.keys(groups).sort((a, b) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
    });
    return renderLanes(keys.map(k => ({
      label: k,
      films: [...groups[k]].sort((a, b) => {
        const ta = (a.title || '').toLowerCase(), tb = (b.title || '').toLowerCase();
        return dir === 'asc' ? ta.localeCompare(tb) : tb.localeCompare(ta);
      })
    })));
  }

  function renderDirectorLanes(movies) {
    const groups = {};
    movies.forEach(m => {
      const dirs = (m.directors || []).length > 0 ? m.directors : ['Unknown Director'];
      dirs.forEach(d => {
        if (!groups[d]) groups[d] = [];
        groups[d].push(m);
      });
    });
    const keys = Object.keys(groups).sort((a, b) => {
      if (a === 'Unknown Director') return 1;
      if (b === 'Unknown Director') return -1;
      return a.localeCompare(b);
    });
    return renderLanes(keys.map(k => ({
      label: escapeHtml(k),
      films: [...groups[k]].sort((a, b) => (b.year || 0) - (a.year || 0))
    })));
  }

  const GENRE_PALETTE = {
    'Action':          { bg: '#200a0a', accent: '#cc2200' },
    'Adventure':       { bg: '#0a1a08', accent: '#2c9020' },
    'Animation':       { bg: '#1a1500', accent: '#c8a800' },
    'Comedy':          { bg: '#1a1200', accent: '#c09000' },
    'Crime':           { bg: '#0a0a1f', accent: '#3840cc' },
    'Documentary':     { bg: '#001814', accent: '#00a090' },
    'Drama':           { bg: '#120018', accent: '#9030b0' },
    'Family':          { bg: '#181000', accent: '#c06828' },
    'Fantasy':         { bg: '#0e0a22', accent: '#6030d0' },
    'History':         { bg: '#1a1200', accent: '#a87810' },
    'Horror':          { bg: '#200000', accent: '#cc0000' },
    'Music':           { bg: '#000f1a', accent: '#0090c8' },
    'Mystery':         { bg: '#001018', accent: '#1050a8' },
    'Romance':         { bg: '#1e0010', accent: '#c00060' },
    'Science Fiction': { bg: '#001820', accent: '#00a8cc' },
    'Thriller':        { bg: '#0c0a18', accent: '#283898' },
    'War':             { bg: '#14100a', accent: '#787040' },
    'Western':         { bg: '#1e1000', accent: '#a06820' },
  };

  function getGenrePalette(genres) {
    const g = genres && genres[0];
    return GENRE_PALETTE[g] || { bg: '#0d1520', accent: '#304468' };
  }

  function renderBlurayShelf(movies) {
    // Group by primary genre, sort groups by count desc
    const groups = {};
    const noGenre = [];
    movies.forEach(m => {
      const g = m.genres && m.genres[0];
      if (g) { if (!groups[g]) groups[g] = []; groups[g].push(m); }
      else noGenre.push(m);
    });
    const sortedGenres = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    if (noGenre.length) sortedGenres.push(null);

    let casesHtml = '';
    sortedGenres.forEach((genre, i) => {
      const group = genre ? groups[genre] : noGenre;
      casesHtml += `<div class="shelf-genre-divider${i === 0 ? ' shelf-genre-divider--first' : ''}"><span>${escapeHtml(genre || '')}</span></div>`;
      group.forEach(m => {
        const pal = getGenrePalette(m.genres);
        const posterVar = m.poster ? `;--poster:url('${m.poster}')` : '';
        casesHtml += `
          <div class="bluray-case" data-id="${m.id}" style="--sc:${pal.bg};--ac:${pal.accent}${posterVar}">
            <div class="case-spine">
              <span class="spine-title">${escapeHtml(m.title)}</span>
              <span class="spine-year">${m.year || ''}</span>
            </div>
          </div>
        `;
      });
    });

    return `
      <div class="bluray-shelf-wrap">
        <div class="shelf-ambient"></div>
        <div class="shelf-row">${casesHtml}</div>
        <div class="shelf-plank"></div>
        <div class="shelf-shadow"></div>
      </div>
    `;
  }

  function renderPosterGrid(movies) {
    return `<div class="poster-grid">
      ${movies.map(m => {
        const img = m.poster
          ? `<img src="${m.poster}" alt="${escapeHtml(m.title)}" loading="lazy">`
          : `<div class="poster-card-no-img">${escapeHtml(m.title)}</div>`;
        const ratingClass = m.rating ? ' rated' : '';
        const rcAttr = m.rating ? ` style="--rc:${ratingColorRGB(m.rating)}"` : '';
        return `
          <div class="poster-card${ratingClass}"${rcAttr} data-id="${m.id}">
            ${img}
            <div class="poster-card-overlay">
              <div class="poster-card-title">${escapeHtml(m.title)}</div>
              <div class="poster-card-year">${m.year || ''}</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>`;
  }

  function renderPersonResult(person) {
    const photo = person.profile_path
      ? `<img src="${TMDB.profileUrl(person.profile_path)}" alt="${escapeHtml(person.name)}">`
      : `<div class="no-poster-sm">?</div>`;
    const knownFor = (person.known_for || [])
      .slice(0, 2)
      .map(f => escapeHtml(f.title || f.name || ''))
      .filter(Boolean)
      .join(', ');
    return `
      <div class="search-result" data-person-id="${person.id}">
        <div class="search-result-poster">${photo}</div>
        <div class="search-result-info">
          <h4>${escapeHtml(person.name)}</h4>
          <p>Director</p>
          ${knownFor ? `<p class="search-result-overview">Known for: ${knownFor}</p>` : ''}
        </div>
      </div>
    `;
  }

  function renderFilmographyResult(film, addedSet) {
    const year = film.release_date ? film.release_date.substring(0, 4) : 'N/A';
    const poster = film.poster_path
      ? `<img src="${TMDB.posterUrl(film.poster_path, 'w92')}" alt="${escapeHtml(film.title)}">`
      : `<div class="no-poster-sm">No Poster</div>`;
    const isAdded = addedSet && addedSet.has(String(film.id));
    const addedClass = isAdded ? ' search-result--added' : '';
    const action = isAdded
      ? `<span class="search-result-added-label">Added</span>`
      : `<button class="search-result-watchlist-btn" data-tmdb-id="${film.id}" title="Add to Watchlist">+ Watchlist</button>`;
    return `
      <div class="search-result${addedClass}" data-tmdb-id="${film.id}">
        <div class="search-result-poster">${poster}</div>
        <div class="search-result-info">
          <h4>${escapeHtml(film.title)}</h4>
          <p>${year}</p>
          <p class="search-result-overview">${escapeHtml((film.overview || '').substring(0, 120))}${film.overview && film.overview.length > 120 ? '...' : ''}</p>
        </div>
        ${action}
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

  return { showToast, ratingColor, ratingColorRGB, formatRating, renderRatingBadge, renderDirectorBadge, renderMovieCard, renderFilmCard, renderDecadeLanes, renderRatingLanes, renderTitleLanes, renderDirectorLanes, renderSearchResult, renderPersonResult, renderFilmographyResult, renderWatchlistCard, renderMovieDetail, renderDirectorGroup, renderPosterGrid, renderBlurayShelf, initCustomSelects, escapeHtml };
})();
