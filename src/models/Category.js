const mongoose = require('mongoose');
const { Schema } = mongoose;

const CategorySchema = new Schema({
  _id: { type: String }, // 'errand', 'delivery'
  name: { type: String, required: true },
  minPrice: { type: Number, default: 0 }, // paisa (optional, for guidance only)
  maxPrice: { type: Number, default: 10000000 }  // paisa (optional, for guidance only)
});

module.exports = mongoose.model('Category', CategorySchema);
