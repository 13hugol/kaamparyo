const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../utils/auth');
const Application = require('../models/Application');
const Task = require('../models/Task');
const User = require('../models/User');

function getUser(req) {
  return req.user;
}

// Apply for a task
router.post('/', authMiddleware, async (req, res) => {
  try {
    const user = getUser(req);
    const { taskId, proposedPrice, message } = req.body;

    if (!taskId) {
      return res.status(400).json({ error: 'Task ID required' });
    }

    // Check if task exists and is available
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.status !== 'posted') {
      return res.status(400).json({ error: 'Task is no longer available' });
    }

    // Can't apply to own task
    if (task.requesterId.toString() === user._id.toString()) {
      return res.status(400).json({ error: 'Cannot apply to your own task' });
    }

    // Check if task requires professional and user is professional
    if (task.professionalOnly) {
      const applicant = await User.findById(user._id).select('isProfessional');
      if (!applicant || !applicant.isProfessional) {
        return res.status(403).json({ error: 'This task is only available to verified professionals' });
      }
    }

    // Check if already applied
    const existing = await Application.findOne({ 
      taskId, 
      applicantId: user._id,
      status: { $in: ['pending', 'approved'] }
    });

    if (existing) {
      return res.status(409).json({ error: 'Already applied to this task' });
    }

    // Create application
    const application = await Application.create({
      taskId,
      applicantId: user._id,
      proposedPrice: proposedPrice || task.price,
      message: message || ''
    });

    // Update task application count
    await Task.findByIdAndUpdate(taskId, { 
      $inc: { applicationCount: 1 } 
    });

    // Notify task poster
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${task.requesterId}`).emit('new_application', {
        taskId: task._id,
        taskTitle: task.title,
        applicantId: user._id,
        applicantName: user.name || user.phone,
        applicationId: application._id
      });
    }

    res.json({ ok: true, application });
  } catch (error) {
    console.error('Apply error:', error);
    res.status(500).json({ error: 'Failed to apply' });
  }
});

// Get applications for a task (poster only)
router.get('/task/:taskId', authMiddleware, async (req, res) => {
  try {
    const user = getUser(req);
    const { taskId } = req.params;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Only task poster can view applications
    if (task.requesterId.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const applications = await Application.find({ taskId })
      .populate('applicantId', 'name phone profilePhoto ratingAvg ratingCount ratingAvgAsTasker ratingCountAsTasker isProfessional skills')
      .sort({ createdAt: -1 })
      .lean();

    // Get task completion stats for each applicant
    const applicationsWithStats = await Promise.all(
      applications.map(async (app) => {
        if (!app.applicantId) {
          return app; // Skip if applicant was deleted
        }
        
        const completedTasks = await Task.countDocuments({
          assignedTaskerId: app.applicantId._id,
          status: 'paid'
        });

        return {
          _id: app._id,
          taskId: app.taskId,
          status: app.status,
          proposedPrice: app.proposedPrice,
          message: app.message,
          createdAt: app.createdAt,
          respondedAt: app.respondedAt,
          applicant: {
            _id: app.applicantId._id,
            name: app.applicantId.name,
            phone: app.applicantId.phone,
            profilePhoto: app.applicantId.profilePhoto,
            ratingAvg: app.applicantId.ratingAvg || 0,
            ratingCount: app.applicantId.ratingCount || 0,
            ratingAvgAsTasker: app.applicantId.ratingAvgAsTasker || 0,
            ratingCountAsTasker: app.applicantId.ratingCountAsTasker || 0,
            isProfessional: app.applicantId.isProfessional || false,
            skills: app.applicantId.skills || [],
            completedTasks
          }
        };
      })
    );

    console.log('[Applications] Returning applications with stats:', applicationsWithStats.length);
    if (applicationsWithStats.length > 0) {
      console.log('[Applications] Sample applicant data:', {
        name: applicationsWithStats[0].applicant.name,
        ratingAvgAsTasker: applicationsWithStats[0].applicant.ratingAvgAsTasker,
        ratingCountAsTasker: applicationsWithStats[0].applicant.ratingCountAsTasker,
        completedTasks: applicationsWithStats[0].applicant.completedTasks
      });
    }
    
    res.json({ ok: true, applications: applicationsWithStats });
  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// Get my applications (tasker view)
router.get('/my-applications', authMiddleware, async (req, res) => {
  try {
    const user = getUser(req);
    const status = req.query.status; // pending, approved, rejected

    const query = { applicantId: user._id };
    if (status) {
      query.status = status;
    }

    const applications = await Application.find(query)
      .populate('taskId', 'title description price location status requesterId')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ ok: true, applications });
  } catch (error) {
    console.error('Get my applications error:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// Approve an application (poster only)
router.post('/:applicationId/approve', authMiddleware, async (req, res) => {
  try {
    const user = getUser(req);
    const { applicationId } = req.params;

    const application = await Application.findById(applicationId).populate('taskId');
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const task = application.taskId;

    // Only task poster can approve
    if (task.requesterId.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (task.status !== 'posted') {
      return res.status(400).json({ error: 'Task is no longer available' });
    }

    // Update application status
    application.status = 'approved';
    application.respondedAt = new Date();
    await application.save();

    // Assign task to applicant
    task.assignedTaskerId = application.applicantId;
    task.status = 'accepted';
    task.acceptedAt = new Date();
    await task.save();

    // Reject all other pending applications
    await Application.updateMany(
      { 
        taskId: task._id, 
        _id: { $ne: applicationId },
        status: 'pending'
      },
      { 
        status: 'rejected',
        respondedAt: new Date()
      }
    );

    // Notify approved applicant
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${application.applicantId}`).emit('application_approved', {
        taskId: task._id,
        taskTitle: task.title,
        applicationId: application._id
      });

      // Notify rejected applicants
      const rejectedApps = await Application.find({
        taskId: task._id,
        _id: { $ne: applicationId },
        status: 'rejected'
      });

      rejectedApps.forEach(app => {
        io.to(`user_${app.applicantId}`).emit('application_rejected', {
          taskId: task._id,
          taskTitle: task.title
        });
      });
    }

    res.json({ ok: true, application, task });
  } catch (error) {
    console.error('Approve application error:', error);
    res.status(500).json({ error: 'Failed to approve application' });
  }
});

// Reject an application (poster only)
router.post('/:applicationId/reject', authMiddleware, async (req, res) => {
  try {
    const user = getUser(req);
    const { applicationId } = req.params;

    const application = await Application.findById(applicationId).populate('taskId');
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const task = application.taskId;

    // Only task poster can reject
    if (task.requesterId.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Update application status
    application.status = 'rejected';
    application.respondedAt = new Date();
    await application.save();

    // Notify rejected applicant
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${application.applicantId}`).emit('application_rejected', {
        taskId: task._id,
        taskTitle: task.title
      });
    }

    res.json({ ok: true, application });
  } catch (error) {
    console.error('Reject application error:', error);
    res.status(500).json({ error: 'Failed to reject application' });
  }
});

// Withdraw application (applicant only)
router.post('/:applicationId/withdraw', authMiddleware, async (req, res) => {
  try {
    const user = getUser(req);
    const { applicationId } = req.params;

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Only applicant can withdraw
    if (application.applicantId.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (application.status !== 'pending') {
      return res.status(400).json({ error: 'Can only withdraw pending applications' });
    }

    application.status = 'withdrawn';
    await application.save();

    // Update task application count
    await Task.findByIdAndUpdate(application.taskId, { 
      $inc: { applicationCount: -1 } 
    });

    res.json({ ok: true, application });
  } catch (error) {
    console.error('Withdraw application error:', error);
    res.status(500).json({ error: 'Failed to withdraw application' });
  }
});

module.exports = router;
