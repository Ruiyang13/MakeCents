const bcrypt = require('@node-rs/bcrypt');
const mongoose = require('mongoose');
const validator = require('validator');
const totp = require('../config/totp');

// Currencies a user can pick. Amounts are recorded and shown in it; nothing is converted.
const CURRENCIES = ['GBP', 'USD', 'EUR', 'CNY', 'HKD', 'JPY', 'KRW', 'SGD', 'MYR', 'INR', 'AUD', 'CAD', 'CHF', 'NGN', 'ZAR', 'BRL', 'MXN', 'AED'];

const userSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    name: { type: String, default: '' },
    currency: { type: String, enum: CURRENCIES },
    // Two-step sign-in: set once the user has proved their authenticator app works. lastStep blocks code replay.
    totp: { secret: String, lastStep: Number },
    aiConsentAt: Date, // when the user agreed to AI processing (sign-up notice)
  },
  { timestamps: true },
);

userSchema.pre('save', async function hashPassword() {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.verify(candidate, this.password);
};

userSchema.statics.normalizeEmail = (email) => validator.normalizeEmail(String(email || ''), { gmail_remove_dots: false }) || '';

userSchema.statics.CURRENCIES = CURRENCIES;
// The user's chosen currency; accounts from before the choice existed fall back to their latest transaction's.
userSchema.statics.currencyOf = async function currencyOf(userId) {
  const user = await this.findById(userId, 'currency').lean();
  if (user?.currency) return user.currency;
  const latest = await mongoose.model('Transaction').findOne({ user: userId }, 'currency').sort({ date: -1 }).lean();
  return latest?.currency || 'GBP';
};

// Accepts a current two-step code once: the time step is recorded atomically, so a code can't be replayed.
userSchema.statics.useTotpCode = async function useTotpCode(userId, code) {
  const user = await this.findById(userId, 'totp').lean();
  const step = user?.totp?.secret && totp.verify(user.totp.secret, String(code || '').replace(/\s/g, ''));
  if (!step) return false;
  const res = await this.updateOne({ _id: userId, $or: [{ 'totp.lastStep': { $lt: step } }, { 'totp.lastStep': null }] }, { $set: { 'totp.lastStep': step } });
  return res.modifiedCount === 1;
};

module.exports = mongoose.model('User', userSchema);
