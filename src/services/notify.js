const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Use /tmp for serverless environments (Vercel), otherwise use uploads folder
const UPLOAD_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    console.warn('Could not create upload directory:', err.message);
  }
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text, parse_mode: 'HTML' });
    return true;
  } catch { return false; }
}

const s3 = {
  getPresignedUploadUrl: async (key) => {
    const filename = `${uuidv4()}_${path.basename(key)}`;
    return { uploadUrl: `/uploads/${filename}`, filepath: path.join(UPLOAD_DIR, filename), filename };
  },
  getSignedDownloadUrl: (key) => `${process.env.BASE_URL || 'http://localhost:4000'}/uploads/${path.basename(key)}`,
  saveFile: (buffer, filename) => {
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
    return `/uploads/${filename}`;
  }
};

module.exports = { sendTelegram, s3 };