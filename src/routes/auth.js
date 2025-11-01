const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { generateToken, authMiddleware, getUser } = require('../utils/auth');

const otp = require('../services/otp');
const { sendTelegram } = require('../services/notify');

// Request OTP (send SMS/email)
router.post('/request-otp', async (req, res) => {
  const contact = String(req.body.phone || '').trim();
  if (!contact) return res.status(400).json({ error: 'Phone or Email required' });

  const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  const ttl = Number(process.env.OTP_EXPIRY_SECONDS || 300);
  otp.setOTP(contact, code, ttl);

  // In production, send via SMS provider or email. For dev/demo, log and optionally return.
  console.log(`OTP for ${contact}: ${code} (expires in ${ttl}s)`);
  // Try Telegram (optional)
  await sendTelegram(`OTP for ${contact}: <b>${code}</b>`);
  // Try Email (optional)
  if (contact.includes('@')) {
    const { sendMail } = require('../services/email');
    await sendMail(contact, 'Your KaamParyo OTP', `<p>Your OTP is <b>${code}</b>. It expires in ${ttl}s.</p>`);
  }
  const debug = process.env.DEBUG_OTP === 'true' || process.env.NODE_ENV !== 'production';
  res.json({ ok: true, message: 'OTP sent', ...(debug ? { debugOtp: code } : {}) });
});

// Verify OTP and login/register
router.post('/verify-otp', async (req, res) => {
  try {
  const contact = String(req.body.phone || '').trim();
  const otpCode = String(req.body.otp || '').trim();
  if (!contact || !otpCode) return res.status(400).json({ error: 'Phone/Email and OTP required' });

    const debug = process.env.DEBUG_OTP === 'true' || process.env.NODE_ENV !== 'production';
    const isSixDigits = /^\d{6}$/.test(otpCode);

    let valid = false;
    if (isSixDigits) valid = otp.verifyOTP(contact, otpCode);
    if (!valid && debug && isSixDigits) valid = true; // allow any 6 digits in dev/debug
    if (!valid) return res.status(401).json({ error: 'Invalid or expired OTP' });

    // Find or create user by phone or email
    const isEmail = contact.includes('@');
    let user = await User.findOne(isEmail ? { email: contact } : { phone: contact });
    if (!user) {
      user = await User.create(isEmail 
        ? { email: contact, emailVerified: true, role: 'user' } 
        : { phone: contact, phoneVerified: true, role: 'user' }
      );
    } else {
      // migrate legacy roles to unified 'user' (except admins)
      if (user.role && !['user','admin'].includes(user.role)) user.role = 'user';
      // Set verified flags
      if (isEmail) {
        user.emailVerified = true;
        if (!user.email) user.email = contact;
      } else {
        user.phoneVerified = true;
        if (!user.phone) user.phone = contact;
      }
      await user.save();
    }

    const token = generateToken(user);
    res.json({ ok: true, token, user: { _id: user._id, phone: user.phone, role: user.role, name: user.name } });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user profile
router.get('/me', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const fullUser = await User.findById(user._id).select('-__v');
  if (!fullUser) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ ok: true, user: fullUser });
});

// Update user profile
router.put('/me', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const { name, email, lat, lng, isOnline, profilePhoto, bio, languages, skills } = req.body;

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email;
  if (profilePhoto !== undefined) updates.profilePhoto = profilePhoto;
  if (bio !== undefined) updates.bio = String(bio).slice(0, 500); // max 500 chars
  if (Array.isArray(languages)) updates.languages = languages;
  if (Array.isArray(skills)) updates.skills = skills;
  if (lat !== undefined && lng !== undefined) {
    updates['location.coordinates'] = [lng, lat];
  }
  if (isOnline !== undefined) updates.isOnline = !!isOnline;

  const updated = await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true });
  res.json({ ok: true, user: updated });
});

// Submit KYC
router.post('/kyc', authMiddleware, async (req, res) => {
  try {
    const user = getUser(req);
    const { fullName, dateOfBirth, address, city, postalCode, idType, idNumber } = req.body;
    
    // Validation
    if (!fullName || !dateOfBirth || !address || !city || !idType || !idNumber) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }
    
    // Update user with KYC data
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      {
        kycCompleted: true, // Auto-approve for demo
        kycSubmittedAt: new Date(),
        kycData: {
          fullName,
          dateOfBirth: new Date(dateOfBirth),
          address,
          city,
          postalCode,
          idType,
          idNumber
        }
      },
      { new: true }
    );
    
    res.json({ ok: true, user: updatedUser });
  } catch (error) {
    console.error('KYC submission error:', error);
    res.status(500).json({ error: 'Failed to submit KYC' });
  }
});

module.exports = router;
