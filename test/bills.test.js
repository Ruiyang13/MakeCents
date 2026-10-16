const { expect } = require('chai');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Transaction = require('../models/Transaction');
const { detectBills, _percentages, fixedClassifier } = require('../controllers/bills');

// Bill detection on synthetic history: fixed-day bills vs irregular habits.
describe('Bill analysis', () => {
  let mongoServer;
  const user = new mongoose.Types.ObjectId();
  const now = new Date(2026, 8, 25, 12); // 25 Sep 2026
  const on = (monthsAgo, day) => new Date(2026, 8 - monthsAgo, day, 10);
  const tx = (date, amount, merchant, category) => ({ user, date, amount, merchant, category, currency: 'GBP' });
  let result;

  before(async () => {
    await mongoose.disconnect();
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    const rows = [];
    for (let m = 5; m >= 0; m--) {
      rows.push(tx(on(m, 8), -22.99, 'Netflix', 'Subscriptions'));
      rows.push(tx(on(m, 9), -17.99, 'Hulu', 'Subscriptions'));
      rows.push(tx(on(m, 1), -1480, 'Mortgage', 'Mortgage'));
      rows.push(tx(on(m, 4), m === 0 ? -95 : -60, 'Gas & Power', 'Utilities')); // last bill spikes
      rows.push(tx(on(m, 28), 3000, 'Payroll', 'Income'));
      // groceries: several times a month on scattered days -> a habit, not a bill
      [3, 11, 19, 26].forEach((d) => rows.push(tx(on(m, d), -40, 'Tesco', 'Groceries')));
      // a monthly dinner on a fixed day is still a habit, not a bill
      rows.push(tx(on(m, 20), -60, 'Pizza night', 'DiningOut'));
    }
    // an old gym membership that stopped three months ago
    for (let m = 5; m >= 3; m--) rows.push(tx(on(m, 14), -30, 'PureGym', 'Health'));
    await Transaction.create(rows);
    result = await detectBills(user, now);
  });

  after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  const bill = (name) => result.bills.find((b) => b.merchant === name);

  it('finds fixed-day monthly bills and ignores habits and income', () => {
    expect(result.bills.map((b) => b.merchant)).to.have.members(['Netflix', 'Hulu', 'Mortgage', 'Gas & Power', 'PureGym']);
  });

  it('predicts the next due date one month after the last charge', () => {
    expect(bill('Netflix').nextDue.toDateString()).to.equal(new Date(2026, 9, 8).toDateString());
    expect(bill('Netflix').daysToDue).to.equal(13);
  });

  it('flags a bill that came in higher than usual', () => {
    expect(bill('Gas & Power').flags.map((f) => f.type)).to.include('higher');
  });

  it('marks bills with no recent charge as inactive and leaves them out of the totals', () => {
    expect(bill('PureGym').active).to.equal(false);
    expect(result.monthlyTotal).to.equal(22.99 + 17.99 + 1480 + 60);
  });

  it('spots overlapping streaming services', () => {
    const overlap = result.insights.find((i) => i.type === 'overlap');
    expect(overlap.title).to.equal('2 video streaming services');
    expect(overlap.text).to.include('£40.98');
  });

  it('works out bills as a share of income', () => {
    expect(result.monthlyIncome).to.equal(3000);
    expect(result.incomeShare).to.equal(Math.round(((22.99 + 17.99 + 1480 + 60) / 3000) * 100));
  });

  it('builds a month-by-month history with the current month marked as partial', () => {
    const labels = result.history.map((h) => h.label);
    expect(labels.at(-1)).to.equal('SEP');
    expect(result.history.at(-1).partial).to.equal(true);
    const aug = result.history.find((h) => h.label === 'AUG');
    expect(aug.total).to.equal(22.99 + 17.99 + 1480 + 60);
  });

  it('rounds composition percentages so they add up to exactly 100', () => {
    for (const vals of [
      [1, 1, 1],
      [1480, 60, 40.98, 22.99],
      [2, 1],
    ]) {
      expect(_percentages(vals).reduce((a, b) => a + b, 0)).to.equal(100);
    }
    expect(_percentages([1, 1, 1])).to.deep.equal([34, 33, 33]);
    expect(_percentages([])).to.deep.equal([]); // user with no bills yet
  });

  it('treats fixed-cost categories and detected bills as fixed, everyday spending as not', () => {
    const isFixed = fixedClassifier(result.bills);
    expect(isFixed({ merchant: 'Gas & Power', category: 'Other' })).to.equal(true); // detected recurring bill
    expect(isFixed({ merchant: 'Landlord', category: 'Rent' })).to.equal(true); // fixed category
    expect(isFixed({ merchant: 'Tesco', category: 'Groceries' })).to.equal(false);
  });

  it("applies the user's corrections: an amount, 'not fixed', and a cost added by hand", async () => {
    const FixedCost = require('../models/FixedCost');
    await FixedCost.create([
      { user, merchant: 'Hulu', key: 'hulu', fixed: false },
      { user, merchant: 'Netflix', key: 'netflix', fixed: true, monthly: 10.99, category: 'Subscriptions' },
      { user, merchant: 'Landlord', key: 'landlord', fixed: true, monthly: 800, category: 'Rent', day: 1 },
    ]);
    const fixed = await detectBills(user, now);
    const by = (name) => fixed.bills.find((b) => b.merchant === name);
    expect(by('Hulu')).to.equal(undefined);
    expect(by('Netflix')).to.include({ monthly: 10.99, edited: true });
    expect(by('Netflix').nextDue.toDateString()).to.equal(new Date(2026, 9, 8).toDateString()); // still detected
    expect(by('Landlord')).to.include({ monthly: 800, manual: true, unrecorded: true, active: true });
    expect(by('Landlord').nextDue.toDateString()).to.equal(new Date(2026, 9, 1).toDateString());
    expect(fixed.monthlyTotal).to.equal(10.99 + 1480 + 60 + 800);
    expect(fixed.unrecordedMonthly).to.equal(800);
    // 'not fixed' wins even over a fixed-cost category
    const isFixed = fixedClassifier(fixed.bills, fixed.excluded);
    expect(isFixed({ merchant: 'Hulu', category: 'Subscriptions' })).to.equal(false);
    expect(isFixed({ merchant: 'Landlord', category: 'Other' })).to.equal(true);
    await FixedCost.deleteMany({ user });
  });
});
