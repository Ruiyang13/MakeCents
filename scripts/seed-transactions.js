/**
 * Seed realistic 6-month transaction histories for a few demo personas.
 *
 *   node scripts/seed-transactions.js
 *
 * Idempotent: re-running upserts the users and replaces their transactions.
 * All demo users share the password below so you can log in and click around.
 *
 * Each persona carries a deliberate "story" (subscription creep, a budget-busting
 * month, forgotten duplicate subscriptions, heavy FX fees) so the assistant has
 * something real to find in the demo.
 */

const path = require('node:path');
const mongoose = require('mongoose');

// Same env-loading approach as app.js (Node 20.12+ / 24 built-in loader).
for (const f of ['.env', '.env.example']) {
  try {
    process.loadEnvFile(path.join(__dirname, '..', f));
    break;
  } catch {
    /* try next */
  }
}

const User = require('../models/User');
const SavingsGoal = require('../models/SavingsGoal');
const Transaction = require('../models/Transaction');
const SandboxAccount = require('../models/SandboxAccount');
const AgentAction = require('../models/AgentAction');
const Budget = require('../models/Budget');
const FixedCost = require('../models/FixedCost');

const DEMO_PASSWORD = 'fintech1234';
const MONTHS = 6; // whole calendar months ending with the current (partial) month
const NOW = new Date();

// Small seeded RNG so every run produces the same history (reproducible demos).
let _seed = 20260910;
const rand = () => {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
};
const between = (a, b) => a + rand() * (b - a);
const money = (a, b) => Math.round(between(a, b) * 100) / 100;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

// monthOffset: 0 = current month, -1 = last month, ... ; day = 1-based day of month.
const dateFor = (monthOffset, day) => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth() + monthOffset, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  d.setHours(Math.floor(between(7, 22)), Math.floor(between(0, 60)));
  return d;
};

// ---------------------------------------------------------------------------
// Persona definitions
// ---------------------------------------------------------------------------

const PERSONAS = [
  {
    name: 'Maria Santos',
    email: 'maria.demo@fintechathon.test',
    currency: 'GBP',
    // International student in London: part-time job + monthly transfer from family.
    // Story: dining-delivery spend grows month over month; chunky FX fees on transfers.
    income: [
      { day: 28, merchant: 'The Library Cafe (payroll)', category: 'Income', amount: [520, 640] },
      { day: 3, merchant: 'Wise transfer from family', category: 'Income', amount: [700, 700] },
    ],
    recurring: [
      { day: 1, merchant: 'Unite Students - room rent', category: 'Rent', amount: [-795, -795] },
      { day: 3, merchant: 'Wise FX fee', category: 'Fees', amount: [-9.4, -12.8] },
      { day: 6, merchant: 'Thames Water', category: 'Utilities', amount: [-18, -24] },
      { day: 6, merchant: 'Octopus Energy', category: 'Utilities', amount: [-41, -63] },
      { day: 10, merchant: 'giffgaff mobile', category: 'Phone', amount: [-10, -10] },
      { day: 12, merchant: 'Spotify', category: 'Subscriptions', amount: [-5.99, -5.99] },
      { day: 15, merchant: 'TfL travel (monthly)', category: 'Transport', amount: [-96, -96] },
      { day: 20, merchant: 'Amazon Prime Student', category: 'Subscriptions', amount: [-4.49, -4.49] },
    ],
    habits: [
      { category: 'Groceries', merchants: ['Tesco Express', 'Sainsbury’s Local', 'Lidl'], perMonth: [7, 10], amount: [-9, -34] },
      { category: 'DiningOut', merchants: ['Franco Manca', 'Pret A Manger', 'Wagamama', 'campus canteen'], perMonth: [3, 6], amount: [-7, -22] },
      { category: 'Shopping', merchants: ['Uniqlo', 'Boots', 'Muji', 'Waterstones'], perMonth: [1, 3], amount: [-8, -45] },
      { category: 'Entertainment', merchants: ['Vue Cinema', 'Southbank Centre', 'Steam'], perMonth: [1, 2], amount: [-6, -25] },
    ],
    story(monthOffset, add) {
      // Food-delivery creep: worse the closer we get to now.
      const recency = monthOffset + MONTHS; // 1..MONTHS
      const orders = Math.round(between(1, 2) + recency * 0.8);
      for (let i = 0; i < orders; i += 1) {
        add(dateFor(monthOffset, Math.floor(between(2, 27))), {
          merchant: pick(['Deliveroo', 'Uber Eats', 'Just Eat']),
          category: 'DiningOut',
          amount: money(-14, -31),
          description: 'Food delivery',
        });
      }
      // Occasional extra remittance/tuition top-up with a fat FX fee.
      if (monthOffset === -4 || monthOffset === -1) {
        add(dateFor(monthOffset, 18), { merchant: 'University tuition instalment', category: 'Education', amount: money(-1100, -1400) });
        add(dateFor(monthOffset, 17), { merchant: 'Wise transfer from family', category: 'Income', amount: money(1200, 1500) });
        add(dateFor(monthOffset, 17), { merchant: 'Wise FX fee', category: 'Fees', amount: money(-16, -28), description: 'FX + transfer fee' });
      }
    },
  },

  {
    name: 'Jason Lee',
    email: 'jason.demo@fintechathon.test',
    currency: 'USD',
    // Mid-20s software engineer, comfortable income, low friction spending.
    // Story: 9+ subscriptions incl. two overlapping video + a forgotten gym;
    // heavy dining out; one big travel splurge; savings transfers are sporadic.
    income: [{ day: 15, merchant: 'Acme Corp payroll', category: 'Income', amount: [4750, 4750] }],
    recurring: [
      { day: 1, merchant: 'Parkview Apartments rent', category: 'Rent', amount: [-2100, -2100] },
      { day: 2, merchant: 'Geico auto insurance', category: 'Insurance', amount: [-128, -128] },
      { day: 4, merchant: 'ConEd electricity', category: 'Utilities', amount: [-55, -110] },
      { day: 5, merchant: 'Verizon Fios internet', category: 'Utilities', amount: [-80, -80] },
      { day: 7, merchant: 'T-Mobile', category: 'Phone', amount: [-85, -85] },
      { day: 8, merchant: 'Netflix', category: 'Subscriptions', amount: [-22.99, -22.99] },
      { day: 9, merchant: 'Hulu', category: 'Subscriptions', amount: [-17.99, -17.99] },
      { day: 11, merchant: 'Disney+', category: 'Subscriptions', amount: [-13.99, -13.99] },
      { day: 12, merchant: 'Spotify', category: 'Subscriptions', amount: [-11.99, -11.99] },
      { day: 13, merchant: 'iCloud+ 2TB', category: 'Subscriptions', amount: [-9.99, -9.99] },
      { day: 14, merchant: 'GitHub Copilot', category: 'Subscriptions', amount: [-10, -10] },
      { day: 16, merchant: 'ChatGPT Plus', category: 'Subscriptions', amount: [-20, -20] },
      { day: 18, merchant: 'Equinox gym', category: 'Health', amount: [-52, -52] },
      { day: 19, merchant: 'NYT + The Athletic', category: 'Subscriptions', amount: [-25, -25] },
      { day: 22, merchant: 'Amazon Prime', category: 'Subscriptions', amount: [-14.99, -14.99] },
    ],
    habits: [
      {
        category: 'DiningOut',
        merchants: ['Sweetgreen', 'Chipotle', 'Joe’s Pizza', 'Blue Bottle', 'DoorDash', 'local izakaya'],
        perMonth: [14, 22],
        amount: [-11, -46],
      },
      { category: 'Groceries', merchants: ['Whole Foods', 'Trader Joe’s'], perMonth: [3, 5], amount: [-28, -74] },
      { category: 'Transport', merchants: ['Uber', 'Lyft', 'MTA MetroCard', 'Citi Bike'], perMonth: [6, 12], amount: [-3, -32] },
      { category: 'Shopping', merchants: ['Amazon', 'Nike', 'Uniqlo', 'Best Buy', 'Steam'], perMonth: [3, 6], amount: [-15, -140] },
      { category: 'Entertainment', merchants: ['AMC', 'Ticketmaster', 'Barcade', 'Comedy Cellar'], perMonth: [2, 4], amount: [-18, -70] },
    ],
    story(monthOffset, add) {
      // Sporadic savings transfers (only some months, varying amounts).
      if (chance(0.55)) {
        add(dateFor(monthOffset, 17), { merchant: 'Transfer to Ally Savings', category: 'Savings', amount: money(-200, -800), account: 'current' });
      }
      // The travel splurge, 3 months ago.
      if (monthOffset === -3) {
        add(dateFor(monthOffset, 9), { merchant: 'United Airlines', category: 'Travel', amount: money(-540, -680) });
        add(dateFor(monthOffset, 21), { merchant: 'Airbnb - Lisbon', category: 'Travel', amount: money(-720, -910) });
        add(dateFor(monthOffset, 23), { merchant: 'GetYourGuide tours', category: 'Travel', amount: money(-90, -160) });
      }
      // Annual domain/hosting bill lands once.
      if (monthOffset === -2) add(dateFor(monthOffset, 6), { merchant: 'Namecheap (annual)', category: 'Subscriptions', amount: money(-58, -58) });
    },
  },

  {
    name: 'Priya & Sam Okafor',
    email: 'okafor.demo@fintechathon.test',
    currency: 'GBP',
    // Dual-income household with a toddler. Budget normally balances.
    // Story: one month a car repair + boiler service blow the monthly budget and
    // push them onto the credit card; childcare is the silent biggest line.
    income: [
      { day: 25, merchant: 'NHS Trust payroll (Priya)', category: 'Income', amount: [2650, 2650] },
      { day: 28, merchant: 'Loamworks Ltd payroll (Sam)', category: 'Income', amount: [3050, 3050] },
    ],
    recurring: [
      { day: 1, merchant: 'Nationwide mortgage', category: 'Mortgage', amount: [-1480, -1480] },
      { day: 2, merchant: 'Bright Horizons nursery', category: 'Childcare', amount: [-1120, -1120] },
      { day: 3, merchant: 'Aviva home + life insurance', category: 'Insurance', amount: [-64, -64] },
      { day: 4, merchant: 'British Gas', category: 'Utilities', amount: [-120, -180] },
      { day: 5, merchant: 'Anglian Water', category: 'Utilities', amount: [-42, -42] },
      { day: 6, merchant: 'Hyperoptic broadband', category: 'Utilities', amount: [-35, -35] },
      { day: 7, merchant: 'Two phones - Vodafone', category: 'Phone', amount: [-46, -46] },
      { day: 9, merchant: 'Council tax', category: 'Utilities', amount: [-190, -190] },
      { day: 12, merchant: 'Disney+ / Netflix', category: 'Subscriptions', amount: [-24, -24] },
      { day: 14, merchant: 'PureGym (Sam)', category: 'Health', amount: [-24, -24] },
      { day: 18, merchant: 'Standing order to Junior ISA', category: 'Savings', amount: [-100, -100] },
    ],
    habits: [
      { category: 'Groceries', merchants: ['Sainsbury’s', 'Aldi', 'Ocado', 'M&S Food'], perMonth: [10, 14], amount: [-24, -96] },
      { category: 'DiningOut', merchants: ['The Ivy Cafe', 'Nando’s', 'local pub', 'Costa'], perMonth: [3, 6], amount: [-12, -68] },
      { category: 'Transport', merchants: ['Shell', 'BP', 'trainline', 'NCP parking'], perMonth: [5, 9], amount: [-6, -78] },
      { category: 'Shopping', merchants: ['John Lewis', 'Boots', 'Amazon', 'Early Learning Centre', 'H&M'], perMonth: [4, 8], amount: [-10, -120] },
      { category: 'Health', merchants: ['Boots pharmacy', 'Specsavers', 'NHS prescription'], perMonth: [1, 3], amount: [-8, -60] },
      { category: 'Entertainment', merchants: ['Vue Cinema', 'soft play', 'National Trust', 'Spotify family'], perMonth: [2, 4], amount: [-8, -42] },
    ],
    story(monthOffset, add) {
      // The budget-busting month, 2 months ago.
      if (monthOffset === -2) {
        add(dateFor(monthOffset, 11), {
          merchant: 'Kwik Fit - clutch replacement',
          category: 'Transport',
          amount: money(-780, -940),
          account: 'credit',
          description: 'Emergency car repair',
        });
        add(dateFor(monthOffset, 19), { merchant: 'PlumbPro - boiler service + part', category: 'Utilities', amount: money(-260, -340), account: 'credit' });
        add(dateFor(monthOffset, 20), { merchant: 'Argos - replacement washer', category: 'Shopping', amount: money(-300, -420), account: 'credit' });
        add(dateFor(monthOffset, 27), { merchant: 'Credit card minimum payment', category: 'Fees', amount: money(-45, -45) });
      }
      // Birthday month spike, 4 months ago.
      if (monthOffset === -4) {
        add(dateFor(monthOffset, 8), { merchant: 'Smyths Toys', category: 'Shopping', amount: money(-70, -130), description: 'Toddler birthday' });
        add(dateFor(monthOffset, 9), { merchant: 'party venue hire', category: 'Entertainment', amount: money(-140, -200) });
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function generateForPersona(persona, userId) {
  const txns = [];
  const push = (date, t) =>
    txns.push({
      user: userId,
      date,
      currency: persona.currency,
      account: t.account || 'current',
      source: 'seed',
      pending: false,
      description: t.description,
      merchant: t.merchant,
      category: t.category,
      amount: Math.round(t.amount * 100) / 100,
    });

  for (let m = -(MONTHS - 1); m <= 0; m += 1) {
    for (const inc of persona.income) push(dateFor(m, inc.day), { ...inc, amount: money(inc.amount[0], inc.amount[1]) });
    for (const r of persona.recurring) push(dateFor(m, r.day), { ...r, amount: money(r.amount[0], r.amount[1]) });

    for (const h of persona.habits) {
      const n = Math.round(between(h.perMonth[0], h.perMonth[1]));
      for (let i = 0; i < n; i += 1) {
        push(dateFor(m, Math.floor(between(1, 28))), {
          merchant: pick(h.merchants),
          category: h.category,
          amount: money(h.amount[0], h.amount[1]),
        });
      }
    }

    if (persona.story) persona.story(m, (date, t) => push(date, t));
  }

  // The current month is partial: drop anything dated after now (no future transactions in a demo).
  return txns.filter((t) => t.date <= NOW).sort((a, b) => a.date - b.date);
}

// Demo savings goals at different fill levels, so every piggy-bank state shows up.
// daysIn = days from now to the deadline; startedDaysAgo sets how long the goal has been running.
const DEMO_GOALS = {
  'maria.demo@fintechathon.test': [
    { name: 'Flight home for Christmas', target: 650, saved: 180, daysIn: 80, startedDaysAgo: 40 },
    { name: 'Emergency fund', target: 1000, saved: 520, daysIn: 150, startedDaysAgo: 120 },
  ],
  'jason.demo@fintechathon.test': [
    { name: 'Japan trip', target: 3000, saved: 2350, daysIn: 60, startedDaysAgo: 150 },
    { name: 'New laptop', target: 1800, saved: 1800, daysIn: 20, startedDaysAgo: 100 },
  ],
  'okafor.demo@fintechathon.test': [
    { name: 'Family holiday', target: 2400, saved: 600, daysIn: 200, startedDaysAgo: 90 },
    { name: 'Boiler replacement fund', target: 1500, saved: 150, daysIn: 120, startedDaysAgo: 60 },
  ],
};

async function seedGoals(user) {
  const DAY = 24 * 60 * 60 * 1000;
  await SavingsGoal.deleteMany({ user: user._id });
  for (const g of DEMO_GOALS[user.email] || []) {
    const created = new Date(NOW - g.startedDaysAgo * DAY);
    // spread the saved amount over a few contributions since the start
    const parts = [0.4, 0.35, 0.25].map((f) => Math.round(g.saved * f * 100) / 100);
    parts[2] = Math.round((g.saved - parts[0] - parts[1]) * 100) / 100;
    await SavingsGoal.create({
      user: user._id,
      name: g.name,
      target: g.target,
      deadline: new Date(NOW.getTime() + g.daysIn * DAY),
      createdAt: created,
      contributions: parts.map((amount, i) => ({ amount, date: new Date(created.getTime() + ((i + 1) * (NOW - created)) / 4) })),
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set (checked .env and .env.example)');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to ${process.env.MONGODB_URI}\n`);

  // Extra "<email>[:persona]" args attach a persona's data to an existing account
  // (e.g. your own login). persona = santos | lee | okafor, default lee.
  const byKey = { santos: PERSONAS[0], lee: PERSONAS[1], okafor: PERSONAS[2] };
  // --goals-only: (re)create just the demo savings goals, leaving transactions untouched.
  const goalsOnly = process.argv.includes('--goals-only');
  const extra = process.argv
    .slice(2)
    .filter((a) => !a.startsWith('--'))
    .map((a) => {
      const [email, key] = a.split(':');
      return { email, persona: byKey[key] || PERSONAS[1] };
    });

  const jobs = [
    ...PERSONAS.map((p) => ({ persona: p, email: p.email, create: true })),
    ...extra.map((e) => ({ persona: e.persona, email: e.email, create: false })),
  ];

  for (const { persona, email, create } of jobs) {
    let user = await User.findOne({ email });
    if (!user && create) {
      user = new User({ email, password: DEMO_PASSWORD, name: persona.name });
      await user.save();
    }
    if (!user) {
      console.log(`SKIP ${email} — no such account (sign up first)`);
      continue;
    }

    // demo accounts get their persona's currency back (someone may have changed it while testing)
    if (create) await User.updateOne({ _id: user._id }, { currency: persona.currency });
    await seedGoals(user);
    if (goalsOnly) {
      console.log(`${persona.name.padEnd(20)} goals only`);
      continue;
    }
    await Transaction.deleteMany({ user: user._id });
    // A clean slate for demos: sandbox back to its starting balance, empty operation log (so no daily limit carries over),
    // no budgets or fixed-cost corrections left over from earlier runs.
    await SandboxAccount.deleteMany({ user: user._id });
    await AgentAction.deleteMany({ user: user._id });
    await Budget.deleteMany({ user: user._id });
    await FixedCost.deleteMany({ user: user._id });
    const txns = generateForPersona(persona, user._id);
    await Transaction.insertMany(txns);

    const inTotal = txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const outTotal = txns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    console.log(
      `${persona.name.padEnd(20)} ${String(txns.length).padStart(4)} txns  ` +
        `in ${persona.currency} ${inTotal.toFixed(0).padStart(7)}  out ${persona.currency} ${outTotal.toFixed(0).padStart(8)}  ` +
        `net ${(inTotal + outTotal).toFixed(0).padStart(7)}`,
    );
  }

  console.log(`\nDemo login: password "${DEMO_PASSWORD}" for every *.demo@fintechathon.test account.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// Reused by scripts/evidence-run.js to build the same demo household in a throwaway database.
module.exports = { PERSONAS, generateForPersona, seedGoals, DEMO_PASSWORD };
