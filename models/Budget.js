const mongoose = require('mongoose');

// Monthly spending limit for one category. Only created via a user-confirmed agent action.
const budgetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, required: true },
    monthlyLimit: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

budgetSchema.index({ user: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('Budget', budgetSchema);
