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
    let img = null;
    if (src) { try { img = await loadImage(src); } catch (_) { img = null; } }

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
  function pickTop(movies, count = 10) {
    return movies
      .filter(m => !m.watchlist && (m.rating || 0) > 0)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) ||
        new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0))
      .slice(0, count)
      .map((movie, i) => ({ movie, rank: i + 1 }))
      .reverse(); // count down to #1, the way a carousel reads
  }

  async function ensureFonts() {
    if (!document.fonts) return;
    try {
      await Promise.all([
        document.fonts.load(`800 300px Montserrat`),
        document.fonts.load(`600 26px Montserrat`),
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
        if (typeof MovieDB !== 'undefined' && movie.id) MovieDB.updateMovie(movie);
      }
    } catch (_) { /* the poster will do */ }
  }

  const fileName = (item) =>
    `top10-${String(item.rank).padStart(2, '0')}-${(item.movie.title || 'film')
      .replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')}.png`;

  function buzz(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} }
  }

  async function openTop10(movies) {
    if (document.getElementById('poster-deck')) return;
    const seq = pickTop(movies);
    if (seq.length < 3) {
      if (typeof UI !== 'undefined') UI.showToast('Rate at least 3 films first.');
      return;
    }

    const deck = document.createElement('div');
    deck.id = 'poster-deck';
    deck.className = 'poster-deck';
    deck.innerHTML = `
      <div class="pd-backdrop"></div>
      <div class="pd-content">
        <button class="pd-close" aria-label="Close">&times;</button>
        <div class="pd-stage">
          <div class="pd-loading">
            <div class="pd-loading-label">Printing 1 / ${seq.length}</div>
            <div class="pd-loading-track"><div class="pd-loading-fill"></div></div>
          </div>
        </div>
        <div class="pd-dots"></div>
        <div class="pd-actions">
          <button class="btn btn-primary pd-share" type="button" disabled>Share</button>
          <button class="btn btn-secondary pd-save" type="button" disabled>&#11015; Save</button>
          <button class="btn btn-secondary pd-save-all" type="button" disabled>Save all</button>
        </div>
      </div>`;
    document.body.appendChild(deck);

    const items = [];
    let closed = false;
    const close = () => {
      closed = true;
      items.forEach(it => URL.revokeObjectURL(it.url));
      deck.classList.add('poster-deck--out');
      setTimeout(() => deck.remove(), 200);
    };
    deck.querySelector('.pd-close').addEventListener('click', close);
    deck.querySelector('.pd-backdrop').addEventListener('click', close);
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });

    await ensureFonts();

    const label = deck.querySelector('.pd-loading-label');
    const fill = deck.querySelector('.pd-loading-fill');
    for (let i = 0; i < seq.length; i++) {
      if (closed) return;
      if (label) label.textContent = `Printing ${i + 1} / ${seq.length}`;
      if (fill) fill.style.width = `${(i / seq.length) * 100}%`;
      await ensureBackdrop(seq[i].movie);
      const canvas = await generate(seq[i].movie, seq[i].rank);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (closed) return;
      items.push({ ...seq[i], blob, url: URL.createObjectURL(blob) });
      await new Promise(res => setTimeout(res, 0)); // let the UI breathe
    }

    const stage = deck.querySelector('.pd-stage');
    stage.innerHTML = `<div class="pd-track">${items.map(it => `
      <div class="pd-slide"><img src="${it.url}" alt="#${it.rank}"></div>`).join('')}</div>`;
    const dots = deck.querySelector('.pd-dots');
    dots.innerHTML = items.map((_, i) => `<span class="pd-dot${i === 0 ? ' active' : ''}"></span>`).join('');

    const track = stage.querySelector('.pd-track');
    let current = 0;
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      if (i === current || !items[i]) return;
      current = i;
      dots.querySelectorAll('.pd-dot').forEach((d, j) => d.classList.toggle('active', j === i));
    }, { passive: true });

    const saveBtn = deck.querySelector('.pd-save');
    const shareBtn = deck.querySelector('.pd-share');
    const saveAllBtn = deck.querySelector('.pd-save-all');
    [saveBtn, shareBtn, saveAllBtn].forEach(b => { b.disabled = false; });

    const saveOne = (it) => {
      const link = document.createElement('a');
      link.download = fileName(it);
      link.href = it.url;
      link.click();
    };

    saveBtn.addEventListener('click', () => { buzz(10); saveOne(items[current]); });

    saveAllBtn.addEventListener('click', async () => {
      buzz(10);
      for (const it of items) {
        saveOne(it);
        await new Promise(res => setTimeout(res, 350)); // browsers throttle bursts
      }
    });

    shareBtn.addEventListener('click', async () => {
      buzz(10);
      const files = items.map(it => new File([it.blob], fileName(it), { type: 'image/png' }));
      try {
        if (navigator.canShare && navigator.canShare({ files })) {
          await navigator.share({ files, title: 'My top 10' });
          return;
        }
        const one = [files[current]];
        if (navigator.canShare && navigator.canShare({ files: one })) {
          await navigator.share({ files: one, title: `#${items[current].rank} — ${items[current].movie.title}` });
          return;
        }
        saveOne(items[current]);
      } catch (_) { /* dismissed */ }
    });
  }

  // ============================================================
  //  The board — one print carrying the whole hand-ranked list
  // ============================================================
  const BW = 1080, BH = 1920;

  async function tryImage(src) {
    if (!src) return null;
    try { return await loadImage(src); } catch (_) { return null; }
  }

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

  async function generateBoard(entries) {
    const list = entries.slice(0, 10);
    const heroSrc = hiRes(list[0].backdrop || list[0].poster || '');
    const heroImg = await tryImage(heroSrc);
    const arts = await Promise.all(list.map(m => tryImage(m.poster || m.backdrop || '')));

    const canvas = document.createElement('canvas');
    canvas.width = BW; canvas.height = BH;
    const ctx = canvas.getContext('2d');
    const pal = heroImg ? samplePalette(heroImg) : fallbackPalette();

    const M = 78;
    // A short list would leave the page half empty, so the slack goes to the
    // still: fewer films, bigger hero, same balance.
    const baseHero = 620;
    const avail0 = BH - 100 - (baseHero + 34);
    const rowH = Math.min(150, avail0 / list.length);
    const used = rowH * list.length;
    const heroH = Math.round(baseHero + Math.min(340, Math.max(0, avail0 - used) * 0.62));

    // Ground
    const ground = ctx.createLinearGradient(0, 0, 0, BH);
    ground.addColorStop(0, css(pal.groundHi));
    ground.addColorStop(1, css(pal.ground));
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, BW, BH);

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
    const top = heroH + 34;
    const blockTop = top + (BH - 100 - top - used) / 2;
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
    ctx.fillRect(0, 0, BW, BH);
    ctx.restore();

    const vig = ctx.createRadialGradient(BW / 2, BH * 0.45, BW * 0.25, BW / 2, BH * 0.5, BH * 0.75);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, BW, BH);

    return canvas;
  }

  async function openBoard(entries) {
    if (document.getElementById('poster-deck')) return;
    const list = (entries || []).slice(0, 10);
    if (list.length < 3) {
      if (typeof UI !== 'undefined') UI.showToast('Pick at least 3 films first.');
      return;
    }

    const deck = document.createElement('div');
    deck.id = 'poster-deck';
    deck.className = 'poster-deck';
    deck.innerHTML = `
      <div class="pd-backdrop"></div>
      <div class="pd-content">
        <button class="pd-close" aria-label="Close">&times;</button>
        <div class="pd-stage">
          <div class="pd-loading">
            <div class="pd-loading-label">Printing your top ${list.length}</div>
            <div class="pd-loading-track"><div class="pd-loading-fill"></div></div>
          </div>
        </div>
        <div class="pd-actions">
          <button class="btn btn-primary pd-share" type="button" disabled>Share</button>
          <button class="btn btn-secondary pd-save" type="button" disabled>&#11015; Save</button>
        </div>
      </div>`;
    document.body.appendChild(deck);

    let closed = false;
    let url = null;
    const close = () => {
      closed = true;
      if (url) URL.revokeObjectURL(url);
      deck.classList.add('poster-deck--out');
      setTimeout(() => deck.remove(), 200);
    };
    deck.querySelector('.pd-close').addEventListener('click', close);
    deck.querySelector('.pd-backdrop').addEventListener('click', close);
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });

    const fill = deck.querySelector('.pd-loading-fill');
    if (fill) fill.style.width = '15%';
    await ensureFonts();
    await ensureBackdrop(list[0]); // the hero still sets the whole palette
    if (closed) return;
    if (fill) fill.style.width = '45%';

    const canvas = await generateBoard(list);
    if (closed) return;
    if (fill) fill.style.width = '85%';
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (closed) return;
    url = URL.createObjectURL(blob);

    deck.querySelector('.pd-stage').innerHTML =
      `<div class="pd-slide"><img src="${url}" alt="My top ${list.length}"></div>`;

    const name = `my-top-${list.length}.png`;
    const saveBtn = deck.querySelector('.pd-save');
    const shareBtn = deck.querySelector('.pd-share');
    saveBtn.disabled = shareBtn.disabled = false;

    const save = () => {
      const link = document.createElement('a');
      link.download = name;
      link.href = url;
      link.click();
    };
    saveBtn.addEventListener('click', () => { buzz(10); save(); });
    shareBtn.addEventListener('click', async () => {
      buzz(10);
      const files = [new File([blob], name, { type: 'image/png' })];
      try {
        if (navigator.canShare && navigator.canShare({ files })) {
          await navigator.share({ files, title: `My top ${list.length}` });
          return;
        }
        save();
      } catch (_) { /* dismissed */ }
    });
  }

  return { generate, openTop10, pickTop, generateBoard, openBoard };
})();
