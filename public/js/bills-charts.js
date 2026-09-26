// Bills tab charts, built from the Lieflat Charts templates in the WIRE preset
// (grey ladder carries the data, one fluorescent-orange element per chart is the focal point):
//   F2 Hairline Line (basics-gallery.html · "Thirty days of sign-ups")      -> everyday money out per day, this month
//   F4 Tick Donut    (basics-gallery.html · "Where the traffic comes from") -> bills by category, 1 tick = 1%
(() => {
  const DATA = JSON.parse(document.getElementById('bills-data').textContent);
  const tr = window.t; // translations from layout.pug (English passthrough)
  const fmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: DATA.currency });
  const fmt0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: DATA.currency, maximumFractionDigits: 0 });

  // WIRE role tokens (color-presets.js). Dark mode flips the greys to paper tints; HERO stays orange.
  const HERO = '#F5572F';
  const theme = () =>
    document.documentElement.getAttribute('data-bs-theme') === 'dark'
      ? {
          BG: '#1C1C1A',
          TXT: '#F0F0EE',
          INK: '#F0F0EE',
          MUT: 'rgba(240,240,238,.60)',
          FAINT: 'rgba(240,240,238,.32)',
          FLOOR: 'rgba(240,240,238,.24)',
          GRID: 'rgba(240,240,238,.16)',
          CAT4: [HERO, '#F0F0EE', 'rgba(240,240,238,.60)', 'rgba(240,240,238,.30)'],
        }
      : {
          BG: '#F0F0EE',
          TXT: '#1F1E1C',
          INK: '#22211F',
          MUT: 'rgba(31,30,28,.60)',
          FAINT: 'rgba(31,30,28,.32)',
          FLOOR: 'rgba(31,30,28,.24)',
          GRID: 'rgba(31,30,28,.16)',
          CAT4: [HERO, '#22211F', '#8F8E86', '#C0BFB7'],
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
  const tip = (n, s) => {
    const t = document.createElementNS(NS, 'title');
    t.textContent = s;
    n.appendChild(t);
  };
  const rnd = (i, k) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000; // deterministic
  const D2R = Math.PI / 180;
  const pol = (cx, cy, r, deg) => [cx + r * Math.cos(deg * D2R), cy + r * Math.sin(deg * D2R)];
  // Unified reveal: draw when scrolled into view, click replays. Returns a redraw function.
  const obsReveal = (id, fn) => {
    const n = document.getElementById(id);
    if (!n) return () => {};
    const go = () => {
      n.innerHTML = '';
      fn(n);
    };
    const io = new IntersectionObserver(
      (es) => {
        if (es[0].isIntersecting) {
          go();
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(n);
    n.style.cursor = 'pointer';
    n.addEventListener('click', go);
    return go;
  };

  // ════ B2 · hairline line ════ one dot per day this month (future days: floor tick only).
  // Everyday spending only (fixed costs are set apart). Orange = the biggest day.
  const drawLine = obsReveal('dayline', (s) => {
    const { BG, TXT, INK, MUT, FAINT, FLOOR, GRID } = theme();
    const D = DATA.days;
    const N = D.length;
    const x = (i) => 30 + i * (346 / (N - 1));
    const base = 262;
    const max = Math.max(...D.map((d) => d.total), 1);
    const map = (v) => base - (v / max) * 210; // from zero: height stays proportional to money
    for (let i = 0; i < N; i++) {
      el(s, 'line', {
        x1: x(i),
        y1: base,
        x2: x(i),
        y2: base - 7,
        stroke: FLOOR,
        'stroke-width': 0.6,
        class: 'lf-fade',
        style: `animation-delay:${i * 0.008}s`,
      });
    }
    el(s, 'line', { x1: 24, y1: base, x2: 376, y2: base, stroke: GRID, 'stroke-width': 0.8, class: 'lf-fade' });
    const past = D.map((d, i) => ({ ...d, i })).filter((d) => !d.future);
    if (past.length) {
      const hero = past.reduce((a, b) => (b.total > a.total ? b : a)).i;
      // second label: the biggest day at least 4 days from the hero, so labels never collide
      const second = past.filter((d) => Math.abs(d.i - hero) >= 4).sort((a, b) => b.total - a.total)[0]?.i;
      const pts = past.map((d) => `${x(d.i)} ${map(d.total)}`).join(' L ');
      el(s, 'path', { d: `M${pts}`, fill: 'none', stroke: INK, 'stroke-width': 2.2, pathLength: 1, class: 'lf-draw', style: 'animation-duration:1.2s' });
      past.forEach((d) => {
        const big = d.i === hero && d.total > 0;
        const dot = el(s, 'circle', {
          cx: x(d.i),
          cy: map(d.total),
          r: big ? 5.2 : 3.1,
          fill: big ? HERO : INK,
          stroke: big ? HERO : INK,
          class: 'lf-pop',
          style: `animation-delay:${0.2 + d.i * 0.03}s`,
        });
        tip(dot, tr('{day} {month} — {amount}', { day: d.day, month: DATA.month, amount: fmt.format(d.total) }));
        if ((big || d.i === second) && d.total > 0) {
          txt(
            s,
            {
              x: x(d.i),
              y: map(d.total) - 11,
              'font-size': 9.5,
              'font-weight': 800,
              fill: TXT,
              'text-anchor': 'middle',
              style: `paint-order:stroke;stroke:${BG};stroke-width:3px;animation-delay:${1 + d.i * 0.01}s`,
              class: 'lf-fade',
            },
            fmt0.format(d.total),
          );
        }
      });
    }
    const mon = document.documentElement.lang === 'zh' ? DATA.month : DATA.month.slice(0, 3).toUpperCase();
    [0, Math.floor((N - 1) / 2), N - 1].forEach((i) =>
      txt(
        s,
        { x: x(i), y: base + 18, 'font-size': 7.5, 'font-weight': 600, fill: MUT, 'text-anchor': 'middle', 'letter-spacing': '.1em', class: 'lf-fade' },
        tr('{mon} {day}', { mon, day: i + 1 }),
      ),
    );
    txt(
      s,
      {
        x: 200,
        y: 306,
        'font-size': 7,
        'font-weight': 600,
        fill: FAINT,
        'text-anchor': 'middle',
        'letter-spacing': '.12em',
        class: 'lf-fade',
        style: 'animation-delay:1.1s',
      },
      tr('ONE DOT = ONE DAY · FIXED COSTS NOT INCLUDED'),
    );
  });
  // ════ B4 · tick donut ════ 1 tick = 1%; Wire CAT4, orange = biggest share. Used for fixed bills and everyday mix.
  const donut = (id, parts, centerLabel) =>
    obsReveal(id, (s) => {
      const { BG, TXT, MUT, FAINT, CAT4 } = theme();
      const cx = 200;
      const cy = 148;
      const R0 = 64;
      let k0 = 0;
      parts.forEach(({ label, pct, monthly }, si) => {
        const shade = CAT4[si];
        for (let k = 0; k < pct; k++) {
          const idx = k0 + k;
          const a = idx * 3.6 - 90;
          const len = 12 + rnd(idx + 1, si + 2) * 6;
          const [x1, y1] = pol(cx, cy, R0, a);
          const [x2, y2] = pol(cx, cy, R0 + len, a);
          el(s, 'line', { x1, y1, x2, y2, stroke: shade, 'stroke-width': 1.9, class: 'lf-fade', style: `animation-delay:${idx * 0.012}s` });
          if (idx % 10 === 0) {
            const [dx, dy] = pol(cx, cy, R0 - 5, a);
            el(s, 'circle', { cx: dx, cy: dy, r: 0.8, fill: FAINT, class: 'lf-fade', style: `animation-delay:${idx * 0.012}s` });
          }
        }
        const mid = (k0 + pct / 2) * 3.6 - 90;
        const [lx, ly] = pol(cx, cy, R0 + 38, mid);
        const [gx, gy] = pol(cx, cy, R0 + 20, mid);
        el(s, 'line', {
          x1: gx,
          y1: gy,
          x2: lx,
          y2: ly,
          stroke: FAINT,
          'stroke-width': 0.7,
          'stroke-dasharray': '1 3',
          class: 'lf-fade',
          style: `animation-delay:${0.6 + si * 0.1}s`,
        });
        const anchor = Math.cos(mid * D2R) > 0.3 ? 'start' : Math.cos(mid * D2R) < -0.3 ? 'end' : 'middle';
        const lab = txt(
          s,
          {
            x: lx,
            y: ly + 3,
            'font-size': 8,
            'font-weight': 800,
            fill: si === 0 ? HERO : TXT, // grey tints are too faint for text; only the focal label takes colour
            'text-anchor': anchor,
            'letter-spacing': '.06em',
            style: `paint-order:stroke;stroke:${BG};stroke-width:3px;animation-delay:${0.65 + si * 0.1}s`,
            class: 'lf-fade',
          },
          `${label.toUpperCase()} · ${pct}`,
        );
        tip(lab, tr('{cat} — {pct}% · {amount} a month', { cat: label, pct, amount: fmt.format(monthly) }));
        k0 += pct;
      });
      txt(
        s,
        { x: cx, y: cy + 2, 'font-size': 20, 'font-weight': 800, fill: TXT, 'text-anchor': 'middle', class: 'lf-fade', style: 'animation-delay:.9s' },
        fmt0.format(parts.reduce((a, c) => a + c.monthly, 0)),
      );
      txt(
        s,
        {
          x: cx,
          y: cy + 16,
          'font-size': 7,
          'font-weight': 600,
          fill: MUT,
          'text-anchor': 'middle',
          'letter-spacing': '.1em',
          class: 'lf-fade',
          style: 'animation-delay:.9s',
        },
        centerLabel,
      );
      txt(
        s,
        {
          x: 200,
          y: 296,
          'font-size': 7,
          'font-weight': 600,
          fill: FAINT,
          'text-anchor': 'middle',
          'letter-spacing': '.12em',
          class: 'lf-fade',
          style: 'animation-delay:1.1s',
        },
        tr('TWELVE O’CLOCK IS ZERO · DOT MARKS EVERY TENTH · READS CLOCKWISE'),
      );
    });

  const drawBills = donut('billdonut', DATA.composition, tr('PER MONTH'));
  const drawMix = donut('mixdonut', DATA.everydayMix, tr('THIS MONTH'));

  // Theme toggle recolours every chart.
  new MutationObserver(() => {
    drawLine();
    drawBills();
    drawMix();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
})();
