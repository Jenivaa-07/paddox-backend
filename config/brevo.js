/* ============================================================
   FILE: config/brevo.js
   PADDOX — Brevo Transactional Email Bridge
   Phase A4.7C: Replaces Resend with Brevo for all PADDOX emails.

   Required Render env values:
   BREVO_API_KEY=your_brevo_api_key
   BREVO_SENDER_EMAIL=your_verified_sender_email
   BREVO_SENDER_NAME=PADDOX
   ============================================================ */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL =
  process.env.BREVO_SENDER_EMAIL ||
  process.env.FROM_EMAIL ||
  '';
const FROM_NAME =
  process.env.BREVO_SENDER_NAME ||
  process.env.FROM_NAME ||
  'PADDOX';

function normaliseRecipient(to) {
  if (!to) return [];

  if (Array.isArray(to)) {
    return to
      .map(item => {
        if (!item) return null;
        if (typeof item === 'object' && item.email) return item;
        return { email: String(item).trim() };
      })
      .filter(item => item?.email);
  }

  return String(to)
    .split(',')
    .map(email => email.trim())
    .filter(Boolean)
    .map(email => ({ email }));
}

async function sendEmail(to, subject, html, options = {}) {
  const recipients = normaliseRecipient(to);

  if (!recipients.length) {
    return { success: false, provider: 'brevo', message: 'No recipient email' };
  }

  if (!BREVO_API_KEY || BREVO_API_KEY === 'disabled') {
    console.log('PADDOX Brevo not configured. Email preview only:', {
      to: recipients,
      subject,
      html
    });
    return {
      success: true,
      provider: 'brevo',
      previewOnly: true,
      message: 'Brevo is not configured. Email preview logged only.'
    };
  }

  if (!FROM_EMAIL) {
    console.warn('PADDOX Brevo sender email missing. Set BREVO_SENDER_EMAIL in Render.');
    return {
      success: false,
      provider: 'brevo',
      message: 'BREVO_SENDER_EMAIL is missing'
    };
  }

  const payload = {
    sender: {
      name: options.fromName || FROM_NAME,
      email: options.fromEmail || FROM_EMAIL
    },
    to: recipients,
    subject: String(subject || 'PADDOX Notification'),
    htmlContent: String(html || ''),
  };

  if (options.replyTo) {
    payload.replyTo =
      typeof options.replyTo === 'object'
        ? options.replyTo
        : { email: String(options.replyTo) };
  }

  if (Array.isArray(options.cc) && options.cc.length) {
    payload.cc = normaliseRecipient(options.cc);
  }

  if (Array.isArray(options.bcc) && options.bcc.length) {
    payload.bcc = normaliseRecipient(options.bcc);
  }

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        data.message ||
        data.error ||
        `Brevo email failed with status ${response.status}`;

      console.error('PADDOX Brevo email failed:', {
        status: response.status,
        message,
        to: recipients,
        subject,
        data,
      });

      return {
        success: false,
        provider: 'brevo',
        status: response.status,
        message,
        data,
      };
    }

    console.log('PADDOX Brevo email sent:', {
      to: recipients.map(item => item.email).join(', '),
      subject,
      messageId: data.messageId || data.messageIds || data.id || '',
    });

    return {
      success: true,
      provider: 'brevo',
      data,
      messageId: data.messageId || data.messageIds || data.id || '',
    };
  } catch (err) {
    console.error('PADDOX Brevo email exception:', err.message);
    return {
      success: false,
      provider: 'brevo',
      message: err.message || 'Brevo email exception',
    };
  }
}

module.exports = {
  sendEmail,
  FROM_EMAIL,
  FROM_NAME,
  BREVO_API_KEY,
};
