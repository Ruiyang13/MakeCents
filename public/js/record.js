// Card-style bookkeeping: tap a category card -> keypad sheet -> plain form POST to /finance/record.
// (Budgets are edited on the Budgets tab.)
(() => {
  const t = window.t; // translations from layout.pug (English passthrough)
  const modalEl = document.getElementById('rec-modal');
  const modal = new window.bootstrap.Modal(modalEl);
  const form = document.getElementById('rec-form');
  const display = document.getElementById('rec-display');
  const amountInput = document.getElementById('rec-amount');
  const saveBtn = document.getElementById('rec-save');
  let value = '';

  function render() {
    display.textContent = value || '0';
    amountInput.value = value;
    saveBtn.disabled = !(Number(value) > 0);
  }

  // Keep input a valid money string: up to 7 digits, one dot, two decimals.
  function press(k) {
    if (k === 'back') value = value.slice(0, -1);
    else if (k === '.') {
      if (!value.includes('.')) value = (value || '0') + '.';
    } else if (/^\d$/.test(k)) {
      const [int, dec] = value.split('.');
      if (dec !== undefined ? dec.length < 2 : int.length < 7) value = value === '0' ? k : value + k;
    }
    render();
  }

  document.querySelectorAll('.rec-card').forEach((card) => {
    card.addEventListener('click', () => {
      const { key, label, sub, icon, income } = card.dataset;
      document.getElementById('rec-category').value = key;
      document.getElementById('rec-title').textContent = income ? t('{cat} received', { cat: label }) : t('{cat} spending', { cat: label });
      document.getElementById('rec-sub').textContent = sub;
      document.getElementById('rec-sheet-icon').className = `fas ${icon}`;
      document.getElementById('rec-sheet-glyph').className = `rec-glyph ${card.querySelector('.rec-glyph').className.match(/tone-\d/)[0]}`;
      saveBtn.textContent = income ? t('Save income') : t('Save spending');
      form.action = '/finance/record';
      catWrap.hidden = true;
      form.elements.note.value = '';
      form.elements.date.value = form.elements.date.defaultValue;
      value = '';
      render();
      modal.show();
    });
  });

  // Edit an entry from the history: the same sheet, prefilled, posting to /finance/record/:id.
  const catWrap = document.getElementById('rec-cat-wrap');
  const catSelect = document.getElementById('rec-cat-select');
  catSelect.addEventListener('change', () => {
    document.getElementById('rec-category').value = catSelect.value;
  });
  document.querySelectorAll('.hist-edit').forEach((b) =>
    b.addEventListener('click', () => {
      const { id, category, amount, note, date } = b.dataset;
      form.action = `/finance/record/${id}`;
      document.getElementById('rec-category').value = category;
      catSelect.value = category;
      catWrap.hidden = false;
      document.getElementById('rec-title').textContent = t('Edit entry');
      document.getElementById('rec-sub').textContent = '';
      const glyph = b.closest('.hist-row').querySelector('.rec-glyph');
      document.getElementById('rec-sheet-glyph').className = `rec-glyph ${glyph.className.match(/tone-\d/)[0]}`;
      document.getElementById('rec-sheet-icon').className = glyph.querySelector('i').className;
      saveBtn.textContent = t('Save changes');
      form.elements.note.value = note;
      form.elements.date.value = date;
      value = amount;
      render();
      modal.show();
    }),
  );

  document.querySelectorAll('.rec-key').forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));

  // Physical keyboard works too, unless the user is typing in the note/date fields.
  modalEl.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select')) return;
    if (/^[\d.]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter' && !saveBtn.disabled) form.requestSubmit();
    else return;
    e.preventDefault();
  });

  // Spending history: search box + filter pills (All / Fixed / Added by you / Scanned).
  // A day header hides when none of its rows match.
  const search = document.getElementById('hist-search');
  if (search) {
    const rows = [...document.querySelectorAll('.hist-row')];
    const days = [...document.querySelectorAll('.hist-day')];
    const count = document.getElementById('hist-count');
    const empty = document.getElementById('hist-empty');
    let filter = 'all';
    const apply = () => {
      const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const r of rows) {
        const hit = terms.every((w) => r.dataset.search.includes(w)) && (filter === 'all' || r.dataset.kind.split(' ').includes(filter));
        r.hidden = !hit;
        if (hit) shown += 1;
      }
      for (const d of days) d.hidden = !d.querySelector('.hist-row:not([hidden])');
      const narrowed = terms.length || filter !== 'all';
      count.textContent = narrowed ? t('{shown} of {n} transactions', { shown, n: rows.length }) : t('{n} transactions', { n: rows.length });
      empty.hidden = shown > 0;
    };
    search.addEventListener('input', apply);
    document.querySelectorAll('.hist-filter').forEach((b) =>
      b.addEventListener('click', () => {
        filter = b.dataset.filter;
        document.querySelectorAll('.hist-filter').forEach((x) => x.classList.toggle('active', x === b));
        apply();
      }),
    );
  }
})();
