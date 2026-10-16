const mongoose = require('mongoose');

// Money in/out for a user's account.
// amount: negative = money leaving (spend/bill), positive = money coming in (income/refund).
const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'GBP' },
    // money spent in another currency: what was actually paid, and the rate used to get `amount` (home currency)
    original: { amount: Number, currency: String, rate: Number },
    merchant: { type: String, required: true },
    description: String,
    category: { type: String, required: true },
    account: { type: String, default: 'current' }, // current | savings | credit
    pending: { type: Boolean, default: false },
    source: { type: String, default: 'seed' }, // seed | csv | manual | bank
  },
  { timestamps: true },
);

transactionSchema.index({ user: 1, date: -1 });
transactionSchema.index({ user: 1, category: 1, date: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
