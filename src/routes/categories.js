const express = require('express');
const router = express.Router();
const Category = require('../models/Category');

// Public categories endpoint (no admin needed)
router.get('/', async (req, res) => {
  const categories = await Category.find().sort({ _id: 1 });
  res.json({ ok: true, categories });
});

module.exports = router;
