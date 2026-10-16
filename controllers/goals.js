const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');
const AgentAction = require('../models/AgentAction');
const { detectBills, fixedClassifier } = require('./bills');

// Savings goals with automatic plans. The plan answers three questions from the user's own data:
//  1. How much per week / month to reach the target by the deadline?
//  2. Does that fit in what's usually left over each month (income − spending, last 90 days)?
//  3. If not: which everyday categories to trim (max 20% each), or what date is realistic instead.

const DAY_MS = 24 * 60 * 60 * 1000;
const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const MAX_GOALS = 20;
const TRIM_CAP = 0.2; // never suggest cutting a category by more than a fifth
const r2 = (n) => Math.round(n * 100) / 100;

// Piggy fill level: 0 = <25%, 1 = 25–49%, 2 = 50–74%, 3 = 75–99%, 4 = full.
const levelOf = (pct) => (pct >= 100 ? 4 : Math.floor(pct / 25));

function planFor(goal, { now = new Date(), freeCash = 0, usual = {} } = {}) {
  const saved = goal.contributions.reduce((a, c) => a + c.amount, 0);
  const remaining = Math.max(0, goal.target - saved);
  const pct = Math.min(100, Math.floor((saved / goal.target) * 100));
  const created = new Date(goal.createdAt || now);
  const deadline = new Date(goal.deadline);
  const daysLeft = Math.ceil((deadline - now) / DAY_MS);
  const plan = { saved: r2(saved), remaining: r2(remaining), pct, level: levelOf(pct), daysLeft };

  if (remaining === 0) return { ...plan, status: 'done' };
  if (daysLeft <= 0) return { ...plan, status: 'overdue' };

  const perWeek = remaining / Math.max(1, daysLeft / 7);
  const perMonth = remaining / Math.max(1, daysLeft / 30.44);
  // On track = at least where an even pace from the start date would be by now.
  const elapsed = Math.min(1, Math.max(0, (now - created) / Math.max(DAY_MS, deadline - created)));
  const status = saved + 0.005 >= goal.target * elapsed ? 'ontrack' : 'behind';
  const out = { ...plan, status, perWeek: r2(perWeek), perMonth: r2(perMonth) };

  if (freeCash >= perMonth) return { ...out, fits: true, spare: r2(freeCash - perMonth) };

  // Doesn't fit: trim the biggest everyday categories, at most 20% each, largest first.
  let gap = perMonth - Math.max(0, freeCash);
  const trims = [];
  for (const [category, monthly] of Object.entries(usual).sort((a, b) => b[1] - a[1])) {
    if (gap <= 0) break;
    const cut = Math.min(Math.ceil((monthly * TRIM_CAP) / 5) * 5, Math.ceil(gap / 5) * 5);
    if (cut < 5) continue;
    trims.push({ category, amount: cut });
    gap -= cut;
  }
  if (gap <= 0) return { ...out, fits: false, trims };

  // Even with trims it won't make it: say when it realistically would.
  const monthlyCapacity = Math.max(0, freeCash) + trims.reduce((a, x) => a + x.amount, 0);
  const realistic = monthlyCapacity > 0 ? new Date(now.getTime() + (remaining / monthlyCapacity) * 30.44 * DAY_MS) : null;
  return { ...out, fits: false, trims, realistic };
}
exports._planFor = planFor;

// Several goals share one month: the earliest deadline gets first call on the left-over money,
// later goals plan with what remains (goals must already be sorted by deadline).
function planAll(goals, { now = new Date(), freeCash = 0, usual = {} } = {}) {
  let available = freeCash;
  return goals.map((g) => {
    const plan = planFor(g, { now, freeCash: available, usual });
    if (plan.perMonth) available = Math.max(0, available - plan.perMonth);
    return { goal: g, plan };
  });
}
exports._planAll = planAll;
// What's usually left over each month, and usual everyday spending per category (last 90 days / 3).
async function monthlyPicture(userId, now) {
  const uid = new mongoose.Types.ObjectId(userId);
  const [rows, { bills, excluded, unrecordedMonthly }, currency] = await Promise.all([
    Transaction.find({ user: uid, date: { $gte: new Date(now - 90 * DAY_MS), $lte: now } }).lean(),
    detectBills(uid, now),
    User.currencyOf(uid),
  ]);
  const isFixed = fixedClassifier(bills, excluded);
  let income = 0;
  let out = 0;
  const usual = {};
  for (const t of rows) {
    if (t.amount > 0 && t.category === 'Income') income += t.amount;
    if (t.amount < 0 && t.category !== 'Savings') {
      out += -t.amount;
      if (!isFixed(t)) usual[t.category] = (usual[t.category] || 0) + -t.amount / 3;
    }
  }
  // hand-set fixed costs paid outside the data (e.g. rent in cash) still leave each month
  return { freeCash: r2((income - out) / 3 - unrecordedMonthly), usual, currency };
}
exports._monthlyPicture = monthlyPicture;

exports.getGoals = async (req, res, next) => {
  try {
    const now = new Date();
    const [goals, picture] = await Promise.all([SavingsGoal.find({ user: req.user._id }).sort({ deadline: 1 }), monthlyPicture(req.user._id, now)]);
    const fmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: picture.currency });
    // the jar that just changed: only it animates its new money dropping in (one page load only)
    const jarFrom = req.session.jarFrom;
    delete req.session.jarFrom;
    const fmt0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: picture.currency, maximumFractionDigits: 0 });
    res.render('finance/goals', {
      title: 'Goals',
      goals: planAll(goals, { now, ...picture }).map(({ goal: g, plan }) => ({
        id: g._id.toString(),
        name: g.name,
        target: g.target,
        deadline: g.deadline,
        plan,
        drop:
          jarFrom?.id === g._id.toString()
            ? { from: jarFrom.pct, label: `${jarFrom.added < 0 ? '−' : '+'}${(Number.isInteger(jarFrom.added) ? fmt0 : fmt).format(Math.abs(jarFrom.added))}` }
            : null,
      })),
      freeCash: picture.freeCash,
      money: (n) => fmt.format(n),
      money0: (n) => fmt0.format(n),
      currencySymbol: fmt.formatToParts(0).find((p) => p.type === 'currency')?.value || '',
      minDate: new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10),
    });
  } catch (error) {
    next(error);
  }
};

exports.postGoal = async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const target = String(req.body.target || '').trim();
  const start = String(req.body.start || '').trim();
  const deadline = new Date(`${req.body.deadline}T23:59:59`);
  const now = new Date();
  let problem = null;
  if (!name || name.length > 60) problem = 'Give the goal a name (up to 60 characters).';
  else if (!MONEY.test(target) || Number(target) <= 0) problem = 'Enter a target amount greater than 0, with at most two decimals.';
  else if (start && !MONEY.test(start)) problem = 'Enter what you have already saved as a number, with at most two decimals.';
  else if (Number.isNaN(deadline.getTime()) || deadline <= now || deadline > new Date(now.getTime() + 3653 * DAY_MS)) {
    problem = 'Pick a deadline in the future, within 10 years.';
  }
  try {
    if (!problem && (await SavingsGoal.countDocuments({ user: req.user._id })) >= MAX_GOALS) problem = 'You can have up to 20 goals.';
    if (problem) {
      req.flash('errors', { msg: problem });
      return res.redirect('/finance/goals');
    }
    const created = await SavingsGoal.create({
      user: req.user._id,
      name,
      target: Number(target),
      deadline,
      contributions: start && Number(start) > 0 ? [{ amount: Number(start), date: now }] : [],
    });
    if (Number(start) > 0) req.session.jarFrom = { id: created._id.toString(), pct: 0, added: Number(start) };
    await AgentAction.logUser(req.user._id, 'create_goal', { name, target: Number(target), deadline, start: Number(start) || 0 }, { id: created._id });
    req.flash('success', { msg: req.t('Goal created: {name}', { name }) });
    res.redirect('/finance/goals');
  } catch (error) {
    next(error);
  }
};

// Log money put aside ("add") or taken back out ("take"). Taking out can't exceed what's saved.
exports.postContribution = async (req, res, next) => {
  try {
    const goal = mongoose.isValidObjectId(req.params.id) && (await SavingsGoal.findOne({ _id: req.params.id, user: req.user._id }));
    const raw = String(req.body.amount || '').trim();
    if (!goal) {
      req.flash('errors', { msg: 'Goal not found.' });
    } else if (!MONEY.test(raw) || Number(raw) <= 0) {
      req.flash('errors', { msg: 'Enter an amount greater than 0, with at most two decimals.' });
    } else if (req.body.direction === 'take' && Number(raw) > goal.saved) {
      req.flash('errors', { msg: req.t('You can take out at most {amount}.', { amount: goal.saved.toFixed(2) }) });
    } else {
      const wasFull = goal.saved >= goal.target;
      // the jar animates the change: new pieces drop in, or pieces fly out when money is taken
      const take = req.body.direction === 'take';
      // same rounding as the jar on the page (any money at all shows at least 1%)
      const fromPct = goal.saved > 0 ? Math.max(1, planFor(goal).pct) : 0;
      req.session.jarFrom = { id: goal._id.toString(), pct: fromPct, added: take ? -Number(raw) : Number(raw) };
      goal.contributions.push({ amount: req.body.direction === 'take' ? -Number(raw) : Number(raw), date: new Date() });
      await goal.save();
      await AgentAction.logUser(
        req.user._id,
        req.body.direction === 'take' ? 'goal_take' : 'goal_add',
        { goal: goal.name, amount: Number(raw) },
        { saved: goal.saved },
      );
      if (!wasFull && goal.saved >= goal.target) req.flash('success', { msg: req.t('🎉 {name} is fully saved!', { name: goal.name }) });
      else
        req.flash('success', {
          msg: req.t('{name}: {saved} of {target} saved.', { name: goal.name, saved: goal.saved.toFixed(2), target: goal.target.toFixed(2) }),
        });
    }
    res.redirect('/finance/goals');
  } catch (error) {
    next(error);
  }
};

exports.postDeleteGoal = async (req, res, next) => {
  try {
    const gone = mongoose.isValidObjectId(req.params.id) && (await SavingsGoal.findOneAndDelete({ _id: req.params.id, user: req.user._id }));
    if (gone) await AgentAction.logUser(req.user._id, 'delete_goal', { goal: gone.name, saved: gone.saved });
    const ok = Boolean(gone);
    req.flash(ok ? 'success' : 'errors', { msg: ok ? 'Goal deleted.' : 'Goal not found.' });
    res.redirect('/finance/goals');
  } catch (error) {
    next(error);
  }
};

exports.planFor = planFor;
exports.planAll = planAll;
exports.monthlyPicture = monthlyPicture;
