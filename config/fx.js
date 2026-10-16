// Exchange rates for money spent in another currency (e.g. abroad). Everything is stored and analysed in the
// user's home currency; a foreign entry is converted at today's rate and keeps its original amount alongside.
// Source: ExchangeRate-API open access (no key, updated daily, covers every currency in User.CURRENCIES; the UI
// credits it). Only currency codes are sent, never user data.
// ponytail: today's rate for every date, cached 12 h in memory; use historical rates if backdated entries matter.

const TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map(); // home currency -> { at, rates: { CODE: units of CODE per 1 home } }

// Home-currency value of 1 unit of `from`.
exports.rate = async (from, home) => {
  if (from === home) return 1;
  let hit = cache.get(home);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(home)}`, { signal: AbortSignal.timeout(5000) });
    const body = await res.json();
    if (!res.ok || body.result !== 'success') throw new Error(`exchange rates unavailable (${res.status})`);
    hit = { at: Date.now(), rates: body.rates };
    cache.set(home, hit);
  }
  const perHome = hit.rates[from];
  if (!(perHome > 0)) throw new Error(`no exchange rate for ${from}`);
  return 1 / perHome;
};

// A positive amount paid in `from`, in the home currency (cents, at least 0.01), plus what was actually paid.
exports.toHome = async (amount, from, home) => {
  if (!from || from === home) return { value: amount, original: null };
  const rate = await exports.rate(from, home);
  return { value: Math.max(0.01, Math.round(amount * rate * 100) / 100), original: { amount, currency: from, rate } };
};
