
/* ============================================================
   FILE: config/resend.js  —  Resend Email Client Setup
   ============================================================ */
// config/resend.js
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@paddox.com';
const FROM_NAME  = 'Paddox F1';

/**
 * Send a transactional email
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 * @param {string} [text]
 */
const sendEmail = async (to, subject, html, text = '') => {
  try {
    const result = await resend.emails.send({
      from   : `${FROM_NAME} <${FROM_EMAIL}>`,
      to     : [to],
      subject,
      html,
      text,
    });
    console.log(`📧 Email sent to ${to}: ${result.id}`);
    return { success: true, id: result.id };
  } catch (error) {
    console.error('❌ Email send failed:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { resend, sendEmail, FROM_EMAIL, FROM_NAME };

