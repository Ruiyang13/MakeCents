const mongoose = require('mongoose');

// One conversation with the assistant. Messages live in the LangGraph checkpointer under `threadId`;
// this document is the index that lets "New chat" start fresh without deleting older conversations.
const chatThreadSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    threadId: { type: String, required: true, unique: true },
    title: { type: String, default: '' }, // first message, trimmed
  },
  { timestamps: true },
);

chatThreadSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model('ChatThread', chatThreadSchema);
