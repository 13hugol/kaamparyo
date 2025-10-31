const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const Category = require('../models/Category');
const Dispute = require('../models/Dispute');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { authMiddleware, getUser } = require('../utils/auth');
const payments = require('../services/payments');

// Middleware to check admin role
const adminOnly = (req, res, next) => {
  const user = getUser(req);
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Get all tasks with filters
router.get('/tasks', authMiddleware, adminOnly, async (req, res) => {
  const { status, limit = 50, skip = 0 } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const tasks = await Task.find(filter)
    .populate('requesterId', 'phone name')
    .populate('assignedTaskerId', 'phone name')
    .sort({ createdAt: -1 })
    .limit(Number(limit))
    .skip(Number(skip));

  res.json({ ok: true, tasks });
});

// Create or update category
router.post('/categories/:id', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { name, minPrice, maxPrice } = req.body;

  if (!name || minPrice === undefined || maxPrice === undefined) {
    return res.status(400).json({ error: 'name, minPrice, and maxPrice are required' });
  }

  const category = await Category.findByIdAndUpdate(
    id,
    { _id: id, name, minPrice, maxPrice },
    { upsert: true, new: true }
  );

  res.json({ ok: true, category });
});

// Get all categories
router.get('/categories', async (req, res) => {
  const categories = await Category.find();
  res.json({ ok: true, categories });
});

// Get all disputes
router.get('/disputes', authMiddleware, adminOnly, async (req, res) => {
  const disputes = await Dispute.find()
    .populate('taskId')
    .populate('raisedBy', 'phone name')
    .sort({ createdAt: -1 });

  res.json({ ok: true, disputes });
});

// Resolve dispute (with optional refund)
router.post('/disputes/:id/resolve', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { resolution, refund } = req.body;

  const dispute = await Dispute.findById(id).populate('taskId');
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  const user = getUser(req);
  dispute.status = 'resolved';
  dispute.resolution = resolution;
  dispute.resolvedBy = user._id;
  dispute.resolvedAt = new Date();
  await dispute.save();

  // If refund requested, process it
  if (refund && dispute.taskId.paymentIntentId) {
    const task = dispute.taskId;
    await payments.refundPayment(task.paymentIntentId);
    task.status = 'refunded';
    task.escrowHeld = false;
    await task.save();
  }

  res.json({ ok: true, dispute });
});

// Get platform stats
router.get('/stats', authMiddleware, adminOnly, async (req, res) => {
  const totalTasks = await Task.countDocuments();
  const completedTasks = await Task.countDocuments({ status: 'paid' });
  const totalUsers = await User.countDocuments();

  // Calculate GMV (sum of paid tasks)
  const gmvResult = await Task.aggregate([
    { $match: { status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$price' }, count: { $sum: 1 } } }
  ]);
  const gmv = gmvResult.length > 0 ? gmvResult[0].total : 0;

  const settings = await Settings.findById('global');

  res.json({
    ok: true,
    stats: {
      totalTasks,
      completedTasks,
      totalUsers,
      gmv,
      completionRate: totalTasks > 0 ? (completedTasks / totalTasks * 100).toFixed(2) : 0,
      platformFeePct: settings?.platformFeePct ?? (Number(process.env.PLATFORM_FEE_PCT) || 10)
    }
  });
});

// Settings endpoints
router.get('/settings', authMiddleware, adminOnly, async (req, res) => {
  const settings = await Settings.findById('global');
  res.json({ ok: true, settings: settings || { _id: 'global', platformFeePct: Number(process.env.PLATFORM_FEE_PCT) || 10 } });
});

router.put('/settings', authMiddleware, adminOnly, async (req, res) => {
  const { platformFeePct, defaultRadiusKm } = req.body;
  const updated = await Settings.findByIdAndUpdate(
    'global',
    { _id: 'global', ...(platformFeePct !== undefined ? { platformFeePct } : {}), ...(defaultRadiusKm !== undefined ? { defaultRadiusKm } : {}) },
    { upsert: true, new: true }
  );
  res.json({ ok: true, settings: updated });
});

module.exports = router;
