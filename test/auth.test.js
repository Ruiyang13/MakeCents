const { expect } = require('chai');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Full HTTP flow through the real app: sessions, CSRF, auth guard, account deletion.
describe('Auth & route protection', () => {
  let mongoServer;
  let app;
  let User;
  let Transaction;
  const csrfOf = (html) => html.match(/name="csrf-token" content="([^"]+)"/)[1];

  before(async () => {
    await mongoose.disconnect();
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    // Required after connecting: the session store binds to the live connection.
    app = require('../app');
    User = require('../models/User');
    Transaction = require('../models/Transaction');
  });

  after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('serves the landing page', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.text).to.include('PlanSmart');
  });

  it('sends a nonce-based CSP, and every inline script carries the nonce', async () => {
    const res = await request(app).get('/').expect(200);
    const nonce = /script-src 'self' 'nonce-([^']+)'/.exec(res.headers['content-security-policy'])[1];
    expect(res.headers['content-security-policy']).to.include("object-src 'none'").and.not.include('unsafe-eval');
    const inline = res.text.match(/<script(?![^>]*\bsrc=)(?![^>]*application\/json)[^>]*>/g);
    expect(inline).to.have.length.above(0);
    inline.forEach((tag) => expect(tag).to.include(`nonce="${nonce}"`));
    // inline event handlers would be blocked by the CSP: none may exist in any template
    const fs = require('node:fs');
    const views = fs.readdirSync('views', { recursive: true }).filter((f) => f.endsWith('.pug'));
    views.forEach((f) => expect(fs.readFileSync(`views/${f}`, 'utf8'), f).to.not.match(/\bon(submit|click|change|load|input)=/));
  });

  it('redirects signed-out users away from the assistant', async () => {
    const res = await request(app).get('/finance').expect(302);
    expect(res.headers.location).to.equal('/login');
  });

  it('returns 401 JSON for signed-out API calls', async () => {
    const agent = request.agent(app);
    const csrf = csrfOf((await agent.get('/login')).text);
    await agent.post('/finance/actions/abc/confirm').set('X-CSRF-Token', csrf).expect(401);
  });

  it('rejects form posts without a CSRF token', async () => {
    await request(app).post('/login').type('form').send({ email: 'a@b.co', password: 'x' }).expect(403);
  });

  it('signs up, reaches the assistant, signs out', async () => {
    const agent = request.agent(app);
    const csrf = csrfOf((await agent.get('/signup')).text);
    const res = await agent
      .post('/signup')
      .type('form')
      .send({ _csrf: csrf, name: 'Ada', email: 'Ada@Example.com', password: 'correct-horse', confirmPassword: 'correct-horse', currency: 'EUR' })
      .expect(302);
    expect(res.headers.location).to.equal('/finance');
    const page = await agent.get('/finance').expect(200);
    expect(page.text).to.include('Everyday spending').and.include('id="scan-drop"'); // calendar + the upload zone under the chat bar
    const user = await User.findOne({ email: 'ada@example.com' }).lean();
    expect(user.password).to.not.equal('correct-horse'); // hashed
    expect(user.currency).to.equal('EUR');
    expect((await agent.get('/finance/budgets').expect(200)).text).to.include('€'); // the chosen currency, before any transactions
    await agent.get('/logout').expect(302);
    await agent.get('/finance').expect(302);
  });

  it('rejects a wrong password with a generic message', async () => {
    const agent = request.agent(app);
    const csrf = csrfOf((await agent.get('/login')).text);
    const res = await agent.post('/login').type('form').send({ _csrf: csrf, email: 'ada@example.com', password: 'wrong-password' }).expect(302);
    expect(res.headers.location).to.equal('/login');
    expect((await agent.get('/login')).text).to.include('Invalid email or password.');
  });

  it('returns to the originally requested page after login', async () => {
    const agent = request.agent(app);
    await agent.get('/finance'); // sets returnTo=/finance
    const csrf = csrfOf((await agent.get('/login')).text);
    const res = await agent.post('/login').type('form').send({ _csrf: csrf, email: 'ada@example.com', password: 'correct-horse' }).expect(302);
    expect(res.headers.location).to.equal('/finance');
  });

  it('two-step sign-in: set up with a code, then every sign-in needs a fresh code', async () => {
    const totp = require('../config/totp');
    const agent = request.agent(app);
    let csrf = csrfOf((await agent.get('/signup')).text);
    const creds = { email: '2fa@example.com', password: 'correct-horse' };
    await agent
      .post('/signup')
      .type('form')
      .send({ _csrf: csrf, ...creds, confirmPassword: creds.password, currency: 'GBP' })
      .expect(302);
    csrf = csrfOf((await agent.get('/account')).text);
    await agent.post('/account/2fa/setup').type('form').send({ _csrf: csrf }).expect(302);
    const page = (await agent.get('/account')).text;
    expect(page).to.include('<svg'); // QR code
    const secret = /class="two-step-key">([A-Z2-7 ]+)</.exec(page)[1].replace(/ /g, '');
    await agent.post('/account/2fa/enable').type('form').send({ _csrf: csrf, code: 'abcdef' }).expect(302);
    expect((await User.findOne({ email: creds.email }).lean()).totp).to.equal(undefined);
    const enableCode = totp.codeAt(secret);
    await agent.post('/account/2fa/enable').type('form').send({ _csrf: csrf, code: enableCode }).expect(302);
    expect((await User.findOne({ email: creds.email }).lean()).totp.secret).to.equal(secret);
    await agent.get('/logout');

    // The password alone no longer signs you in.
    const next = request.agent(app);
    csrf = csrfOf((await next.get('/login')).text);
    const login = await next
      .post('/login')
      .type('form')
      .send({ _csrf: csrf, ...creds })
      .expect(302);
    expect(login.headers.location).to.equal('/login/code');
    await next.get('/finance').expect(302).expect('Location', '/login');
    csrf = csrfOf((await next.get('/login/code')).text);
    // A code that was already used (replay) is refused.
    const replay = await next.post('/login/code').type('form').send({ _csrf: csrf, code: enableCode }).expect(302);
    expect(replay.headers.location).to.equal('/login/code');
    const ok = await next
      .post('/login/code')
      .type('form')
      .send({ _csrf: csrf, code: totp.codeAt(secret, totp.stepAt() + 1) })
      .expect(302);
    expect(ok.headers.location).to.equal('/finance');
    await next.get('/finance').expect(200);

    // Turning it off needs the password and a code.
    csrf = csrfOf((await next.get('/account')).text);
    await next
      .post('/account/2fa/disable')
      .type('form')
      .send({ _csrf: csrf, currentPassword: 'wrong-pass', code: totp.codeAt(secret) });
    expect((await User.findOne({ email: creds.email }).lean()).totp.secret).to.equal(secret);
    await next
      .post('/account/2fa/disable')
      .type('form')
      .send({ _csrf: csrf, currentPassword: creds.password, code: totp.codeAt(secret) });
    expect((await User.findOne({ email: creds.email }).lean()).totp).to.equal(undefined);
  });

  it('two-step codes match the RFC 6238 test vectors', () => {
    const { _hotp } = require('../config/totp');
    const key = Buffer.from('12345678901234567890');
    expect([59, 1111111109, 20000000000].map((s) => _hotp(key, Math.floor(s / 30), 8))).to.deep.equal(['94287082', '07081804', '65353130']);
  });

  it('deleting the account removes the user and their transactions', async () => {
    const agent = request.agent(app);
    let csrf = csrfOf((await agent.get('/login')).text);
    await agent.post('/login').type('form').send({ _csrf: csrf, email: 'ada@example.com', password: 'correct-horse' }).expect(302);
    const user = await User.findOne({ email: 'ada@example.com' });
    await Transaction.create({ user: user._id, date: new Date(), amount: -5, merchant: 'Cafe', category: 'DiningOut' });
    csrf = csrfOf((await agent.get('/account')).text);
    await agent.post('/account/delete').type('form').send({ _csrf: csrf }).expect(302);
    expect(await User.exists({ _id: user._id })).to.equal(null);
    expect(await Transaction.countDocuments({ user: user._id })).to.equal(0);
  });

  describe('Record tab (card-style bookkeeping)', () => {
    let agent;
    let csrf;
    let user;
    before(async () => {
      agent = request.agent(app);
      csrf = csrfOf((await agent.get('/signup')).text);
      await agent
        .post('/signup')
        .type('form')
        .send({ _csrf: csrf, email: 'rec@example.com', password: 'correct-horse', confirmPassword: 'correct-horse', currency: 'GBP' })
        .expect(302);
      user = await User.findOne({ email: 'rec@example.com' });
      csrf = csrfOf((await agent.get('/finance/record')).text);
    });
    const post = (body) =>
      agent
        .post('/finance/record')
        .type('form')
        .send({ _csrf: csrf, ...body })
        .expect(302);

    it('shows the category cards', async () => {
      const page = await agent.get('/finance/record').expect(200);
      expect(page.text).to.include('data-key="DiningOut"').and.include('data-key="Clothing"').and.include('data-key="Income"');
    });

    it('records spending as money out and income as money in', async () => {
      await post({ category: 'DiningOut', amount: '12.35', note: 'Mala hotpot' });
      await post({ category: 'Income', amount: '500' });
      const rows = await Transaction.find({ user: user._id }).sort({ amount: 1 }).lean();
      expect(rows.map((r) => [r.category, r.amount, r.merchant, r.source])).to.deep.equal([
        ['DiningOut', -12.35, 'Mala hotpot', 'manual'],
        ['Income', 500, 'Income', 'manual'],
      ]);
    });

    it('rejects bad amounts, unknown categories and future dates', async () => {
      const before = await Transaction.countDocuments({ user: user._id });
      await post({ category: 'DiningOut', amount: '0' });
      await post({ category: 'DiningOut', amount: '1.234' });
      await post({ category: 'DiningOut', amount: '-5' });
      await post({ category: 'Yachts', amount: '5' });
      await post({ category: 'DiningOut', amount: '5', date: '2099-01-01' });
      expect(await Transaction.countDocuments({ user: user._id })).to.equal(before);
    });

    it("deletes only the user's own manual entries", async () => {
      const mine = await Transaction.findOne({ user: user._id, category: 'DiningOut' });
      const imported = await Transaction.create({ user: user._id, date: new Date(), amount: -9, merchant: 'Bank feed', category: 'Shopping', source: 'bank' });
      const other = await Transaction.create({
        user: new mongoose.Types.ObjectId(),
        date: new Date(),
        amount: -3,
        merchant: 'X',
        category: 'Other',
        source: 'manual',
      });
      for (const t of [mine, imported, other]) await agent.post(`/finance/record/${t._id}/delete`).type('form').send({ _csrf: csrf }).expect(302);
      expect(await Transaction.exists({ _id: mine._id })).to.equal(null);
      expect(await Transaction.exists({ _id: imported._id })).to.not.equal(null);
      expect(await Transaction.exists({ _id: other._id })).to.not.equal(null);
    });

    describe('scan a receipt (Claude stubbed)', () => {
      const records = require('../controllers/records');
      const AgentAction = require('../models/AgentAction');
      const original = records.extractFromImage;
      const today = new Date().toISOString().slice(0, 10);
      before(() => {
        records.extractFromImage = async () => ({
          readable: true,
          currency: 'CNY',
          items: [
            { merchant: 'Tesco', amount: -12.345, direction: 'out', date: '2099-01-01', category: 'Groceries' },
            { merchant: 'Refund', amount: 5, direction: 'in', date: null, category: 'Shopping' },
            { merchant: 'Zero', amount: 0, direction: 'out', date: null, category: 'Other' },
            { merchant: 'Odd', amount: 3, direction: 'out', date: '2026-01-02', category: 'Yachts' },
          ],
        });
      });
      after(() => {
        records.extractFromImage = original;
      });
      const scan = (body) => agent.post('/finance/record/scan').set('X-CSRF-Token', csrf).send(body);

      it('returns cleaned rows for review and saves nothing', async () => {
        const before = await Transaction.countDocuments({ user: user._id });
        const res = await scan({ image: 'aGVsbG8=', mediaType: 'image/jpeg' }).expect(200);
        expect(res.body.currency).to.equal('CNY');
        expect(res.body.accountCurrency).to.equal('GBP');
        expect(res.body.items).to.deep.equal([
          { merchant: 'Tesco', amount: 12.35, category: 'Groceries', date: today },
          { merchant: 'Refund', amount: 5, category: 'Income', date: today },
          { merchant: 'Odd', amount: 3, category: 'Other', date: '2026-01-02' },
        ]);
        expect(await Transaction.countDocuments({ user: user._id })).to.equal(before);
        expect(await AgentAction.exists({ user: user._id, tool: 'scan_image' })).to.not.equal(null);
      });

      it('rejects non-images', async () => {
        await scan({ image: 'aGVsbG8=', mediaType: 'application/pdf' }).expect(400);
        await scan({ image: 'not base64!', mediaType: 'image/png' }).expect(400);
      });

      it('saves reviewed rows, all-or-nothing', async () => {
        const save = (items) => agent.post('/finance/record/scan/save').set('X-CSRF-Token', csrf).send({ items });
        const bad = await save([
          { merchant: 'Tesco', amount: '12.35', category: 'Groceries', date: today },
          { merchant: 'Oops', amount: '-1', category: 'Other', date: today },
        ]).expect(400);
        expect(bad.body.error).to.match(/Row 2/);
        expect(await Transaction.countDocuments({ user: user._id, source: 'scan' })).to.equal(0);
        await save([
          { merchant: 'Tesco', amount: '12.35', category: 'Groceries', date: today },
          { merchant: 'Refund', amount: '5', category: 'Income', date: today },
        ]).expect(200);
        const rows = await Transaction.find({ user: user._id, source: 'scan' }).sort({ amount: 1 }).lean();
        expect(rows.map((r) => [r.merchant, r.amount])).to.deep.equal([
          ['Tesco', -12.35],
          ['Refund', 5],
        ]);
      });

      it('scanned entries show in the searchable history and can be deleted', async () => {
        const page = await agent.get('/finance/record').expect(200);
        expect(page.text).to.include('Spending history').and.include('id="hist-search"').and.include('data-kind="scan"');
        const t = await Transaction.findOne({ user: user._id, source: 'scan' });
        await agent.post(`/finance/record/${t._id}/delete`).type('form').send({ _csrf: csrf }).expect(302).expect('Location', '/finance/record#history');
        expect(await Transaction.exists({ _id: t._id })).to.equal(null);
      });
    });

    it('Record cards show how much of each budget is used (budgets set on the Budgets tab)', async () => {
      const Budget = require('../models/Budget');
      await agent.post('/finance/budgets/all').type('form').send({ _csrf: csrf, b_Groceries: '50' }).expect(302);
      expect((await Budget.findOne({ user: user._id, category: 'Groceries' })).monthlyLimit).to.equal(50);
      await Transaction.create({ user: user._id, date: new Date(), amount: -20, merchant: 'Aldi', category: 'Groceries', source: 'manual' });
      const page = await agent.get('/finance/record').expect(200);
      expect(page.text).to.match(/rec-budget is-ok[\s\S]*?width: 40%/); // £20 of £50
      expect(page.text).to.not.include('rec-setbudget'); // no budget editing on the Record cards
      await agent.post('/finance/budgets/all').type('form').send({ _csrf: csrf }).expect(302); // all blank = no budgets
      expect(await Budget.countDocuments({ user: user._id })).to.equal(0);
    });
    it('"New chat" starts a new conversation and keeps the old one in History', async () => {
      const ChatThread = require('../models/ChatThread');
      await agent.get('/finance').expect(200); // creates the first thread
      await ChatThread.updateOne({ user: user._id }, { title: 'First conversation' });
      const res = await agent.post('/finance/reset').type('form').send({ _csrf: csrf }).expect(302);
      expect(res.headers.location).to.match(/^\/finance\?thread=/);
      const threads = await ChatThread.find({ user: user._id }).lean();
      expect(threads).to.have.length(2);
      const page = await agent.get(res.headers.location).expect(200);
      expect(page.text).to.include('First conversation'); // listed under History
      // pressing New chat again on an empty conversation does not pile up empty threads
      await agent.post('/finance/reset').type('form').send({ _csrf: csrf }).expect(302);
      expect(await ChatThread.countDocuments({ user: user._id })).to.equal(2);
    });

    it('renders in Chinese when the language cookie says so', async () => {
      const page = await agent.get('/finance/record').set('Cookie', 'lang=zh').expect(200);
      expect(page.text).to.include('<html class="h-100" lang="zh"').and.include('花了什么？').and.include('餐饮');
      const en = await request(app).get('/').set('Accept-Language', 'zh-CN,zh;q=0.9').expect(200);
      expect(en.text).to.include('开始使用'); // first visit follows the browser language
    });

    it('Budgets page: saves every category at once; blank removes; one bad amount saves nothing', async () => {
      const Budget = require('../models/Budget');
      const save = (fields) =>
        agent
          .post('/finance/budgets/all')
          .type('form')
          .send({ _csrf: csrf, ...fields })
          .expect(302);
      await save({ b_DiningOut: '260', b_Transport: '120.50', b_Groceries: '' });
      const set = await Budget.find({ user: user._id }).sort({ category: 1 }).lean();
      expect(set.map((b) => [b.category, b.monthlyLimit])).to.deep.equal([
        ['DiningOut', 260],
        ['Transport', 120.5],
      ]);
      await save({ b_DiningOut: '300', b_Transport: 'abc' }); // invalid -> nothing changes
      expect((await Budget.findOne({ user: user._id, category: 'DiningOut' })).monthlyLimit).to.equal(260);
      await save({ b_DiningOut: '260', b_Transport: '' }); // clearing a box removes that budget
      expect(await Budget.exists({ user: user._id, category: 'Transport' })).to.equal(null);
      const page = await agent.get('/finance/budgets').expect(200);
      expect(page.text).to.include('name="b_DiningOut"').and.include('value="260"').and.include('repeats every month');
      const zh = await agent.get('/finance/budgets').set('Cookie', 'lang=zh').expect(200);
      expect(zh.text).to.include('你的预算');
    });

    it('Insights: one pace chart and a category list compared with last month', async () => {
      const now = new Date();
      await Transaction.create([
        { user: user._id, date: new Date(now.getFullYear(), now.getMonth(), 1), amount: -50, merchant: 'Bistro', category: 'DiningOut' },
        { user: user._id, date: new Date(now.getFullYear(), now.getMonth() - 1, 1), amount: -20, merchant: 'Bistro', category: 'DiningOut' },
      ]);
      const page = await agent.get('/finance/bills').expect(200);
      expect(page.text).to.include('id="pace"').and.include('class="cat-rows"').and.include('more than this point in');
      expect(page.text).to.not.include('mixdonut');
    });

    it('Goals: create, add, cap take-outs at what is saved, protect from other users, delete', async () => {
      const SavingsGoal = require('../models/SavingsGoal');
      const future = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
      await agent.post('/finance/goals').type('form').send({ _csrf: csrf, name: 'Tokyo trip', target: '1500', deadline: future, start: '100' }).expect(302);
      const g = await SavingsGoal.findOne({ user: user._id, name: 'Tokyo trip' });
      expect(g.saved).to.equal(100);
      const add = (direction, amount) => agent.post(`/finance/goals/${g._id}/contribute`).type('form').send({ _csrf: csrf, direction, amount }).expect(302);
      await add('add', '400');
      await add('take', '9999'); // more than saved: refused
      await add('take', '50');
      expect((await SavingsGoal.findById(g._id)).saved).to.equal(450);
      const page = await agent.get('/finance/goals').expect(200);
      expect(page.text).to.include('Tokyo trip').and.include('class="jar"').and.include('data-pct="30"').and.include('a week');
      // only the jar money just went into animates: it knows its level before (6%) and what was added; once only
      expect(page.text).to.include('data-from="6"').and.include('data-added="+£400"');
      expect((await agent.get('/finance/goals').expect(200)).text).to.not.include('data-from');
      // invalid goals are rejected
      await agent.post('/finance/goals').type('form').send({ _csrf: csrf, name: 'Past', target: '10', deadline: '2020-01-01' }).expect(302);
      expect(await SavingsGoal.exists({ user: user._id, name: 'Past' })).to.equal(null);
      // another user's goal can't be touched
      const other = await SavingsGoal.create({ user: new mongoose.Types.ObjectId(), name: 'Not yours', target: 10, deadline: new Date(Date.now() + 864e5) });
      await agent.post(`/finance/goals/${other._id}/contribute`).type('form').send({ _csrf: csrf, direction: 'add', amount: '5' }).expect(302);
      await agent.post(`/finance/goals/${other._id}/delete`).type('form').send({ _csrf: csrf }).expect(302);
      expect((await SavingsGoal.findById(other._id)).saved).to.equal(0);
      await agent.post(`/finance/goals/${g._id}/delete`).type('form').send({ _csrf: csrf }).expect(302);
      expect(await SavingsGoal.exists({ _id: g._id })).to.equal(null);
    });
  });
});
