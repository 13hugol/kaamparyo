const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');

// Public get settings
router.get('/', async (req, res) => {
  const s = await Settings.findById('global');
  res.json({ ok: true, settings: s || { _id: 'global', platformFeePct: Number(process.env.PLATFORM_FEE_PCT) || 10, defaultRadiusKm: Number(process.env.DEFAULT_RADIUS_KM) || 3 } });
});

// Anyone can update settings (demo mode)
router.put('/', async (req, res) => {
  const { platformFeePct, defaultRadiusKm } = req.body;
  const updated = await Settings.findByIdAndUpdate(
    'global',
    { _id: 'global', ...(platformFeePct !== undefined ? { platformFeePct } : {}), ...(defaultRadiusKm !== undefined ? { defaultRadiusKm } : {}) },
    { upsert: true, new: true }
  );
  res.json({ ok: true, settings: updated });
});

module.exports = router;
