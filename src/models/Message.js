const mongoose = require('mongoose');
const { Schema } = mongoose;

const MessageSchema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
  from: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  to: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

MessageSchema.index({ taskId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', MessageSchema);