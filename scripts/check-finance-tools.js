/**
 * Smoke-test the finance agent's tools against seeded data (no LLM needed).
 *   node scripts/check-finance-tools.js
 * Fails loudly if a tool errors or returns obviously wrong shape.
 */
const path = require('node:path');
const assert = require('node:assert');
const mongoose = require('mongoose');

for (const f of ['.env', '.env.example']) {
  try {
    process.loadEnvFile(path.join(__dirname, '..', f));
    break;
  } catch {
    /* next */
  }
}

const User = require('../models/User');
const { _buildTools } = require('../controllers/finance-agent');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ email: 'jason.demo@fintechathon.test' });
  assert(user, 'seed data missing - run npm run seed first');

  const [byCategory, transactions, monthly] = _buildTools(user._id);
  const noopConfig = { writer: () => {} };

  const cats = JSON.parse(await byCategory.invoke({ period: 'last_6_months' }, noopConfig));
  assert(cats.categories.length > 3, 'expected several spending categories');
  assert(
    cats.categories.every((c) => c.spent > 0),
    'spending should be reported positive',
  );
  console.log('get_spending_by_category:', cats.categories.slice(0, 4));

  const subs = JSON.parse(await transactions.invoke({ category: 'Subscriptions', period: 'last_month', limit: 50 }, noopConfig));
  assert(Array.isArray(subs) && subs.length > 5, 'Jason should have many subscriptions');
  console.log('get_transactions (subscriptions, last month):', subs.length, 'rows');

  const months = JSON.parse(await monthly.invoke({ months: 6 }, noopConfig));
  assert(months.length >= 5 && months[0].month < months[months.length - 1].month, 'months ascending');
  assert(
    months.every((m) => typeof m.net === 'number' && m.topCategories.length),
    'each month has net + categories',
  );
  console.log('get_monthly_summary:', months.map((m) => `${m.month} net ${m.net}`).join('  '));

  console.log('\nAll finance tool checks passed.');
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
