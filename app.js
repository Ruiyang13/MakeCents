const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const lusca = require('lusca');
const mongoose = require('mongoose');
const morgan = require('morgan');
const passport = require('passport');
const rateLimit = require('express-rate-limit');

// Real .env first (its values win), then .env.example fills gaps with local defaults.
for (const f of ['.env', '.env.example']) {
  try {
    process.loadEnvFile(path.join(__dirname, f));
  } catch {
    /* optional */
  }
}

const { flash } = require('./config/flash');
const i18n = require('./config/i18n');
const { isAuthenticated } = require('./config/passport');
const homeController = require('./controllers/home');
const userController = require('./controllers/user');
const financeController = require('./controllers/finance-agent');
const billsController = require('./controllers/bills');
const recordsController = require('./controllers/records');
const budgetsController = require('./controllers/budgets');
const goalsController = require('./controllers/goals');

const app = express();
const secure = (process.env.BASE_URL || '').startsWith('https');
const limit = (windowMin, max) => rateLimit({ windowMs: windowMin * 60 * 1000, max, standardHeaders: true, legacyHeaders: false });

app.locals.appName = process.env.APP_NAME || 'PlanSmart';
// English defaults for pages rendered before the i18n middleware (early errors); overridden per request.
Object.assign(app.locals, { lang: 'en', t: i18n.makeT('en'), cat: (k) => i18n.catName('en', k), dateLocale: 'en-GB', i18nClient: '{}' });
app.locals.v = Date.now().toString(36); // cache-buster for our own CSS/JS, changes on each restart
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');
app.set('trust proxy', secure ? 1 : 0);
app.disable('x-powered-by');

// Content-Security-Policy: scripts only from this site or inline blocks carrying this request's nonce
// (no inline event handlers, no eval). Styles allow inline style="" attributes used for bar widths and colours.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${res.locals.cspNonce}'`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; '),
  );
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});
if (require.main === module) app.use(morgan('dev')); // no request logs in tests
app.use(compression());
// Images for receipt scanning arrive as base64 JSON; only that route gets a large body limit.
const smallJson = express.json();
const imageJson = express.json({ limit: '8mb' });
app.use((req, res, next) => (req.path === '/finance/record/scan' ? imageJson : smallJson)(req, res, next));
app.use(express.urlencoded({ extended: false }));
app.use(limit(15, 300));
app.use(
  session({
    name: 'plansmart.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 14 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure },
    store: MongoStore.create({ clientPromise: mongoose.connection.asPromise().then((c) => c.getClient()) }),
  }),
);
app.use(passport.initialize());
app.use(passport.session());
app.use(flash);
app.use(i18n.middleware);
app.use(lusca.csrf());
app.use(lusca.xframe('SAMEORIGIN'));
app.use(lusca.nosniff());
app.use(lusca.referrerPolicy('same-origin'));
app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '4h' }));
app.use('/vendor/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist'), { maxAge: '7d' }));
app.use('/vendor/marked', express.static(path.join(__dirname, 'node_modules/marked/lib'), { maxAge: '7d' }));
app.use('/vendor/dompurify', express.static(path.join(__dirname, 'node_modules/dompurify/dist'), { maxAge: '7d' }));
app.use('/vendor/fontawesome', express.static(path.join(__dirname, 'node_modules/@fortawesome/fontawesome-free'), { maxAge: '7d' }));

app.get('/', homeController.index);
app.get('/login', userController.getLogin);
app.post('/login', limit(60, 20), userController.postLogin);
app.get('/login/code', userController.getLoginCode);
app.post('/login/code', limit(15, 10), userController.postLoginCode);
app.get('/logout', userController.logout);
app.get('/signup', userController.getSignup);
app.post('/signup', limit(60, 10), userController.postSignup);
app.get('/account', isAuthenticated, userController.getAccount);
app.post('/account/profile', isAuthenticated, userController.postUpdateProfile);
app.post('/account/password', isAuthenticated, userController.postUpdatePassword);
app.post('/account/delete', isAuthenticated, userController.postDeleteAccount);
app.post('/account/2fa/setup', isAuthenticated, userController.postTwoStepSetup);
app.post('/account/2fa/enable', isAuthenticated, limit(15, 10), userController.postTwoStepEnable);
app.post('/account/2fa/cancel', isAuthenticated, userController.postTwoStepCancel);
app.post('/account/2fa/disable', isAuthenticated, limit(15, 10), userController.postTwoStepDisable);

app.get('/finance', isAuthenticated, financeController.getFinanceAgent);
app.post('/finance/chat', isAuthenticated, limit(1, 10), financeController.postFinanceAgentChat);
app.post('/finance/reset', isAuthenticated, financeController.postFinanceAgentReset);
app.post('/finance/actions/:id/confirm', isAuthenticated, financeController.postFinanceActionConfirm);
app.post('/finance/actions/:id/reject', isAuthenticated, financeController.postFinanceActionReject);
app.get('/finance/audit', isAuthenticated, financeController.getFinanceAudit);
app.get('/finance/audit/export', isAuthenticated, financeController.getFinanceAuditExport);
app.get('/finance/bills', isAuthenticated, billsController.getBills);
app.post('/finance/fixed', isAuthenticated, billsController.postFixedCost);
app.get('/finance/record', isAuthenticated, recordsController.getRecord);
app.post('/finance/record', isAuthenticated, limit(1, 30), recordsController.postRecord);
app.get('/finance/budgets', isAuthenticated, budgetsController.getBudgets);
app.post('/finance/budgets/all', isAuthenticated, budgetsController.postBudgetsAll);
app.get('/finance/goals', isAuthenticated, goalsController.getGoals);
app.post('/finance/goals', isAuthenticated, goalsController.postGoal);
app.post('/finance/goals/:id/contribute', isAuthenticated, goalsController.postContribution);
app.post('/finance/goals/:id/delete', isAuthenticated, goalsController.postDeleteGoal);
app.post('/finance/record/:id/delete', isAuthenticated, recordsController.postDeleteRecord);
app.post('/finance/record/scan', isAuthenticated, limit(1, 10), recordsController.postScan);
app.post('/finance/record/scan/save', isAuthenticated, limit(1, 20), recordsController.postScanSave);
app.post('/finance/record/:id', isAuthenticated, limit(1, 30), recordsController.postUpdateRecord); // after /scan, which :id would catch

app.use((req, res) => res.status(404).render('error', { title: req.t('Not found'), message: req.t('That page does not exist.') }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const t = req.t || ((s) => s); // errors can happen before the i18n middleware runs
  if (err.code === 'EBADCSRFTOKEN' || /csrf/i.test(err.message)) {
    return res.status(403).render('error', { title: t('Session expired'), message: t('Your form expired. Go back, refresh and try again.') });
  }
  console.error(err);
  res.status(500).render('error', { title: t('Error'), message: t('Something went wrong.') });
});

if (require.main === module) {
  // .env.example's placeholder secret is fine on a laptop, never on a server: anyone could forge session cookies.
  if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me')) {
    console.error('Set SESSION_SECRET in .env before running in production.');
    process.exit(1);
  }
  mongoose.connect(process.env.MONGODB_URI).catch((err) => {
    console.error('MongoDB connection error. Is MongoDB running?', err.message);
    process.exit(1);
  });
  const port = process.env.PORT || 8080;
  app.listen(port, () => console.log(`${app.locals.appName} running on http://localhost:${port}`));
}

module.exports = app;
