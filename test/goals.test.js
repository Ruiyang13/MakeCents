const { expect } = require('chai');
const { _planFor: planFor, _planAll: planAll } = require('../controllers/goals');

// The automatic savings plan: pure maths on a goal + the user's usual month.
describe('Savings goal plans', () => {
  const now = new Date(2026, 8, 25, 12);
  const days = (n) => new Date(now.getTime() + n * 864e5);
  const goal = (target, saved, { createdDaysAgo = 0, deadlineInDays = 120 } = {}) => ({
    target,
    createdAt: days(-createdDaysAgo),
    deadline: days(deadlineInDays),
    contributions: saved ? [{ amount: saved }] : [],
  });

  it('works out per-week and per-month amounts and says when it fits', () => {
    const p = planFor(goal(1200, 0), { now, freeCash: 500 });
    expect(p.perMonth).to.be.closeTo(1200 / (120 / 30.44), 0.01);
    expect(p.perWeek).to.be.closeTo(1200 / (120 / 7), 0.01);
    expect(p.fits).to.equal(true);
    expect(p.spare).to.be.closeTo(500 - p.perMonth, 0.01);
  });

  it('suggests trims (max 20% of a category, biggest first) when it does not fit', () => {
    const p = planFor(goal(1200, 0), { now, freeCash: 250, usual: { DiningOut: 300, Shopping: 200 } });
    expect(p.fits).to.equal(false);
    expect(p.trims).to.have.length(1); // gap ≈ £54 fits inside the 20% (£60) of eating out
    expect(p.trims[0].category).to.equal('DiningOut');
    expect(p.trims[0].amount).to.be.at.most(60);
    expect(p.realistic).to.equal(undefined);
  });

  it('gives a realistic date when even the trims are not enough', () => {
    const p = planFor(goal(1200, 0), { now, freeCash: 100, usual: { DiningOut: 300, Shopping: 200 } });
    expect(p.trims.map((x) => [x.category, x.amount])).to.deep.equal([
      ['DiningOut', 60],
      ['Shopping', 40],
    ]);
    // capacity £200/month for £1,200 -> about 6 months, well after the 4-month deadline
    const months = (p.realistic - now) / (30.44 * 864e5);
    expect(months).to.be.closeTo(6, 0.01);
  });

  it('knows on track vs behind from an even pace since the start', () => {
    expect(planFor(goal(1000, 300, { createdDaysAgo: 60, deadlineInDays: 60 }), { now, freeCash: 1000 }).status).to.equal('behind');
    expect(planFor(goal(1000, 600, { createdDaysAgo: 60, deadlineInDays: 60 }), { now, freeCash: 1000 }).status).to.equal('ontrack');
    expect(planFor(goal(1000, 100, { createdDaysAgo: 90, deadlineInDays: -1 }), { now }).status).to.equal('overdue');
  });

  it('maps progress to the five piggy levels', () => {
    const levels = [0, 24, 25, 50, 74, 75, 99, 100, 130].map((saved) => planFor(goal(100, saved), { now, freeCash: 1e6 }).level);
    expect(levels).to.deep.equal([0, 0, 1, 2, 2, 3, 3, 4, 4]);
    expect(planFor(goal(100, 100), { now }).status).to.equal('done');
  });

  it('shares the monthly left-over across goals, earliest deadline first', () => {
    const soon = goal(1200, 0, { deadlineInDays: 120 }); // needs ≈ £304/month
    const later = goal(1200, 0, { deadlineInDays: 240 }); // needs ≈ £152/month
    const [a, b] = planAll([soon, later], { now, freeCash: 400 });
    expect(a.plan.fits).to.equal(true);
    expect(b.plan.fits).to.equal(false); // only ≈ £96 left after the first goal
  });
});
