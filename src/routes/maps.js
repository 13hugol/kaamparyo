const express = require('express');
const router = express.Router();
const galliMaps = require('../services/galliMaps');
const { authMiddleware } = require('../utils/auth');

// Autocomplete search endpoint
router.get('/autocomplete', authMiddleware, async (req, res) => {
  const { word, lat, lng } = req.query;
  
  if (!word) {
    return res.status(400).json({ error: 'Search word required' });
  }
  
  const result = await galliMaps.autocomplete(
    word,
    lat || 27.7172,
    lng || 85.3240
  );
  
  res.json(result);
});

// Search location by name
router.get('/search', authMiddleware, async (req, res) => {
  const { name, currentLat, currentLng } = req.query;
  
  if (!name) {
    return res.status(400).json({ error: 'Location name required' });
  }
  
  const result = await galliMaps.search(
    name,
    currentLat || 27.7172,
    currentLng || 85.3240
  );
  
  res.json(result);
});

// Reverse geocode - get address from coordinates
router.get('/reverse', authMiddleware, async (req, res) => {
  const { lat, lng } = req.query;
  
  if (!lat || !lng) {
    return res.status(400).json({ error: 'Latitude and longitude required' });
  }
  
  const result = await galliMaps.reverseGeocode(lat, lng);
  res.json(result);
});

// Get route between two points
router.get('/route', authMiddleware, async (req, res) => {
  const { srcLat, srcLng, dstLat, dstLng, mode } = req.query;
  
  if (!srcLat || !srcLng || !dstLat || !dstLng) {
    return res.status(400).json({ error: 'Source and destination coordinates required' });
  }
  
  const result = await galliMaps.getRoute(
    srcLat,
    srcLng,
    dstLat,
    dstLng,
    mode || 'driving'
  );
  
  res.json(result);
});

// Get distance and duration
router.get('/distance', authMiddleware, async (req, res) => {
  const { srcLat, srcLng, dstLat, dstLng, mode } = req.query;
  
  if (!srcLat || !srcLng || !dstLat || !dstLng) {
    return res.status(400).json({ error: 'Source and destination coordinates required' });
  }
  
  const result = await galliMaps.getDistance(
    srcLat,
    srcLng,
    dstLat,
    dstLng,
    mode || 'driving'
  );
  
  res.json(result);
});

module.exports = router;
