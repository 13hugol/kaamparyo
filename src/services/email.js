const nodemailer = require('nodemailer');

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  
  try {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
      auth: process.env.SMTP_USER ? { 
        user: process.env.SMTP_USER, 
        pass: process.env.SMTP_PASS 
      } : undefined,
      tls: {
        rejectUnauthorized: false // Allow self-signed certificates
      }
    });
  } catch (e) {
    console.warn('⚠️ Email transport creation failed:', e.message);
    return null;
  }
}

async function sendMail(to, subject, html) {
  try {
    const transporter = getTransport();
    if (!transporter) {
      console.log('ℹ️ Email not configured - OTP will show in console only');
      return false;
    }
    
    const from = process.env.SMTP_FROM || 'noreply@kaamparyo.local';
    
    await transporter.sendMail({ from, to, subject, html });
    console.log(`✓ Email sent to ${to}`);
    return true;
  } catch (e) {
    console.warn('⚠️ Email send failed:', e.message);
    return false;
  }
}

module.exports = { sendMail };