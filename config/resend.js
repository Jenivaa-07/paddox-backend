const { Resend } = require('resend');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const FROM_NAME = 'Paddox F1';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const sendEmail = async (to, subject, html, text = '') => {
  try {
    if (!resend) {
      console.log('📧 Resend disabled: RESEND_API_KEY missing');
      return { success: true, skipped: true };
    }

    const result = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
      text,
    });

    return { success: true, id: result.id };
  } catch (error) {
    console.error('❌ Email send failed:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { resend, sendEmail, FROM_EMAIL, FROM_NAME };