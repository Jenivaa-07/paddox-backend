/* ============================================================
   FILE: models/Counter.js
   PADDOX — Atomic sequence counter for order numbers
   ============================================================ */

const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  seq: {
    type: Number,
    default: 0,
    min: 0
  }
}, { timestamps: true });

module.exports =
  mongoose.models.Counter ||
  mongoose.model('Counter', counterSchema);
