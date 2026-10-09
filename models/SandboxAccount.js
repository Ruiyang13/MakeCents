const mongoose = require('mongoose');

// Simulated current account the assistant may move money out of (to the user's own goals or detected bills).
// No real bank is involved. Opened lazily with a fixed starting balance; only the confirmed money-movement
// actions in controllers/finance-agent.js change it, each with an atomic balance check.
const START_BALANCE = 2500;

const sandboxAccountSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balance: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

sandboxAccountSchema.statics.START_BALANCE = START_BALANCE;
sandboxAccountSchema.statics.open = function open(userId) {
  return this.findOneAndUpdate({ user: userId }, { $setOnInsert: { balance: START_BALANCE } }, { upsert: true, returnDocument: 'after' }).lean();
};
// Takes money out only if it is there: one atomic update, so two confirmations can't overdraw it.
sandboxAccountSchema.statics.debit = async function debit(userId, amount) {
  await this.open(userId);
  const after = await this.findOneAndUpdate({ user: userId, balance: { $gte: amount } }, { $inc: { balance: -amount } }, { returnDocument: 'after' }).lean();
  if (!after) throw new Error('Not enough money in the sandbox account.');
  return { before: Math.round((after.balance + amount) * 100) / 100, after: Math.round(after.balance * 100) / 100 };
};

module.exports = mongoose.model('SandboxAccount', sandboxAccountSchema);
