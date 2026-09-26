const passport = require('passport');
const validator = require('validator');
const User = require('../models/User');
const { deleteUserFinanceAgentData } = require('./finance-agent');

const MIN_PASSWORD = 8;
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
    logInAndRedirect(req, res, next, user);
  })(req, res, next);
};

exports.logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect('/'));
  });
};

exports.getSignup = (req, res) => {
  if (req.user) return res.redirect('/finance');
  res.render('account/signup', { title: 'Create account' });
};

exports.postSignup = async (req, res, next) => {
  const { email, password, confirmPassword, name } = req.body;
  const errors = [];
  if (!validator.isEmail(String(email || ''))) errors.push({ msg: 'Enter a valid email address.' });
  if (!validator.isLength(String(password || ''), { min: MIN_PASSWORD, max: 128 }))
    errors.push({ msg: req.t('Password must be {min}-128 characters.', { min: MIN_PASSWORD }) });
  if (password !== confirmPassword) errors.push({ msg: 'Passwords do not match.' });
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
    });
    logInAndRedirect(req, res, next, user);
  } catch (error) {
    next(error);
  }
};

exports.getAccount = (req, res) => res.render('account/profile', { title: 'Account' });

exports.postUpdateProfile = async (req, res, next) => {
  try {
    req.user.name = String(req.body.name || '')
      .trim()
      .slice(0, 80);
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
