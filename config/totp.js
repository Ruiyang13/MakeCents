// Two-step sign-in codes (TOTP, RFC 6238): the 6-digit codes authenticator apps show, changing every 30 s.
// Node's crypto is all it needs; secrets are base32 so apps can import them from the QR code.
const crypto = require('node:crypto');

const STEP = 30;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(buf) {
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  return bits
    .match(/.{1,5}/g)
    .map((c) => ALPHABET[parseInt(c.padEnd(5, '0'), 2)])
    .join('');
}

function unbase32(s) {
  const bits = [...s.replace(/=+$/, '').toUpperCase()].map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}

// RFC 4226 HOTP: HMAC-SHA1 of the counter, dynamic truncation, last `digits` digits.
function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}

const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP);
const newSecret = () => base32(crypto.randomBytes(20));
const codeAt = (secret, step = stepAt()) => hotp(unbase32(secret), step);

// The time step the code belongs to (now ±1 step, for clock drift), or null. Callers reject steps already used.
function verify(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const step = stepAt(now);
  for (const s of [step, step - 1, step + 1]) {
    if (crypto.timingSafeEqual(Buffer.from(codeAt(secret, s)), Buffer.from(String(code)))) return s;
  }
  return null;
}

const otpauthUrl = (secret, account, issuer) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;

module.exports = { newSecret, verify, codeAt, stepAt, otpauthUrl, _hotp: hotp, _base32: base32 };
