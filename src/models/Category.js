const mongoose = require('mongoose');
const { Schema } = mongoose;

const CategorySchema = new Schema({
  _id: { type: String }, // 'errand', 'delivery'
  name: { type: String, required: true },
  minPrice: { type: Number, required: true }, // paisa
  maxPrice: { type: Number, required: true }  // paisa
});

module.exports = mongoose.model('Category', CategorySchema);
