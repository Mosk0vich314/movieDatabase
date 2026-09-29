// Top 10 poster set — a countdown of ranked posters drawn to canvas.
// One poster per film: a giant rank numeral filled with the film's own still,
// a photo band across the bottom, the title set in a colour sampled from the
// image, grain over everything. Sized 1080x1350 for social.
const Posters = (() => {
  const W = 1080, H = 1350;
  const FACE = 'Montserrat, Impact, Haettenschweiler, sans-serif';

  // TMDB stores backdrops at w1280; the numeral fill upscales hard, so pull
  // the original when we can.
  function hiRes(url) {
    return (url || '').replace(/\/w\d+\//, '/original/');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ---- Colour ----
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    if (s === 0) { const v = l * 255; return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
  }

  const css = (c) => `rgb(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0})`;

  // Bucket the pixels by hue, weighted by saturation, and take the strongest
  // bucket — the film's own colour rather than a muddy average.
  function samplePalette(img) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 64, 64);
    let data;
    try { data = x.getImageData(0, 0, 64, 64).data; }
    catch (_) { return fallbackPalette(); }

    const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    let ar = 0, ag = 0, ab = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      ar += r; ag += g; ab += b; n++;
      const [h, s, l] = rgbToHsl(r, g, b);
      if (l < 0.18 || l > 0.86 || s < 0.16) continue;
      const bk = buckets[Math.min(11, Math.floor(h * 12))];
      const w = s * (1 - Math.abs(l - 0.5));
      bk.w += w; bk.r += r * w; bk.g += g * w; bk.b += b * w;
    }

    const avg = [ar / n, ag / n, ab / n];
    const best = buckets.reduce((a, b) => (b.w > a.w ? b : a), buckets[0]);
    const raw = best.w > 0 ? [best.r / best.w, best.g / best.w, best.b / best.w] : avg;

    // Push the accent until it reads as ink on a near-black ground
    const [ah, as, al] = rgbToHsl(raw[0], raw[1], raw[2]);
    const accent = hslToRgb(ah, Math.min(1, Math.max(0.42, as * 1.3)), Math.min(0.74, Math.max(0.58, al * 1.15)));
    const [gh, gs] = rgbToHsl(avg[0], avg[1], avg[2]);
    return {
      accent,
      // Keep enough saturation that the ground reads as the film's colour
      // rather than as plain black.
      ground: hslToRgb(gh, Math.min(0.5, Math.max(gs, 0.14)), 0.07),
      groundHi: hslToRgb(gh, Math.min(0.55, Math.max(gs * 1.1, 0.16)), 0.145),
      lum: (avg[0] * 0.299 + avg[1] * 0.587 + avg[2] * 0.114) / 255,
    };
  }

  function fallbackPalette() {
    return { accent: [214, 205, 188], ground: [12, 12, 18], groundHi: [28, 28, 40], lum: 0.4, accentLum: 0.6 };
  }

  // ---- Texture ----
  let grainTile = null;
  function grainPattern(ctx) {
    if (!grainTile) {
      const t = document.createElement('canvas');
      t.width = t.height = 200;
      const tx = t.getContext('2d');
      const id = tx.createImageData(200, 200);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = 108 + Math.random() * 96;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
        id.data[i + 3] = 255;
      }
      tx.putImageData(id, 0, 0);
      grainTile = t;
    }
    return ctx.createPattern(grainTile, 'repeat');
  }

  // ---- Drawing helpers ----
  function drawCover(ctx, img, dx, dy, dw, dh, focusY = 0.5) {
    const scale = Math.max(dw / img.width, dh / img.height);
    const sw = dw / scale, sh = dh / scale;
    const sx = (img.width - sw) / 2;
    const sy = Math.max(0, Math.min(img.height - sh, img.height * focusY - sh / 2));
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function spacedWidth(ctx, text, sp) {
    let w = 0;
    for (const ch of text) w += ctx.measureText(ch).width + sp;
    return Math.max(0, w - sp);
  }

  function spacedText(ctx, text, x, y, sp, align = 'left') {
    let cx = x;
    if (align === 'right') cx = x - spacedWidth(ctx, text, sp);
    else if (align === 'center') cx = x - spacedWidth(ctx, text, sp) / 2;
    for (const ch of text) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + sp;
    }
  }

  // Shrink the title until it fits the measure in at most two lines.
  function fitTitle(ctx, title, maxW, startSize, spRatio) {
    let last = null;
    for (let size = startSize; size >= 24; size -= 2) {
      ctx.font = `800 ${size}px ${FACE}`;
      const sp = size * spRatio;
      const words = title.split(/\s+/);
      const lines = [];
      let cur = '';
      for (const wd of words) {
        const test = cur ? `${cur} ${wd}` : wd;
        if (!cur || spacedWidth(ctx, test, sp) <= maxW) cur = test;
        else { lines.push(cur); cur = wd; }
      }
      lines.push(cur);
      last = { size, sp, lines };
      if (lines.length <= 2 && lines.every(l => spacedWidth(ctx, l, sp) <= maxW)) return last;
    }
    return last;
  }

  // ---- The poster ----
  async function generate(movie, rank) {
    const src = hiRes(movie.backdrop || movie.poster || '');
    const img = await tryImage(src);

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const pal = img ? samplePalette(img) : fallbackPalette();

    // Ground
    const ground = ctx.createLinearGradient(0, 0, 0, H);
    ground.addColorStop(0, css(pal.groundHi));
    ground.addColorStop(1, css(pal.ground));
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, W, H);

    const bandY = Math.round(H * 0.6);

    // Rank numeral, filled with the still itself. Built on its own canvas so
    // `source-in` can pour the image through the glyph.
    const numeral = String(rank);
    ctx.font = `800 400px ${FACE}`;
    const m = ctx.measureText(numeral);
    const wRatio = m.width / 400;
    const capRatio = (m.actualBoundingBoxAscent || 288) / 400;
    // A narrow glyph (the 1) would leave the frame half empty at the height
    // that suits a round one, so let it run taller instead.
    const heightTarget = H * (wRatio < 0.45 ? 0.86 : 0.74);
    const size = Math.min(heightTarget / capRatio, (W * (numeral.length > 1 ? 1 : 1.02)) / wRatio);
    const baseY = H * 0.045 + size * capRatio;

    const mask = document.createElement('canvas');
    mask.width = W; mask.height = H;
    const mc = mask.getContext('2d');
    mc.font = `800 ${size}px ${FACE}`;
    mc.textAlign = 'center';
    mc.textBaseline = 'alphabetic';
    mc.fillStyle = img ? '#ffffff' : css(pal.groundHi);
    mc.fillText(numeral, W / 2, baseY);
    if (img) {
      // A dark still needs more lift than a bright one, or the glyph sinks
      // into the ground instead of reading as printed ink.
      const bright = Math.min(2, Math.max(1.2, 1.15 + (0.45 - pal.lum) * 1.7));
      const wash = Math.min(0.44, Math.max(0.28, 0.3 + (0.4 - pal.lum) * 0.5));
      mc.globalCompositeOperation = 'source-in';
      if ('filter' in mc) mc.filter = `grayscale(0.72) brightness(${bright.toFixed(2)}) contrast(0.92)`;
      drawCover(mc, img, 0, 0, W, H, 0.4);
      if ('filter' in mc) mc.filter = 'none';
      mc.globalCompositeOperation = 'source-atop';
      mc.fillStyle = `rgba(228, 233, 240, ${wash.toFixed(2)})`;
      mc.fillRect(0, 0, W, H);
      mc.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(mask, 0, 0);

    // Photo band — the numeral runs on behind it
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bandY, W, H - bandY);
    ctx.clip();
    if (img) drawCover(ctx, img, 0, bandY, W, H - bandY, 0.5);
    else { ctx.fillStyle = css(pal.ground); ctx.fillRect(0, bandY, W, H - bandY); }
    const grade = ctx.createLinearGradient(0, bandY, 0, H);
    grade.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    grade.addColorStop(0.3, 'rgba(0, 0, 0, 0.08)');
    grade.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    ctx.fillStyle = grade;
    ctx.fillRect(0, bandY, W, H - bandY);
    ctx.restore();

    // Title, sitting on the band's edge
    const M = 64;
    const fit = fitTitle(ctx, (movie.title || '').toUpperCase(), W - M * 2, 66, 0.1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `800 ${fit.size}px ${FACE}`;
    ctx.fillStyle = css(pal.accent);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 18;
    let ty = bandY - 44 - (fit.lines.length - 1) * fit.size * 1.14;
    for (const line of fit.lines) {
      spacedText(ctx, line, M, ty, fit.sp);
      ty += fit.size * 1.14;
    }
    ctx.shadowBlur = 0;

    // Credits, printed onto the top of the photo
    const meta = [movie.year, (movie.directors || [])[0]].filter(Boolean).join('   ·   ').toUpperCase();
    if (meta) {
      ctx.font = `600 26px ${FACE}`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      spacedText(ctx, meta, M, bandY + 52, 26 * 0.22);
    }

    // The rating that earned the rank
    if (movie.rating) {
      const shown = (typeof UI !== 'undefined' && UI.formatRating)
        ? UI.formatRating(movie.rating) : movie.rating;
      ctx.font = `700 24px ${FACE}`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      spacedText(ctx, `RATED ${shown}`, W - M, H - 52, 24 * 0.2, 'right');
    }

    // Grain and vignette over the whole print
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.17;
    ctx.fillStyle = grainPattern(ctx);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const vig = ctx.createRadialGradient(W / 2, H * 0.45, W * 0.2, W / 2, H * 0.5, W * 0.95);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    return canvas;
  }

  // ---- Deck ----

  // The hand-ranked Top 10 (Chart > My Top 10), resolved against the films it
  // was handed, #1 first. Key duplicated from app.js rather than imported —
  // this module stays standalone.
  function manualTop10(movies) {
    let ids = [];
    try {
      const raw = JSON.parse(localStorage.getItem('manualTop10') || '[]');
      if (Array.isArray(raw)) ids = raw.map(Number).filter(n => !isNaN(n));
    } catch (_) { return []; }
    const byId = new Map(movies.map(m => [m.id, m]));
    return ids.map(id => byId.get(id)).filter(Boolean);
  }

  // Sorting by score only settles an order while the scores disagree — a wall
  // of 10s (or of ★★★★★) leaves the top of the deck arranged by nothing. So a
  // hand-ranked list wins whenever the user has built one long enough to print.
  function pickTop(movies, count = 10) {
    const manual = manualTop10(movies).slice(0, count);
    const ranked = manual.length >= 3
      ? manual
      : movies
          .filter(m => !m.watchlist && (m.rating || 0) > 0)
          .sort((a, b) => (b.rating || 0) - (a.rating || 0) ||
            new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0))
          .slice(0, count);
    return ranked
      .map((movie, i) => ({ movie, rank: i + 1 }))
      .reverse(); // count down to #1, the way a carousel reads
  }

  async function ensureFonts() {
    if (!document.fonts) return;
    try {
      await Promise.all([
        document.fonts.load(`800 300px Montserrat`),
        document.fonts.load(`600 26px Montserrat`),
        document.fonts.load(`400 120px Staatliches`),
      ]);
      await document.fonts.ready;
    } catch (_) { /* system fallback is fine */ }
  }

  // Older entries were saved before backdrops were stored — fill the gap.
  async function ensureBackdrop(movie) {
    if (movie.backdrop || !movie.tmdbId || typeof TMDB === 'undefined') return;
    try {
      const details = await TMDB.getMovieDetails(movie.tmdbId);
      if (details.backdrop_path) {
        movie.backdrop = TMDB.posterUrl(details.backdrop_path, 'w1280');
        if (typeof MovieDB !== 'undefined' && movie.id) await MovieDB.updateMovie(movie, {metadataOnly:true});
      }
    } catch (_) { /* the poster will do */ }
  }

  const fileName = (item) =>
    `top10-${String(item.rank).padStart(2, '0')}-${(item.movie.title || 'film')
      .replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')}.png`;

  function buzz(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} }
  }

  // The deck chrome every print set shares: the modal, the progress bar shown
  // while the canvases are drawn, and the swipeable track they land in. The
  // prints are handed over with `add()` — {blob, url, name, alt, title} — so a
  // one-print board and a five-page countdown mount the same way, and closing
  // mid-print still revokes whatever was made so far.
  function mountDeck(labelText, multi) {
    const deck = document.createElement('div');
    deck.id = 'poster-deck';
    deck.className = 'poster-deck';
    deck.innerHTML = `
      <div class="pd-backdrop"></div>
      <div class="pd-content">
        <button class="pd-close" aria-label="Close">&times;</button>
        <div class="pd-stage">
          <div class="pd-loading">
            <div class="pd-loading-label">${labelText}</div>
            <div class="pd-loading-track"><div class="pd-loading-fill"></div></div>
          </div>
        </div>
        ${multi ? '<div class="pd-dots"></div>' : ''}
        <div class="pd-actions">
          <button class="btn btn-primary pd-share" type="button" disabled>Share</button>
          <button class="btn btn-secondary pd-save" type="button" disabled>&#11015; Save</button>
          ${multi ? '<button class="btn btn-secondary pd-save-all" type="button" disabled>Save all</button>' : ''}
        </div>
      </div>`;
    document.body.appendChild(deck);
    const releaseFocus = typeof UI !== 'undefined' ? UI.focusDialog(deck,labelText) : () => {};

    const items = [];
    const onClosed = [];
    let current = 0;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      releaseFocus();
      document.removeEventListener('keydown', onEsc);
      items.forEach(it => URL.revokeObjectURL(it.url));
      onClosed.forEach(fn => fn());
      deck.classList.add('poster-deck--out');
      setTimeout(() => deck.remove(), 200);
    };
    deck.querySelector('.pd-close').addEventListener('click', close);
    deck.querySelector('.pd-backdrop').addEventListener('click', close);
    function onEsc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onEsc);

    const stage = deck.querySelector('.pd-stage');

    return {
      closed: () => closed,
      // Anything waiting on the person — the header picker — has to be let go
      // when they close the deck, or it waits for an answer that never comes.
      onClose: (fn) => onClosed.push(fn),
      add: (item) => items.push(item),
      // Hand the stage over to a step that asks something before printing.
      ask(node) {
        deck.classList.add('poster-deck--asking');
        stage.replaceChildren(node);
      },
      // Back to the progress bar. The elements are re-made because `ask` may
      // have replaced them, so `progress` looks them up each time.
      busy(text) {
        deck.classList.remove('poster-deck--asking');
        stage.innerHTML = `
          <div class="pd-loading">
            <div class="pd-loading-label">${text}</div>
            <div class="pd-loading-track"><div class="pd-loading-fill"></div></div>
          </div>`;
      },
      progress(frac, text) {
        const fillEl = deck.querySelector('.pd-loading-fill');
        const labelEl = deck.querySelector('.pd-loading-label');
        if (fillEl) fillEl.style.width = `${Math.round(frac * 100)}%`;
        if (text && labelEl) labelEl.textContent = text;
      },
      // `alt` lands in markup, so callers pass a rank or a page number — never
      // a film title, which arrives from TMDB or an imported backup.
      show(shareTitle, tall) {
        deck.classList.remove('poster-deck--asking');
        const trackNode = document.createElement('div');
        trackNode.className = items.length > 1 ? 'pd-track' : '';
        for (const it of items) {
          const node = document.createElement('div');
          node.className = `pd-slide${tall ? ' pd-slide--tall' : ''}`;
          const img = document.createElement('img');
          img.src = it.url; img.alt = it.alt;
          node.appendChild(img); trackNode.appendChild(node);
        }
        stage.replaceChildren(trackNode);

        const dots = deck.querySelector('.pd-dots');
        const track = stage.querySelector('.pd-track');
        if (dots && track) {
          dots.innerHTML = items.map((_, i) => `<span class="pd-dot${i === 0 ? ' active' : ''}"></span>`).join('');
          track.addEventListener('scroll', () => {
            const i = Math.round(track.scrollLeft / track.clientWidth);
            if (i === current || !items[i]) return;
            current = i;
            dots.querySelectorAll('.pd-dot').forEach((d, j) => d.classList.toggle('active', j === i));
          }, { passive: true });
        }

        const saveBtn = deck.querySelector('.pd-save');
        const shareBtn = deck.querySelector('.pd-share');
        const saveAllBtn = deck.querySelector('.pd-save-all');
        [saveBtn, shareBtn, saveAllBtn].forEach(b => { if (b) b.disabled = false; });

        const saveOne = (it) => {
          const link = document.createElement('a');
          link.download = it.name;
          link.href = it.url;
          link.click();
        };

        saveBtn.addEventListener('click', () => { buzz(10); saveOne(items[current]); });

        if (saveAllBtn) saveAllBtn.addEventListener('click', async () => {
          buzz(10);
          for (const it of items) {
            saveOne(it);
            await new Promise(res => setTimeout(res, 350)); // browsers throttle bursts
          }
        });

        shareBtn.addEventListener('click', async () => {
          buzz(10);
          const files = items.map(it => new File([it.blob], it.name, { type: 'image/png' }));
          try {
            if (navigator.canShare && navigator.canShare({ files })) {
              await navigator.share({ files, title: shareTitle });
              return;
            }
            const one = [files[current]];
            if (navigator.canShare && navigator.canShare({ files: one })) {
              await navigator.share({ files: one, title: items[current].title || shareTitle });
              return;
            }
            saveOne(items[current]);
          } catch (_) { /* dismissed */ }
        });
      },
    };
  }

  async function openTop10(movies) {
    if (document.getElementById('poster-deck')) return;
    const seq = pickTop(movies);
    if (seq.length < 3) {
      if (typeof UI !== 'undefined') UI.showToast('Rate at least 3 films first.');
      return;
    }

    const deck = mountDeck(`Printing 1 / ${seq.length}`, true);
    await ensureFonts();

    for (let i = 0; i < seq.length; i++) {
      if (deck.closed()) return;
      deck.progress(i / seq.length, `Printing ${i + 1} / ${seq.length}`);
      await ensureBackdrop(seq[i].movie);
      const canvas = await generate(seq[i].movie, seq[i].rank);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (deck.closed()) return;
      deck.add({
        blob,
        url: URL.createObjectURL(blob),
        name: fileName(seq[i]),
        alt: `#${seq[i].rank}`,
        title: `#${seq[i].rank} — ${seq[i].movie.title}`,
      });
      await new Promise(res => setTimeout(res, 0)); // let the UI breathe
    }
    deck.show('My top 10');
  }

  // ============================================================
  //  The board — one print carrying the whole hand-ranked list
  // ============================================================
  const BW = 1080, BH = 1920;
  const BOARD_MAX = 25;   // the longest hand-ranked list the chart offers

  // The page renders these very TMDB URLs in plain <img> tags, so the browser
  // may already hold a copy fetched without CORS; asking for the same URL with
  // `crossOrigin` set can be failed outright against that cached response, and
  // every chip comes back empty while the hero (a /original/ URL the DOM never
  // requests) loads fine. A distinct URL forces a fresh, CORS-clean fetch.
  async function tryImage(src) {
    if (!src) return null;
    try { return await loadImage(src); } catch (_) { /* retry CORS-clean */ }
    try { return await loadImage(src + (src.includes('?') ? '&' : '?') + 'cors=1'); }
    catch (_) { return null; }
  }

  // Stored posters are w342, which is exactly what the DOM renders; asking the
  // canvas for w500 keeps the chip off that cached URL (see tryImage above) and
  // prints it a little sharper. Backdrops, which have no w500, are left alone.
  const chipSrc = (url) => (url || '').replace('/w342/', '/w500/');

  // Shrink until the line fits, but never past the floor — a title that still
  // doesn't fit there is wrapped or clipped instead of set microscopically.
  function fitLine(ctx, text, maxW, startSize, spRatio, weight = 800, minSize = 18) {
    for (let size = startSize; size >= minSize; size -= 2) {
      ctx.font = `${weight} ${size}px ${FACE}`;
      if (spacedWidth(ctx, text, size * spRatio) <= maxW) return { size, sp: size * spRatio };
    }
    ctx.font = `${weight} ${minSize}px ${FACE}`;
    return { size: minSize, sp: minSize * spRatio, over: true };
  }

  // Break into at most `maxLines`; whatever is left over lands clipped on the last.
  function wrapSpaced(ctx, text, maxW, sp, maxLines) {
    const lines = [];
    let cur = '';
    for (const word of text.split(/\s+/)) {
      const test = cur ? `${cur} ${word}` : word;
      if (!cur || spacedWidth(ctx, test, sp) <= maxW) cur = test;
      else { lines.push(cur); cur = word; }
    }
    lines.push(cur);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines - 1);
    kept.push(clipToWidth(ctx, lines.slice(maxLines - 1).join(' '), maxW, sp));
    return kept;
  }

  function clipToWidth(ctx, text, maxW, sp) {
    if (spacedWidth(ctx, text, sp) <= maxW) return text;
    let cut = text;
    while (cut.length > 1 && spacedWidth(ctx, cut + '…', sp) > maxW) cut = cut.slice(0, -1);
    return cut + '…';
  }

  // One photographic print for a short ranking: the winner leads, then each
  // remaining film has its own frame. Incomplete lists fill the same sheet.
  async function generateMosaic(list) {
    const arts = await Promise.all(list.map(async m =>
      await tryImage(m.backdrop || '') || await tryImage(chipSrc(m.poster || ''))));
    const pal = arts[0] ? samplePalette(arts[0]) : fallbackPalette();
    const canvas = document.createElement('canvas');
    canvas.width = BW; canvas.height = BH;
    const ctx = canvas.getContext('2d');
    const display = 'Staatliches, Impact, sans-serif';
    const paper = '#eff2fb';
    const margin = 36, gap = 12, width = BW - margin * 2;
    ctx.fillStyle = css(pal.ground);
    ctx.fillRect(0, 0, BW, BH);

    ctx.fillStyle = paper;
    ctx.font = `400 112px ${display}`;
    ctx.fillText(`MY TOP ${list.length}`, margin, 132);
    ctx.fillStyle = css(pal.accent);
    ctx.fillRect(margin, 158, width, 5);

    const frame = (index, x, y, w, h) => {
      const m = list[index];
      const hero = index === 0;
      const pad = hero ? 32 : 20;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = css(pal.groundHi);
      ctx.fillRect(x, y, w, h);
      if (arts[index]) drawCover(ctx, arts[index], x, y, w, h, 0.42);
      const shade = ctx.createLinearGradient(0, y, 0, y + h);
      shade.addColorStop(0, 'rgba(0,0,0,0.48)');
      shade.addColorStop(0.32, 'rgba(0,0,0,0.02)');
      shade.addColorStop(0.6, 'rgba(0,0,0,0.18)');
      shade.addColorStop(1, 'rgba(0,0,0,0.92)');
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, w, h);

      ctx.fillStyle = paper;
      const rankSize = hero ? 180 : 88;
      ctx.font = `400 ${rankSize}px ${display}`;
      ctx.fillText(String(index + 1).padStart(2, '0'), x + pad, y + pad + rankSize * 0.76);

      const title = (m.title || 'Untitled').toUpperCase();
      const maxW = w - pad * 2;
      const maxSize = hero ? 72 : 38;
      const minSize = hero ? 48 : 30;
      let lines, size;
      for (size = maxSize; size >= minSize; size -= 2) {
        ctx.font = `400 ${size}px ${display}`;
        lines = wrapSpaced(ctx, title, maxW, 0, 2);
        if (lines.every(line => spacedWidth(ctx, line, 0) <= maxW) &&
            !lines.some(line => line.endsWith('…'))) break;
      }
      size = Math.max(minSize, size);
      ctx.font = `400 ${size}px ${display}`;
      lines = wrapSpaced(ctx, title, maxW, 0, 2).map(line => clipToWidth(ctx, line, maxW, 0));
      const baseline = y + h - pad - 32;
      lines.forEach((line, i) => ctx.fillText(line, x + pad,
        baseline - (lines.length - 1 - i) * size * 1.05));
      ctx.font = `500 ${hero ? 24 : 18}px ${FACE}`;
      ctx.fillStyle = paper;
      const meta = [m.year, (m.directors || [])[0]].filter(Boolean).join(' / ');
      ctx.fillText(clipToWidth(ctx, meta, maxW, 0), x + pad, y + h - pad);
      ctx.restore();
    };

    const remaining = list.length - 1;
    const columns = remaining > 4 ? 3 : 2;
    const rows = Math.ceil(remaining / columns);
    const top = 188, bottom = BH - 72;
    const heroH = remaining ? (rows === 3 ? 540 : 700) : bottom - top;
    frame(0, margin, top, width, heroH);
    if (remaining) {
      const gridTop = top + heroH + gap;
      const rowH = (bottom - gridTop - gap * (rows - 1)) / rows;
      let index = 1;
      for (let row = 0; row < rows; row++) {
        const count = Math.min(columns, list.length - index);
        const cellW = (width - gap * (count - 1)) / count;
        for (let col = 0; col < count; col++, index++) {
          frame(index, margin + col * (cellW + gap), gridTop + row * (rowH + gap), cellW, rowH);
        }
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = grainPattern(ctx);
    ctx.fillRect(0, 0, BW, BH);
    ctx.restore();
    return canvas;
  }

  async function generateBoard(entries) {
    const list = entries.slice(0, BOARD_MAX);
    if (!list.length) throw new Error('Pick at least one film first.');
    if (list.length <= 10) return generateMosaic(list);
    const heroSrc = hiRes(list[0].backdrop || list[0].poster || '');
    const heroImg = await tryImage(heroSrc);
    const arts = await Promise.all(list.map(m => tryImage(chipSrc(m.poster || m.backdrop || ''))));

    const M = 78;
    const FOOT = 100, GAP = 34;
    // A short list would leave the page half empty, so the slack goes to the
    // still: fewer films, bigger hero, same balance. A long one can't fit the
    // 1080x1920 social frame at a readable row height, so the print grows
    // taller instead of squeezing twenty-five films into slivers.
    const baseHero = 620;
    const avail0 = BH - FOOT - (baseHero + GAP);
    const rowH = Math.max(92, Math.min(150, avail0 / list.length));
    const used = rowH * list.length;
    const BOARD_H = Math.max(BH, Math.round(baseHero + GAP + used + FOOT));
    const slack = BOARD_H - FOOT - (baseHero + GAP) - used;
    const heroH = Math.round(baseHero + Math.min(340, Math.max(0, slack) * 0.62));

    const canvas = document.createElement('canvas');
    canvas.width = BW; canvas.height = BOARD_H;
    const ctx = canvas.getContext('2d');
    const pal = heroImg ? samplePalette(heroImg) : fallbackPalette();

    // Ground
    const ground = ctx.createLinearGradient(0, 0, 0, BOARD_H);
    ground.addColorStop(0, css(pal.groundHi));
    ground.addColorStop(1, css(pal.ground));
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, BW, BOARD_H);

    // Hero still, melting into the ground so the list reads on top of colour
    if (heroImg) {
      const g = pal.ground.map(c => c | 0).join(',');
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, BW, heroH);
      ctx.clip();
      drawCover(ctx, heroImg, 0, 0, BW, heroH, 0.38);
      const fade = ctx.createLinearGradient(0, 0, 0, heroH);
      fade.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
      fade.addColorStop(0.32, 'rgba(0, 0, 0, 0.16)');
      fade.addColorStop(0.72, `rgba(${g}, 0.72)`);
      fade.addColorStop(1, `rgba(${g}, 1)`);
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, BW, heroH);
      ctx.restore();
    }

    // Masthead
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const headline = `MY TOP ${list.length}`;
    const hFit = fitLine(ctx, headline, BW - M * 2, 138, 0.02);
    const titleBase = heroH - 104;

    ctx.font = `600 24px ${FACE}`;
    ctx.fillStyle = css(pal.accent);
    spacedText(ctx, 'MOVIE CATALOGUE', M, titleBase - hFit.size - 30, 24 * 0.32);

    ctx.font = `800 ${hFit.size}px ${FACE}`;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 22;
    spacedText(ctx, headline, M, titleBase, hFit.sp);
    ctx.shadowBlur = 0;

    const stamp = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
    ctx.font = `600 22px ${FACE}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    spacedText(ctx, `RANKED BY HAND · ${stamp}`, M, heroH - 46, 22 * 0.26);

    // The list
    const top = heroH + GAP;
    const blockTop = top + (BOARD_H - FOOT - top - used) / 2;
    const thumbH = Math.round(rowH - 24);
    const thumbW = Math.round(thumbH * 2 / 3);
    const rankRight = M + 66;
    const thumbX = M + 92;
    const textX = thumbX + thumbW + 26;
    const textW = BW - M - textX;

    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const y0 = blockTop + i * rowH;
      const cy = y0 + rowH / 2;

      // Rank
      ctx.font = `800 ${Math.round(rowH * 0.46)}px ${FACE}`;
      ctx.fillStyle = css(pal.accent);
      ctx.textAlign = 'right';
      ctx.fillText(String(i + 1), rankRight, cy + rowH * 0.16);
      ctx.textAlign = 'left';

      // Poster chip
      const ty = Math.round(cy - thumbH / 2);
      const art = arts[i];
      if (art) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(thumbX, ty, thumbW, thumbH);
        ctx.clip();
        drawCover(ctx, art, thumbX, ty, thumbW, thumbH, 0.5);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(thumbX, ty, thumbW, thumbH);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(thumbX + 0.5, ty + 0.5, thumbW - 1, thumbH - 1);

      // Title + credits. A long title runs to a second line rather than
      // shrinking until it can't be read next to the short ones.
      const title = (m.title || '').toUpperCase();
      const tMax = Math.min(42, Math.round(rowH * 0.36));
      const tFit = fitLine(ctx, title, textW, tMax, 0.05, 800, Math.round(tMax * 0.64));
      ctx.font = `800 ${tFit.size}px ${FACE}`;
      ctx.fillStyle = '#f2f4f8';
      const lines = tFit.over ? wrapSpaced(ctx, title, textW, tFit.sp, 2) : [title];
      let lineY = lines.length > 1 ? cy - tFit.size * 0.9 : cy - 4;
      for (const line of lines) {
        spacedText(ctx, line, textX, lineY, tFit.sp);
        lineY += tFit.size * 1.1;
      }

      const meta = [m.year, (m.directors || [])[0]].filter(Boolean).join('   ·   ').toUpperCase();
      if (meta) {
        ctx.font = `600 21px ${FACE}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.48)';
        spacedText(ctx, clipToWidth(ctx, meta, textW, 21 * 0.22), textX,
          lines.length > 1 ? cy + rowH * 0.3 : cy + 28, 21 * 0.22);
      }

      if (i < list.length - 1) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(M, Math.round(y0 + rowH) - 1, BW - M * 2, 1);
      }
    }

    // Grain and vignette over the whole print
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = grainPattern(ctx);
    ctx.fillRect(0, 0, BW, BOARD_H);
    ctx.restore();

    const vig = ctx.createRadialGradient(BW / 2, BOARD_H * 0.45, BW * 0.25,
      BW / 2, BOARD_H * 0.5, BOARD_H * 0.75);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, BW, BOARD_H);

    return canvas;
  }

  async function openBoard(entries) {
    if (document.getElementById('poster-deck')) return;
    const list = (entries || []).slice(0, BOARD_MAX);
    if (list.length < 3) {
      if (typeof UI !== 'undefined') UI.showToast('Pick at least 3 films first.');
      return;
    }

    const deck = mountDeck(`Printing your top ${list.length}`, false);
    deck.progress(0.15);
    await ensureFonts();
    for (let i = 0; i < (list.length <= 10 ? list.length : 1); i++) {
      if (deck.closed()) return;
      await ensureBackdrop(list[i]);
      deck.progress(0.15 + 0.3 * ((i + 1) / list.length));
    }
    if (deck.closed()) return;
    deck.progress(0.45);

    const canvas = await generateBoard(list);
    if (deck.closed()) return;
    deck.progress(0.85);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (deck.closed()) return;

    deck.add({
      blob,
      url: URL.createObjectURL(blob),
      name: `my-top-${list.length}.png`,
      alt: `My top ${list.length}: ${list.map((m, i) => `${i + 1}. ${m.title}`).join(', ')}`,
    });
    // Letterboxing a 1:3 print into the stage would leave it unreadable, so a
    // long board scrolls at full width instead.
    deck.show(`My top ${list.length}`, canvas.height / canvas.width > 2.1);
  }

  // ============================================================
  //  The countdown carousel — the long list as a set of pages
  // ============================================================
  // Printed as one board a top 25 comes out 1080x3054: a strip that has to be
  // shrunk past reading to be taken in whole. A countdown is read a handful at
  // a time anyway, so the long list prints as pages instead — warm stock, a
  // still from the champion heading each page under the range it covers, six
  // films to a grid, ranks counting down, and #1 alone on the last page.
  const PER_PAGE = 6;
  const STOCK = [239, 230, 210];     // the card stock every page is printed on
  const cream = (a) => `rgba(${STOCK[0]}, ${STOCK[1]}, ${STOCK[2]}, ${a})`;
  const PM = 20, PGAP = 22, HEAD_H = 288;

  // Ranks N..2, six to a page at most, then #1 by itself. The films are spread
  // evenly over the pages rather than packed from the front: 24 of them still
  // come out 6-6-6-6, but 13 come out 5-4-4 instead of 6-6-1, and no page is
  // left holding a single stranded card.
  function carouselPages(entries) {
    const ranked = entries.map((movie, i) => ({ movie, rank: i + 1 }));
    const rest = ranked.slice(1).reverse();
    const count = Math.ceil(rest.length / PER_PAGE);
    const pages = [];
    for (let p = 0, i = 0; p < count; p++) {
      const take = Math.floor(rest.length / count) + (p < rest.length % count ? 1 : 0);
      pages.push(rest.slice(i, i + take));
      i += take;
    }
    pages.push([ranked[0]]);
    return pages;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Centre a title on the numeral. A long one is broken over two lines rather
  // than set at a third the size of the short ones beside it — the cards are
  // read as a set, so the type has to stay one size.
  function centredTitle(ctx, title, cx, baseline, maxW, startSize, minSize) {
    const sp = (size) => size * 0.08;
    let pick = null;
    for (let size = startSize; size >= minSize; size -= 2) {
      ctx.font = `800 ${size}px ${FACE}`;
      const lines = wrapSpaced(ctx, title, maxW, sp(size), 2);
      if (lines.every(l => spacedWidth(ctx, l, sp(size)) <= maxW)) { pick = { size, lines }; break; }
    }
    if (!pick) {
      ctx.font = `800 ${minSize}px ${FACE}`;
      pick = { size: minSize, lines: wrapSpaced(ctx, title, maxW, sp(minSize), 2) };
    }
    ctx.font = `800 ${pick.size}px ${FACE}`;
    let y = baseline - (pick.lines.length - 1) * pick.size * 0.6;
    for (const line of pick.lines) {
      spacedText(ctx, line, cx, y, sp(pick.size), 'center');
      y += pick.size * 1.2;
    }
  }

  // The title sits across the waist of the rank numeral, which is what makes
  // the card read as one object rather than a picture with a caption.
  function drawCarouselCell(ctx, item, img, x, y, w, h) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 8);
    ctx.clip();
    if (img) drawCover(ctx, img, x, y, w, h, 0.45);
    else { ctx.fillStyle = '#14141c'; ctx.fillRect(x, y, w, h); }
    const scrim = ctx.createLinearGradient(0, y, 0, y + h);
    scrim.addColorStop(0, 'rgba(0, 0, 0, 0.06)');
    scrim.addColorStop(0.42, 'rgba(0, 0, 0, 0.18)');
    scrim.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    ctx.fillStyle = scrim;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    const cx = x + w / 2;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';

    ctx.font = `800 ${Math.round(h * 0.58)}px ${FACE}`;
    ctx.fillStyle = cream(0.9);
    ctx.shadowBlur = 28;
    ctx.textAlign = 'center';
    ctx.fillText(String(item.rank), cx, y + h * 0.8);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 14;
    const max = Math.round(Math.min(34, h * 0.11));
    centredTitle(ctx, (item.movie.title || '').toUpperCase(), cx, y + h * 0.55,
      w - 56, max, Math.round(max * 0.62));

    ctx.shadowBlur = 0;
  }

  function drawCarouselHead(ctx, img, page, pageNo, pageCount, total) {
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, HEAD_H);
      ctx.clip();
      drawCover(ctx, img, 0, 0, W, HEAD_H, 0.42);
      const scrim = ctx.createLinearGradient(0, 0, 0, HEAD_H);
      scrim.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
      scrim.addColorStop(0.55, 'rgba(0, 0, 0, 0.2)');
      scrim.addColorStop(1, 'rgba(0, 0, 0, 0.38)');
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, W, HEAD_H);
      ctx.restore();
    } else {
      ctx.fillStyle = '#12121a';
      ctx.fillRect(0, 0, W, HEAD_H);
    }

    const hi = page[0].rank, lo = page[page.length - 1].rank;
    const range = hi === lo ? String(hi) : `${hi} - ${lo}`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 26;
    const fit = fitLine(ctx, range, W - 260, 132, 0.02, 800, 76);
    ctx.font = `800 ${fit.size}px ${FACE}`;
    ctx.fillStyle = cream(0.96);
    spacedText(ctx, range, W / 2, 208, fit.sp, 'center');

    ctx.shadowBlur = 14;
    ctx.font = `600 22px ${FACE}`;
    ctx.fillStyle = cream(0.72);
    spacedText(ctx, `MY TOP ${total}`, W / 2, 84, 22 * 0.34, 'center');
    ctx.shadowBlur = 0;

    // Page counter, the way a carousel numbers its slides
    const tag = `${pageNo} / ${pageCount}`;
    ctx.font = `600 26px ${FACE}`;
    const cw = spacedWidth(ctx, tag, 26 * 0.1) + 44;
    roundRect(ctx, W - PM - 12 - cw, 26, cw, 56, 28);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill();
    ctx.fillStyle = cream(0.9);
    spacedText(ctx, tag, W - PM - 12 - cw / 2, 63, 26 * 0.1, 'center');
  }

  // #1 gets the page to itself — the poster full-bleed inside the stock frame,
  // the numeral at the size the rest of the set has been counting towards.
  function drawCarouselFinale(ctx, item, img, total) {
    const w = W - PM * 2, h = H - PM * 2;
    ctx.save();
    roundRect(ctx, PM, PM, w, h, 10);
    ctx.clip();
    if (img) drawCover(ctx, img, PM, PM, w, h, 0.42);
    else { ctx.fillStyle = '#14141c'; ctx.fillRect(PM, PM, w, h); }
    const scrim = ctx.createLinearGradient(0, PM, 0, PM + h);
    scrim.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    scrim.addColorStop(0.3, 'rgba(0, 0, 0, 0.12)');
    scrim.addColorStop(0.62, 'rgba(0, 0, 0, 0.32)');
    scrim.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
    ctx.fillStyle = scrim;
    ctx.fillRect(PM, PM, w, h);
    ctx.restore();

    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 20;
    ctx.font = `600 26px ${FACE}`;
    ctx.fillStyle = cream(0.8);
    spacedText(ctx, `MY TOP ${total} · NUMBER ONE`, W / 2, PM + 92, 26 * 0.34, 'center');

    ctx.shadowBlur = 44;
    ctx.font = `800 520px ${FACE}`;
    ctx.fillStyle = cream(0.92);
    ctx.textAlign = 'center';
    ctx.fillText('1', W / 2, H * 0.76);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 18;
    // Across the numeral's waist, the same way the grid cards are set
    centredTitle(ctx, (item.movie.title || '').toUpperCase(), W / 2, H * 0.62, W - 180, 76, 42);

    const meta = [item.movie.year, (item.movie.directors || [])[0]]
      .filter(Boolean).join('   ·   ').toUpperCase();
    if (meta) {
      ctx.font = `600 26px ${FACE}`;
      ctx.fillStyle = cream(0.75);
      spacedText(ctx, clipToWidth(ctx, meta, W - 220, 26 * 0.26), W / 2, H - PM - 74, 26 * 0.26, 'center');
    }
    ctx.shadowBlur = 0;
  }

  async function generateCarouselPage(page, pageNo, pageCount, headImg, total) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = css(STOCK);
    ctx.fillRect(0, 0, W, H);

    if (page.length === 1 && page[0].rank === 1) {
      // The still, not the poster: the page sets the film's title itself, and
      // a poster carries its own — printed over each other they fight.
      const m = page[0].movie;
      drawCarouselFinale(ctx, page[0], await tryImage(hiRes(m.backdrop || m.poster || '')), total);
    } else {
      const arts = await Promise.all(page.map(it =>
        tryImage(it.movie.backdrop || chipSrc(it.movie.poster || ''))));
      drawCarouselHead(ctx, headImg, page, pageNo, pageCount, total);

      const rows = Math.ceil(page.length / 2);
      const top = HEAD_H + PM;
      const colW = (W - PM * 2 - PGAP) / 2;
      const rowH = (H - PM - top - PGAP * (rows - 1)) / rows;
      // An odd page would otherwise leave a hole in the grid, so its first
      // film runs the full measure instead.
      let i = 0;
      for (let r = 0; r < rows; r++) {
        const full = page.length % 2 === 1 && r === 0;
        const y = top + r * (rowH + PGAP);
        for (let c = 0; c < (full ? 1 : 2) && i < page.length; c++, i++) {
          drawCarouselCell(ctx, page[i], arts[i],
            full ? PM : PM + c * (colW + PGAP), y, full ? W - PM * 2 : colW, rowH);
        }
      }
    }

    // Paper tooth over the whole page
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = grainPattern(ctx);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    return canvas;
  }

  // A page is headed by a frame from one of the films on it — and by a frame
  // the page doesn't already show, the way the reference set heads its Stalker
  // page with a second Stalker still. The card keeps the stored backdrop; the
  // header takes the best of the film's other plates.
  const frameCache = new Map();
  async function headerFrame(movie) {
    const own = movie.backdrop || '';
    if (typeof TMDB !== 'undefined' && TMDB.getMovieBackdrops && movie.tmdbId) {
      if (!frameCache.has(movie.tmdbId)) {
        frameCache.set(movie.tmdbId, await TMDB.getMovieBackdrops(movie.tmdbId));
      }
      const ownPath = own ? own.slice(own.lastIndexOf('/')) : '';
      const alt = (frameCache.get(movie.tmdbId) || []).find(p => p !== ownPath);
      if (alt) return TMDB.posterUrl(alt, 'original');
    }
    // One plate on file, or no key: the card's own still is better than none.
    return hiRes(own || movie.poster || '');
  }

  const pickSrc = (url) =>
    (typeof UI !== 'undefined' && UI.imgSrc ? UI.imgSrc(url) : url);

  // Ask, page by page, which film heads it. Built with DOM calls rather than a
  // markup string: titles and image URLs here come from TMDB or an imported
  // backup, and `textContent`/`imgSrc` keep them out of the parser.
  function pickHeaders(deck, gridPages) {
    return new Promise((resolve) => {
      const picks = [];
      deck.onClose(() => resolve(null));

      const step = () => {
        if (deck.closed()) { resolve(null); return; }
        if (picks.length === gridPages.length) { resolve(picks); return; }
        const page = gridPages[picks.length];
        // Nothing to choose between on a page of one.
        if (page.length < 2) { picks.push(page[0].movie); step(); return; }
        render(picks.length, page);
      };

      const render = (i, page) => {
        const wrap = document.createElement('div');
        wrap.className = 'pd-pick';

        const title = document.createElement('div');
        title.className = 'pd-pick-title';
        title.textContent = `Page ${i + 1} of ${gridPages.length}`;
        const sub = document.createElement('div');
        sub.className = 'pd-pick-sub';
        sub.textContent = `Which film heads ranks ${page[0].rank} - ${page[page.length - 1].rank}?`;

        const grid = document.createElement('div');
        grid.className = 'pd-pick-grid';
        for (const item of page) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pd-pick-card';
          const img = document.createElement('img');
          img.alt = '';
          img.src = pickSrc(item.movie.backdrop || item.movie.poster || '');
          const rank = document.createElement('span');
          rank.className = 'pd-pick-rank';
          rank.textContent = String(item.rank);
          const label = document.createElement('span');
          label.className = 'pd-pick-label';
          label.textContent = item.movie.title || '';
          btn.append(img, rank, label);
          btn.addEventListener('click', () => { buzz(8); picks.push(item.movie); step(); });
          grid.appendChild(btn);
        }

        const auto = document.createElement('button');
        auto.type = 'button';
        auto.className = 'btn btn-secondary pd-pick-auto';
        auto.textContent = 'Pick for me';
        auto.addEventListener('click', () => {
          buzz(8);
          // The best-ranked film on each remaining page heads it.
          while (picks.length < gridPages.length) {
            const p = gridPages[picks.length];
            picks.push(p[p.length - 1].movie);
          }
          step();
        });

        wrap.append(title, sub, grid, auto);
        deck.ask(wrap);
      };

      step();
    });
  }

  async function openCarousel(entries) {
    if (document.getElementById('poster-deck')) return;
    const list = (entries || []).slice(0, BOARD_MAX);
    if (list.length < 3) {
      if (typeof UI !== 'undefined') UI.showToast('Pick at least 3 films first.');
      return;
    }

    const pages = carouselPages(list);
    const gridPages = pages.slice(0, -1); // the last page is #1 alone
    const deck = mountDeck('Fetching stills', true);
    await ensureFonts();

    // Every film on the page shows its own still, not just the hero, so fill
    // in the ones saved before backdrops were stored — and the picker needs
    // them all on screen before it can ask.
    for (let i = 0; i < list.length; i++) {
      if (deck.closed()) return;
      deck.progress(0.25 * (i / list.length));
      await ensureBackdrop(list[i]);
    }
    if (deck.closed()) return;

    const heads = await pickHeaders(deck, gridPages);
    if (!heads || deck.closed()) return;

    deck.busy('Finding the frames');
    const headImgs = [];
    for (let i = 0; i < heads.length; i++) {
      if (deck.closed()) return;
      deck.progress(0.25 + 0.2 * (i / heads.length));
      headImgs.push(await tryImage(await headerFrame(heads[i])));
    }

    for (let i = 0; i < pages.length; i++) {
      if (deck.closed()) return;
      deck.progress(0.45 + 0.55 * (i / pages.length), `Printing ${i + 1} / ${pages.length}`);
      const canvas = await generateCarouselPage(pages[i], i + 1, pages.length, headImgs[i], list.length);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (deck.closed()) return;
      deck.add({
        blob,
        url: URL.createObjectURL(blob),
        name: `my-top-${list.length}-${String(i + 1).padStart(2, '0')}.png`,
        alt: `Page ${i + 1}`,
      });
      await new Promise(res => setTimeout(res, 0)); // let the UI breathe
    }
    deck.show(`My top ${list.length}`);
  }
  return {
    generate, openTop10, pickTop, manualTop10,
    generateBoard, openBoard, generateCarouselPage, openCarousel,
  };
})();
