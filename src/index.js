require('dotenv').config();
const { createServer } = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const { createAdapter } = require('@socket.io/redis-adapter');

const app = require('./app');
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

// Attempt to enable Redis adapter, but gracefully fall back if Redis is unavailable
(async function setupRedisAdapter() {
  try {
    if (process.env.DISABLE_REDIS_ADAPTER === 'true') {
      console.log('ℹ️ Socket.IO Redis adapter disabled by env');
      return;
    }

    const primaryUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

    const tryConnect = async (url) => {
      const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
      client.on('error', (err) => console.error('Redis error:', err.message));
      await client.connect();
      await client.ping();
      return client;
    };

    const enableAdapter = async (url) => {
      const pub = await tryConnect(url);
      const sub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
      await sub.connect();
      await sub.ping();
      io.adapter(createAdapter(pub, sub));
      console.log(`✓ Socket.IO Redis adapter enabled (${url})`);
    };

    try {
      await enableAdapter(primaryUrl);
    } catch (e) {
      if (!/^(redis:\/\/(127\.0\.0\.1|localhost):\d+)/i.test(primaryUrl)) {
        const fallback = 'redis://127.0.0.1:6379';
        try {
          await enableAdapter(fallback);
          return;
        } catch (e2) {
          console.warn('⚠️ Redis unavailable on fallback; continuing without adapter');
        }
      } else {
        console.warn('⚠️ Redis unavailable; continuing without adapter');
      }
    }
  } catch (e) {
    console.warn('⚠️ Redis adapter setup failed; continuing without adapter');
  }
})();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join_tasker', (userId) => {
    socket.join('online:taskers');
    if (userId) {
      socket.join(userId); // Join user-specific room
      console.log('Tasker joined:', socket.id, 'userId:', userId);
    } else {
      console.log('Tasker joined:', socket.id);
    }
  });

  socket.on('join_requester', (userId) => {
    socket.join('online:requesters');
    if (userId) {
      socket.join(userId); // Join user-specific room
      console.log('Requester joined:', socket.id, 'userId:', userId);
    } else {
      console.log('Requester joined:', socket.id);
    }
  });

  socket.on('location_update', async (data) => {
    try {
      const { taskId, lat, lng } = data;
      if (!taskId || lat == null || lng == null) return;
      
      const Task = require('./models/Task');
      const task = await Task.findById(taskId);
      if (!task || !task.assignedTaskerId) return;
      socket.to(task.requesterId.toString()).emit('tasker_location', {
        taskId,
        lat,
        lng,
        timestamp: new Date()
      });
    } catch (e) {
      console.error('Location update error:', e.message);
    }
  });
  
  socket.on('typing', (data) => {
    const { taskId, userId } = data;
    if (taskId && userId) {
      socket.broadcast.emit('user_typing', { taskId, userId });
    }
  });
  
  socket.on('stop_typing', (data) => {
    const { taskId, userId } = data;
    if (taskId && userId) {
      socket.broadcast.emit('user_stop_typing', { taskId, userId });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(async () => {
    console.log('✓ MongoDB connected');
    const { ensureDefaultCategories } = require('./bootstrap/defaults');
    await ensureDefaultCategories();
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await mongoose.connection.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const Task = require('./models/Task');
const Transaction = require('./models/Transaction');
const payments = require('./services/payments');
const { startScheduler } = require('./services/scheduler');

setInterval(async () => {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const stale = await Task.find({ status: { $in: ['accepted','in_progress'] }, acceptedAt: { $lte: oneHourAgo }, escrowHeld: true }).limit(50);
    for (const t of stale) {
      try { if (t.paymentIntentId) await payments.refundPayment(t.paymentIntentId); } catch {}
      await Transaction.findOneAndUpdate({ taskId: t._id }, { $set: { status: 'refunded' } });
      t.status = 'posted';
      t.escrowHeld = false;
      t.assignedTaskerId = undefined;
      t.acceptedAt = undefined;
      t.startedAt = undefined;
      t.completedAt = undefined;
      t.paymentIntentId = undefined;
      await t.save();
      const io = server.listeners('request')[0]?.get('io');
      if (io) {
        // Notify requester about cancellation
        io.to(t.requesterId.toString()).emit('task_cancelled', { taskId: t._id, auto: true, reposted: true });
        // Notify taskers about new task
        io.to('online:taskers').emit('task_posted', { id: t._id, title: t.title, price: t.price, lat: t.location.coordinates[1], lng: t.location.coordinates[0], categoryId: t.categoryId });
      }
      console.log('Auto-refunded and reposted task', t._id.toString());
    }
  } catch (e) {}
}, 60 * 1000);

startScheduler();

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Server listening on port ${PORT}`);
});
