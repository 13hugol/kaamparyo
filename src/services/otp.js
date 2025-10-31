const otpStore = new Map();

function setOTP(phone, code, ttlSeconds = 300) {
  const key = normalize(phone);
  const expiresAt = Date.now() + ttlSeconds * 1000;
  otpStore.set(key, { code: String(code), expiresAt });
  setTimeout(() => {
    const entry = otpStore.get(key);
    if (entry && entry.expiresAt <= Date.now()) otpStore.delete(key);
  }, ttlSeconds * 1000 + 1000);
}

function verifyOTP(phone, code) {
  const key = normalize(phone);
  const entry = otpStore.get(key);
  if (!entry) return false;
  const ok = entry.expiresAt > Date.now() && entry.code === String(code);
  if (ok) otpStore.delete(key);
  return ok;
}

function normalize(p) { return String(p || '').trim(); }

module.exports = { setOTP, verifyOTP };