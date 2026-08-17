const TRIGGER_KEYWORDS = [
  'PAUZE',
  'pauze',
  'Pauze',
  'AUTOMATIZĀCIJA',
  'automatizācija',
];

/**
 * Normalize text for keyword matching.
 * Preserves Latvian letters; lowercases for case-insensitive comparison.
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.normalize('NFC').toLowerCase();
}

/**
 * Check if comment text contains any trigger keyword (partial, case-insensitive).
 */
function matchesTriggerKeyword(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  return TRIGGER_KEYWORDS.some((keyword) =>
    normalized.includes(normalizeText(keyword))
  );
}

/**
 * Random delay between min and max milliseconds (inclusive).
 */
function randomDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the DM message body with the configured test link.
 */
function buildDmMessage(testLink) {
  return `Čau! 🌿 Paldies par Tavu 'PAUZE'.

Es zinu, cik daudz spēka prasa nemitīgā būšana 'formā' un kontrolē. Šeit ir saite uz 3 minūšu Pašsajūtas testu un Tavu dāvanu:

📲 ${testLink}

Kad izpildīsi testu, saņemsi arī solīto apzinātības praksi prāta atelpai. Sirsnībā, Beāte.`;
}

const PUBLIC_REPLY_VARIATIONS = [
  'Nosūtīju Tev saiti privātā ziņā! 🌿',
  'Saite nosūtīta privātā ziņā! 🌿',
  'Pārbaudi savas DM — nosūtīju saiti! 🌿',
];

function getPublicReplyMessage() {
  const index = Math.floor(Math.random() * PUBLIC_REPLY_VARIATIONS.length);
  return PUBLIC_REPLY_VARIATIONS[index];
}

module.exports = {
  TRIGGER_KEYWORDS,
  normalizeText,
  matchesTriggerKeyword,
  randomDelay,
  buildDmMessage,
  getPublicReplyMessage,
};
