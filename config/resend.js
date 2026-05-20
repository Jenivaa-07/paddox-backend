// config/resend.js

const FROM_EMAIL = 'onboarding@resend.dev';
const FROM_NAME = 'Paddox F1';

const sendEmail = async () => {
  console.log('Email sending disabled');
  return { success: true };
};

module.exports = {
  sendEmail,
  FROM_EMAIL,
  FROM_NAME,
};