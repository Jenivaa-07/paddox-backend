/* ============================================================
   FILE: config/resend.js
   PADDOX — Brevo compatibility bridge
   Phase A4.7C

   Existing controllers may still import ../config/resend.
   This file intentionally redirects those calls to Brevo so the
   whole project uses one provider without rewriting every old import.
   ============================================================ */
module.exports = require('./brevo');
