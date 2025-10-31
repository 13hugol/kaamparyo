const Task = require('../models/Task');
const Transaction = require('../models/Transaction');
const payments = require('./payments');

// Process recurring tasks - generate new instances
async function processRecurringTasks() {
  try {
    const now = new Date();
    
    // Find recurring tasks that need a new instance
    const recurringTasks = await Task.find({
      isRecurring: true,
      status: 'paid', // Only generate from completed parent tasks
      'recurringConfig.nextOccurrence': { $lte: now },
      $or: [
        { 'recurringConfig.endDate': { $exists: false } },
        { 'recurringConfig.endDate': { $gte: now } }
      ]
    });
    
    for (const parentTask of recurringTasks) {
      try {
        // Create payment intent for new instance
        const paymentIntent = await payments.createPaymentIntent({
          amount: parentTask.price,
          currency: 'npr',
          metadata: { requesterId: parentTask.requesterId, recurring: true }
        });
        
        // Create new task instance
        const newTask = await Task.create({
          requesterId: parentTask.requesterId,
          title: parentTask.title,
          description: parentTask.description,
          categoryId: parentTask.categoryId,
          categoryName: parentTask.categoryName,
          price: parentTask.price,
          durationMin: parentTask.durationMin,
          requiredSkills: parentTask.requiredSkills,
          biddingEnabled: false, // Recurring tasks use fixed price
          quickAccept: true,
          allowedTier: parentTask.allowedTier,
          location: parentTask.location,
          radiusKm: parentTask.radiusKm,
          paymentIntentId: paymentIntent.id,
          escrowHeld: true,
          status: 'posted',
          parentTaskId: parentTask._id,
          isRecurring: false, // Instance is not recurring itself
          assignedTaskerId: parentTask.assignedTaskerId, // Pre-assign to same tasker
          scheduledFor: parentTask.recurringConfig.nextOccurrence
        });
        
        // Record transaction
        await Transaction.create({
          taskId: newTask._id,
          amount: parentTask.price,
          platformFee: Math.round((Number(process.env.PLATFORM_FEE_PCT || 10) / 100) * parentTask.price),
          status: 'held',
          providerRef: paymentIntent.id
        });
        
        // Update parent's next occurrence
        parentTask.recurringConfig.nextOccurrence = calculateNextOccurrence(
          parentTask.recurringConfig.frequency,
          parentTask.recurringConfig.dayOfWeek,
          parentTask.recurringConfig.timeOfDay
        );
        await parentTask.save();
        
        console.log(`✓ Generated recurring task instance: ${newTask._id} from parent ${parentTask._id}`);
        
        // Notify tasker about new recurring task
        // Socket notification would go here if io is available
      } catch (err) {
        console.error(`Failed to generate recurring task from ${parentTask._id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Error processing recurring tasks:', err.message);
  }
}

// Process scheduled tasks - activate when time arrives
async function processScheduledTasks() {
  try {
    const now = new Date();
    
    // Find scheduled tasks whose time has arrived
    const scheduledTasks = await Task.find({
      isScheduled: true,
      scheduledFor: { $lte: now },
      status: 'posted'
    });
    
    for (const task of scheduledTasks) {
      // If bidding was enabled, close the bid window
      if (task.biddingEnabled && task.offers.length > 0) {
        // Auto-accept best offer if bid window closed
        if (task.bidWindowEndsAt && task.bidWindowEndsAt <= now) {
          const bestOffer = task.offers
            .filter(o => o.status === 'pending')
            .sort((a, b) => a.proposedPrice - b.proposedPrice)[0]; // Lowest price wins
          
          if (bestOffer) {
            task.offers.forEach(o => {
              if (o._id.toString() === bestOffer._id.toString()) {
                o.status = 'accepted';
              } else if (o.status === 'pending') {
                o.status = 'rejected';
              }
            });
            
            task.price = bestOffer.proposedPrice;
            task.status = 'accepted';
            task.assignedTaskerId = bestOffer.taskerId;
            task.acceptedAt = new Date();
            await task.save();
            
            console.log(`✓ Auto-assigned scheduled task ${task._id} to best bidder`);
          }
        }
      }
      
      // Mark as active (no longer "scheduled")
      task.isScheduled = false;
      await task.save();
    }
  } catch (err) {
    console.error('Error processing scheduled tasks:', err.message);
  }
}

// Helper function
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

// Start scheduler
function startScheduler() {
  // Run every minute
  setInterval(processRecurringTasks, 60 * 1000);
  setInterval(processScheduledTasks, 60 * 1000);
  
  console.log('✓ Task scheduler started (recurring & scheduled tasks)');
}

module.exports = { startScheduler, processRecurringTasks, processScheduledTasks };
