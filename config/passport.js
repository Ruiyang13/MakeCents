const passport = require('passport');
const { Strategy: LocalStrategy } = require('passport-local');
const User = require('../models/User');

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    done(null, await User.findById(id));
  } catch (error) {
    done(error);
  }
});

passport.use(
  new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = await User.findOne({ email: User.normalizeEmail(email) });
      // Same message for unknown email and wrong password: don't reveal which accounts exist.
      if (!user || !(await user.comparePassword(password))) return done(null, false, { msg: 'Invalid email or password.' });
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }),
);

exports.isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  if (req.method !== 'GET') return res.status(401).json({ error: req.t ? req.t('Not signed in.') : 'Not signed in.' });
  req.session.returnTo = req.originalUrl;
  req.flash('errors', { msg: 'Please sign in first.' });
  res.redirect('/login');
};
