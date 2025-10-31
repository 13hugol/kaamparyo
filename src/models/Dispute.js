const mongoose = require('mongoose');
const { Schema } = mongoose;

const DisputeSchema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
  raisedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, required: true },
  description: { type: String },
  status: { type: String, enum: ['pending','resolved','rejected'], default: 'pending' },
  resolution: { type: String },
  resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: Date,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Dispute', DisputeSchema);
