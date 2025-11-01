const mongoose = require('mongoose');
const { Schema } = mongoose;

const ApplicationSchema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
  applicantId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'withdrawn'], 
    default: 'pending' 
  },
  proposedPrice: { type: Number }, // Optional: tasker can propose different price
  message: { type: String, maxlength: 500 }, // Why they're a good fit
  createdAt: { type: Date, default: Date.now },
  respondedAt: { type: Date } // When poster approved/rejected
});

// Index for quick lookups
ApplicationSchema.index({ taskId: 1, applicantId: 1 }, { unique: true });
ApplicationSchema.index({ taskId: 1, status: 1 });
ApplicationSchema.index({ applicantId: 1, status: 1 });

module.exports = mongoose.model('Application', ApplicationSchema);
