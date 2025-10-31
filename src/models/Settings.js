const mongoose = require('mongoose');
const { Schema } = mongoose;

const SettingsSchema = new Schema({
  _id: { type: String, default: 'global' },
  platformFeePct: { type: Number, default: 10 },
  defaultRadiusKm: { type: Number, default: 3 }
});

module.exports = mongoose.model('Settings', SettingsSchema);