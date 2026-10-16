const mongoose = require('mongoose');

// The user's correction to fixed-cost detection, one per merchant:
//  fixed: true  -> a fixed cost of `monthly` (added by hand, or a detected bill with its amount corrected)
//  fixed: false -> never treat this merchant as a fixed cost
const fixedCostSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    merchant: { type: String, required: true },
    key: { type: String, required: true }, // merchant, trimmed and lower-cased (how transactions are matched)
    fixed: { type: Boolean, required: true },
    monthly: { type: Number, min: 0 },
    category: String,
    day: { type: Number, min: 1, max: 31 }, // day of the month it's due (hand-added costs)
  },
  { timestamps: true },
);

fixedCostSchema.index({ user: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('FixedCost', fixedCostSchema);
