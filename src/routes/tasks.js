const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const Review = require('../models/Review');
const Message = require('../models/Message');
const Settings = require('../models/Settings');
const { authMiddleware, getUser } = require('../utils/auth');
const payments = require('../services/payments');

// Create task + authorize payment
router.post('/', authMiddleware, async (req, res) => {
  const user = getUser(req);

  const { title, description, categoryId, categoryName, price, lat, lng, radiusKm, durationMin, requiredSkills, biddingEnabled, quickAccept, allowedTier, scheduledFor, bidWindowHours, isRecurring, recurringConfig } = req.body;

  let category = null;
  if (categoryId !== 'custom') {
    category = await Category.findById(categoryId);
    if (!category) return res.status(400).json({ error: 'Invalid category' });
    if (price < category.minPrice || price > category.maxPrice) {
      return res.status(400).json({ error: `Price must be between ${category.minPrice} and ${category.maxPrice}` });
    }
  } else {
    if (!categoryName || !String(categoryName).trim()) {
      return res.status(400).json({ error: 'Custom category name required' });
    }
  }

  // Handle scheduled tasks
  let isScheduled = false;
  let scheduledDate = null;
  let bidWindowEndsAt = null;
  
  if (scheduledFor) {
    scheduledDate = new Date(scheduledFor);
    if (scheduledDate <= new Date()) {
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }
    isScheduled = true;
    
    // Calculate bid window end time (default 2 hours before scheduled time)
    const hoursBeforeTask = Number(bidWindowHours) || 2;
    bidWindowEndsAt = new Date(scheduledDate.getTime() - hoursBeforeTask * 60 * 60 * 1000);
  }

  // Handle recurring tasks
  let recurringData = null;
  if (isRecurring && recurringConfig) {
    const { frequency, dayOfWeek, timeOfDay, endDate } = recurringConfig;
    if (!frequency || !timeOfDay) {
      return res.status(400).json({ error: 'Recurring tasks require frequency and time' });
    }
    
    // Calculate next occurrence
    const nextOccurrence = calculateNextOccurrence(frequency, dayOfWeek, timeOfDay);
    
    recurringData = {
      frequency,
      dayOfWeek: dayOfWeek !== undefined ? Number(dayOfWeek) : undefined,
      timeOfDay,
      endDate: endDate ? new Date(endDate) : undefined,
      nextOccurrence
    };
  }

  // create Stripe PaymentIntent (manual capture)
  const paymentIntent = await payments.createPaymentIntent({ amount: price, currency: 'npr', metadata: { requesterId: user._id } });

  const task = await Task.create({
    requesterId: user._id,
    title,
    description,
    categoryId,
    categoryName: categoryId === 'custom' ? categoryName : undefined,
    price,
    durationMin: Number(durationMin) || 0,
    requiredSkills: Array.isArray(requiredSkills) ? requiredSkills : [],
    biddingEnabled: biddingEnabled === true || biddingEnabled === 'true',
    quickAccept: quickAccept !== false && quickAccept !== 'false', // Default true (Insta-Task)
    allowedTier: allowedTier || 'all',
    location: { type: 'Point', coordinates: [lng, lat] },
    radiusKm: radiusKm || parseInt(process.env.DEFAULT_RADIUS_KM || '3'),
    paymentIntentId: paymentIntent.id,
    escrowHeld: true,
    status: 'posted',
    isScheduled,
    scheduledFor: scheduledDate,
    bidWindowEndsAt,
    isRecurring: isRecurring === true || isRecurring === 'true',
    recurringConfig: recurringData
  });

  // record transaction as held
  await Transaction.create({ taskId: task._id, amount: price, platformFee: Math.round((Number(process.env.PLATFORM_FEE_PCT) / 100) * price), status: 'held', providerRef: paymentIntent.id });

  // broadcast to taskers (simple approach: emit to all; client filters)
  const io = req.app.get('io');
  io.emit('task_posted', {
    id: task._id,
    title: task.title,
    price: task.price,
    lat,
    lng,
    categoryId: task.categoryId,
    categoryName: task.categoryName,
    isScheduled,
    scheduledFor: scheduledDate,
    bidWindowEndsAt
  });

  return res.json({ ok: true, taskId: task._id, paymentIntentId: paymentIntent.id, isScheduled, scheduledFor: scheduledDate });
});

// Helper function to calculate next occurrence for recurring tasks
function calculateNextOccurrence(frequency, dayOfWeek, timeOfDay) {
  const now = new Date();
  const [hours, minutes] = timeOfDay.split(':').map(Number);
  
  let next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  
  switch (frequency) {
    case 'daily':
      if (next <= now) next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + ((7 + dayOfWeek - next.getDay()) % 7));
      if (next <= now) next.setDate(next.getDate() + 7);
      break;
    case 'biweekly':
      next.setDate(next.getDate() + ((7 + dayOfWeek - next.getDay()) % 7));
      if (next <= now) next.setDate(next.getDate() + 14);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      if (next <= now) next.setMonth(next.getMonth() + 1);
      break;
  }
  
  return next;
}

// Get nearby posted tasks (exclude own tasks, filter by tier)
router.get('/nearby', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const User = require('../models/User');
  const currentUser = await User.findById(user._id).select('tier');
  
  const { lat, lng, radiusKm } = req.query;
  const meters = (radiusKm ? Number(radiusKm) : Number(process.env.DEFAULT_RADIUS_KM || 3)) * 1000;
  
  // Filter: show 'all' tasks to everyone, 'pro' tasks only to pro taskers
  const tierFilter = currentUser.tier === 'pro' 
    ? { allowedTier: { $in: ['all', 'pro'] } }
    : { allowedTier: 'all' };
  
  const tasks = await Task.find({
    status: 'posted',
    requesterId: { $ne: user._id },
    ...tierFilter,
    location: {
      $nearSphere: {
        $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
        $maxDistance: meters
      }
    }
  }).limit(50);
  res.json({ tasks });
});

// Accept task (atomic) - handles both quickAccept and bidding
router.post('/:id/accept', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const User = require('../models/User');
  const tasker = await User.findById(user._id).select('tier');
  
  // Prevent accepting own tasks
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.requesterId.toString() === user._id.toString()) {
    return res.status(403).json({ error: 'Cannot accept your own task' });
  }
  
  // Check tier eligibility
  if (task.allowedTier === 'pro' && tasker.tier !== 'pro') {
    return res.status(403).json({ error: 'This task is only available to Pro taskers' });
  }
  
  // If bidding enabled and not quickAccept, require offer first
  if (task.biddingEnabled && !task.quickAccept) {
    return res.status(400).json({ error: 'Please submit an offer first. This task requires bidding.' });
  }

  const taskId = req.params.id;
  // atomic findOneAndUpdate: only set if still posted
  const updated = await Task.findOneAndUpdate(
    { _id: taskId, status: 'posted' },
    { $set: { status: 'accepted', assignedTaskerId: user._id, acceptedAt: new Date() } },
    { new: true }
  );

  if (!updated) return res.status(409).json({ error: 'Task already assigned or not available' });

  // notify clients
  const io = req.app.get('io');
  io.emit('task_assigned', { taskId, assignedTaskerId: user._id });

  res.json({ ok: true, task: updated });
});

// Complete task (tasker uploads proof first via S3 presigned URL or multipart)
router.post('/:id/complete', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const { proofUrl } = req.body;
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.assignedTaskerId || task.assignedTaskerId.toString() !== user._id.toString()) return res.status(403).json({ error: 'Not assigned to you' });

  task.proofUrl = proofUrl;
  task.status = 'completed';
  task.completedAt = new Date();
  await task.save();

  // notify requester
  const io = req.app.get('io');
  io.emit('task_completed', { taskId: task._id });

  res.json({ ok: true, task });
});

// Mark task started (tasker)
router.post('/:id/start', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.assignedTaskerId || task.assignedTaskerId.toString() !== user._id.toString()) return res.status(403).json({ error: 'Not assigned to you' });
  if (task.status !== 'accepted') return res.status(400).json({ error: 'Task not in accepted state' });
  task.status = 'in_progress';
  task.startedAt = new Date();
  await task.save();
  const io = req.app.get('io');
  io.emit('task_started', { taskId: task._id });
  res.json({ ok: true, task });
});

// Approve and capture funds (requester)
router.post('/:id/approve', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.requesterId.toString() !== user._id.toString()) return res.status(403).json({ error: 'Not your task' });
  if (task.status !== 'completed') return res.status(400).json({ error: 'Task not in completed state' });

  // capture payment via stripe (mock)
  const captureResult = await payments.capturePaymentIntent(task.paymentIntentId);

  // determine platform fee from settings
  const settings = await Settings.findById('global');
  const feePct = settings?.platformFeePct ?? Number(process.env.PLATFORM_FEE_PCT) ?? 10;
  const platformFee = Math.round((Number(feePct) / 100) * task.price);
  const payout = task.price - platformFee;

  // credit to tasker wallet (atomic update)
  const User = require('../models/User');
  await User.findByIdAndUpdate(task.assignedTaskerId, { $inc: { 'wallet.balance': payout } });
  
  // Award loyalty points to both requester and tasker (10% of price in paisa as points)
  const loyaltyPointsEarned = Math.round(task.price * 0.10); // 10% of task price
  await User.findByIdAndUpdate(task.requesterId, { $inc: { loyaltyPoints: loyaltyPointsEarned, taskPoints: loyaltyPointsEarned } });
  await User.findByIdAndUpdate(task.assignedTaskerId, { $inc: { loyaltyPoints: loyaltyPointsEarned, taskPoints: loyaltyPointsEarned } });
  
  // Check and update rewards level for tasker
  const taskerUser = await User.findById(task.assignedTaskerId).select('taskPoints rewardsLevel');
  const newLevel = calculateRewardsLevel(taskerUser.taskPoints);
  if (newLevel !== taskerUser.rewardsLevel) {
    taskerUser.rewardsLevel = newLevel;
    await taskerUser.save();
    // Award perks based on level
    await awardLevelPerks(task.assignedTaskerId, newLevel);
  }

  // update transaction and task
  await Transaction.findOneAndUpdate({ taskId: task._id }, { $set: { status: 'released', providerRef: captureResult.id } });
  task.status = 'paid';
  task.escrowHeld = false;
  await task.save();

  // notify parties
  const io = req.app.get('io');
  io.emit('task_paid', { taskId: task._id, taskerId: task.assignedTaskerId });

  res.json({ ok: true });
});

// Reject task (tasker-triggered refund)
router.post('/:id/reject', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.assignedTaskerId || task.assignedTaskerId.toString() !== user._id.toString()) {
    return res.status(403).json({ error: 'Not assigned to you' });
  }
  if (!['accepted','in_progress'].includes(task.status)) {
    return res.status(400).json({ error: 'Cannot reject in this state' });
  }

  try { if (task.paymentIntentId) await payments.refundPayment(task.paymentIntentId); } catch {}
  await Transaction.findOneAndUpdate({ taskId: task._id }, { $set: { status: 'refunded' } });
  task.status = 'cancelled';
  task.escrowHeld = false;
  await task.save();
  const io = req.app.get('io');
  io.emit('task_cancelled', { taskId: task._id });
  res.json({ ok: true });
});

// Chat: list messages for task (both parties)
router.get('/:id/messages', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const isParty = task.requesterId.toString() === user._id.toString() || (task.assignedTaskerId && task.assignedTaskerId.toString() === user._id.toString());
  if (!isParty) return res.status(403).json({ error: 'Not part of this task' });
  const messages = await Message.find({ taskId: task._id }).sort({ createdAt: 1 });
  res.json({ ok: true, messages });
});

// Chat: send message
router.post('/:id/messages', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text required' });
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const isParty = task.requesterId.toString() === user._id.toString() || (task.assignedTaskerId && task.assignedTaskerId.toString() === user._id.toString());
  if (!isParty) return res.status(403).json({ error: 'Not part of this task' });
  const to = task.requesterId.toString() === user._id.toString() ? task.assignedTaskerId : task.requesterId;
  const msg = await Message.create({ taskId: task._id, from: user._id, to, text: text.trim() });
  const io = req.app.get('io');
  io.emit('message', { taskId: task._id, from: user._id, text: msg.text, createdAt: msg.createdAt });
  res.json({ ok: true, message: msg });
});

// Reviews: submit rating (either party, once)
router.post('/:id/review', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating 1-5 required' });
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'paid') return res.status(400).json({ error: 'Can review only after payment' });
  const isRequester = task.requesterId.toString() === user._id.toString();
  const isTasker = task.assignedTaskerId && task.assignedTaskerId.toString() === user._id.toString();
  if (!isRequester && !isTasker) return res.status(403).json({ error: 'Not part of this task' });
  const revieweeId = isRequester ? task.assignedTaskerId : task.requesterId;

  const existing = await Review.findOne({ taskId: task._id, reviewerId: user._id });
  if (existing) return res.status(409).json({ error: 'Already reviewed' });

  const review = await Review.create({ taskId: task._id, reviewerId: user._id, revieweeId, rating, comment });

  // update reviewee aggregates
  const User = require('../models/User');
  const rUser = await User.findById(revieweeId).select('ratingAvg ratingCount');
  const newCount = (rUser.ratingCount || 0) + 1;
  const newAvg = ((rUser.ratingAvg || 0) * (rUser.ratingCount || 0) + rating) / newCount;
  rUser.ratingAvg = Math.round(newAvg * 10) / 10;
  rUser.ratingCount = newCount;
  await rUser.save();

  res.json({ ok: true, review });
});

// Upload proof image directly
const multer = require('multer');
const path = require('path');
const { s3 } = require('../services/notify');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `proof_${req.params.id}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit for images/videos
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|webm|mov/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = /image\/.+|video\/.+/.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image/video files are allowed'));
    }
  }
});

// Presigned upload URL (compat with README; returns local upload endpoint)
router.get('/:id/upload-url', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.assignedTaskerId || task.assignedTaskerId.toString() !== user._id.toString()) {
    return res.status(403).json({ error: 'Not assigned to you' });
  }

  // Return a local upload endpoint to use with FormData (acts as a presigned URL substitute)
  return res.json({ ok: true, uploadUrl: `/tasks/${req.params.id}/upload-proof`, method: 'POST', fields: null });
});

// Upload proof directly (FREE local storage)
router.post('/:id/upload-proof', authMiddleware, upload.single('proof'), async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id);
  
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.assignedTaskerId || task.assignedTaskerId.toString() !== user._id.toString()) {
    return res.status(403).json({ error: 'Not assigned to you' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const proofUrl = `/uploads/${req.file.filename}`;
  
  task.proofUrl = proofUrl;
  task.status = 'completed';
  task.completedAt = new Date();
  // Calculate actual duration
  if (task.startedAt) {
    task.actualDuration = Math.round((task.completedAt - task.startedAt) / 60000); // minutes
  }
  await task.save();

  // notify requester
  const io = req.app.get('io');
  io.emit('task_completed', { taskId: task._id });

  res.json({ ok: true, task, proofUrl });
});

// Delete or cancel task (requester)
router.delete('/:id', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.requesterId.toString() !== user._id.toString()) return res.status(403).json({ error: 'Not your task' });

  if (task.status === 'posted') {
    // safe to delete; optionally refund any held intent
    try { if (task.paymentIntentId) await payments.refundPayment(task.paymentIntentId); } catch {}
    await Transaction.deleteMany({ taskId: task._id });
    await Task.deleteOne({ _id: task._id });
    const io = req.app.get('io');
    io.emit('task_cancelled', { taskId: task._id, deleted: true });
    return res.json({ ok: true, deleted: true });
  }

  if (['accepted','in_progress'].includes(task.status)) {
    // refund and repost
    try { if (task.paymentIntentId) await payments.refundPayment(task.paymentIntentId); } catch {}
    await Transaction.findOneAndUpdate({ taskId: task._id }, { $set: { status: 'refunded' } });
    task.status = 'posted';
    task.escrowHeld = false;
    task.assignedTaskerId = undefined;
    task.acceptedAt = undefined;
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.paymentIntentId = undefined;
    await task.save();
    const io = req.app.get('io');
    io.emit('task_cancelled', { taskId: task._id, reposted: true });
    io.emit('task_posted', { id: task._id, title: task.title, price: task.price, lat: task.location.coordinates[1], lng: task.location.coordinates[0], categoryId: task.categoryId });
    return res.json({ ok: true, reposted: true });
  }

  if (['completed','paid','refunded','cancelled'].includes(task.status)) {
    await Transaction.deleteMany({ taskId: task._id });
    await Task.deleteOne({ _id: task._id });
    const io = req.app.get('io');
    io.emit('task_cancelled', { taskId: task._id, deleted: true });
    return res.json({ ok: true, deleted: true });
  }

  return res.status(400).json({ error: 'Cannot delete task in this state' });
});

// Edit task (requester)
router.put('/:id', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.requesterId.toString() !== user._id.toString()) return res.status(403).json({ error: 'Not your task' });
  if (task.status !== 'posted') return res.status(400).json({ error: 'Can only edit tasks in posted state' });

  const { title, description, price, durationMin, radiusKm } = req.body;
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (price !== undefined) updates.price = Number(price);
  if (durationMin !== undefined) updates.durationMin = Number(durationMin);
  if (radiusKm !== undefined) updates.radiusKm = Number(radiusKm);
  
  const updated = await Task.findByIdAndUpdate(task._id, { $set: updates }, { new: true });
  return res.json({ ok: true, task: updated });
});

// ========== EXPENSE TRACKING ==========

// Submit expense (tasker)
router.post('/:id/expense', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const { description, amount } = req.body;
  
  if (!description || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Description and valid amount required' });
  }
  
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.assignedTaskerId || task.assignedTaskerId.toString() !== user._id.toString()) {
    return res.status(403).json({ error: 'Not assigned to you' });
  }
  if (!['in_progress', 'completed'].includes(task.status)) {
    return res.status(400).json({ error: 'Can only add expenses during task execution' });
  }
  
  task.expenses.push({
    description,
    amount: Number(amount),
    status: 'pending',
    submittedAt: new Date()
  });
  
  await task.save();
  
  // Notify requester
  const io = req.app.get('io');
  io.to(task.requesterId.toString()).emit('expense_submitted', {
    taskId: task._id,
    expense: { description, amount }
  });
  
  res.json({ ok: true, message: 'Expense submitted for approval' });
});

// Upload expense receipt
router.post('/:id/expense/:expenseId/receipt', authMiddleware, upload.single('receipt'), async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id);
  
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.assignedTaskerId || task.assignedTaskerId.toString() !== user._id.toString()) {
    return res.status(403).json({ error: 'Not assigned to you' });
  }
  
  if (!req.file) return res.status(400).json({ error: 'No receipt uploaded' });
  
  const expense = task.expenses.id(req.params.expenseId);
  if (!expense) return res.status(404).json({ error: 'Expense not found' });
  
  expense.receiptUrl = `/uploads/${req.file.filename}`;
  await task.save();
  
  res.json({ ok: true, receiptUrl: expense.receiptUrl });
});

// Approve/reject expense (requester)
router.post('/:id/expense/:expenseId/review', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const { approved } = req.body;
  
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.requesterId.toString() !== user._id.toString()) {
    return res.status(403).json({ error: 'Not your task' });
  }
  
  const expense = task.expenses.id(req.params.expenseId);
  if (!expense) return res.status(404).json({ error: 'Expense not found' });
  
  expense.status = approved ? 'approved' : 'rejected';
  expense.reviewedAt = new Date();
  
  if (approved) {
    task.totalExpenses = (task.totalExpenses || 0) + expense.amount;
  }
  
  await task.save();
  
  // Notify tasker
  const io = req.app.get('io');
  io.to(task.assignedTaskerId.toString()).emit('expense_reviewed', {
    taskId: task._id,
    expenseId: expense._id,
    approved
  });
  
  res.json({ ok: true, expense });
});

// Get single task with full details (for tracking)
router.get('/:id', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id)
    .populate('requesterId', 'name phone email profilePhoto ratingAvg ratingCount phoneVerified emailVerified')
    .populate('assignedTaskerId', 'name phone email profilePhoto ratingAvg ratingCount phoneVerified emailVerified');
  
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  const isParty = task.requesterId._id.toString() === user._id.toString() || 
                  (task.assignedTaskerId && task.assignedTaskerId._id.toString() === user._id.toString());
  
  if (!isParty && user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to view this task' });
  }
  
  res.json({ ok: true, task });
});

// Get task expenses
router.get('/:id/expenses', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id);
  
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  const isParty = task.requesterId.toString() === user._id.toString() || 
                  (task.assignedTaskerId && task.assignedTaskerId.toString() === user._id.toString());
  
  if (!isParty) return res.status(403).json({ error: 'Not part of this task' });
  
  res.json({ ok: true, expenses: task.expenses, totalExpenses: task.totalExpenses || 0 });
});

// ========== DEMAND HOT ZONES ==========

// Get demand hot zones (aggregated task density by location)
router.get('/heatmap/demand', authMiddleware, async (req, res) => {
  try {
    const { lat, lng, radiusKm } = req.query;
    const radius = Number(radiusKm) || 10;
    const meters = radius * 1000;
    
    // Aggregate tasks by location grid (0.01 degree ~1km grid)
    const tasks = await Task.find({
      status: 'posted',
      location: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
          $maxDistance: meters
        }
      }
    }).select('location price categoryId');
    
    // Group by grid cells
    const gridSize = 0.01; // ~1km
    const heatmap = {};
    
    tasks.forEach(task => {
      const [taskLng, taskLat] = task.location.coordinates;
      const gridLat = Math.floor(taskLat / gridSize) * gridSize;
      const gridLng = Math.floor(taskLng / gridSize) * gridSize;
      const key = `${gridLat.toFixed(2)},${gridLng.toFixed(2)}`;
      
      if (!heatmap[key]) {
        heatmap[key] = { lat: gridLat, lng: gridLng, count: 0, totalValue: 0 };
      }
      heatmap[key].count++;
      heatmap[key].totalValue += task.price;
    });
    
    // Convert to array and calculate intensity
    const zones = Object.values(heatmap).map(zone => ({
      ...zone,
      intensity: zone.count, // Can be weighted by price
      avgPrice: Math.round(zone.totalValue / zone.count)
    })).sort((a, b) => b.intensity - a.intensity);
    
    res.json({ ok: true, zones, totalTasks: tasks.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== BIDDING / COUNTER-OFFER SYSTEM ==========

// Submit offer (tasker)
router.post('/:id/offer', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const { proposedPrice, message } = req.body;
  
  if (!proposedPrice || proposedPrice <= 0) {
    return res.status(400).json({ error: 'Valid proposed price required' });
  }
  
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'posted') return res.status(400).json({ error: 'Task not available for bidding' });
  if (!task.biddingEnabled) return res.status(400).json({ error: 'Bidding not enabled for this task' });
  if (task.requesterId.toString() === user._id.toString()) {
    return res.status(403).json({ error: 'Cannot bid on your own task' });
  }
  
  // Check if user already has a pending offer
  const existingOffer = task.offers.find(o => 
    o.taskerId.toString() === user._id.toString() && o.status === 'pending'
  );
  
  if (existingOffer) {
    return res.status(409).json({ error: 'You already have a pending offer for this task' });
  }
  
  // Add offer
  task.offers.push({
    taskerId: user._id,
    proposedPrice: Number(proposedPrice),
    message: message || '',
    status: 'pending',
    createdAt: new Date()
  });
  
  await task.save();
  
  // Notify requester
  const io = req.app.get('io');
  const User = require('../models/User');
  const tasker = await User.findById(user._id).select('name profilePhoto ratingAvg');
  io.to(task.requesterId.toString()).emit('task_offer_received', {
    taskId: task._id,
    offer: {
      taskerId: user._id,
      taskerName: tasker.name,
      taskerPhoto: tasker.profilePhoto,
      taskerRating: tasker.ratingAvg,
      proposedPrice,
      message,
      createdAt: new Date()
    }
  });
  
  res.json({ ok: true, message: 'Offer submitted successfully' });
});

// Get all offers for a task (requester only)
router.get('/:id/offers', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id).populate('offers.taskerId', 'name profilePhoto ratingAvg ratingCount skills');
  
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.requesterId.toString() !== user._id.toString()) {
    return res.status(403).json({ error: 'Only task requester can view offers' });
  }
  
  res.json({ ok: true, offers: task.offers });
});

// Accept an offer (requester)
router.post('/:id/offer/:offerId/accept', authMiddleware, async (req, res) => {
  const user = getUser(req);
  const task = await Task.findById(req.params.id);
  
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.requesterId.toString() !== user._id.toString()) {
    return res.status(403).json({ error: 'Only task requester can accept offers' });
  }
  if (task.status !== 'posted') {
    return res.status(400).json({ error: 'Task already assigned or completed' });
  }
  
  const offer = task.offers.id(req.params.offerId);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });
  if (offer.status !== 'pending') return res.status(400).json({ error: 'Offer already processed' });
  
  // Accept this offer, reject all others
  task.offers.forEach(o => {
    if (o._id.toString() === req.params.offerId) {
      o.status = 'accepted';
    } else if (o.status === 'pending') {
      o.status = 'rejected';
    }
  });
  
  // Update task with accepted offer details
  task.price = offer.proposedPrice; // Update final price to negotiated price
  task.status = 'accepted';
  task.assignedTaskerId = offer.taskerId;
  task.acceptedAt = new Date();
  await task.save();
  
  // Notify all bidders
  const io = req.app.get('io');
  task.offers.forEach(o => {
    if (o.taskerId.toString() === offer.taskerId.toString()) {
      io.to(o.taskerId.toString()).emit('offer_accepted', { taskId: task._id, offerId: offer._id });
    } else {
      io.to(o.taskerId.toString()).emit('offer_rejected', { taskId: task._id });
    }
  });
  
  io.emit('task_assigned', { taskId: task._id, assignedTaskerId: offer.taskerId });
  
  res.json({ ok: true, task });
});

// Helper functions for rewards system
function calculateRewardsLevel(taskPoints) {
  if (taskPoints >= 100000) return 'platinum'; // 1000 NPR worth
  if (taskPoints >= 50000) return 'gold'; // 500 NPR worth
  if (taskPoints >= 20000) return 'silver'; // 200 NPR worth
  return 'bronze';
}

async function awardLevelPerks(userId, level) {
  const User = require('../models/User');
  const perks = [];
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days
  
  switch (level) {
    case 'platinum':
      perks.push(
        { type: 'reduced_commission', value: 5, expiresAt }, // 5% commission reduction
        { type: 'priority_listing', value: 1, expiresAt },
        { type: 'top_badge', value: 1, expiresAt }
      );
      break;
    case 'gold':
      perks.push(
        { type: 'reduced_commission', value: 3, expiresAt },
        { type: 'priority_listing', value: 1, expiresAt }
      );
      break;
    case 'silver':
      perks.push({ type: 'reduced_commission', value: 2, expiresAt });
      break;
  }
  
  if (perks.length > 0) {
    await User.findByIdAndUpdate(userId, { $set: { perks } });
    console.log(`✓ Awarded ${level} perks to user ${userId}`);
  }
}

module.exports = router;
