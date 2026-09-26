const mongoose = require('mongoose');

// A savings goal ("Tokyo trip, £1,500 by March"). The app never moves money: contributions are the user's own
// log of what they put aside (positive) or took back out (negative).
const savingsGoalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 60 },
    target: { type: Number, required: true, min: 0.01 },
    deadline: { type: Date, required: true },
    contributions: [
      {
        amount: { type: Number, required: true },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

savingsGoalSchema.virtual('saved').get(function saved() {
  return Math.round(this.contributions.reduce((a, c) => a + c.amount, 0) * 100) / 100;
});

savingsGoalSchema.index({ user: 1, deadline: 1 });

module.exports = mongoose.model('SavingsGoal', savingsGoalSchema);
