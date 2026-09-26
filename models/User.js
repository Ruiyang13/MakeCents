const bcrypt = require('@node-rs/bcrypt');
const mongoose = require('mongoose');
const validator = require('validator');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    name: { type: String, default: '' },
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

module.exports = mongoose.model('User', userSchema);
