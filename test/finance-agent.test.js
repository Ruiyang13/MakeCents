const { expect } = require('chai');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Transaction = require('../models/Transaction');
const Budget = require('../models/Budget');
const AgentAction = require('../models/AgentAction');
const { _buildTools, _decideAction, _dailySpendHeatmap } = require('../controllers/finance-agent');

// Finance agent tools + permission tiers, no LLM involved.
describe('Finance Agent tools & permissions', () => {
  let mongoServer;
  const userId = new mongoose.Types.ObjectId();
  const otherUser = new mongoose.Types.ObjectId();
  let tools;
  const byName = (name) => tools.find((t) => t.name === name);
  const call = async (name, args = {}) => JSON.parse(await byName(name).invoke(args));

  before(async () => {
    await mongoose.disconnect();
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    const now = new Date();
    const thisMonth = (day) => new Date(now.getFullYear(), now.getMonth(), Math.min(day, now.getDate()));
    await Transaction.create([
      { user: userId, date: thisMonth(1), amount: -150, merchant: 'Nandos (Soho)', category: 'DiningOut' },
      { user: userId, date: thisMonth(1), amount: -40, merchant: 'Tesco', category: 'Groceries' },
      { user: userId, date: thisMonth(1), amount: 2000, merchant: 'Employer', category: 'Income' },
    ]);
    tools = _buildTools(userId);
  });

  after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Budget.deleteMany({});
    await AgentAction.deleteMany({});
  });

  it('read tools run immediately and are audit-logged', async () => {
    const res = await call('get_spending_by_category', { period: 'this_month' });
    expect(res.categories.map((c) => c.category)).to.have.members(['DiningOut', 'Groceries']);
    const log = await AgentAction.find({ user: userId }).lean();
    expect(log).to.have.length(1);
    expect(log[0]).to.include({ tool: 'get_spending_by_category', tier: 'read', status: 'executed' });
  });

  it('merchant filter treats regex characters literally', async () => {
    const rows = await call('get_transactions', { merchant: 'Nandos (Soho', period: 'all' });
    expect(rows).to.have.length(1);
    expect(await call('get_transactions', { merchant: '.*', period: 'all' })).to.have.length(0);
  });

  it('set_budget only proposes; nothing changes until confirmed', async () => {
    const res = await call('set_budget', { category: 'DiningOut', monthlyLimit: 100 });
    expect(res.status).to.equal('awaiting_user_confirmation');
    expect(await Budget.countDocuments()).to.equal(0);

    const action = await _decideAction(userId, res.actionId, true);
    expect(action.status).to.equal('confirmed');
    const budget = await Budget.findOne({ user: userId, category: 'DiningOut' }).lean();
    expect(budget.monthlyLimit).to.equal(100);
  });

  it('rejected actions never run, and cannot be decided twice', async () => {
    const { actionId } = await call('set_budget', { category: 'DiningOut', monthlyLimit: 100 });
    expect((await _decideAction(userId, actionId, false)).status).to.equal('rejected');
    expect(await _decideAction(userId, actionId, true)).to.equal(null);
    expect(await Budget.countDocuments()).to.equal(0);
  });

  it("another user cannot confirm someone else's action", async () => {
    const { actionId } = await call('set_budget', { category: 'DiningOut', monthlyLimit: 100 });
    expect(await _decideAction(otherUser, actionId, true)).to.equal(null);
    expect(await Budget.countDocuments()).to.equal(0);
  });

  it('expired proposals cannot be confirmed', async () => {
    const { actionId } = await call('set_budget', { category: 'DiningOut', monthlyLimit: 100 });
    await AgentAction.collection.updateOne({ _id: new mongoose.Types.ObjectId(actionId) }, { $set: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } });
    expect(await _decideAction(userId, actionId, true)).to.equal(null);
    expect((await AgentAction.findById(actionId)).status).to.equal('expired');
  });

  it('rejects unknown categories and invalid limits', async () => {
    expect((await call('set_budget', { category: 'Yachts', monthlyLimit: 100 })).error).to.match(/Unknown category/);
    let threw = false;
    try {
      await byName('set_budget').invoke({ category: 'DiningOut', monthlyLimit: -5 });
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    expect(await AgentAction.countDocuments({ status: 'pending' })).to.equal(0);
  });

  it('caps the number of pending proposals', async () => {
    for (let i = 0; i < 5; i++) await call('set_budget', { category: 'DiningOut', monthlyLimit: 100 + i });
    expect((await call('set_budget', { category: 'DiningOut', monthlyLimit: 999 })).error).to.match(/Too many/);
  });

  it('check_budgets flags overspending', async () => {
    await Budget.create([
      { user: userId, category: 'DiningOut', monthlyLimit: 100 },
      { user: userId, category: 'Groceries', monthlyLimit: 10000 },
    ]);
    const { budgets } = await call('check_budgets');
    const dining = budgets.find((b) => b.category === 'DiningOut');
    expect(dining).to.include({ spent: 150, remaining: -50, status: 'over' });
    expect(budgets.find((b) => b.category === 'Groceries').status).to.equal('ok');
  });

  it('add_transaction records spending only after confirmation', async () => {
    const res = await call('add_transaction', { amount: 10, merchant: 'Mala hotpot', category: 'DiningOut' });
    expect(res.status).to.equal('awaiting_user_confirmation');
    expect(await Transaction.countDocuments({ user: userId, source: 'manual' })).to.equal(0);
    const action = await _decideAction(userId, res.actionId, true);
    expect(action.status).to.equal('confirmed');
    const t = await Transaction.findOne({ user: userId, source: 'manual' }).lean();
    expect(t).to.include({ amount: -10, merchant: 'Mala hotpot', category: 'DiningOut', currency: 'GBP' });
    await Transaction.deleteMany({ source: 'manual' });
  });

  it('add_transaction rejects future dates and unknown categories', async () => {
    const future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    expect((await call('add_transaction', { amount: 5, merchant: 'X', category: 'DiningOut', date: future })).error).to.match(/future/);
    expect((await call('add_transaction', { amount: 5, merchant: 'X', category: 'Yachts' })).error).to.match(/Unknown category/);
  });

  it("heatmap: this month's calendar, colour intensity = sqrt(amount / max)", async () => {
    const u = new mongoose.Types.ObjectId();
    const now = new Date(2026, 8, 25, 12); // Fri 25 Sep 2026; 1 Sep is a Tuesday
    await Transaction.create(
      [
        [2, 25],
        [3, 100],
        [4, 400],
        [10, 100],
      ].map(([day, amt]) => ({ user: u, date: new Date(2026, 8, day, 12), amount: -amt, merchant: 'X', category: 'Shopping' })),
    );
    await Transaction.create({ user: u, date: new Date(2026, 7, 31, 12), amount: -999, merchant: 'Last month', category: 'Shopping' });
    // a fixed cost this month: listed apart, never coloured into the calendar
    await Transaction.create({ user: u, date: new Date(2026, 8, 4, 12), amount: -1480, merchant: 'Rent', category: 'Rent' });
    const hm = await _dailySpendHeatmap(u, now);
    expect(hm.month).to.equal('September');
    expect(hm.max).to.equal(400);
    expect(hm.weeks.every((w) => w.length === 7)).to.equal(true);
    const cells = hm.weeks.flat();
    expect(cells[0]).to.equal(null); // Monday before the 1st is blank
    const day = (n) => cells.find((c) => c && c.day === n);
    expect(cells.filter(Boolean)).to.have.length(30);
    expect([day(4).t, day(3).t, day(2).t]).to.deep.equal([1, 0.5, 0.25]);
    expect(day(5).t).to.equal(0);
    expect(day(25).today).to.equal(true);
    expect(day(26).future).to.equal(true);
    expect(hm.total).to.equal('£625.00');
    expect(hm.fixed.map((x) => [x.merchant, x.amount, x.day])).to.deep.equal([['Rent', 1480, 4]]);
    expect(hm.fixedTotal).to.equal('£1,480.00');
  });
});
