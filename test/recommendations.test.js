const { expect } = require('chai');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Transaction = require('../models/Transaction');
const { buildRecommendations } = require('../controllers/recommendations');

// Synthetic household built to trigger specific signals; checks evidence, ranking and savings maths.
describe('Recommendations', () => {
  let mongoServer;
  const user = new mongoose.Types.ObjectId();
  const now = new Date(2026, 8, 25, 12);
  const daysAgo = (n) => new Date(now - n * 864e5);
  const tx = (age, amount, merchant, category) => ({ user, date: daysAgo(age), amount, merchant, category, currency: 'GBP' });
  let recs;
  const byKind = (k) => recs.filter((r) => r.kind === k);

  before(async () => {
    await mongoose.disconnect();
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    const rows = [];
    // Eating out: £100 in each of the three older 30-day windows, £220 in the last 30 days (creep)
    for (const age of [40, 70, 100]) rows.push(tx(age, -100, 'Pizza place', 'DiningOut'));
    rows.push(tx(5, -220, 'Pizza place', 'DiningOut'));
    // 5 delivery orders in the last 30 days
    for (const age of [2, 6, 10, 14, 18]) rows.push(tx(age, -20, 'Deliveroo', 'DiningOut'));
    // Two video subscriptions, monthly on the 8th/9th for 6 months
    for (let m = 0; m < 6; m++) {
      rows.push({ ...tx(0, -10, 'Netflix', 'Subscriptions'), date: new Date(2026, 8 - m, 8, 10) });
      rows.push({ ...tx(0, -8, 'Hulu', 'Subscriptions'), date: new Date(2026, 8 - m, 9, 10) });
    }
    // A credit-card interest-type fee
    rows.push(tx(20, -45, 'Credit card minimum payment', 'Fees'));
    // Income lower than spending over 90 days -> cash-flow warning
    for (const age of [10, 40, 70]) rows.push(tx(age, 150, 'Payroll', 'Income'));
    await Transaction.create(rows);
    recs = await buildRecommendations(user, { now });
  });

  after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('puts the cash-flow warning first', () => {
    expect(recs[0].kind).to.equal('cashflow');
    expect(recs[0].severity).to.equal('warning');
    expect(recs[0].title).to.match(/more than you earn/);
  });

  it('spots category creep and prices the saving as the monthly excess × 12', () => {
    const [creep] = byKind('creep');
    // everyday DiningOut: last 30 days = 220 + 5×20 = 320 vs usual 100
    expect(creep.title).to.equal('Food is up 220% on your usual month');
    expect(creep.saving).to.equal((320 - 100) * 12);
    expect(creep.ask).to.equal('Set my Food budget to 100 a month');
  });

  it('flags frequent delivery orders', () => {
    const [d] = byKind('delivery');
    expect(d.title).to.equal('5 delivery orders in 30 days cost £100');
    expect(d.saving).to.equal(50 * 12);
  });

  it('suggests keeping one of two overlapping streaming services', () => {
    const [o] = byKind('overlap');
    expect(o.title).to.equal('You pay for 2 video streaming services');
    expect(o.saving).to.equal(8 * 12); // keep Netflix (£10), drop Hulu (£8)
  });

  it('gives card-specific advice for interest/minimum-payment fees', () => {
    const [f] = byKind('fees');
    expect(f.evidence).to.equal('1 charge: Credit card minimum payment.');
    expect(f.action).to.match(/in full/);
  });

  it('ranks savings by size after warnings and caps the list at six', () => {
    expect(recs.length).to.be.at.most(6);
    const savings = recs.filter((r) => r.severity === 'saving').map((r) => r.saving);
    expect(savings).to.deep.equal([...savings].sort((a, b) => b - a));
  });
});
