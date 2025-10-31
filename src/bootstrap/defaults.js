const Category = require('../models/Category');

const DEFAULT_CATEGORIES = [
  { _id: 'delivery', name: 'Delivery', minPrice: 5000, maxPrice: 50000 },
  { _id: 'errand', name: 'Errand', minPrice: 3000, maxPrice: 30000 },
  { _id: 'shopping', name: 'Shopping', minPrice: 5000, maxPrice: 100000 },
  { _id: 'pickup', name: 'Pickup & Drop', minPrice: 3000, maxPrice: 20000 },
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
