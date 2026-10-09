// Chat client for /finance: streams agent replies (SSE), renders Markdown safely, handles approval cards.
(() => {
  const t = window.t; // translations from layout.pug (English passthrough)
  const log = document.getElementById('chat-log');
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-button');
  const activity = document.getElementById('activity');
  const statusEl = document.getElementById('status');
  const statusDot = document.getElementById('status-dot');
  const avatarTpl = document.getElementById('avatar-tpl');
  const csrf = () => document.querySelector('meta[name="csrf-token"]').content;

  // Model output is untrusted: parse Markdown, then sanitise before it touches the DOM.
  const renderMd = (text) => window.DOMPurify.sanitize(window.marked.parse(text, { breaks: true, gfm: true }));

  const scrollDown = () => {
    log.scrollTop = log.scrollHeight;
  };
  const clearWelcome = () => document.getElementById('welcome')?.remove();

  function addUser(text) {
    clearWelcome();
    const div = document.createElement('div');
    div.className = 'msg user';
    div.textContent = text;
    log.appendChild(div);
    scrollDown();
  }

  function addAI(markdown, extraClass = '') {
    const wrap = document.createElement('div');
    wrap.className = `msg ai ${extraClass}`;
    wrap.appendChild(avatarTpl.content.cloneNode(true));
    const bubble = document.createElement('div');
    bubble.className = 'bubble md';
    bubble.innerHTML = renderMd(markdown);
    wrap.appendChild(bubble);
    log.appendChild(wrap);
    scrollDown();
    return wrap;
  }

  function thinking() {
    const wrap = document.createElement('div');
    wrap.className = 'msg ai';
    wrap.appendChild(avatarTpl.content.cloneNode(true));
    wrap.insertAdjacentHTML('beforeend', '<div class="thinking"><i></i><i></i><i></i><span>' + t('Thinking…') + '</span></div>');
    log.appendChild(wrap);
    scrollDown();
    return wrap;
  }

  function note(text) {
    if (activity.firstElementChild?.classList.contains('muted')) activity.innerHTML = '';
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.append(time, text);
    activity.appendChild(li);
    activity.scrollTop = activity.scrollHeight;
  }

  function setBusy(busy) {
    sendBtn.disabled = busy;
    statusEl.textContent = busy ? t('Working') : t('Ready');
    statusDot.classList.toggle('busy', busy);
  }

  function describe({ tool, args }) {
    if (tool === 'set_budget') return t('Set {cat} budget → {limit} / month', { cat: t(args.category), limit: args.monthlyLimit });
    if (tool === 'delete_budget') return t('Remove {cat} budget', { cat: t(args.category) });
    if (tool === 'add_transaction') {
      const sign = args.direction === 'in' ? '+' : '−';
      return t('Record {amount} at {merchant} ({cat}, {date})', {
        amount: sign + args.amount,
        merchant: args.merchant,
        cat: t(args.category),
        date: args.date || t('today'),
      });
    }
    if (tool === 'transfer_to_goal') return t('Move {amount} from the sandbox account to {goal}', { amount: args.amount, goal: args.goal });
    if (tool === 'pay_bill') return t('Pay {merchant} {amount} from the sandbox account', { merchant: args.merchant, amount: args.amount });
    return `${tool} ${JSON.stringify(args)}`;
  }

  // Human-in-the-loop: write actions only run when the user clicks Confirm.
  function approvalCard(a) {
    clearWelcome();
    const card = document.createElement('div');
    card.className = a.tier === 'move' ? 'approval money' : 'approval';
    const text = document.createElement('div');
    text.innerHTML = `<span class="tag">${t('Needs your approval')}</span>`;
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = describe(a);
    text.appendChild(what);
    const btns = document.createElement('div');
    btns.className = 'd-flex gap-2';
    for (const [verb, label, cls] of [
      ['confirm', t('Confirm'), 'btn-danger'],
      ['reject', t('Reject'), 'btn-ghost'],
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn btn-sm ${cls}`;
      b.textContent = label;
      b.onclick = () => decide(a, verb, card, text);
      btns.appendChild(b);
    }
    card.append(text, btns);
    log.appendChild(card);
    scrollDown();
  }

  // Moving money with two-step sign-in on: the server asks for a fresh authenticator code before it runs.
  function askCode(a, card, text, message) {
    const row = card.lastElementChild;
    const code = Object.assign(document.createElement('input'), {
      className: 'form-control form-control-sm num code-input',
      inputMode: 'numeric',
      maxLength: 7,
      placeholder: t('6-digit code'),
      autocomplete: 'one-time-code',
    });
    code.setAttribute('aria-label', message);
    const ok = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-sm btn-danger', textContent: t('Confirm') });
    ok.onclick = () => code.value.trim() && decide(a, 'confirm', card, text, code.value.trim());
    code.onkeydown = (e) => e.key === 'Enter' && ok.click();
    const no = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-sm btn-ghost', textContent: t('Reject') });
    no.onclick = () => decide(a, 'reject', card, text);
    row.replaceChildren(code, ok, no);
    text.querySelector('.tag').textContent = message;
    code.focus();
  }

  async function decide(a, verb, card, text, code) {
    card.querySelectorAll('button').forEach((b) => {
      b.disabled = true;
    });
    let tag;
    try {
      const r = await fetch(`/finance/actions/${encodeURIComponent(a.id)}/${verb}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        body: JSON.stringify(code ? { code } : {}),
      });
      const d = await r.json();
      if (d.needCode) return askCode(a, card, text, d.error);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      tag = { confirmed: t('Applied'), rejected: t('Rejected'), error: t('Failed: {error}', { error: d.action.error }) }[d.action.status];
      card.classList.add(d.action.status === 'error' ? 'failed' : 'done');
      note(`${tag}: ${describe(a)}`);
    } catch (err) {
      tag = err.message;
      card.classList.add('failed');
    }
    text.querySelector('.tag').textContent = tag;
    card.lastElementChild.remove();
  }

  async function send(textArg) {
    const text = (textArg ?? input.value).trim();
    if (!text || sendBtn.disabled) return;
    addUser(text);
    input.value = '';
    input.style.height = '';
    setBusy(true);
    let pending = thinking();
    const done = () => {
      pending?.remove();
      pending = null;
    };
    try {
      const response = await fetch('/finance/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
        body: JSON.stringify({ message: text, threadId: log.dataset.thread }),
      });
      if (!response.ok) {
        const d = await response.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data;
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (data.type === 'chat') {
            done();
            addAI(data.message);
          } else if (data.type === 'pending') {
            approvalCard(data.action);
          } else if (data.type === 'status') {
            note(data.message);
          } else if (data.type === 'error') {
            done();
            addAI(t('Something went wrong: {error}', { error: data.error }), 'error');
          }
        }
      }
    } catch (err) {
      addAI(t('Something went wrong: {error}', { error: err.message }), 'error');
    } finally {
      done();
      setBusy(false);
      input.focus();
    }
  }

  sendBtn.onclick = () => send();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  });
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.onclick = () => send(chip.textContent);
  });

  // Saved history arrives as raw Markdown; render it the same way as live replies.
  document.querySelectorAll('.bubble[data-md]').forEach((el) => {
    el.innerHTML = renderMd(el.dataset.md);
  });
  JSON.parse(document.getElementById('pending-data').textContent).forEach(approvalCard);
  scrollDown();

  // Spending calendar legend: hovering the gradient reads out the amount at that point (amount = t² × max,
  // the inverse of the sqrt colour scale); hovering a day marks where it sits on the gradient.
  const gradient = document.getElementById('hm-gradient');
  if (gradient) {
    const max = Number(gradient.dataset.max) || 0;
    const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: gradient.dataset.currency || 'GBP', maximumFractionDigits: 0 });
    const marker = gradient.querySelector('.hm-marker');
    const tipEl = gradient.querySelector('.hm-tip');
    const show = (t, text) => {
      marker.style.left = tipEl.style.left = `${t * 100}%`;
      tipEl.textContent = text;
      gradient.classList.add('active');
    };
    gradient.addEventListener('mousemove', (e) => {
      const r = gradient.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      show(t, money.format(t * t * max));
    });
    gradient.addEventListener('mouseleave', () => gradient.classList.remove('active'));
    document.querySelectorAll('.cal-cell.spent').forEach((cell) => {
      cell.addEventListener('mouseenter', () => show(Number(cell.dataset.t), cell.title.split(': ')[1]));
      cell.addEventListener('mouseleave', () => gradient.classList.remove('active'));
    });
  }

  // --- voice input: the browser's speech recognition types into the message box -----------
  // Listens in the page language (English or Chinese). Nothing is sent until the user presses send.
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = document.getElementById('mic-button');
  if (mic && SpeechRec) {
    mic.hidden = false;
    let rec = null;
    mic.addEventListener('click', () => {
      if (rec) return rec.stop();
      rec = new SpeechRec();
      rec.lang = document.documentElement.lang === 'zh' ? 'zh-CN' : 'en-GB';
      rec.interimResults = true;
      const before = input.value.trim() ? `${input.value.trim()} ` : '';
      rec.onresult = (e) => {
        input.value =
          before +
          Array.from(e.results)
            .map((r) => r[0].transcript)
            .join('');
        input.dispatchEvent(new Event('input')); // grow the textarea
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          addAI(t('Microphone access is blocked. Allow it in the browser address bar to use voice input.'), 'error');
        }
      };
      rec.onend = () => {
        rec = null;
        mic.classList.remove('listening');
        mic.setAttribute('aria-pressed', 'false');
        input.focus();
      };
      mic.classList.add('listening');
      mic.setAttribute('aria-pressed', 'true');
      rec.start();
    });
  }

  // --- "+" in the chat bar: scan a receipt or payment screenshot --------------------------
  // Claude reads the image (/finance/record/scan); the user reviews every row in the sheet; only Save writes data.
  const scanInput = document.getElementById('scan-file');
  const scanModalEl = document.getElementById('scan-modal');
  if (scanInput && scanModalEl) {
    const scanModal = new window.bootstrap.Modal(scanModalEl);
    const CATS = JSON.parse(document.getElementById('cat-data').textContent);
    const zh = document.documentElement.lang === 'zh';
    const catLabel = (key) => {
      const c = CATS.find((x) => x.key === key);
      return c ? (zh ? c.zh : c.label) : key;
    };
    const rowsEl = document.getElementById('scan-rows');
    const warn = document.getElementById('scan-warn');
    const errorEl = document.getElementById('scan-error');
    const saveScan = document.getElementById('scan-save');
    const preview = document.getElementById('scan-preview');
    let active = null; // the scan currently open in the review sheet

    // Downsize in the browser (max 1600px, JPEG) so uploads stay small and fast.
    const toJpeg = async (file) => {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // transparent screenshots become white, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
    };

    const field = (tag, attrs, label) => {
      const n = Object.assign(document.createElement(tag), attrs);
      n.setAttribute('aria-label', label);
      return n;
    };
    function rowFor(item, i) {
      const row = document.createElement('div');
      row.className = 'scan-row';
      const keep = field('input', { type: 'checkbox', checked: true, className: 'form-check-input' }, t('Include row {n}', { n: i + 1 }));
      const merchant = field('input', { type: 'text', value: item.merchant, maxLength: 80, className: 'form-control' }, t('Merchant, row {n}', { n: i + 1 }));
      const amount = field(
        'input',
        { type: 'text', value: item.amount.toFixed(2), inputMode: 'decimal', className: 'form-control num' },
        t('Amount, row {n}', { n: i + 1 }),
      );
      const cat = field('select', { className: 'form-select' }, t('Category, row {n}', { n: i + 1 }));
      for (const c of CATS) cat.add(new Option(`${c.label} · ${c.zh}`, c.key, false, c.key === item.category));
      const date = field(
        'input',
        { type: 'date', value: item.date, max: new Date().toISOString().slice(0, 10), className: 'form-control' },
        t('Date, row {n}', { n: i + 1 }),
      );
      keep.addEventListener('change', () => row.classList.toggle('off', !keep.checked));
      row.append(keep, merchant, amount, cat, date);
      row.read = () => (keep.checked ? { merchant: merchant.value, amount: amount.value.trim(), category: cat.value, date: date.value } : null);
      return row;
    }
    const updateSave = () => {
      const n = [...rowsEl.children].filter((r) => r.read()).length;
      saveScan.textContent = n === 1 ? t('Save 1 entry') : t('Save {n} entries', { n });
      saveScan.disabled = n === 0;
    };
    rowsEl.addEventListener('change', updateSave);

    function openReview(scan) {
      active = scan;
      preview.src = scan.dataUrl;
      rowsEl.replaceChildren(...scan.items.map(rowFor));
      warn.hidden = !(scan.currency && scan.currency !== scan.accountCurrency);
      warn.textContent = t('The image shows {cur}, but your account records {account}. Amounts are saved as typed, without conversion; edit them if needed.', {
        cur: scan.currency,
        account: scan.accountCurrency,
      });
      errorEl.hidden = true;
      updateSave();
      scanModal.show();
    }

    // Chat card that stays in the conversation, so the sheet can be reopened if it was closed.
    function scanCard(scan) {
      const card = document.createElement('div');
      card.className = 'approval';
      const text = document.createElement('div');
      text.innerHTML = `<span class="tag">${t('Scanned image · not saved yet')}</span>`;
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = scan.items.length === 1 ? t('1 transaction to check') : t('{n} transactions to check', { n: scan.items.length });
      text.appendChild(what);
      const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-sm btn-danger', textContent: t('Review & save') });
      btn.onclick = () => openReview(scan);
      card.append(text, btn);
      log.appendChild(card);
      scrollDown();
      return card;
    }

    function addUserImage(dataUrl) {
      clearWelcome();
      const div = document.createElement('div');
      div.className = 'msg user img';
      div.appendChild(Object.assign(document.createElement('img'), { src: dataUrl, alt: t('Uploaded image') }));
      log.appendChild(div);
      scrollDown();
    }

    // Drop an image on the zone under the chat bar (or anywhere in the composer); clicking it opens the picker.
    const composer = document.querySelector('.composer');
    const zone = document.getElementById('scan-drop');
    composer.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('over');
    });
    composer.addEventListener('dragleave', (e) => {
      if (!composer.contains(e.relatedTarget)) zone.classList.remove('over');
    });
    composer.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      scanFile(e.dataTransfer.files[0]);
    });
    scanInput.addEventListener('change', () => {
      const file = scanInput.files[0];
      scanInput.value = '';
      scanFile(file);
    });

    async function scanFile(file) {
      if (!file || sendBtn.disabled) return;
      if (!file.type.startsWith('image/')) return addAI(t('That file is not an image. Attach a photo of a receipt or a payment screenshot.'), 'error');
      setBusy(true);
      let pending = null;
      try {
        const dataUrl = await toJpeg(file);
        addUserImage(dataUrl);
        pending = thinking();
        note(t('Reading your image...'));
        const r = await fetch('/finance/record/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
          body: JSON.stringify({ image: dataUrl.split(',')[1], mediaType: 'image/jpeg' }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        pending.remove();
        if (!d.readable) {
          note(t('Done: no payments found in the image'));
          addAI(t("I couldn't find any payments in that image. Try a clearer photo, or record it on the **Record** tab."));
          return;
        }
        note(t('Done: found {n} in the image', { n: d.items.length }));
        const lines = d.items.map((it) => `- **${it.merchant}** · ${it.amount.toFixed(2)} · ${catLabel(it.category)} · ${it.date}`).join('\n');
        addAI(
          `${d.items.length === 1 ? t('I found **1** transaction in your image:') : t('I found **{n}** transactions in your image:', { n: d.items.length })}\n\n${lines}\n\n${t('Nothing is saved yet. Check them, fix anything I got wrong, then press **Save**.')}`,
        );
        const scan = { ...d, dataUrl };
        scan.card = scanCard(scan);
        openReview(scan);
      } catch (err) {
        pending?.remove();
        addAI(t('Something went wrong reading the image: {error}', { error: err.message }), 'error');
      } finally {
        setBusy(false);
      }
    }

    saveScan.addEventListener('click', async () => {
      const items = [...rowsEl.children].map((r) => r.read()).filter(Boolean);
      if (!items.length || !active) return;
      saveScan.disabled = true;
      try {
        const r = await fetch('/finance/record/scan/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
          body: JSON.stringify({ items }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        scanModal.hide();
        const n = d.saved;
        active.card.classList.add('done');
        active.card.querySelector('.tag').textContent = t('Scanned image · saved');
        active.card.querySelector('.what').textContent = n === 1 ? t('1 entry saved') : t('{n} entries saved', { n });
        active.card.querySelector('button')?.remove();
        note(n === 1 ? t('Saved 1 scanned entry') : t('Saved {n} scanned entries', { n }));
        addAI(
          n === 1
            ? t("Saved **1** entry. It's in your spending history now; the calendar picks it up next time the page loads.")
            : t("Saved **{n}** entries. They're in your spending history now; the calendar picks them up next time the page loads.", { n }),
        );
        active = null;
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = err.message;
        saveScan.disabled = false;
      }
    });
  }

  // Links from other pages (e.g. Bills) arrive as /finance?q=...: ask it once, then clean the URL.
  const q = new URLSearchParams(window.location.search).get('q');
  if (q) {
    window.history.replaceState(null, '', window.location.pathname);
    send(q.slice(0, 2000));
  }
})();
