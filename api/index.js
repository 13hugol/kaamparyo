const mongoose = require('mongoose');
const app = require('../src/app');

let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  const MONGO_URI = process.env.MONGO_URI;
  
  if (!MONGO_URI) {
    throw new Error('Please define MONGO_URI environment variable in Vercel');
  }

  const db = await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  cachedDb = db;
  return db;
}

module.exports = async (req, res) => {
  try {
    await connectToDatabase();
    return app(req, res);
  } catch (error) {
    console.error('Function error:', error);
    return res.status(500).json({
      error: 'Server Error',
      message: error.message,
      hint: 'Make sure MONGO_URI is set in Vercel environment variables'
    });
  }
};
