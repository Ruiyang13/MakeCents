const passport = require('passport');
const validator = require('validator');
const QRCode = require('qrcode');
const User = require('../models/User');
const totp = require('../config/totp');
const { deleteUserFinanceAgentData } = require('./finance-agent');

const MIN_PASSWORD = 8;
// "GBP · British pound (£)", named in the page's language.
const currencyOptions = (lang) => {
  const names = new Intl.DisplayNames([lang === 'zh' ? 'zh-CN' : 'en-GB'], { type: 'currency' });
  const symbol = (code) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }).formatToParts(0).find((p) => p.type === 'currency').value;
  return User.CURRENCIES.map((code) => ({ code, label: `${code} · ${names.of(code)}${symbol(code) === code ? '' : ` (${symbol(code)})`}` }));
};
const pickCurrency = (c) => (User.CURRENCIES.includes(c) ? c : null);

// Only same-site relative paths, never "//evil.com".
const safeReturnTo = (url) => (typeof url === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(url) ? url : '/finance');

function logInAndRedirect(req, res, next, user) {
  const returnTo = safeReturnTo(req.session.returnTo);
  // passport regenerates the session id on login (session-fixation defence).
  req.logIn(user, (err) => {
    if (err) return next(err);
    res.redirect(returnTo);
  });
}

exports.getLogin = (req, res) => {
  if (req.user) return res.redirect('/finance');
  res.render('account/login', { title: 'Sign in', demoHint: process.env.NODE_ENV !== 'production' });
};

exports.postLogin = (req, res, next) => {
  if (!validator.isEmail(String(req.body.email || '')) || !req.body.password) {
    req.flash('errors', { msg: 'Enter your email and password.' });
    return res.redirect('/login');
  }
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('errors', info);
      return res.redirect('/login');
    }
    // Two-step sign-in: the password was right, but the session isn't signed in until the app code is too.
    if (user.totp?.secret) {
      req.session.twoStep = { id: user.id, at: Date.now(), tries: 0 };
      return res.redirect('/login/code');
    }
    logInAndRedirect(req, res, next, user);
  })(req, res, next);
};

const TWO_STEP_MS = 5 * 60 * 1000;
const MAX_CODE_TRIES = 5;
const twoStepPending = (req) => {
  const p = req.session.twoStep;
  return p && Date.now() - p.at < TWO_STEP_MS ? p : null;
};

exports.getLoginCode = (req, res) => {
  if (!twoStepPending(req)) return res.redirect('/login');
  res.render('account/login-code', { title: 'Two-step sign-in' });
};

exports.postLoginCode = async (req, res, next) => {
  const pending = twoStepPending(req);
  if (!pending) {
    delete req.session.twoStep;
    req.flash('errors', { msg: 'Sign-in timed out. Enter your password again.' });
    return res.redirect('/login');
  }
  try {
    const user = await User.findById(pending.id);
    if (!user || !(await User.useTotpCode(user._id, req.body.code))) {
      pending.tries += 1;
      if (pending.tries >= MAX_CODE_TRIES) {
        delete req.session.twoStep;
        req.flash('errors', { msg: 'Too many wrong codes. Enter your password again.' });
        return res.redirect('/login');
      }
      req.flash('errors', { msg: 'That code is wrong or already used. Enter the current code from your app.' });
      return res.redirect('/login/code');
    }
    delete req.session.twoStep;
    logInAndRedirect(req, res, next, user);
  } catch (error) {
    next(error);
  }
};

exports.logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect('/'));
  });
};

exports.getSignup = (req, res) => {
  if (req.user) return res.redirect('/finance');
  res.render('account/signup', { title: 'Create account', currencies: currencyOptions(req.lang) });
};

exports.postSignup = async (req, res, next) => {
  const { email, password, confirmPassword, name } = req.body;
  const errors = [];
  if (!validator.isEmail(String(email || ''))) errors.push({ msg: 'Enter a valid email address.' });
  if (!validator.isLength(String(password || ''), { min: MIN_PASSWORD, max: 128 }))
    errors.push({ msg: req.t('Password must be {min}-128 characters.', { min: MIN_PASSWORD }) });
  if (password !== confirmPassword) errors.push({ msg: 'Passwords do not match.' });
  if (!pickCurrency(req.body.currency)) errors.push({ msg: 'Choose a currency.' });
  if (errors.length) {
    errors.forEach((e) => req.flash('errors', e));
    return res.redirect('/signup');
  }
  try {
    const normalized = User.normalizeEmail(email);
    if (await User.exists({ email: normalized })) {
      req.flash('errors', { msg: 'An account with that email already exists.' });
      return res.redirect('/signup');
    }
    const user = await User.create({
      email: normalized,
      password,
      name: String(name || '')
        .trim()
        .slice(0, 80),
      currency: req.body.currency,
    });
    logInAndRedirect(req, res, next, user);
  } catch (error) {
    next(error);
  }
};

exports.getAccount = async (req, res, next) => {
  try {
    // While setting up two-step sign-in, the new secret waits in the session until a code proves the app has it.
    const setup = req.session.totpSetup;
    const qr = setup && (await QRCode.toString(totp.otpauthUrl(setup, req.user.email, res.locals.appName), { type: 'svg', margin: 1 }));
    res.render('account/profile', {
      title: 'Account',
      currencies: currencyOptions(req.lang),
      currency: await User.currencyOf(req.user._id),
      twoStepOn: Boolean(req.user.totp?.secret),
      setup: setup && { qr, key: setup.match(/.{1,4}/g).join(' ') },
    });
  } catch (error) {
    next(error);
  }
};

exports.postUpdateProfile = async (req, res, next) => {
  try {
    req.user.name = String(req.body.name || '')
      .trim()
      .slice(0, 80);
    req.user.currency = pickCurrency(req.body.currency) || req.user.currency;
    await req.user.save();
    req.flash('success', { msg: 'Profile updated.' });
    res.redirect('/account');
  } catch (error) {
    next(error);
  }
};

exports.postUpdatePassword = async (req, res, next) => {
  const { currentPassword, password, confirmPassword } = req.body;
  try {
    if (!(await req.user.comparePassword(String(currentPassword || '')))) {
      req.flash('errors', { msg: 'Current password is incorrect.' });
    } else if (!validator.isLength(String(password || ''), { min: MIN_PASSWORD, max: 128 })) {
      req.flash('errors', { msg: req.t('New password must be {min}-128 characters.', { min: MIN_PASSWORD }) });
    } else if (password !== confirmPassword) {
      req.flash('errors', { msg: 'New passwords do not match.' });
    } else {
      req.user.password = password;
      await req.user.save();
      req.flash('success', { msg: 'Password changed.' });
    }
    res.redirect('/account');
  } catch (error) {
    next(error);
  }
};

exports.postTwoStepSetup = (req, res) => {
  if (!req.user.totp?.secret) req.session.totpSetup = totp.newSecret();
  res.redirect('/account#two-step');
};

exports.postTwoStepEnable = async (req, res, next) => {
  try {
    const secret = req.session.totpSetup;
    const step = secret && totp.verify(secret, String(req.body.code || '').replace(/\s/g, ''));
    if (!step) {
      req.flash('errors', { msg: 'That code did not match. Check the time on your phone and try the current code.' });
    } else {
      req.user.totp = { secret, lastStep: step };
      await req.user.save();
      delete req.session.totpSetup;
      req.flash('success', { msg: 'Two-step sign-in is on. You will need a code from your app each time you sign in.' });
    }
    res.redirect('/account#two-step');
  } catch (error) {
    next(error);
  }
};

exports.postTwoStepCancel = (req, res) => {
  delete req.session.totpSetup;
  res.redirect('/account#two-step');
};

// Turning it off needs both the password and a current code, so a hijacked session alone can't remove it.
exports.postTwoStepDisable = async (req, res, next) => {
  try {
    const okPassword = await req.user.comparePassword(String(req.body.currentPassword || ''));
    const okCode = req.user.totp?.secret && totp.verify(req.user.totp.secret, String(req.body.code || '').replace(/\s/g, ''));
    if (!okPassword || !okCode) {
      req.flash('errors', { msg: 'Password or code is wrong. Two-step sign-in is still on.' });
    } else {
      req.user.totp = undefined;
      await req.user.save();
      req.flash('success', { msg: 'Two-step sign-in is off.' });
    }
    res.redirect('/account#two-step');
  } catch (error) {
    next(error);
  }
};

// Removes the account and every piece of financial data tied to it.
exports.postDeleteAccount = async (req, res, next) => {
  try {
    const userId = req.user._id;
    await deleteUserFinanceAgentData(userId);
    await User.deleteOne({ _id: userId });
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => res.redirect('/'));
    });
  } catch (error) {
    next(error);
  }
};
