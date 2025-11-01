const Category = require('../models/Category');

const DEFAULT_CATEGORIES = [
  { _id: 'delivery', name: 'Delivery', minPrice: 0, maxPrice: 10000000 },
  { _id: 'errand', name: 'Errand', minPrice: 0, maxPrice: 10000000 },
  { _id: 'shopping', name: 'Shopping', minPrice: 0, maxPrice: 10000000 },
  { _id: 'pickup', name: 'Pickup & Drop', minPrice: 0, maxPrice: 10000000 },
  { _id: 'custom', name: 'Custom', minPrice: 0, maxPrice: 10000000 }
];

async function ensureDefaultCategories() {
  const count = await Category.countDocuments();
  if (count === 0) {
    await Category.insertMany(DEFAULT_CATEGORIES);
    console.log(`✓ Seeded ${DEFAULT_CATEGORIES.length} default categories`);
  }
}

module.exports = { ensureDefaultCategories, DEFAULT_CATEGORIES };
