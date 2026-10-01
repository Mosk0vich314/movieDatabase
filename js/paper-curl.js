// A two-sided paper mesh in 3D, with a fixed taped edge and a free corner that
// comes toward the camera. Transparent overscan lets perspective carry the
// sheet beyond the poster's resting rectangle.
const PaperCurl = (() => {
  const WIDTH = 240, COLS = 12, ROWS = 44;
  const PAD_X = 0.4, PAD_Y = 0.2, CAMERA_DISTANCE = 1.8;
  const NS = 'http://www.w3.org/2000/svg';

  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    uniform vec3 uCamera;
    uniform vec4 uBounds;
    varying vec3 vNormal;
    varying vec2 vUV;
    void main() {
      float w = uCamera.z - aPosition.z;
      float x = (aPosition.x - uCamera.x) * uCamera.z
                + (uCamera.x + uBounds.z - uBounds.x * 0.5) * w;
      float y = (aPosition.y - uCamera.y) * uCamera.z
                + (uCamera.y + uBounds.w - uBounds.y * 0.5) * w;
      float nearPlane = uCamera.z * 0.05;
      float farPlane = uCamera.z * 2.0;
      float z = (farPlane + nearPlane) / (farPlane - nearPlane) * w
                - 2.0 * farPlane * nearPlane / (farPlane - nearPlane);
      gl_Position = vec4(2.0 * x / uBounds.x, -2.0 * y / uBounds.y, z, w);
      vNormal = aNormal;
      vUV = aUV;
    }
  `;
  const fragmentSource = `
    precision mediump float;
    uniform sampler2D uArt;
    uniform vec3 uPaper;
    varying vec3 vNormal;
    varying vec2 vUV;
    void main() {
      vec3 normal = normalize(vNormal);
      if (!gl_FrontFacing) normal = -normal;
      vec3 light = normalize(vec3(-0.35, -0.55, 1.0));
      float diffuse = max(0.0, dot(normal, light));
      if (gl_FrontFacing) {
        vec4 art = texture2D(uArt, vUV);
        gl_FragColor = vec4(art.rgb * min(1.0, 0.80 + 0.26 * diffuse), art.a);
      } else {
        gl_FragColor = vec4(uPaper * (0.66 + 0.34 * diffuse), 1.0);
      }
    }
  `;

  function surface(x, y, height, progress) {
    const across = x / WIDTH;
    const left = 0.28 * Math.pow(progress, 1.35);
    const right = 0.80 * Math.pow(progress, 0.85);
    const length = height * (left + (right - left) * across * across);
    let py = y, pz = 0;
    if (length > 0.001 && y > height - length) {
      const radius = length / 2.65;
      const angle = (y - height + length) / radius;
      py = height - length + radius * Math.sin(angle);
      pz = radius * (1 - Math.cos(angle));
    }
    // A little lift in the body joins the round corner to the fixed top,
    // instead of leaving the rest of the poster glued to the page.
    const lean = progress * 0.18;
    return { x, y: py * Math.cos(lean) - pz * Math.sin(lean), z: py * Math.sin(lean) + pz * Math.cos(lean) };
  }

  function project(point, height) {
    const camera = height * CAMERA_DISTANCE;
    const factor = camera / (camera - point.z);
    return { x: WIDTH / 2 + (point.x - WIDTH / 2) * factor, y: height * 0.08 + (point.y - height * 0.08) * factor };
  }

  function hull(points) {
    const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const half = (list) => {
      const result = [];
      list.forEach(p => {
        while (result.length > 1 && cross(result.at(-2), result.at(-1), p) <= 0) result.pop();
        result.push(p);
      });
      result.pop();
      return result;
    };
    return half(sorted).concat(half(sorted.slice().reverse()));
  }

  function svgNode(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([name, value]) => el.setAttribute(name, value));
    return el;
  }

  function create(card) {
    const img = card.querySelector('.detail-poster');
    if (!img) return null;
    let progress = 0, height = WIDTH * 1.5, gl, program, canvas, shadow, focus;
    let vertexBuffer, indexBuffer, vertices, indexCount, ready = false;
    let fallback = false, disposed = false;

    function render() {
      if (disposed) return 1;
      if (!ready) {
        if (fallback) card.style.transform = `rotateX(${progress * 36}deg)`;
        return 1;
      }
      const projected = [], ground = [];
      for (let row = 0; row <= ROWS; row++) {
        for (let col = 0; col <= COLS; col++) {
          const x = col * WIDTH / COLS, y = row * height / ROWS;
          const p = surface(x, y, height, progress);
          const dx0 = surface(Math.max(0, x - 0.5), y, height, progress);
          const dx1 = surface(Math.min(WIDTH, x + 0.5), y, height, progress);
          const dy0 = surface(x, Math.max(0, y - 0.5), height, progress);
          const dy1 = surface(x, Math.min(height, y + 0.5), height, progress);
          const tx = [dx1.x - dx0.x, dx1.y - dx0.y, dx1.z - dx0.z];
          const ty = [dy1.x - dy0.x, dy1.y - dy0.y, dy1.z - dy0.z];
          const normal = [tx[1] * ty[2] - tx[2] * ty[1], tx[2] * ty[0] - tx[0] * ty[2], tx[0] * ty[1] - tx[1] * ty[0]];
          const magnitude = Math.hypot(...normal) || 1;
          const offset = (row * (COLS + 1) + col) * 8;
          vertices.set([p.x, p.y, p.z, ...normal.map(n => n / magnitude), x / WIDTH, y / height], offset);
          projected.push(project(p, height));
          // Cast the shadow onto the page at z=0; it doesn't move on the paper.
          const cast = { x: p.x + p.z * 0.12, y: p.y + p.z * 0.2 };
          if (!ground[col] || cast.y > ground[col].y) ground[col] = cast;
        }
      }
      const outline = hull(projected);
      focus.setAttribute('d', outline.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + ' Z');
      // Keep the extended corner tappable without blocking adjacent controls
      // through the transparent padding around the rendering surface.
      canvas.style.clipPath = `polygon(${outline.map(p => `${(p.x + WIDTH * PAD_X) / (WIDTH * (1 + 2 * PAD_X)) * 100}% ${(p.y + height * PAD_Y) / (height * (1 + 2 * PAD_Y)) * 100}%`).join(',')})`;
      const shadowPoints = [{ x: 0, y: 0 }, { x: WIDTH, y: 0 }, ...ground.slice().reverse()];
      shadow.setAttribute('d', shadowPoints.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + ' Z');
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
      return Math.max(...projected.map(p => p.y)) / height;
    }

    function shader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        throw new Error('Paper shader could not compile');
      }
      return shader;
    }

    async function mount() {
      if (canvas || !img.naturalWidth || !card.isConnected) return;
      const url = UI.safeUrl(img.currentSrc || img.src);
      if (!url) return;
      height = WIDTH * img.naturalHeight / img.naturalWidth;
      canvas = document.createElement('canvas');
      canvas.className = 'poster-paper';
      canvas.setAttribute('aria-hidden', 'true');
      try {
        gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
        if (!gl) throw new Error('Paper rendering is unavailable');
        const art = await Posters.loadImage(url);
        if (!card.isConnected) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return; }
        if (!art) throw new Error('Paper texture is unavailable');
        program = gl.createProgram();
        const vertex = shader(gl.VERTEX_SHADER, vertexSource), fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Paper renderer could not link');
        gl.useProgram(program);
        vertices = new Float32Array((ROWS + 1) * (COLS + 1) * 8);
        const indices = [];
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const a = row * (COLS + 1) + col, b = a + 1, c = a + COLS + 1, d = c + 1;
            indices.push(a, d, b, a, c, d);
          }
        }
        indexCount = indices.length;
        vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW);
        indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        [['aPosition', 3, 0], ['aNormal', 3, 12], ['aUV', 2, 24]].forEach(([name, size, offset]) => {
          const location = gl.getAttribLocation(program, name);
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
        });
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, art);
        gl.uniform1i(gl.getUniformLocation(program, 'uArt'), 0);
        gl.uniform3f(gl.getUniformLocation(program, 'uCamera'), WIDTH / 2, height * 0.08, height * CAMERA_DISTANCE);
        gl.uniform4f(gl.getUniformLocation(program, 'uBounds'), WIDTH * (1 + 2 * PAD_X), height * (1 + 2 * PAD_Y), WIDTH * PAD_X, height * PAD_Y);
        const stock = getComputedStyle(card).getPropertyValue('--bone').trim();
        const color = /^#[a-f\d]{6}$/i.test(stock) ? [1, 3, 5].map(i => parseInt(stock.slice(i, i + 2), 16) / 255) : [1, 1, 1];
        gl.uniform3fv(gl.getUniformLocation(program, 'uPaper'), color);
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0, 0, 0, 0);
        const resize = () => {
          const scale = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.ceil(card.clientWidth * (1 + 2 * PAD_X) * scale);
          canvas.height = Math.ceil(card.clientHeight * (1 + 2 * PAD_Y) * scale);
          gl.viewport(0, 0, canvas.width, canvas.height);
          render();
        };
        const groundSvg = svgNode('svg', { viewBox: `0 0 ${WIDTH} ${height}`, class: 'paper-shadow', 'aria-hidden': 'true', focusable: 'false' });
        shadow = svgNode('path', { fill: 'rgba(var(--bg-rgb), 0.8)' });
        groundSvg.appendChild(shadow);
        const focusSvg = svgNode('svg', { viewBox: `0 0 ${WIDTH} ${height}`, class: 'paper-focus', 'aria-hidden': 'true', focusable: 'false' });
        focus = svgNode('path', { fill: 'none', stroke: 'var(--accent)', 'stroke-width': '3' });
        focusSvg.appendChild(focus);
        card.append(groundSvg, canvas, focusSvg);
        ready = true;
        card.classList.add('has-paper-curl');
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(card);
        const cleanup = () => {
          disposed = true;
          observer.disconnect();
          gl.deleteTexture(texture);
          gl.deleteBuffer(vertexBuffer);
          gl.deleteBuffer(indexBuffer);
          gl.deleteProgram(program);
          gl.getExtension('WEBGL_lose_context')?.loseContext();
        };
        const removal = new MutationObserver(() => {
          if (!card.isConnected) { removal.disconnect(); cleanup(); }
        });
        removal.observe(document.getElementById('movie-detail'), { childList: true, subtree: true });
        canvas.addEventListener('webglcontextlost', (event) => {
          if (disposed) return;
          event.preventDefault();
          ready = false;
          fallback = true;
          card.classList.remove('has-paper-curl');
          groundSvg.remove();
          focusSvg.remove();
          canvas.remove();
          render();
        });
      } catch (error) {
        fallback = true;
        ready = false;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        console.warn('Poster curl uses its fallback:', error.message);
        render();
      }
    }

    img.addEventListener('load', mount, { once: true });
    if (img.complete) mount();
    return { setProgress(value) { progress = Math.max(0, Math.min(1, value)); return render(); } };
  }

  return { create };
})();
