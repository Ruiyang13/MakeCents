const mongoose = require('mongoose');

// Audit log of every finance-agent tool call, and the queue for write actions awaiting user confirmation.
// status: executed (read tool ran) | pending | confirmed | rejected | expired | error
const agentActionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tool: { type: String, required: true },
    tier: { type: String, enum: ['read', 'write', 'move'], required: true }, // move = sandbox money movement
    args: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['executed', 'pending', 'confirmed', 'rejected', 'expired', 'error'], required: true },
    result: mongoose.Schema.Types.Mixed,
    error: String,
    decidedAt: Date,
  },
  { timestamps: true },
);

agentActionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('AgentAction', agentActionSchema);
