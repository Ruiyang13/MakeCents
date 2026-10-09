// Insights charts, drawn in the app's own palette (ink greys + one crimson focal point):
//   pace  running total of everyday spending, this month (solid) vs last month (dotted); a crosshair reads any day
//   pie   this month's everyday spending by category; hover a slice or its row to pull it out and read it
(() => {
  const DATA = JSON.parse(document.getElementById('bills-data').textContent);
  const tr = window.t; // translations from layout.pug (English passthrough)
  const fmt0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: DATA.currency, maximumFractionDigits: 0 });

  // Colours are the app's CSS variables (main.css :root), read at draw time so dark mode just works.
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fade = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };
  let HERO = '';
  const theme = () => {
    const ink = css('--ink');
    HERO = css('--crimson');
    return {
      BG: css('--card'),
      TXT: ink,
      INK: ink,
      MUT: fade(ink, 0.6),
      FAINT: fade(ink, 0.4),
      GRID: fade(ink, 0.16),
      PIE: [HERO, ink, css('--ochre'), css('--sage'), css('--slate'), css('--ink-2'), fade(ink, 0.3)],
    };
  };

  const NS = 'http://www.w3.org/2000/svg';
  const el = (p, t, a) => {
    const n = document.createElementNS(NS, t);
    for (const k in a) n.setAttribute(k, a[k]);
    p.appendChild(n);
    return n;
  };
  const txt = (p, a, s) => {
    const n = el(p, 'text', a);
    n.textContent = s;
    return n;
  };
  // pointer position in the SVG's own coordinates
  const local = (svg, e) => {
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  };

  // ════ pace ════
  const pace = document.getElementById('pace');
  function drawPace() {
    if (!pace) return;
    pace.innerHTML = '';
    const { BG, TXT, INK, MUT, FAINT, GRID } = theme();
    const now = DATA.thisCum;
    const last = DATA.lastCum;
    const N = Math.max(31, last.length);
    const step = 352 / (N - 1);
    const x = (i) => 24 + i * step;
    const base = 210;
    const max = Math.max(...now, ...last, 1);
    const y = (v) => base - (v / max) * 170;
    const path = (vals) => `M${vals.map((v, i) => `${x(i)} ${y(v)}`).join(' L ')}`;

    for (const f of [0.5, 1]) {
      el(pace, 'line', { x1: 24, y1: y(max * f), x2: 376, y2: y(max * f), stroke: GRID, 'stroke-width': 0.6, 'stroke-dasharray': '2 4', class: 'ins-fade' });
      txt(pace, { x: 376, y: y(max * f) - 5, 'font-size': 8, fill: MUT, 'text-anchor': 'end', class: 'ins-fade' }, fmt0.format(max * f));
    }
    el(pace, 'line', { x1: 24, y1: base, x2: 376, y2: base, stroke: GRID, 'stroke-width': 0.8 });
    if (last.length) {
      el(pace, 'path', {
        d: path(last),
        fill: 'none',
        stroke: FAINT,
        'stroke-width': 1.6,
        'stroke-dasharray': '1 4',
        'stroke-linecap': 'round',
        class: 'ins-fade',
      });
    }
    const today = el(pace, 'g', {});
    if (now.length) {
      el(pace, 'path', { d: path(now), fill: 'none', stroke: INK, 'stroke-width': 2.2, pathLength: 1, class: 'ins-draw', style: 'animation-duration:1.2s' });
      const i = now.length - 1;
      el(today, 'circle', { cx: x(i), cy: y(now[i]), r: 5, fill: HERO, class: 'ins-pop', style: 'animation-delay:1s' });
      txt(
        today,
        {
          x: x(i),
          y: y(now[i]) - 12,
          'font-size': 11,
          'font-weight': 800,
          fill: TXT,
          'text-anchor': i > N * 0.8 ? 'end' : 'middle',
          style: `paint-order:stroke;stroke:${BG};stroke-width:4px;animation-delay:1.1s`,
          class: 'ins-fade',
        },
        fmt0.format(now[i]),
      );
    }
    [1, 10, 20, N].forEach((d) =>
      txt(pace, { x: x(d - 1), y: base + 18, 'font-size': 8, 'font-weight': 600, fill: MUT, 'text-anchor': 'middle', class: 'ins-fade' }, String(d)),
    );

    // crosshair + readout, shown while the pointer is over the chart
    const hover = el(pace, 'g', { visibility: 'hidden', 'pointer-events': 'none' });
    const rule = el(hover, 'line', { y1: 24, y2: base, stroke: MUT, 'stroke-width': 0.8 });
    const dotNow = el(hover, 'circle', { r: 4.5, fill: HERO, stroke: BG, 'stroke-width': 2 });
    const dotLast = el(hover, 'circle', { r: 3.5, fill: BG, stroke: MUT, 'stroke-width': 1.5 });
    const box = el(hover, 'rect', { width: 128, height: 50, rx: 8, fill: INK });
    const t1 = txt(hover, { 'font-size': 9, 'font-weight': 700, fill: BG }, '');
    const t2 = txt(hover, { 'font-size': 9, fill: BG }, '');
    const t3 = txt(hover, { 'font-size': 9, fill: BG, opacity: 0.7 }, '');
    const show = (e) => {
      const i = Math.max(0, Math.min(N - 1, Math.round((local(pace, e).x - 24) / step)));
      if (now[i] === undefined && last[i] === undefined) return;
      hover.setAttribute('visibility', 'visible');
      today.setAttribute('opacity', 0.25);
      rule.setAttribute('x1', x(i));
      rule.setAttribute('x2', x(i));
      dotNow.setAttribute('visibility', now[i] === undefined ? 'hidden' : 'visible');
      dotNow.setAttribute('cx', x(i));
      dotNow.setAttribute('cy', y(now[i] || 0));
      dotLast.setAttribute('visibility', last[i] === undefined ? 'hidden' : 'visible');
      dotLast.setAttribute('cx', x(i));
      dotLast.setAttribute('cy', y(last[i] || 0));
      const bx = x(i) > 230 ? x(i) - 140 : x(i) + 12;
      box.setAttribute('x', bx);
      box.setAttribute('y', 26);
      [t1, t2, t3].forEach((n, k) => {
        n.setAttribute('x', bx + 10);
        n.setAttribute('y', 41 + k * 13);
      });
      t1.textContent = tr('Day {day}', { day: i + 1 });
      t2.textContent = now[i] === undefined ? '' : `${DATA.month}  ${fmt0.format(now[i])}`;
      t3.textContent = last[i] === undefined ? '' : `${DATA.lastMonth}  ${fmt0.format(last[i])}`;
    };
    pace.onpointermove = show;
    pace.onpointerdown = show; // touch: tap a day
    pace.onpointerleave = () => {
      hover.setAttribute('visibility', 'hidden');
      today.setAttribute('opacity', 1);
    };
  }

  // ════ pie ════ donut with the total in the middle; slices from twelve o'clock, biggest first
  const pie = document.getElementById('pie');
  const rows = [...document.querySelectorAll('.cat-rows li')];
  let focus = () => {};
  function drawPie() {
    if (!pie) return;
    pie.innerHTML = '';
    const { BG, TXT, MUT, PIE } = theme();
    const cats = DATA.categories;
    const total = cats.reduce((a, c) => a + c.spent, 0);
    const C = 120;
    const R = 104;
    const r = 64;
    const pt = (rad, a) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;
    let a0 = -Math.PI / 2;
    const slices = cats.map((c, i) => {
      const a1 = a0 + (c.spent / total) * Math.PI * 2;
      const am = (a0 + a1) / 2; // two half-arcs per slice, so a single 100% slice still draws
      const d = `M${pt(R, a0)} A${R} ${R} 0 0 1 ${pt(R, am)} A${R} ${R} 0 0 1 ${pt(R, a1)} L${pt(r, a1)} A${r} ${r} 0 0 0 ${pt(r, am)} A${r} ${r} 0 0 0 ${pt(r, a0)} Z`;
      const s = el(pie, 'path', {
        d,
        fill: PIE[i % PIE.length],
        stroke: BG,
        'stroke-width': 2,
        class: 'pie-slice ins-fade',
        style: `animation-delay:${i * 0.08}s`,
      });
      s.dataset.dx = Math.cos(am) * 7;
      s.dataset.dy = Math.sin(am) * 7;
      s.addEventListener('pointerenter', () => focus(i));
      s.addEventListener('pointerleave', () => focus(-1));
      s.addEventListener('click', () => focus(i));
      if (rows[i]) rows[i].querySelector('.cat-swatch').style.background = PIE[i % PIE.length];
      a0 = a1;
      return s;
    });
    const big = txt(pie, { x: C, y: C + 2, 'font-size': 26, 'font-weight': 800, fill: TXT, 'text-anchor': 'middle' }, '');
    const small = txt(pie, { x: C, y: C + 20, 'font-size': 10, 'font-weight': 600, fill: MUT, 'text-anchor': 'middle', 'letter-spacing': '.04em' }, '');
    focus = (k) => {
      slices.forEach((s, i) => {
        s.style.transform = i === k ? `translate(${s.dataset.dx}px, ${s.dataset.dy}px)` : '';
        s.style.opacity = k < 0 || i === k ? 1 : 0.35;
      });
      rows.forEach((row, i) => row.classList.toggle('active', i === k));
      big.textContent = k < 0 ? fmt0.format(total) : `${cats[k].pct}%`;
      small.textContent = k < 0 ? tr('THIS MONTH') : `${cats[k].label} · ${fmt0.format(cats[k].spent)}`;
    };
    focus(-1);
  }
  rows.forEach((row, i) => {
    row.addEventListener('mouseenter', () => focus(i));
    row.addEventListener('mouseleave', () => focus(-1));
    row.addEventListener('focus', () => focus(i));
    row.addEventListener('blur', () => focus(-1));
  });

  drawPace();
  drawPie();
  // Theme toggle recolours both charts.
  new MutationObserver(() => {
    drawPace();
    drawPie();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
})();
