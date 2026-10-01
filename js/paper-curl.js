// A poster is a sheet of paper: the top stays put and the lower edge bends
// around a curved fold. SVG keeps the existing artwork sharp without a canvas
// readback or another image fetch mode (important for imported poster URLs).
const PaperCurl = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const COLS = 6, ROWS = 32, WIDTH = 240;
  let serial = 0;

  function node(tag, attrs = {}) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  function curlLength(across, progress) {
    // The right corner turns first; the rest of the bottom follows it. A small
    // resting curl makes the loose edge visible before the person touches it.
    const left = 0.28 * Math.pow(progress, 1.35);
    const right = 0.055 + 0.745 * Math.pow(progress, 0.85);
    return left + (right - left) * across * across;
  }

  function bend(x, y, height, progress) {
    const length = height * curlLength(x / WIDTH, progress);
    if (length < 0.001 || y <= height - length) return { x, y, angle: 0 };
    const radius = length / 2.65;
    const angle = (y - (height - length)) / radius;
    return { x, y: height - length + radius * Math.sin(angle), angle };
  }

  function create(card) {
    const img = card.querySelector('.detail-poster');
    if (!img) return null;
    let progress = 0, height = WIDTH * 1.5, svg, faces, front, edge, silhouette, lip, reverse, reverseShade;
    let extent = 1;
    const prefix = `paper-curl-${++serial}`;

    function render() {
      const points = [];
      extent = 0;
      for (let row = 0; row <= ROWS; row++) {
        for (let col = 0; col <= COLS; col++) {
          const point = bend(col * WIDTH / COLS, row * height / ROWS, height, progress);
          points.push(point);
          extent = Math.max(extent, point.y / height);
        }
      }
      if (!svg) return extent;

      faces.forEach(face => {
        const [p, q, r] = face.indices.map(i => points[i]);
        const [a, b, c] = face.source;
        // x stays fixed. Solve the affine y mapping for each little triangle;
        // adjoining patches meet at the very same points on the curved sheet.
        const dx1 = b.x - a.x, dy1 = b.y - a.y;
        const dx2 = c.x - a.x, dy2 = c.y - a.y;
        const det = dx1 * dy2 - dx2 * dy1;
        const shear = ((q.y - p.y) * dy2 - (r.y - p.y) * dy1) / det;
        const scale = (dx1 * (r.y - p.y) - dx2 * (q.y - p.y)) / det;
        const offset = p.y - shear * a.x - scale * a.y;
        const signature = `${shear}:${scale}:${offset}`;
        if (signature === face.signature) return;
        face.signature = signature;
        // Adjacent SVG clips are antialiased independently. Overlap them by a
        // fraction of a display pixel so the artwork never shows a mesh of seams.
        const cx = (p.x + q.x + r.x) / 3, cy = (p.y + q.y + r.y) / 3;
        const shape = [p, q, r].map(v => `${v.x + Math.sign(v.x - cx)},${v.y + Math.sign(v.y - cy)}`).join(' ');
        face.clip.setAttribute('points', shape);
        face.tone.setAttribute('points', shape);
        face.texture.setAttribute('transform', `matrix(1 ${shear} 0 ${scale} 0 ${offset})`);
        // Shade the print as it rounds the nose. The unprinted back is drawn
        // as one smooth surface over the mesh, with no faceted colour bands.
        const angle = (p.angle + q.angle + r.angle) / 3;
        face.tone.setAttribute('opacity', String(0.18 * (1 - Math.cos(angle))));
      });

      const leftLength = height * curlLength(0, progress), rightLength = height * curlLength(1, progress);
      const leftNose = height - leftLength + leftLength / 2.65;
      const rightNose = height - rightLength + rightLength / 2.65;
      const outline = `M0 0 H${WIDTH} V${rightNose} Q${WIDTH / 2} ${leftNose} 0 ${leftNose} Z`;
      silhouette.setAttribute('d', outline);
      edge.setAttribute('d', outline);
      const leftLip = height - leftLength + leftLength * Math.sin(2.65) / 2.65;
      const rightLip = height - rightLength + rightLength * Math.sin(2.65) / 2.65;
      lip.setAttribute('d', `M0 ${leftLip} Q${WIDTH / 2} ${leftLip} ${WIDTH} ${rightLip}`);
      const reversePath = `M0 ${leftLip} Q${WIDTH / 2} ${leftLip} ${WIDTH} ${rightLip} L${WIDTH} ${rightNose} Q${WIDTH / 2} ${leftNose} 0 ${leftNose} Z`;
      reverse.setAttribute('d', reversePath);
      reverseShade.setAttribute('d', reversePath);
      return extent;
    }

    function mount() {
      if (svg || !img.naturalWidth || !card.isConnected) return;
      const url = UI.safeUrl(img.currentSrc || img.src);
      if (!url) return;
      height = WIDTH * img.naturalHeight / img.naturalWidth;
      svg = node('svg', { viewBox: `0 0 ${WIDTH} ${height}`, class: 'poster-paper', 'aria-hidden': 'true', focusable: 'false' });
      const defs = node('defs');
      defs.appendChild(node('image', { id: `${prefix}-art`, href: url, width: WIDTH, height, preserveAspectRatio: 'none' }));
      front = node('g');
      const shadeGradient = node('linearGradient', { id: `${prefix}-shade`, x1: '0', y1: '0', x2: '0.3', y2: '1' });
      shadeGradient.append(
        node('stop', { offset: '0', 'stop-color': 'var(--ink)', 'stop-opacity': '0.08' }),
        node('stop', { offset: '0.5', 'stop-color': 'var(--ink)', 'stop-opacity': '0.18' }),
        node('stop', { offset: '1', 'stop-color': 'var(--ink)', 'stop-opacity': '0.38' })
      );
      defs.appendChild(shadeGradient);
      reverse = node('path', { fill: 'var(--bone)' });
      reverseShade = node('path', { fill: `url(#${prefix}-shade)` });
      const paperClip = node('clipPath', { id: `${prefix}-outline`, clipPathUnits: 'userSpaceOnUse' });
      silhouette = node('path');
      paperClip.appendChild(silhouette);
      defs.appendChild(paperClip);
      const surface = node('g', { 'clip-path': `url(#${prefix}-outline)` });
      surface.append(front, reverse, reverseShade);
      edge = node('path', { fill: 'none', stroke: 'var(--line-strong)', 'stroke-width': '0.8', 'stroke-linejoin': 'round' });
      lip = node('path', { fill: 'none', stroke: 'var(--ink)', 'stroke-opacity': '0.3', 'stroke-width': '1' });
      svg.append(defs, surface, edge, lip);
      faces = [];
      const patch = (indices) => {
        const id = `${prefix}-${faces.length}`;
        const clip = node('polygon');
        const clipPath = node('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
        clipPath.appendChild(clip);
        defs.appendChild(clipPath);
        const group = node('g', { 'clip-path': `url(#${id})` });
        const texture = node('use', { href: `#${prefix}-art` });
        const tone = node('polygon', { fill: 'var(--ink)' });
        group.append(texture, tone);
        front.appendChild(group);
        const source = indices.map(i => ({ x: (i % (COLS + 1)) * WIDTH / COLS, y: Math.floor(i / (COLS + 1)) * height / ROWS }));
        faces.push({ indices, source, clip, texture, tone });
      };
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const a = row * (COLS + 1) + col, b = a + 1, c = a + COLS + 1, d = c + 1;
          patch([a, b, d]);
          patch([a, d, c]);
        }
      }
      render();
      card.appendChild(svg);
      card.classList.add('has-paper-curl');
    }

    img.addEventListener('load', mount, { once: true });
    if (img.complete) mount();
    return {
      setProgress(value) {
        progress = Math.max(0, Math.min(1, value));
        return render();
      },
    };
  }

  return { create };
})();
