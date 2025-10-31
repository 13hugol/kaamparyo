const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const categoriesRoutes = require('./routes/categories');
const settingsRoutes = require('./routes/settings');
const mapsRoutes = require('./routes/maps');

const app = express();

const mockIo = {
  emit: () => {},
  to: () => ({ emit: () => {} }),
  on: () => {}
};
app.set('io', mockIo);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/logo.png', (req, res) => res.sendFile(path.join(__dirname, './logo.png')));
app.get('/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));
app.get('/api/config', (req, res) => res.json({ 
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '', 
  galliMapsApiKey: process.env.GALLI_MAPS_API_KEY || 'urle63a1458-7833-4b82-b946-19e4ef1f1138' 
}));

app.use('/auth', authRoutes);
app.use('/tasks', taskRoutes);
app.use('/users', userRoutes);
app.use('/admin', adminRoutes);
app.use('/categories', categoriesRoutes);
app.use('/settings', settingsRoutes);
app.use('/maps', mapsRoutes);

app.get('*', (req, res, next) => {
  const isApi = req.path.startsWith('/auth') || req.path.startsWith('/tasks') || req.path.startsWith('/users') || req.path.startsWith('/admin') || req.path.startsWith('/uploads') || req.path.startsWith('/health');
  if (!isApi && req.method === 'GET' && req.accepts('html')) return res.sendFile(path.join(__dirname, '../public/index.html'));
  next();
});

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path, method: req.method }));
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
