const mongoose = require('mongoose');
const { Schema } = mongoose;

const TaskSchema = new Schema({
  requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String },
  categoryId: { type: String, ref: 'Category' },
  categoryName: { type: String }, // for custom category label
  price: { type: Number, required: true }, // paisa (initial/final price)
  currency: { type: String, default: 'NPR' },
  durationMin: { type: Number, default: 0 }, // estimated duration (minutes)
  actualDuration: { type: Number }, // actual time spent (minutes)
  requiredSkills: [{ type: String }], // e.g., ['Plumbing', 'Delivery']
  biddingEnabled: { type: Boolean, default: false }, // allow counter-offers
  quickAccept: { type: Boolean, default: true }, // Insta-Task: first to accept wins (no bidding)
  allowedTier: { type: String, enum: ['all', 'pro'], default: 'all' }, // Filter by tasker tier
  professionalOnly: { type: Boolean, default: false }, // Only verified professionals can apply
  professionalBonus: { type: Number, default: 0 }, // Extra amount for professional mode (20% = 0.2)
  
  // Schedule for Later
  scheduledFor: { type: Date }, // Future date/time for task execution
  bidWindowEndsAt: { type: Date }, // When bidding closes for scheduled tasks
  isScheduled: { type: Boolean, default: false },
  
  // Recurring Tasks
  isRecurring: { type: Boolean, default: false },
  recurringConfig: {
    frequency: { type: String, enum: ['daily', 'weekly', 'biweekly', 'monthly'] },
    dayOfWeek: { type: Number, min: 0, max: 6 }, // 0=Sunday, 6=Saturday
    timeOfDay: { type: String }, // HH:MM format
    endDate: { type: Date }, // When to stop recurring
    nextOccurrence: { type: Date }
  },
  parentTaskId: { type: Schema.Types.ObjectId, ref: 'Task' }, // Links to original recurring task
  
  // Expense Tracking
  expenses: [{
    description: { type: String, required: true },
    amount: { type: Number, required: true }, // paisa
    receiptUrl: { type: String },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date }
  }],
  totalExpenses: { type: Number, default: 0 }, // paisa
  
  offers: [{
    taskerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    proposedPrice: { type: Number, required: true }, // paisa
    message: { type: String },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
  }],
  status: { type: String, enum: ['posted','accepted','in_progress','completed','paid','refunded','cancelled'], default: 'posted' },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [lng, lat]
  },
  radiusKm: { type: Number, default: 3 },
  assignedTaskerId: { type: Schema.Types.ObjectId, ref: 'User' },
  applicationCount: { type: Number, default: 0 }, // Track number of applications
  acceptedAt: Date,
  startedAt: Date,
  completedAt: Date,
  proofUrl: String,
  escrowHeld: { type: Boolean, default: true },
  paymentIntentId: String,
  createdAt: { type: Date, default: Date.now }
});

TaskSchema.index({ status: 1, createdAt: -1 });
TaskSchema.index({ location: '2dsphere' });
TaskSchema.index({ scheduledFor: 1, status: 1 });
TaskSchema.index({ isRecurring: 1, 'recurringConfig.nextOccurrence': 1 });

module.exports = mongoose.model('Task', TaskSchema);
