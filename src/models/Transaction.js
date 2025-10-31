const mongoose = require('mongoose');
const { Schema } = mongoose;

const TransactionSchema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
  amount: { type: Number, required: true }, // paisa
  platformFee: { type: Number, required: true },
  status: { type: String, enum: ['held','released','refunded'], required: true },
  providerRef: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', TransactionSchema);
