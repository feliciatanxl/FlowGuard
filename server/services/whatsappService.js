// Mock-safe WhatsApp notification service for Smart Logistics (Phase 1).
//
// Reads ALL credentials from environment variables only — nothing is hardcoded.
//   WHATSAPP_ENABLED=false            (must be the string "true" to actually send)
//   WHATSAPP_API_URL=                 (e.g. https://graph.facebook.com/v19.0)
//   WHATSAPP_API_KEY=                 (bearer token — never logged in full)
//   WHATSAPP_PHONE_NUMBER_ID=
//
// If disabled or not fully configured, it logs a safe message and returns a
// simulated success — it never throws, so a booking flow can't crash on it.
const axios = require('axios');

const ENABLED = process.env.WHATSAPP_ENABLED === 'true';
const API_URL = process.env.WHATSAPP_API_URL;
const API_KEY = process.env.WHATSAPP_API_KEY;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Only ever expose the last 4 chars of the key in logs.
function maskKey(key) {
  if (!key) return '(none)';
  return key.length <= 4 ? '****' : `****${key.slice(-4)}`;
}

function isConfigured() {
  return ENABLED && Boolean(API_URL && API_KEY && PHONE_NUMBER_ID);
}

// Core sender. Never throws — always resolves to a result object.
async function sendMessage(to, body) {
  if (!isConfigured()) {
    const reason = !ENABLED ? 'WHATSAPP_ENABLED is not "true"' : 'missing WhatsApp credentials';
    console.log(`[WhatsApp] Simulated send (${reason}). to=${to} key=${maskKey(API_KEY)} body="${body}"`);
    return { success: true, simulated: true, message: 'WhatsApp disabled — message simulated.' };
  }

  try {
    const cleanTo = String(to).replace(/\D/g, '');
    await axios.post(
      `${API_URL}/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', to: cleanTo, type: 'text', text: { body } },
      { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    console.log(`[WhatsApp] Sent to ${cleanTo} (key ${maskKey(API_KEY)})`);
    return { success: true, simulated: false, message: 'WhatsApp message sent.' };
  } catch (err) {
    // Log a short, safe reason — never the key or full payload.
    console.error(`[WhatsApp] Send failed: ${err.response?.status || err.code || 'error'}`);
    return { success: false, simulated: false, message: 'WhatsApp send failed (delivery pending).' };
  }
}

function formatSlot(booking) {
  if (!booking.slot_start) return 'your scheduled time';
  try {
    return new Date(booking.slot_start).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(booking.slot_start);
  }
}

// --- Phase 1 events ---
function sendBookingConfirmed(booking) {
  return sendMessage(
    booking.driver_phone,
    `FlowGuard: Your loading bay slot is confirmed at ${formatSlot(booking)}, ${booking.loading_bay}. Please do not arrive early.`
  );
}

function sendNextInLine(booking) {
  return sendMessage(
    booking.driver_phone,
    `FlowGuard: You are next in line. Please proceed to the loading bay entrance (${booking.loading_bay}).`
  );
}

function sendBookingCancelled(booking) {
  return sendMessage(
    booking.driver_phone,
    `FlowGuard: Your loading bay booking (${booking.booking_ref}) has been cancelled.`
  );
}

module.exports = {
  sendMessage,
  sendBookingConfirmed,
  sendNextInLine,
  sendBookingCancelled,
  isConfigured,
  _maskKey: maskKey,
};
