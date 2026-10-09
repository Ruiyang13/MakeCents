const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Budget = require('../models/Budget');
const User = require('../models/User');
const { detectBills, fixedClassifier, OVERLAP_GROUPS } = require('./bills');
const { CATEGORY_NAMES } = require('../config/categories');

// Recommendations: deterministic, explainable signals computed from the user's own data. Every card says
// what we saw (evidence), what to do (action + a ready-made question for the assistant), and, only where it
// can be stated honestly, an estimated yearly saving. No model call: same data in, same advice out.

const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERY = /deliveroo|uber ?eats|just ?eat|doordash|grubhub|foodpanda|meituan|美团|ele\.me|饿了么/i;
const r0 = (n) => Math.round(n);
const identity = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m) : s);

async function buildRecommendations(userId, { now = new Date(), t = identity, lang = 'en' } = {}) {
  const uid = new mongoose.Types.ObjectId(userId);
  const [rows, billData, budgets, currency] = await Promise.all([
    Transaction.find({ user: uid, date: { $gte: new Date(now - 200 * DAY_MS), $lte: now } }).lean(),
    detectBills(uid, now),
    Budget.find({ user: uid }).lean(),
    User.currencyOf(uid),
  ]);
  if (!rows.length) return [];
  const fmt = new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-GB', { style: 'currency', currency, maximumFractionDigits: 0 });
  const money = (n) => fmt.format(n);
  const isFixed = fixedClassifier(billData.bills);
  const cat = (key) => t(CATEGORY_NAMES[key] || key); // friendly names (DiningOut -> Food), translated
  const crept = new Set();
  const ago = (d) => (now - new Date(d)) / DAY_MS;
  const out = rows.filter((x) => x.amount < 0).map((x) => ({ ...x, spent: -x.amount, age: ago(x.date) }));
  const everyday = out.filter((x) => !isFixed(x) && x.category !== 'Savings'); // savings transfers aren't spending
  const recs = [];

  // 1. Category creep: last 30 days vs the average of the three 30-day windows before it.
  const byCat = {};
  for (const x of everyday) {
    const w = Math.floor(x.age / 30); // 0 = last 30 days, 1..3 = the three before
    if (w > 3) continue;
    (byCat[x.category] ||= [0, 0, 0, 0])[w] += x.spent;
  }
  for (const [category, w] of Object.entries(byCat)) {
    const usual = (w[1] + w[2] + w[3]) / 3;
    const recent = w[0];
    if (usual >= 20 && recent >= usual * 1.25 && recent - usual >= 25) {
      crept.add(category);
      recs.push({
        kind: 'creep',
        severity: 'saving',
        title: t('{cat} is up {pct}% on your usual month', { cat: cat(category), pct: r0((recent / usual - 1) * 100) }),
        evidence: t('{recent} in the last 30 days, against a usual {usual} a month.', { recent: money(recent), usual: money(usual) }),
        action: t('Set a {cat} budget at your usual {usual} so the app warns you before it creeps again.', { cat: cat(category), usual: money(usual) }),
        ask: t('Set my {cat} budget to {usual} a month', { cat: cat(category), usual: r0(usual) }),
        saving: r0((recent - usual) * 12),
      });
    }
  }

  // 2. Food delivery: frequent orders are the most common silent leak.
  const delivery = everyday.filter((x) => x.age <= 30 && DELIVERY.test(x.merchant));
  if (delivery.length >= 4) {
    const total = delivery.reduce((a, x) => a + x.spent, 0);
    recs.push({
      kind: 'delivery',
      severity: 'saving',
      title: t('{n} delivery orders in 30 days cost {total}', { n: delivery.length, total: money(total) }),
      evidence: t('That is {avg} an order on average.', { avg: money(total / delivery.length) }),
      action: t('Halving delivery orders would keep about {half} a month; cooking twice more a week usually covers it.', { half: money(total / 2) }),
      ask: t('How much did I spend on food delivery, and how can I cut it?'),
      saving: r0((total / 2) * 12),
    });
  }

  // 3. Overlapping subscriptions: keep the one you use most, cancel the rest.
  const activeBills = billData.bills.filter((b) => b.active);
  for (const [label, re] of Object.entries(OVERLAP_GROUPS)) {
    const hits = activeBills.filter((b) => re.test(b.merchant));
    if (hits.length < 2) continue;
    const total = hits.reduce((a, b) => a + b.monthly, 0);
    const keep = Math.max(...hits.map((b) => b.monthly));
    recs.push({
      kind: 'overlap',
      severity: 'saving',
      title: t('You pay for {n} {label} services', { n: hits.length, label: t(label) }),
      evidence: t('{list}: {total} a month together.', { list: hits.map((b) => b.merchant).join(', '), total: money(total) }),
      action: t('Keep the one you actually use and cancel the others; rotate month to month if you binge one show at a time.'),
      ask: t('Which of my {label} subscriptions should I cancel?', { label: t(label) }),
      saving: r0((total - keep) * 12),
    });
  }

  // 4. Bill price rises: a fixed-price bill that went up is worth a call.
  for (const b of activeBills) {
    if (b.flags.some((f) => f.type === 'increase') && b.lastAmount > b.typical) {
      recs.push({
        kind: 'price',
        severity: 'saving',
        title: t('{merchant} raised its price', { merchant: b.merchant }),
        evidence: t('Now {now} a month, up from {before}.', { now: money(b.lastAmount), before: money(b.typical) }),
        action: t('Ask for the old rate or a loyalty deal, or compare providers; price rises are often negotiable.'),
        ask: t('{merchant} went up, what are my options?', { merchant: b.merchant }),
        saving: r0((b.lastAmount - b.typical) * 12),
      });
    } else if (b.flags.some((f) => f.type === 'higher')) {
      recs.push({
        kind: 'bill-spike',
        severity: 'tip',
        title: t('{merchant} came in higher than usual', { merchant: b.merchant }),
        evidence: t('Last bill {now}, usually about {before}.', { now: money(b.lastAmount), before: money(b.typical) }),
        action: t('Check the meter reading or tariff; if usage rose, it will show again next month.'),
        ask: t('Why was my {merchant} bill higher?', { merchant: b.merchant }),
        saving: null,
      });
    }
  }

  // 5. Fees: bank, FX, interest and late fees are almost always avoidable. Advice depends on the kind of fee.
  const fees = out.filter((x) => x.category === 'Fees' && x.age <= 90);
  const feeTotal = fees.reduce((a, x) => a + x.spent, 0);
  if (feeTotal >= 15) {
    const names = fees.map((x) => x.merchant).join(' ');
    let action = t('Check each charge: most bank fees can be avoided by switching account type or paying on time.');
    if (/minimum payment|interest|late|overdraft/i.test(names)) {
      action = t('Pay the card in full each month (set up a full-balance direct debit); minimum payments leave interest running.');
    } else if (/fx|foreign|transfer|wise|exchange/i.test(names)) {
      action = t('Batch transfers into fewer, larger ones and use a fee-free or mid-market-rate account for foreign currency.');
    }
    recs.push({
      kind: 'fees',
      severity: 'saving',
      title: t('{total} in fees over the last 3 months', { total: money(feeTotal) }),
      evidence:
        fees.length === 1
          ? t('1 charge: {example}.', { example: fees[0].merchant })
          : t('{n} charges, e.g. {example}.', { n: fees.length, example: fees[0].merchant }),
      action,
      ask: t('How can I reduce the fees I pay?'),
      saving: r0((feeTotal / 3) * 12),
    });
  }
  // 6. Cash flow: over the last 90 days, is more going out than coming in?
  const income90 = rows.filter((x) => x.amount > 0 && x.category === 'Income' && ago(x.date) <= 90).reduce((a, x) => a + x.amount, 0);
  const out90 = out.filter((x) => x.age <= 90 && x.category !== 'Savings').reduce((a, x) => a + x.spent, 0);
  if (income90 > 0) {
    const monthlyGap = (income90 - out90) / 3;
    const rate = (income90 - out90) / income90;
    if (monthlyGap < 0) {
      recs.push({
        kind: 'cashflow',
        severity: 'warning',
        title: t('You are spending {gap} a month more than you earn', { gap: money(-monthlyGap) }),
        evidence: t('Last 3 months: {income} in, {out} out (savings transfers not counted as spending).', { income: money(income90), out: money(out90) }),
        action: t('Start with the biggest everyday category and one fixed cost; closing half the gap still stops the slide.'),
        ask: t('Where can I cut {gap} a month?', { gap: money(-monthlyGap) }),
        saving: null,
      });
    } else if (rate < 0.1) {
      recs.push({
        kind: 'cashflow',
        severity: 'tip',
        title: t('You keep {pct}% of what you earn', { pct: r0(rate * 100) }),
        evidence: t('Last 3 months: {income} in, {out} out.', { income: money(income90), out: money(out90) }),
        action: t('Aim for 10%: an automatic transfer of {target} on payday makes it happen without willpower.', { target: money((income90 / 3) * 0.1) }),
        ask: t('Help me save 10% of my income each month'),
        saving: null,
      });
    }
  }

  // 7. Weekend effect: everyday spending per weekend day vs per weekday, last 8 weeks.
  const recent56 = everyday.filter((x) => x.age <= 56);
  if (recent56.length >= 10) {
    const isWeekend = (x) => [0, 6].includes(new Date(x.date).getDay());
    const weekendDaily = recent56.filter(isWeekend).reduce((a, x) => a + x.spent, 0) / 16;
    const weekdayDaily = recent56.filter((x) => !isWeekend(x)).reduce((a, x) => a + x.spent, 0) / 40;
    if (weekdayDaily > 0 && weekendDaily >= weekdayDaily * 1.6 && weekendDaily - weekdayDaily >= 10) {
      recs.push({
        kind: 'weekend',
        severity: 'tip',
        title: t('Weekends cost you {x}× a weekday', { x: (weekendDaily / weekdayDaily).toFixed(1) }),
        evidence: t('About {we} per weekend day vs {wd} per weekday over the last 8 weeks.', { we: money(weekendDaily), wd: money(weekdayDaily) }),
        action: t('Give each weekend a set allowance and plan one free activity; most weekend spend is unplanned.'),
        ask: t('Why do I spend more at weekends?'),
        saving: null,
      });
    }
  }

  // 8. Small purchases: many little ones add up without registering.
  const small = everyday.filter((x) => x.age <= 30 && x.spent < 10);
  if (small.length >= 12) {
    const total = small.reduce((a, x) => a + x.spent, 0);
    recs.push({
      kind: 'small',
      severity: 'tip',
      title: t('{n} small purchases added up to {total}', { n: small.length, total: money(total) }),
      evidence: t('Each under {limit}, in the last 30 days.', { limit: money(10) }),
      action: t('Pick the most frequent one (often coffee or snacks) and cut it by half for a month to see if you miss it.'),
      ask: t('What are my most frequent small purchases?'),
      saving: null,
    });
  }

  // 9. No budget on the biggest everyday category.
  const budgeted = new Set(budgets.map((b) => b.category));
  const top = Object.entries(byCat)
    .map(([k, w]) => [k, w[0]])
    .sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 100 && !budgeted.has(top[0]) && !crept.has(top[0])) {
    recs.push({
      kind: 'budget',
      severity: 'tip',
      title: t('{cat} is your biggest everyday cost, with no budget', { cat: cat(top[0]) }),
      evidence: t('{amount} in the last 30 days.', { amount: money(top[1]) }),
      action: t('A realistic budget based on your own history gives the app something to warn you against.'),
      ask: t('Set me a realistic {cat} budget', { cat: cat(top[0]) }),
      saving: null,
    });
  }

  const rank = { warning: 0, saving: 1, tip: 2 };
  return recs
    .sort((a, b) => rank[a.severity] - rank[b.severity] || (b.saving || 0) - (a.saving || 0))
    .slice(0, 6)
    .map((r) => ({ ...r, savingLabel: r.saving ? money(r.saving) : null }));
}

exports.buildRecommendations = buildRecommendations;
