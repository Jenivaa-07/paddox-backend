/* ============================================================
   FILE: config/resend.js
   PADDOX — Email utility
   ============================================================ */
const { Resend } = require('resend');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const FROM_NAME  = process.env.RESEND_FROM_NAME || 'PADDOX';

let resend = null;
if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 'disabled') {
  resend = new Resend(process.env.RESEND_API_KEY);
}

const sendEmail = async (to, subject, html) => {
  if (!to) return { success:false, message:'No recipient email' };

  if (!resend) {
    console.log('Email provider not configured. Email preview:');
    console.log({ to, subject, html });
    return { success:true, previewOnly:true };
  }

  const result = await resend.emails.send({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to,
    subject,
    html
  });

  return { success:true, data:result };
};

module.exports = { sendEmail, FROM_EMAIL, FROM_NAME };
