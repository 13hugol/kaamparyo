const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Task = require('../models/Task');
const { authMiddleware, getUser } = require('../utils/auth');

// Utility: mask phone number for privacy
function maskPhone(phone) {
  if (!phone) return '';
  const str = String(phone);
  if (str.length < 7) return '***';
  return str.slice(0, 3) + '***' + str.slice(-4);
}

// Get user by ID (mask phone for non-self)
router.get('/:id', authMiddleware, async (req, res) => {
  const currentUser = getUser(req);
  const user = await User.findById(req.params.id).select('-__v').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Mask phone if not viewing own profile
  if (currentUser._id !== req.params.id && user.phone) {
    user.phoneMasked = maskPhone(user.phone);
    delete user.phone;
  }
  if (currentUser._id !== req.params.id && user.email) {
    const [local, domain] = user.email.split('@');
    user.emailMasked = local[0] + '***@' + domain;
    delete user.email;
  }

  res.json({ ok: true, user });
});

// Get user's tasks (as requester)
router.get('/:id/tasks/requested', authMiddleware, async (req, res) => {
  const tasks = await Task.find({ requesterId: req.params.id })
    .populate('assignedTaskerId', 'name phone ratingAvg')
    .sort({ createdAt: -1 });

  res.json({ ok: true, tasks });
});

// Get user's tasks (as tasker)
router.get('/:id/tasks/assigned', authMiddleware, async (req, res) => {
  const tasks = await Task.find({ assignedTaskerId: req.params.id })
    .populate('requesterId', 'name phone')
    .sort({ createdAt: -1 });

  res.json({ ok: true, tasks });
});

// Get wallet balance
router.get('/:id/wallet', authMiddleware, async (req, res) => {
  const currentUser = getUser(req);
  if (currentUser._id !== req.params.id) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const user = await User.findById(req.params.id).select('wallet');
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({ ok: true, wallet: user.wallet });
});

// Personal metrics (no admin needed)
router.get('/:id/metrics', authMiddleware, async (req, res) => {
  const currentUser = getUser(req);
  if (currentUser._id !== req.params.id) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const userId = req.params.id;
  const Settings = require('../models/Settings');
  const settings = await Settings.findById('global');
  const feePct = settings?.platformFeePct ?? Number(process.env.PLATFORM_FEE_PCT) ?? 10;
  const feeRate = Number(feePct) / 100;

  // As poster
  const postedTotal = await Task.countDocuments({ requesterId: userId });
  const postedCompleted = await Task.countDocuments({ requesterId: userId, status: 'completed' });
  const postedPaidAgg = await Task.aggregate([
    { $match: { requesterId: new (require('mongoose').Types.ObjectId)(userId), status: 'paid' } },
    { $group: { _id: null, gmv: { $sum: '$price' }, count: { $sum: 1 } } }
  ]);
  const postedPaid = postedPaidAgg.length ? postedPaidAgg[0].count : 0;
  const postedGMV = postedPaidAgg.length ? postedPaidAgg[0].gmv : 0;
  const platformFeesFromMyTasks = Math.round(postedGMV * feeRate);

  // Platform fees pending from completed tasks
  const postedCompletedAgg = await Task.aggregate([
    { $match: { requesterId: new (require('mongoose').Types.ObjectId)(userId), status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$price' } } }
  ]);
  const platformFeesPending = postedCompletedAgg.length ? Math.round(postedCompletedAgg[0].total * feeRate) : 0;

  // As tasker
  const taskerAccepted = await Task.countDocuments({ assignedTaskerId: userId });
  const taskerCompleted = await Task.countDocuments({ assignedTaskerId: userId, status: { $in: ['completed','paid'] } });
  const taskerPaidAgg = await Task.aggregate([
    { $match: { assignedTaskerId: new (require('mongoose').Types.ObjectId)(userId), status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$price' } } }
  ]);
  const taskerGrossPaid = taskerPaidAgg.length ? taskerPaidAgg[0].total : 0;
  const taskerEarned = Math.round(taskerGrossPaid * (1 - feeRate));
  const feesFromMyEarnings = Math.round(taskerGrossPaid * feeRate);
  const taskerPendingAgg = await Task.aggregate([
    { $match: { assignedTaskerId: new (require('mongoose').Types.ObjectId)(userId), status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$price' } } }
  ]);
  const taskerPendingPayout = taskerPendingAgg.length ? Math.round(taskerPendingAgg[0].total * (1 - feeRate)) : 0;

  res.json({ ok: true, metrics: {
    postedTotal, postedCompleted, postedPaid, postedGMV, platformFeesFromMyTasks, platformFeesPending,
    taskerAccepted, taskerCompleted, taskerEarned, taskerPendingPayout,
    feesFromMyEarnings,
    feePct
  }});
});

// Upload ID document for verification
const multer = require('multer');
const path = require('path');

const idStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `id_${req.user._id}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const idUpload = multer({ 
  storage: idStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = /image\/.+|application\/pdf/.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only images or PDF files allowed'));
    }
  }
});

router.post('/me/id-document', authMiddleware, idUpload.single('idDocument'), async (req, res) => {
  const user = getUser(req);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  const docUrl = `/uploads/${req.file.filename}`;
  await User.findByIdAndUpdate(user._id, { 
    $set: { 
      idDocument: docUrl,
      idVerified: false // Manual review needed
    } 
  });
  
  res.json({ ok: true, message: 'ID document uploaded. Awaiting verification.', url: docUrl });
});

// Block a user
router.post('/:id/block', authMiddleware, async (req, res) => {
  const currentUser = getUser(req);
  const targetId = req.params.id;
  
  if (currentUser._id === targetId) {
    return res.status(400).json({ error: 'Cannot block yourself' });
  }
  
  await User.findByIdAndUpdate(currentUser._id, {
    $addToSet: { blockedUserIds: targetId }
  });
  
  res.json({ ok: true, message: 'User blocked' });
});

// Report a user (demo - just logs)
router.post('/:id/report', authMiddleware, async (req, res) => {
  const currentUser = getUser(req);
  const { reason } = req.body;
  
  console.log(`User ${currentUser._id} reported ${req.params.id}: ${reason}`);
  
  res.json({ ok: true, message: 'Report submitted' });
});

// ========== PORTFOLIO SYSTEM ==========

const portfolioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `portfolio_${req.user._id}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const portfolioUpload = multer({ 
  storage: portfolioStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = /image\/.+/.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed for portfolio'));
    }
  }
});

// Add portfolio item
router.post('/me/portfolio', authMiddleware, portfolioUpload.single('image'), async (req, res) => {
  const user = getUser(req);
  const { title, description, category } = req.body;
  
  if (!req.file) return res.status(400).json({ error: 'Image required' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });
  
  const imageUrl = `/uploads/${req.file.filename}`;
  
  await User.findByIdAndUpdate(user._id, {
    $push: {
      portfolio: {
        title: title.trim(),
        description: description || '',
        imageUrl,
        category: category || 'General',
        completedAt: new Date()
      }
    }
  });
  
  res.json({ ok: true, message: 'Portfolio item added', imageUrl });
});

// Delete portfolio item
router.delete('/me/portfolio/:itemId', authMiddleware, async (req, res) => {
  const user = getUser(req);
  
  await User.findByIdAndUpdate(user._id, {
    $pull: { portfolio: { _id: req.params.itemId } }
  });
  
  res.json({ ok: true, message: 'Portfolio item removed' });
});

// ========== LOYALTY POINTS SYSTEM ==========

// Redeem loyalty points for discount
router.post('/me/redeem-points', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const { points } = req.body;
  
  if (!points || points <= 0) {
    return res.status(400).json({ error: 'Invalid points amount' });
  }
  
  const currentUser = await User.findById(user._id).select('loyaltyPoints wallet');
  
  if (currentUser.loyaltyPoints < points) {
    return res.status(400).json({ error: 'Insufficient loyalty points' });
  }
  
  // Redemption rate: 100 points = 1 NPR (100 paisa)
  const discountAmount = Math.floor(points / 100) * 100; // Convert to paisa
  const pointsToDeduct = Math.floor(points / 100) * 100;
  
  if (discountAmount === 0) {
    return res.status(400).json({ error: 'Minimum 100 points required for redemption' });
  }
  
  // Add discount to wallet balance
  await User.findByIdAndUpdate(user._id, {
    $inc: { 
      loyaltyPoints: -pointsToDeduct,
      'wallet.balance': discountAmount
    }
  });
  
  res.json({ 
    ok: true, 
    message: 'Points redeemed successfully',
    pointsRedeemed: pointsToDeduct,
    creditedAmount: discountAmount,
    creditedNPR: (discountAmount / 100).toFixed(2)
  });
});

// Get loyalty points balance
router.get('/me/loyalty', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const currentUser = await User.findById(user._id).select('loyaltyPoints');
  
  res.json({ 
    ok: true, 
    loyaltyPoints: currentUser.loyaltyPoints,
    redeemableNPR: Math.floor(currentUser.loyaltyPoints / 100) // How much NPR can be redeemed
  });
});

module.exports = router;
