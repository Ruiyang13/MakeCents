const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const FixedCost = require('../models/FixedCost');
const AgentAction = require('../models/AgentAction');
// required lazily below: recommendations.js requires this module too
const lazyRecs = () => require('./recommendations');

// Bill analysis: find recurring monthly charges in a user's transactions and flag what deserves attention.
// ponytail: monthly bills only (same merchant, ~monthly, same day of month). Weekly/annual bills need
// more history than the demo data has; add a frequency detector if real data shows them.

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LOOKBACK_DAYS = 200;
const STALE_DAYS = 45;
const NEVER_BILL = new Set(['DiningOut', 'Groceries', 'Shopping', 'Clothing']); // no charge for this long -> probably cancelled
const OVERLAP_GROUPS = {
  'video streaming': /netflix|hulu|disney|prime video|apple tv|hbo|\bmax\b|paramount|now tv|youtube premium/i,
  'music streaming': /spotify|apple music|youtube music|tidal|deezer/i,
  gym: /gym|fitness|equinox|peloton/i,
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (n) => Math.round(n * 100) / 100;
const addMonth = (d) => {
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  next.setDate(Math.min(d.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
  return next;
};

// A merchant is a monthly bill if it charges about once per month, ~30 days apart, on a stable day of month.
function asMonthlyBill(charges) {
  if (charges.length < 3) return null;
  const dates = charges.map((c) => c.date);
  const months = new Set(dates.map((d) => `${d.getFullYear()}-${d.getMonth()}`));
  if (charges.length > months.size * 1.2) return null; // several per month = a habit, not a bill
  const gaps = dates.slice(1).map((d, i) => (d - dates[i]) / DAY_MS);
  const gap = median(gaps);
  if (gap < 25 || gap > 35) return null;
  const days = dates.map((d) => d.getDate());
  const typicalDay = median(days);
  if (days.some((d) => Math.abs(d - typicalDay) > 4 && d < 28)) return null;
  return { typicalDay };
}

async function detectBills(userId, now = new Date(), { t = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m) : s) } = {}) {
  const rows = await Transaction.find({
    user: new mongoose.Types.ObjectId(userId),
    date: { $gte: new Date(now - LOOKBACK_DAYS * DAY_MS), $lte: now },
  })
    .sort({ date: 1 })
    .lean();
  const [currency, rules] = await Promise.all([User.currencyOf(userId), FixedCost.find({ user: new mongoose.Types.ObjectId(userId) }).lean()]);
  const fmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency });
  const money = (n) => fmt.format(n);
  // the user's corrections: amounts for fixed costs, and merchants that are never fixed
  const ruleOf = new Map(rules.map((r) => [r.key, r]));

  const byMerchant = new Map();
  for (const r of rows.filter((t) => t.amount < 0)) {
    const key = r.merchant.trim().toLowerCase();
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key).push({ date: new Date(r.date), amount: -r.amount, merchant: r.merchant, category: r.category });
  }

  const bills = [];
  const spentByMonth = new Map(); // 'YYYY-M' -> money paid to recurring bills that month
  for (const [key, charges] of byMerchant) {
    const rule = ruleOf.get(key);
    if (rule && !rule.fixed) continue; // the user said it's not a fixed cost
    // A monthly restaurant or supermarket habit is still everyday spending, not a bill (unless the user says so).
    if (!rule && NEVER_BILL.has(charges.at(-1).category)) continue;
    const pattern = asMonthlyBill(charges);
    if (!pattern) continue; // a fixed cost the user set but no monthly pattern: added below as a hand-set bill
    for (const ch of charges) {
      const k = `${ch.date.getFullYear()}-${ch.date.getMonth()}`;
      spentByMonth.set(k, (spentByMonth.get(k) || 0) + ch.amount);
    }
    const amounts = charges.map((c) => c.amount);
    const last = charges.at(-1);
    const typical = median(amounts.slice(0, -1));
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const spread = Math.sqrt(amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length) / mean;
    const daysSinceLast = Math.floor((now - last.date) / DAY_MS);
    const nextDue = addMonth(last.date);
    const flags = [];
    const active = daysSinceLast <= STALE_DAYS;
    if (!active) flags.push({ type: 'inactive', text: t('No charge for {n} days, maybe cancelled', { n: daysSinceLast }) });
    if (active && last.amount > typical * 1.2 && last.amount - typical >= 2) {
      flags.push({ type: 'higher', text: t('Last bill {pct}% above usual', { pct: Math.round((last.amount / typical - 1) * 100) }) });
    } else if (active && spread < 0.05 && last.amount > typical * 1.02 && last.amount - typical >= 0.5) {
      flags.push({ type: 'increase', text: t('Price went up from {before} to {now}', { before: money(typical), now: money(last.amount) }) });
    }
    const daysToDue = Math.ceil((nextDue - now) / DAY_MS);
    if (active && daysToDue >= 0 && daysToDue <= 7)
      flags.push({ type: 'due', text: daysToDue === 1 ? t('Due in 1 day') : t('Due in {n} days', { n: daysToDue }) });
    bills.push({
      key,
      merchant: last.merchant,
      category: last.category,
      monthly: rule ? rule.monthly : r2(median(amounts.slice(-3))),
      edited: Boolean(rule),
      lastAmount: r2(last.amount),
      typical: r2(typical),
      lastDate: last.date,
      nextDue: active ? nextDue : null,
      daysToDue: active ? daysToDue : null,
      charges: charges.length,
      varies: spread >= 0.05,
      active,
      flags,
    });
  }
  // Fixed costs the user set that detection didn't find (rent paid in cash, a new contract): always active,
  // due on their day of the month. If nothing was paid to them lately, they aren't in the transactions at all.
  const found = new Set(bills.map((b) => b.key));
  for (const rule of rules.filter((r) => r.fixed && !found.has(r.key))) {
    let nextDue = null;
    let daysToDue = null;
    if (rule.day) {
      const on = (y, m) => new Date(y, m, Math.min(rule.day, new Date(y, m + 1, 0).getDate()));
      nextDue = on(now.getFullYear(), now.getMonth());
      if (nextDue < new Date(now.getFullYear(), now.getMonth(), now.getDate())) nextDue = on(now.getFullYear(), now.getMonth() + 1);
      daysToDue = Math.ceil((nextDue - now) / DAY_MS);
    }
    const paid = (byMerchant.get(rule.key) || []).filter((c) => now - c.date <= STALE_DAYS * DAY_MS);
    bills.push({
      key: rule.key,
      merchant: rule.merchant,
      category: rule.category || 'Other',
      monthly: rule.monthly,
      lastAmount: rule.monthly,
      typical: rule.monthly,
      lastDate: paid.at(-1)?.date || null,
      nextDue,
      daysToDue,
      charges: paid.length,
      varies: false,
      active: true,
      manual: true,
      day: rule.day,
      unrecorded: !paid.length,
      flags: daysToDue != null && daysToDue <= 7 ? [{ type: 'due', text: daysToDue === 1 ? t('Due in 1 day') : t('Due in {n} days', { n: daysToDue }) }] : [],
    });
  }
  bills.sort((a, b) => b.active - a.active || b.monthly - a.monthly);

  // Month-by-month bill totals: only whole months inside the lookback window, plus the current month so far.
  const windowStart = new Date(now - LOOKBACK_DAYS * DAY_MS);
  const history = [];
  for (let m = new Date(windowStart.getFullYear(), windowStart.getMonth() + 1, 1); m <= now; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    history.push({
      label: MONTHS[m.getMonth()],
      total: r2(spentByMonth.get(`${m.getFullYear()}-${m.getMonth()}`) || 0),
      partial: m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth(),
    });
  }

  const active = bills.filter((b) => b.active);
  const monthlyTotal = r2(active.reduce((a, b) => a + b.monthly, 0));
  const subscriptions = active.filter((b) => b.category === 'Subscriptions');
  const incomeByMonth = {};
  for (const t of rows.filter((x) => x.amount > 0 && x.category === 'Income')) {
    const k = `${t.date.getFullYear()}-${t.date.getMonth()}`;
    incomeByMonth[k] = (incomeByMonth[k] || 0) + t.amount;
  }
  const monthlyIncome = Object.keys(incomeByMonth).length ? median(Object.values(incomeByMonth)) : 0;

  const byCategory = Object.entries(
    active.reduce((acc, b) => {
      acc[b.category] = (acc[b.category] || 0) + b.monthly;
      return acc;
    }, {}),
  )
    .map(([category, monthly]) => ({ category, monthly: r2(monthly) }))
    .sort((a, b) => b.monthly - a.monthly);

  const insights = [];
  for (const [label, re] of Object.entries(OVERLAP_GROUPS)) {
    const hits = active.filter((b) => re.test(b.merchant));
    if (hits.length >= 2) {
      insights.push({
        type: 'overlap',
        title: t('{n} {label} services', { n: hits.length, label: t(label) }),
        text: t('{list} cost {total} a month together. Do you use all of them?', {
          list: hits.map((b) => b.merchant).join(', '),
          total: money(hits.reduce((a, b) => a + b.monthly, 0)),
        }),
      });
    }
  }
  for (const b of active.filter((x) => x.flags.some((f) => f.type === 'higher' || f.type === 'increase'))) {
    insights.push({ type: 'higher', title: t('{merchant} went up', { merchant: b.merchant }), text: b.flags.find((f) => f.type !== 'due').text });
  }
  for (const b of bills.filter((x) => !x.active)) {
    insights.push({
      type: 'inactive',
      title: t('{merchant} stopped', { merchant: b.merchant }),
      text: t('Last charged {date}. Cancelled, or just late?', { date: b.lastDate.toISOString().slice(0, 10) }),
    });
  }
  if (monthlyIncome && monthlyTotal / monthlyIncome > 0.5) {
    insights.push({
      type: 'share',
      title: t('Bills take {pct}% of income', { pct: Math.round((monthlyTotal / monthlyIncome) * 100) }),
      text: t('Fixed costs above half of income leave little room for surprises. The biggest lines are the ones worth renegotiating.'),
    });
  }

  return {
    currency,
    monthlyTotal,
    monthlyIncome: r2(monthlyIncome),
    incomeShare: monthlyIncome ? Math.round((monthlyTotal / monthlyIncome) * 100) : null,
    subscriptionsYearly: r2(subscriptions.reduce((a, b) => a + b.monthly, 0) * 12),
    subscriptionCount: subscriptions.length,
    history,
    bills,
    byCategory,
    upcoming: active.filter((b) => b.daysToDue != null && b.daysToDue <= 30).sort((a, b) => a.daysToDue - b.daysToDue),
    insights,
    // merchants the user says are never fixed (display names)
    excluded: rules.filter((r) => !r.fixed).map((r) => r.merchant),
    // hand-set fixed costs with no payments in the data: money out that cash-flow sums can't see
    unrecordedMonthly: r2(active.filter((b) => b.unrecorded).reduce((a, b) => a + b.monthly, 0)),
  };
}

exports.detectBills = detectBills;

// Fixed costs are kept apart from everyday spending (heatmap, day-by-day chart): a transaction is fixed if
// its category is a fixed-cost one, or its merchant is a detected recurring bill (e.g. a variable electricity bill).
// Merchants the user marked "not fixed" never are, whatever their category.
const FIXED_CATEGORIES = new Set(['Rent', 'Mortgage', 'Utilities', 'Insurance', 'Phone', 'Childcare', 'Subscriptions']);
function fixedClassifier(bills, excluded = []) {
  const names = new Set(bills.map((b) => b.merchant.trim().toLowerCase()));
  const never = new Set(excluded.map((m) => m.trim().toLowerCase()));
  return (t) => {
    const key = t.merchant.trim().toLowerCase();
    return !never.has(key) && (FIXED_CATEGORIES.has(t.category) || names.has(key));
  };
}
exports.FIXED_CATEGORIES = FIXED_CATEGORIES;
exports.OVERLAP_GROUPS = OVERLAP_GROUPS;
exports.fixedClassifier = fixedClassifier;

// Merged spending history (imported transactions, bills, the user's own entries), newest first.
// The latest charge of each active recurring bill carries its next due date and any price flags.
function spendingHistory(rows, bills, excluded) {
  const billByName = new Map(bills.map((b) => [b.merchant.trim().toLowerCase(), b]));
  const isFixed = fixedClassifier(bills, excluded);
  const seenBill = new Set();
  return rows.map((t) => {
    const key = t.merchant.trim().toLowerCase();
    const bill = billByName.get(key);
    const latestOfBill = bill && bill.active && !seenBill.has(key);
    if (bill) seenBill.add(key);
    return {
      id: t._id.toString(),
      date: t.date,
      merchant: t.merchant,
      category: t.category,
      amount: t.amount,
      original: t.original?.currency ? t.original : null, // paid in another currency
      fixed: isFixed(t),
      nextDue: latestOfBill ? bill.nextDue : null,
      flags: latestOfBill ? bill.flags.filter((f) => f.type !== 'due') : [],
      source: t.source,
      deletable: t.source === 'manual' || t.source === 'scan',
    };
  });
}
exports.spendingHistory = spendingHistory;
exports.LOOKBACK_DAYS = LOOKBACK_DAYS;
// Whole-number percentages that always add up to 100 (largest remainder).
function percentages(values) {
  if (!values.length) return [];
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  const missing = 100 - out.reduce((a, b) => a + b, 0);
  for (let k = 0; k < missing; k++) out[order[k % order.length][1]] += 1;
  return out;
}
exports._percentages = percentages;

// Categories a hand-set fixed cost can have.
const FIXED_COST_CATEGORIES = [...FIXED_CATEGORIES, 'Transport', 'Education', 'Other'];
exports.FIXED_COST_CATEGORIES = FIXED_COST_CATEGORIES;
const MONEY = /^\d{1,7}(\.\d{1,2})?$/;

// The user's corrections to fixed costs, one form for all three:
//  save    -> fixed, at this amount a month (a detected bill's amount, or a new one added by hand)
//  exclude -> this merchant is not a fixed cost
//  reset   -> forget the correction; detection decides again (a hand-added cost goes away)
exports.postFixedCost = async (req, res, next) => {
  const back = '/finance/bills#fixed';
  const merchant = String(req.body.merchant || '').trim();
  const key = merchant.toLowerCase();
  const { action } = req.body;
  let problem = null;
  if (!merchant || merchant.length > 60) problem = 'Give the fixed cost a name (up to 60 characters).';
  else if (!['save', 'exclude', 'reset'].includes(action)) problem = 'Something went wrong.';
  else if (action === 'save') {
    const amount = String(req.body.amount || '').trim();
    const day = String(req.body.day || '').trim();
    if (!MONEY.test(amount) || !(Number(amount) > 0)) problem = 'Enter an amount greater than 0, with at most two decimals.';
    else if (!FIXED_COST_CATEGORIES.includes(req.body.category)) problem = 'Pick a category.';
    else if (day && !(/^\d{1,2}$/.test(day) && Number(day) >= 1 && Number(day) <= 31)) problem = 'Day of the month must be between 1 and 31.';
  }
  if (problem) {
    req.flash('errors', { msg: problem });
    return res.redirect(back);
  }
  try {
    const where = { user: req.user._id, key };
    if (action === 'reset') await FixedCost.deleteOne(where);
    else if (action === 'exclude') await FixedCost.findOneAndUpdate(where, { merchant, fixed: false, $unset: { monthly: 1, day: 1 } }, { upsert: true });
    else {
      const set = { merchant, fixed: true, monthly: Number(req.body.amount), category: req.body.category };
      await FixedCost.findOneAndUpdate(where, req.body.day ? { ...set, day: Number(req.body.day) } : { ...set, $unset: { day: 1 } }, { upsert: true });
    }
    await AgentAction.logUser(req.user._id, 'fixed_cost', { action, merchant, amount: Number(req.body.amount) || null });
    const msg = { save: 'Fixed cost saved: {name}', exclude: '{name} no longer counts as a fixed cost.', reset: '{name} is back to automatic detection.' }[
      action
    ];
    req.flash('success', { msg: req.t(msg, { name: merchant }) });
    res.redirect(back);
  } catch (error) {
    next(error);
  }
};

exports.getBills = async (req, res, next) => {
  try {
    const data = await detectBills(req.user._id, new Date(), { t: req.t });
    const fmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: data.currency });
    // Copilot-style insights: this month's everyday spending against last month at the same point,
    // one cumulative pace line, and a ranked category list. Fixed costs are set apart.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const rows = await Transaction.find({ user: req.user._id, date: { $gte: prevStart, $lte: now } }).lean();
    const isFixed = fixedClassifier(data.bills, data.excluded);
    const today = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const prevDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const thisDaily = Array(daysInMonth).fill(0);
    const lastDaily = Array(prevDays).fill(0);
    const thisByCat = {};
    const lastByCat = {}; // last month up to the same day of the month
    for (const t of rows) {
      const d = new Date(t.date);
      if (t.amount >= 0 || d < prevStart || isFixed(t) || t.category === 'Savings') continue; // savings transfers aren't spending
      const day = d.getDate();
      if (d >= monthStart) {
        thisDaily[day - 1] += -t.amount;
        thisByCat[t.category] = (thisByCat[t.category] || 0) + -t.amount;
      } else {
        lastDaily[day - 1] += -t.amount;
        if (day <= today) lastByCat[t.category] = (lastByCat[t.category] || 0) + -t.amount;
      }
    }
    const cumulative = (a) => a.reduce((acc, v) => [...acc, r2((acc.at(-1) || 0) + v)], []);
    const thisCum = cumulative(thisDaily).slice(0, today);
    const lastCum = cumulative(lastDaily);
    const monthSpent = thisCum.at(-1) || 0;
    const hasLast = lastCum.at(-1) > 0;
    const lastSoFar = hasLast ? lastCum[Math.min(today, prevDays) - 1] : 0;
    const names = Object.keys(thisByCat).sort((x, y) => thisByCat[y] - thisByCat[x]);
    const row = (name, list) => {
      const spent = r2(list.reduce((a, n) => a + (thisByCat[n] || 0), 0));
      return { name, label: req.cat(name), spent, change: hasLast ? r2(spent - list.reduce((a, n) => a + (lastByCat[n] || 0), 0)) : null };
    };
    const categories = names.slice(0, 6).map((n) => row(n, [n]));
    if (names.length > 6) categories.push(row('Other', names.slice(6)));
    percentages(categories.map((c) => c.spent)).forEach((pct, i) => (categories[i].pct = pct));
    const monthName = now.toLocaleDateString(res.locals.dateLocale, { month: 'long' });
    const lastMonthName = prevStart.toLocaleDateString(res.locals.dateLocale, { month: 'long' });
    const recommendations = await lazyRecs().buildRecommendations(req.user._id, { now, t: req.t, lang: req.lang });
    // bill alerts the recommendations don't already cover (they handle overlaps and price rises)
    const alerts = data.insights.filter((i) => i.type === 'inactive' || i.type === 'share');

    res.render('finance/bills', {
      title: 'Insights',
      money: (n) => fmt.format(n),
      money0: (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: data.currency, maximumFractionDigits: 0 }).format(n),
      chartData: { currency: data.currency, thisCum, lastCum: hasLast ? lastCum : [], month: monthName, lastMonth: lastMonthName, categories },
      monthSpent,
      hasLast,
      paceChange: r2(monthSpent - lastSoFar),
      monthName,
      lastMonthName,
      categories,
      fixedMonthly: data.monthlyTotal,
      fixedBills: data.bills.filter((b) => b.active),
      fixedExcluded: data.excluded,
      fixedCategories: FIXED_COST_CATEGORIES,
      currencySymbol: fmt.formatToParts(0).find((p) => p.type === 'currency')?.value || '',
      recommendations,
      alerts,
    });
  } catch (error) {
    next(error);
  }
};
