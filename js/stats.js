const Stats = (() => {
  const MILESTONE_VALUES = [10, 25, 50, 100, 250, 500, 1000];

  function computeHeatmap(movies) {
    const counts = {};
    movies.forEach(m => {
      if (m.dateAdded) { const d = m.dateAdded.substring(0, 10); counts[d] = (counts[d] || 0) + 1; }
    });
    const today = new Date();
    const cells = [];
    // Start from day 0 of the week 52 weeks ago so the grid aligns to full weeks
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 364 - startDate.getDay());
    for (let i = 0; i < 371; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().substring(0, 10);
      cells.push({ date: key, count: counts[key] || 0 });
    }
    return cells;
  }

  function computeDecadePassport(movies) {
    const dec = {};
    movies.forEach(m => {
      const yr = parseInt(m.year);
      if (!isNaN(yr)) { const d = Math.floor(yr / 10) * 10; dec[d] = (dec[d] || 0) + 1; }
    });
    return Object.entries(dec)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([decade, count]) => ({ decade: parseInt(decade), count }));
  }

  function generateChallenges(movies) {
    const msPerWeek = 7 * 24 * 3600000;
    const weekNum = Math.floor(Date.now() / msPerWeek);
    const now = new Date();
    const dow = now.getDay();
    const weekStartMs = now.getTime() - (dow === 0 ? 6 : dow - 1) * 86400000;
    const weekStart = new Date(weekStartMs);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().substring(0, 10);

    const addedThisWeek = movies.filter(m => m.dateAdded && m.dateAdded >= weekStartStr).length;
    const highRatedThisWeek = movies.filter(m => m.dateAdded && m.dateAdded >= weekStartStr && m.rating >= 8).length;

    const decCounts = {};
    movies.forEach(m => {
      const yr = parseInt(m.year);
      if (!isNaN(yr)) { const d = Math.floor(yr / 10) * 10; decCounts[d] = (decCounts[d] || 0) + 1; }
    });
    const genreCounts = {};
    movies.forEach(m => (m.genres || []).forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; }));
    const rareGenres = Object.entries(genreCounts).sort((a, b) => a[1] - b[1]).map(([g]) => g);

    const challenges = [];

    // Challenge 1: Weekly catalogue goal
    const weekGoal = 3;
    challenges.push({
      id: 'weekly-add', icon: '🎬',
      title: `Catalogue ${weekGoal} films this week`,
      progress: Math.min(addedThisWeek, weekGoal), goal: weekGoal,
      done: addedThisWeek >= weekGoal,
    });

    // Challenge 2: Decade explorer — target is stable for the week (weekNum only, not collection state)
    const decadePool = [1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
    const targetDecade = decadePool[weekNum % decadePool.length];
    const thisWeekDecade = movies.filter(m =>
      m.dateAdded && m.dateAdded >= weekStartStr &&
      !isNaN(parseInt(m.year)) && Math.floor(parseInt(m.year) / 10) * 10 === targetDecade
    ).length;
    challenges.push({
      id: 'decade', icon: '🗓',
      title: `Add a film from the ${targetDecade}s`,
      progress: Math.min(thisWeekDecade, 1), goal: 1,
      done: thisWeekDecade >= 1,
    });

    // Challenge 3: Genre explorer — rotate through sorted genre keys (alphabetical = stable)
    const genrePool = Object.keys(genreCounts).sort();
    if (genrePool.length > 0) {
      const targetGenre = genrePool[weekNum % genrePool.length];
      const thisWeekGenre = movies.filter(m =>
        m.dateAdded && m.dateAdded >= weekStartStr && (m.genres || []).includes(targetGenre)
      ).length;
      challenges.push({
        id: 'genre', icon: '🎭',
        title: `Add a ${targetGenre} film`,
        progress: Math.min(thisWeekGenre, 1), goal: 1,
        done: thisWeekGenre >= 1,
      });
    } else {
      challenges.push({
        id: 'rate', icon: '⭐',
        title: 'Rate a film 8 or higher',
        progress: Math.min(highRatedThisWeek, 1), goal: 1,
        done: highRatedThisWeek >= 1,
      });
    }

    return challenges;
  }

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

  function computeStreak(movies) {
    const dates = new Set();
    movies.forEach(m => { if (m.dateAdded) dates.add(m.dateAdded.substring(0, 10)); });
    if (!dates.size) return { current: 0, longest: 0 };

    const sorted = Array.from(dates).sort();
    let longest = 1, cur = 1;
    for (let i = 1; i < sorted.length; i++) {
      const diff = (new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000;
      if (diff === 1) { cur++; if (cur > longest) longest = cur; }
      else cur = 1;
    }

    const today = new Date().toISOString().substring(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
    let current = 0;
    if (dates.has(today) || dates.has(yesterday)) {
      current = 1;
      const d = new Date(dates.has(today) ? today : yesterday);
      while (true) {
        d.setDate(d.getDate() - 1);
        if (dates.has(d.toISOString().substring(0, 10))) current++;
        else break;
      }
    }
    return { current, longest };
  }

  function getRank(total) {
    const tiers = [
      { min: 1000, name: 'Auteur',     color: '#f5c518' },
      { min: 500,  name: 'Curator',    color: '#c084fc', next: 'Auteur',     nextAt: 1000 },
      { min: 200,  name: 'Archivist',  color: '#60a5fa', next: 'Curator',    nextAt: 500  },
      { min: 100,  name: 'Cinephile',  color: '#34d399', next: 'Archivist',  nextAt: 200  },
      { min: 50,   name: 'Enthusiast', color: '#e94560', next: 'Cinephile',  nextAt: 100  },
      { min: 25,   name: 'Buff',       color: '#7c5cfc', next: 'Enthusiast', nextAt: 50   },
      { min: 10,   name: 'Viewer',     color: '#94a3b8', next: 'Buff',       nextAt: 25   },
      { min: 0,    name: 'Initiate',   color: '#64748b', next: 'Viewer',     nextAt: 10   },
    ];
    const t = tiers.find(r => total >= r.min);
    return {
      name: t.name,
      color: t.color,
      next: t.next || null,
      nextAt: t.nextAt || null,
      progress: t.nextAt ? ((total - t.min) / (t.nextAt - t.min)) * 100 : 100,
      remaining: t.nextAt ? t.nextAt - total : 0,
    };
  }

  function compute(movies) {
    const total = movies.length;
    const avgRating = total > 0
      ? (movies.reduce((sum, m) => sum + (m.rating || 0), 0) / total).toFixed(1)
      : 0;

    const genreCounts = {};
    movies.forEach(m => {
      (m.genres || []).forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
    });
    const genresSorted = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);

    const directorCounts = {};
    movies.forEach(m => {
      (m.directors || []).forEach(d => { directorCounts[d] = (directorCounts[d] || 0) + 1; });
    });
    const directorsSorted = Object.entries(directorCounts).sort((a, b) => b[1] - a[1]);
    const uniqueDirectors = directorsSorted.length;

    const ratingDist = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    movies.forEach(m => {
      if (m.rating >= 1 && m.rating <= 10) ratingDist[Math.min(Math.floor(m.rating), 10) - 1]++;
    });

    const topRated = [...movies].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 20);

    const totalRuntime = movies.reduce((s, m) => s + (m.runtime || 0), 0);

    const streak = computeStreak(movies);
    const rank = getRank(total);
    const milestones = MILESTONE_VALUES.map(m => ({ count: m, achieved: total >= m }));
    const genreBadges = genresSorted.filter(([, c]) => c >= 5).map(([g, c]) => ({ name: g, count: c }));
    const auteurBadges = directorsSorted.filter(([, c]) => c >= 3).map(([d, c]) => ({ name: d, count: c }));

    return {
      total, avgRating, genresSorted, directorsSorted, uniqueDirectors,
      ratingDist, topRated, dna: tasteDNA(movies),
      totalRuntime, streak, rank, milestones, genreBadges, auteurBadges,
      heatmap: computeHeatmap(movies),
      decadePassport: computeDecadePassport(movies),
      challenges: generateChallenges(movies),
    };
  }

  function fmtRuntime(mins) {
    if (!mins) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
  }

  function renderChallenges(challenges) {
    if (!challenges || challenges.length === 0) return '';
    return `
      <div class="stats-section">
        <h3>Weekly Challenges</h3>
        <div class="challenges-grid">
          ${challenges.map(c => `
            <div class="challenge-card${c.done ? ' challenge-done' : ''}">
              <div class="challenge-icon">${c.icon}</div>
              <div class="challenge-body">
                <div class="challenge-title">${c.title}</div>
                <div class="challenge-bar-wrap">
                  <div class="challenge-bar" style="width:${c.goal > 0 ? Math.round((c.progress / c.goal) * 100) : 0}%"></div>
                </div>
                <div class="challenge-count">${c.progress} / ${c.goal}</div>
              </div>
              ${c.done ? '<div class="challenge-check">&#10003;</div>' : ''}
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function renderDecadePassport(passport) {
    if (!passport || passport.length === 0) return '';
    const maxCount = Math.max(...passport.map(p => p.count), 1);
    return `
      <div class="stats-section">
        <h3>Decade Passport</h3>
        <div class="decade-passport">
          ${passport.map(({ decade, count }) => {
            const level = count >= 20 ? 'gold' : count >= 10 ? 'silver' : count >= 5 ? 'bronze' : 'entry';
            const pct = Math.round((count / maxCount) * 100);
            return `
              <div class="passport-stamp passport-stamp--${level}">
                <div class="passport-decade">${decade}s</div>
                <div class="passport-count">${count}</div>
                <div class="passport-bar"><div class="passport-bar-fill" style="width:${pct}%"></div></div>
                <div class="passport-films">film${count !== 1 ? 's' : ''}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function renderHeatmap(cells) {
    if (!cells || cells.length === 0) return '';
    // Group into weeks (7 days each)
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    // Month labels: show month name at the first week of each month
    let lastMonth = -1;
    const monthLabels = weeks.map(week => {
      const d = new Date(week[0].date + 'T12:00:00');
      const m = d.getMonth();
      if (m !== lastMonth) { lastMonth = m; return d.toLocaleDateString('en', { month: 'short' }); }
      return '';
    });

    const cellHtml = cell => {
      const lvl = cell.count === 0 ? 0 : cell.count === 1 ? 1 : cell.count <= 3 ? 2 : 3;
      const label = `${cell.date}: ${cell.count} film${cell.count !== 1 ? 's' : ''}`;
      return `<div class="hm-cell hm-level-${lvl}" title="${label}"></div>`;
    };

    return `
      <div class="stats-section">
        <h3>Activity</h3>
        <div class="heatmap-wrap">
          <div class="heatmap-months">${monthLabels.map(l => `<span>${l}</span>`).join('')}</div>
          <div class="heatmap-grid">
            ${weeks.map(week => `<div class="hm-week">${week.map(cellHtml).join('')}</div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  function render(stats) {
    const maxGenre = stats.genresSorted.length > 0 ? stats.genresSorted[0][1] : 1;
    const maxDirector = stats.directorsSorted.length > 0 ? stats.directorsSorted[0][1] : 1;
    const hasAchievements = stats.milestones.some(m => m.achieved) || stats.genreBadges.length || stats.auteurBadges.length;

    return `
      <div class="rank-banner" style="--rank-color:${stats.rank.color}">
        <div class="rank-inner">
          <div>
            <div class="rank-label">Collector Rank</div>
            <div class="rank-name">${stats.rank.name}</div>
          </div>
          <div class="rank-count">${stats.total}<span class="rank-count-unit"> film${stats.total !== 1 ? 's' : ''}</span></div>
        </div>
        ${stats.rank.next ? `
          <div class="rank-progress-wrap">
            <div class="rank-progress-bar" style="width:${stats.rank.progress.toFixed(1)}%"></div>
          </div>
          <div class="rank-next-label">${stats.rank.remaining} more to <strong>${stats.rank.next}</strong></div>
        ` : '<div class="rank-next-label rank-next-label--max">Maximum rank — legendary status achieved</div>'}
      </div>

      <div class="stats-overview">
        <div class="stat-card">
          <div class="stat-number" data-count="${stats.total}">0</div>
          <div class="stat-label">Films Watched</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-count="${stats.avgRating}">0</div>
          <div class="stat-label">Avg Rating</div>
        </div>
        <div class="stat-card">
          <div class="stat-number stat-number--sm">${fmtRuntime(stats.totalRuntime)}</div>
          <div class="stat-label">Time Watched</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-count="${stats.streak.current}">0</div>
          <div class="stat-label">Day Streak${stats.streak.longest > 1 ? ` <span class="streak-best">best ${stats.streak.longest}</span>` : ''}</div>
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
        ${renderChallenges(stats.challenges)}

        ${renderDecadePassport(stats.decadePassport)}

        ${hasAchievements ? `
        <div class="stats-section">
          <h3>Achievements</h3>

          <div class="achievement-group">
            <div class="achievement-group-label">Milestones</div>
            <div class="milestone-row">
              ${stats.milestones.map(m => `
                <div class="milestone-chip${m.achieved ? ' milestone-chip--unlocked' : ''}">
                  ${m.achieved ? '&#127902;' : '&#128274;'} ${m.count}
                </div>
              `).join('')}
            </div>
          </div>

          ${stats.genreBadges.length ? `
          <div class="achievement-group">
            <div class="achievement-group-label">Genre Favourites</div>
            <div class="achievement-badges">
              ${stats.genreBadges.map(b => `
                <div class="achievement-badge">
                  <span class="ab-name">${b.name}</span>
                  <span class="ab-count">&times;${b.count}</span>
                </div>
              `).join('')}
            </div>
          </div>` : ''}

          ${stats.auteurBadges.length ? `
          <div class="achievement-group">
            <div class="achievement-group-label">Director Devotee</div>
            <div class="achievement-badges">
              ${stats.auteurBadges.map(b => `
                <div class="achievement-badge achievement-badge--director">
                  <span class="ab-name">${b.name}</span>
                  <span class="ab-count">&times;${b.count}</span>
                </div>
              `).join('')}
            </div>
          </div>` : ''}
        </div>
        ` : ''}

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
            ${stats.ratingDist.map((count, i) => {
              const r = i + 1;
              const color = UI.ratingColor(r);
              return `
              <div class="bar-row">
                <span class="bar-label" style="color:${color};font-weight:700">${r}</span>
                <div class="bar-track">
                  <div class="bar-fill" style="width: ${stats.total > 0 ? (count / stats.total) * 100 : 0}%;background:${color}"></div>
                </div>
                <span class="bar-value">${count}</span>
              </div>`;
            }).join('')}
          </div>
        </div>

        ${renderHeatmap(stats.heatmap)}
      `}
    `;
  }

  return { compute, render, MILESTONE_VALUES };
})();
