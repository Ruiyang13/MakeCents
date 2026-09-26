const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Budget = require('../models/Budget');
const { QUICK_CATEGORIES } = require('../config/categories');

// Budgets page: every spending category in one table, edited and saved in one go.
// A budget is a standing monthly amount (no month on the record), so it repeats every month until changed.

const SPENDING = QUICK_CATEGORIES.filter((c) => !c.income);
const MONEY = /^\d{1,7}(\.\d{1,2})?$/;
const r2 = (n) => Math.round(n * 100) / 100;

exports.getBudgets = async (req, res, next) => {
  try {
    const uid = new mongoose.Types.ObjectId(req.user._id);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const usualStart = new Date(now.getFullYear(), now.getMonth() - 3, 1); // three whole months before this one
    const [rows, budgets, latest] = await Promise.all([
      Transaction.aggregate([
        { $match: { user: uid, amount: { $lt: 0 }, date: { $gte: usualStart, $lte: now } } },
        { $group: { _id: { cat: '$category', thisMonth: { $gte: ['$date', monthStart] } }, total: { $sum: '$amount' } } },
      ]),
      Budget.find({ user: uid }).lean(),
      Transaction.findOne({ user: uid }).sort({ date: -1 }).lean(),
    ]);
    const currency = latest?.currency || 'GBP';
    const fmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency });
    const spent = {};
    const usual = {};
    for (const r of rows) (r._id.thisMonth ? spent : usual)[r._id.cat] = -r.total;
    const limitOf = Object.fromEntries(budgets.map((b) => [b.category, b.monthlyLimit]));

    const lines = SPENDING.map((c) => {
      const month = r2(spent[c.key] || 0);
      const limit = limitOf[c.key] ?? null;
      const pct = limit ? Math.round((month / limit) * 100) : null;
      return {
        ...c,
        month,
        usual: Math.round((usual[c.key] || 0) / 3),
        limit,
        pct,
        status: pct == null ? null : pct > 100 ? 'over' : pct >= 80 ? 'warn' : 'ok',
      };
    });
    const budgeted = lines.filter((l) => l.limit);
    const total = budgeted.reduce((a, l) => a + l.limit, 0);
    const used = budgeted.reduce((a, l) => a + l.month, 0);
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1; // including today
    res.render('finance/budgets', {
      title: 'Budgets',
      lines,
      summary: budgeted.length ? { total, used, left: total - used, perDay: Math.max(0, total - used) / daysLeft, daysLeft } : null,
      money: (n) => fmt.format(n),
      currencySymbol: fmt.formatToParts(0).find((p) => p.type === 'currency')?.value || '',
      monthName: now.toLocaleDateString(res.locals.dateLocale, { month: 'long' }),
    });
  } catch (error) {
    next(error);
  }
};

// Save the whole table at once: blank or 0 removes a budget; any invalid amount rejects the whole save.
exports.postBudgetsAll = async (req, res, next) => {
  try {
    const changes = [];
    for (const c of SPENDING) {
      const raw = String(req.body[`b_${c.key}`] ?? '').trim(); // one field per category: b_DiningOut, b_Groceries…
      if (raw === '' || Number(raw) === 0) changes.push({ key: c.key, limit: null });
      else if (MONEY.test(raw) && Number(raw) <= 1_000_000) changes.push({ key: c.key, limit: Number(raw) });
      else {
        req.flash('errors', { msg: req.t('{cat}: enter an amount greater than 0, with at most two decimals.', { cat: req.cat(c.key) }) });
        return res.redirect('/finance/budgets');
      }
    }
    await Budget.bulkWrite(
      changes.map(({ key, limit }) =>
        limit == null
          ? { deleteOne: { filter: { user: req.user._id, category: key } } }
          : { updateOne: { filter: { user: req.user._id, category: key }, update: { $set: { monthlyLimit: limit } }, upsert: true } },
      ),
    );
    const n = changes.filter((c) => c.limit != null).length;
    req.flash('success', {
      msg:
        n === 1
          ? req.t('Saved 1 budget. It repeats every month until you change it.')
          : req.t('Saved {n} budgets. They repeat every month until you change them.', { n }),
    });
    res.redirect('/finance/budgets');
  } catch (error) {
    next(error);
  }
};
