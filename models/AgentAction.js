const mongoose = require('mongoose');

// Operation log: every finance-agent tool call, every change the user makes on the app's own forms (tier 'user'),
// and the queue for agent proposals awaiting user confirmation.
// status: executed (read tool ran / user action done) | pending | confirmed | rejected | expired | error
//         | refused (a proposal that broke a rule: never shown to the user, never run)
const agentActionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tool: { type: String, required: true },
    tier: { type: String, enum: ['read', 'write', 'user'], required: true }, // user = the user's own form action
    args: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['executed', 'pending', 'confirmed', 'rejected', 'expired', 'error', 'refused'], required: true },
    result: mongoose.Schema.Types.Mixed,
    error: String,
    warning: mongoose.Schema.Types.Mixed, // { overBudget: { category, spent, limit } }: shown on the proposal, never blocking
    decidedAt: Date,
  },
  { timestamps: true },
);

agentActionSchema.index({ user: 1, createdAt: -1 });

// A change the user made directly (Record, Budgets, Goals, Account forms).
agentActionSchema.statics.logUser = function logUser(userId, tool, args = {}, result) {
  return this.create({ user: userId, tool, tier: 'user', args, status: 'executed', result });
};

module.exports = mongoose.model('AgentAction', agentActionSchema);
