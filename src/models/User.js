const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
  phone: { type: String, unique: true, sparse: true },
  email: { type: String, unique: true, sparse: true },
  name: { type: String, default: '' },
  role: { type: String, enum: ['user','admin'], default: 'user' },
  profilePhoto: { type: String },
  phoneVerified: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  idVerified: { type: Boolean, default: false },
  idDocument: { type: String }, // uploaded ID photo
  idVerifiedAt: { type: Date },
  isProfessional: { type: Boolean, default: false }, // Verified professional tasker
  professionalVerifiedAt: { type: Date },
  professionalVerifiedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // Admin who verified
  
  // KYC Information
  kycCompleted: { type: Boolean, default: false },
  kycSubmittedAt: { type: Date },
  kycData: {
    fullName: { type: String },
    dateOfBirth: { type: Date },
    address: { type: String },
    city: { type: String },
    postalCode: { type: String },
    idType: { type: String, enum: ['citizenship', 'passport', 'license', 'voter_id'] },
    idNumber: { type: String },
    idFrontPhoto: { type: String }, // URL to uploaded front photo
    idBackPhoto: { type: String }, // URL to uploaded back photo
    selfiePhoto: { type: String } // URL to selfie with ID
  },
  
  bio: { type: String, maxlength: 500 },
  languages: [{ type: String }], // e.g., ['English', 'Nepali']
  skills: [{ type: String }], // e.g., ['Plumbing', 'Delivery', 'Cleaning']
  certificates: [{
    name: { type: String, required: true },
    organization: { type: String, required: true },
    issueDate: { type: Date },
    certificateId: { type: String }
  }],
  badges: [{ type: String }], // e.g., ['Top Performer', 'Fast Responder']
  tier: { type: String, enum: ['basic', 'standard', 'pro'], default: 'standard' }, // Service tier
  portfolio: [{
    title: { type: String, required: true },
    description: { type: String },
    imageUrl: { type: String, required: true },
    category: { type: String },
    completedAt: { type: Date, default: Date.now }
  }],
  loyaltyPoints: { type: Number, default: 0 }, // Earned from completed tasks
  taskPoints: { type: Number, default: 0 }, // Task Points for rewards (separate from loyalty)
  rewardsLevel: { type: String, enum: ['bronze', 'silver', 'gold', 'platinum'], default: 'bronze' },
  perks: [{
    type: { type: String }, // e.g., 'reduced_commission', 'priority_listing', 'top_badge'
    value: { type: Number }, // e.g., 5 (for 5% commission reduction)
    expiresAt: { type: Date }
  }],
  isOnline: { type: Boolean, default: false },
  ratingAvg: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
  // Dual-channel ratings
  ratingAvgAsCustomer: { type: Number, default: 0 },
  ratingCountAsCustomer: { type: Number, default: 0 },
  ratingAvgAsTasker: { type: Number, default: 0 },
  ratingCountAsTasker: { type: Number, default: 0 },
  blockedUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  wallet: {
    balance: { type: Number, default: 0 },   // paisa
    pending: { type: Number, default: 0 }
  },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [lng, lat]
  },
  createdAt: { type: Date, default: Date.now },
  cancelCount: { type: Number, default: 0 },
  cancelUpdatedAt: { type: Date }
});

UserSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', UserSchema);
