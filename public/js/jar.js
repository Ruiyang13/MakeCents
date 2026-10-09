// Savings jar: a soft, tinted glass jar with cash bundles and coins piled inside, drawn on <canvas class="jar">.
// Jars draw already settled. Only the jar whose amount just went up (data-from = its previous %) animates:
// the new pieces drop in through the mouth and land on the pile. A tiny position/velocity simulation, no libraries.
(() => {
  const jars = document.querySelectorAll('canvas.jar');
  if (!jars.length) return;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- geometry (CSS px, jar-local frame: jar box 110 × 172) -----------------------------
  const W = 170; // canvas size
  const H = 222;
  const OX = 30; // jar box position
  const OY = 30;
  const CX = 55; // centre line
  const MOUTH = 14;
  const NECK = 22;
  const BODY_TOP = 42;
  const CHAMFER_TOP = 150;
  const FLOOR = 167;
  const halfWidth = (y) => {
    // inner half-width of the glass at height y
    if (y < NECK) return 28;
    if (y < BODY_TOP) return 28 + (y - NECK);
    if (y < CHAMFER_TOP) return 48;
    return 48 - ((y - CHAMFER_TOP) * 14) / 20;
  };
  // faceted mason jar: short wide neck, angled shoulders, chamfered base; the rim sits on top
  const BODY = [
    [CX - 30, MOUTH],
    [CX + 30, MOUTH],
    [CX + 30, NECK],
    [CX + 50, BODY_TOP],
    [CX + 50, CHAMFER_TOP],
    [CX + 36, 170],
    [CX - 36, 170],
    [CX - 50, CHAMFER_TOP],
    [CX - 50, BODY_TOP],
    [CX - 30, NECK],
  ];
  const RIM = [
    [CX - 34, 3],
    [CX + 34, 3],
    [CX + 34, MOUTH],
    [CX - 34, MOUTH],
  ];

  // --- tiny deterministic RNG so each goal's jar always looks the same ---------------------------
  const rngFor = (seed) => {
    let h = 2166136261;
    for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
  };
  const pieces = (pct) => (pct > 0 ? Math.max(2, Math.round((pct / 100) * 46)) : 0); // 46 pieces fill the jar
  const clampPct = (v) => Math.max(0, Math.min(100, Number(v) || 0));

  const css = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (n) => s.getPropertyValue(n).trim();
    const dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    return {
      ink: v('--ink'),
      gold: v('--ochre'),
      sparkle: v('--ochre'),
      // cash bundle: face, side, paper band
      cash: dark ? '#7fa872' : '#6b9560',
      cashSide: dark ? '#5b7f50' : '#4f7346',
      band: dark ? '#e9e0c8' : '#f4ecd6',
      // coin: top, edge, highlight
      coin: dark ? '#dcb252' : '#dcae45',
      coinEdge: dark ? '#a8822f' : '#b0832c',
      coinShine: dark ? '#f2d488' : '#f5d987',
      glass: dark ? 'rgba(150,175,210,0.16)' : 'rgba(176,198,228,0.42)',
      halo: dark ? 'rgba(150,175,210,0.08)' : 'rgba(176,198,228,0.22)',
      rim: dark ? 'rgba(150,175,210,0.24)' : 'rgba(150,176,214,0.5)',
      shine: dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.5)',
      dark,
    };
  };
  let colors = css();
  new MutationObserver(() => {
    colors = css();
    jars.forEach((c) => c.jar?.draw());
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });

  function makeJar(canvas) {
    const pct = clampPct(canvas.dataset.pct);
    const full = pct >= 100;
    const rand = rngFor(canvas.dataset.seed || 'jar');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Pieces come from the same seeded sequence every load, so the first n always settle the same way.
    const all = [];
    for (let i = 0; i < pieces(pct); i++) {
      const cash = rand() < 0.45;
      all.push({
        cash,
        r: cash ? 10 : 6.5 + rand() * 1.5,
        m: cash ? 0.6 : 1,
        drag: cash ? 1.6 : 0.4, // per second
        bounce: cash ? 0.08 : 0.25,
        x: CX + (rand() - 0.5) * 60,
        y: BODY_TOP + 8 - rand() * 40 - i * 4,
        vx: 0,
        vy: 0,
        a: (rand() - 0.5) * 1.2,
        va: (rand() - 0.5) * 2,
        hue: rand(),
        wait: 0, // seconds before a dropping piece enters
      });
    }
    let parts = all;
    let time = 0;

    function step(dt) {
      for (const p of parts) {
        if (p.wait > 0) {
          p.wait -= dt;
          continue;
        }
        p.vy += 980 * dt;
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        if (p.cash) {
          // a bundle tumbles a little while falling, then lies still
          p.vx += Math.sin(time * 7 + p.hue * 20) * 14 * dt * Math.min(1, Math.abs(p.vy) / 60);
          p.va = (p.va + p.vx * 0.3 * dt) * 0.92;
          p.a += p.va * dt;
        } else {
          p.a = Math.max(-0.5, Math.min(0.5, p.a + p.vx * 0.002)); // coins tip with sideways motion
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // walls of the glass
        const hw = halfWidth(p.y) - 1;
        if (p.x < CX - hw + p.r) {
          p.x = CX - hw + p.r;
          p.vx = Math.abs(p.vx) * p.bounce;
          p.vy *= 0.92;
        } else if (p.x > CX + hw - p.r) {
          p.x = CX + hw - p.r;
          p.vx = -Math.abs(p.vx) * p.bounce;
          p.vy *= 0.92;
        }
        if (p.y > FLOOR - p.r) {
          p.y = FLOOR - p.r;
          p.vy = -Math.abs(p.vy) * p.bounce;
          p.vx *= 0.88;
        }
      }
      // pieces push each other apart (lighter bundles get pushed more)
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i];
          const b = parts[j];
          if (a.wait > 0 || b.wait > 0) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const min = a.r + b.r - 2; // a little overlap reads as a heap
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const push = min - d;
          const wa = b.m / (a.m + b.m);
          const wb = a.m / (a.m + b.m);
          a.x -= nx * push * wa;
          a.y -= ny * push * wa;
          b.x += nx * push * wb;
          b.y += ny * push * wb;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            const j2 = (-(1 + 0.15) * rel) / (1 / a.m + 1 / b.m);
            a.vx -= (j2 / a.m) * nx;
            a.vy -= (j2 / a.m) * ny;
            b.vx += (j2 / b.m) * nx;
            b.vy += (j2 / b.m) * ny;
          }
        }
      }
    }
    const settle = () => {
      for (let i = 0; i < 700; i++) step(1 / 120);
      for (const p of parts) p.vx = p.vy = 0;
    };

    // --- drawing -------------------------------------------------------------------------------
    const poly = (pts) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };

    function coin(p, c) {
      // a coin lying at an angle: an ellipse with a visible edge underneath and a highlight
      const rx = p.r * 1.3;
      const ry = p.r * 0.62;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = c.coinEdge;
      ctx.beginPath();
      ctx.ellipse(0, 2.4, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-rx, 0, rx * 2, 2.4);
      ctx.fillStyle = c.coin;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.coinShine;
      ctx.beginPath();
      ctx.ellipse(-rx * 0.15, -ry * 0.15, rx * 0.55, ry * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function bundle(p, c) {
      // a brick of notes: face, a thick side showing the stack, and a paper band round the middle
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = c.cashSide;
      ctx.fillRect(-15, -4, 30, 12);
      ctx.fillStyle = c.cash;
      ctx.fillRect(-15, -9, 30, 12);
      ctx.strokeStyle = c.cashSide;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(-8, -3, 2.6, 0, Math.PI * 2);
      ctx.moveTo(6, -5);
      ctx.lineTo(12, -5);
      ctx.moveTo(6, -1.5);
      ctx.lineTo(10, -1.5);
      ctx.stroke();
      ctx.fillStyle = c.band;
      ctx.fillRect(-3, -9, 6, 17);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(-3, 3, 6, 5);
      ctx.restore();
    }

    function draw() {
      const c = colors;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(OX, OY);

      // layer 1: soft halo, offset down-right (depth)
      ctx.fillStyle = c.halo;
      ctx.save();
      ctx.translate(7, 7);
      poly(BODY);
      ctx.fill();
      poly(RIM);
      ctx.fill();
      ctx.restore();

      // layer 2: geometric floor shadow
      ctx.save();
      ctx.globalAlpha = c.dark ? 0.35 : 0.1;
      ctx.fillStyle = c.ink;
      poly([
        [CX - 44, 174],
        [CX + 48, 174],
        [CX + 40, 181],
        [CX - 52, 181],
      ]);
      ctx.fill();
      ctx.restore();

      // layer 3: the tinted glass
      poly(BODY);
      ctx.fillStyle = c.glass;
      ctx.fill();

      // layer 4: contents, clipped to the glass, drawn back to front (higher pieces first)
      ctx.save();
      poly(BODY);
      ctx.clip();
      const shown = parts.filter((p) => p.wait <= 0).sort((a, b) => a.y - b.y);
      for (const p of shown) (p.cash ? bundle : coin)(p, c);
      ctx.restore();

      // layer 5: glass facets in front of the contents
      ctx.fillStyle = c.shine;
      poly([
        [CX - 42, 50],
        [CX - 36, 50],
        [CX - 36, 140],
        [CX - 42, 146],
      ]);
      ctx.fill();
      poly([
        [CX - 26, 22],
        [CX - 44, 40],
        [CX - 36, 40],
        [CX - 20, 22],
      ]);
      ctx.fill();
      // level marks at 25 / 50 / 75 %
      ctx.strokeStyle = c.rim;
      ctx.lineWidth = 1.5;
      for (const f of [0.25, 0.5, 0.75]) {
        const y = FLOOR - f * (FLOOR - BODY_TOP);
        ctx.beginPath();
        ctx.moveTo(CX + 38, y);
        ctx.lineTo(CX + 46, y);
        ctx.stroke();
      }
      // the rim (open jar, no lid)
      poly(RIM);
      ctx.fillStyle = c.rim;
      ctx.fill();
      ctx.fillStyle = c.shine;
      poly([
        [CX - 34, 3],
        [CX - 14, 3],
        [CX - 18, MOUTH],
        [CX - 34, MOUTH],
      ]);
      ctx.fill();
      ctx.restore();

      // "+£50" rises from the mouth and fades while the money drops in
      const added = canvas.dataset.added;
      if (added && time > 0 && time < 2.4) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, time * 4) * Math.min(1, (2.4 - time) / 0.8);
        ctx.font = '800 15px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = c.dark ? '#1c1c1a' : '#faf8f3';
        ctx.fillStyle = c.coinEdge;
        const ly = OY - 4 - Math.min(1, time / 1.2) * 14;
        ctx.strokeText(added, OX + CX, ly);
        ctx.fillText(added, OX + CX, ly);
        ctx.restore();
      }

      // full: three geometric sparkles
      if (full) {
        ctx.fillStyle = c.sparkle;
        [
          [OX + 2, OY + 30, 6],
          [OX + 118, OY + 14, 5],
          [OX + 126, OY + 110, 7],
        ].forEach(([x, y, s]) => {
          poly([
            [x, y - s],
            [x + s * 0.35, y],
            [x, y + s],
            [x - s * 0.35, y],
          ]);
          ctx.fill();
        });
      }
    }

    canvas.jar = { draw };

    // What was already there rests on the bottom. If the amount just went up, the new pieces fall in.
    const from = canvas.dataset.from === undefined ? pct : clampPct(canvas.dataset.from);
    // money just went in: at least one piece drops, even for an amount too small to add a whole piece
    const before = canvas.dataset.from === undefined || pct < from ? all.length : Math.min(pieces(from), all.length - 1);
    parts = all.slice(0, before);
    settle();
    const dropping = all.slice(before);
    parts = all;
    if (!dropping.length) return draw();
    if (reduceMotion) {
      settle();
      return draw();
    }
    dropping.forEach((p, i) => {
      p.x = CX + (p.hue - 0.5) * 24; // through the mouth
      p.y = MOUTH - p.r;
      p.vy = 60;
      p.wait = 0.25 + i * 0.12;
    });
    draw();

    let last = 0;
    let quiet = 0;
    function frame(now) {
      const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
      last = now;
      time += dt;
      step(dt / 2);
      step(dt / 2);
      draw();
      const moving = parts.some((p) => p.wait > 0 || Math.abs(p.vx) + Math.abs(p.vy) > 4);
      quiet = moving ? 0 : quiet + 1;
      if (quiet < 30 || time < 2.4) requestAnimationFrame(frame); // keep going until the "+£" label has faded
    }
    // start once the jar is on screen, so the drop isn't missed
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      last = performance.now();
      requestAnimationFrame(frame);
    });
    io.observe(canvas);
  }

  jars.forEach(makeJar);
})();
