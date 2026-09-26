// English / 中文. English strings are the keys; ZH holds the Chinese for each. A missing key falls back to English.
// Placeholders: t('Recorded {amount}', { amount: '£5' }). test/i18n.test.js fails if any t('…') key lacks a translation.
const ZH = require('./i18n-zh.json');
const { CATEGORY_NAMES } = require('./categories');

function translate(lang, key, vars) {
  const s = (lang === 'zh' && ZH[key]) || key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m) : s;
}

const makeT = (lang) => (key, vars) => translate(lang, key, vars);
// Display name for a stored category key: 'DiningOut' -> 'Food' / '餐饮'.
const catName = (lang, key) => translate(lang, CATEGORY_NAMES[key] || key);

// Language comes from the `lang` cookie (set by the header toggle); first visit follows the browser.
function pickLang(req) {
  const cookie = /(?:^|;\s*)lang=(en|zh)\b/.exec(req.headers.cookie || '');
  if (cookie) return cookie[1];
  return /^zh\b/i.test(req.headers['accept-language'] || '') ? 'zh' : 'en';
}

exports.middleware = (req, res, next) => {
  req.lang = pickLang(req);
  req.t = makeT(req.lang);
  res.locals.lang = req.lang;
  res.locals.t = req.t;
  req.cat = (key) => catName(req.lang, key);
  res.locals.cat = req.cat;
  res.locals.dateLocale = req.lang === 'zh' ? 'zh-CN' : 'en-GB';
  // Browser scripts get the dictionary only when it is needed.
  res.locals.i18nClient = req.lang === 'zh' ? JSON.stringify(ZH).replace(/</g, '\\u003c') : '{}';
  next();
};

exports.makeT = makeT;
exports.catName = catName;
exports.ZH = ZH;
