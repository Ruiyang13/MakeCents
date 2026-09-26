const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');
const { ZH, makeT, catName } = require('../config/i18n');
const { CATEGORY_NAMES } = require('../config/categories');
const { OVERLAP_GROUPS } = require('../controllers/bills');

// Every English string passed to t()/tr()/req.t() must have a Chinese translation with the same placeholders.
describe('i18n (English / 中文)', () => {
  const root = path.join(__dirname, '..');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = ['views', 'controllers', 'public/js', 'config'].flatMap((d) => walk(path.join(root, d))).filter((f) => /\.(pug|js)$/.test(f));
  files.push(path.join(root, 'app.js'));
  const keys = new Set();
  const re = /\b(?:t|tr|req\.t)\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(re)) keys.add((m[1] ?? m[2]).replace(/\\'/g, "'"));
  const IGNORE = new Set(['English text', '…']); // examples in comments
  const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('finds the translated strings in the code', () => {
    expect(keys.size).to.be.greaterThan(250);
  });

  it('has a Chinese translation for every static t() key', () => {
    const missing = [...keys].filter((k) => !IGNORE.has(k) && !ZH[k]);
    expect(missing, `missing zh for: ${missing.join(' | ')}`).to.deep.equal([]);
  });

  it('keeps the same {placeholders} in every translation', () => {
    const bad = Object.entries(ZH).filter(([en, zh]) => placeholders(en).join() !== placeholders(zh).join());
    expect(bad.map(([en]) => en)).to.deep.equal([]);
  });

  it('translates dynamic strings: category names, overlap groups, home features', () => {
    const home = fs.readFileSync(path.join(root, 'controllers/home.js'), 'utf8');
    const featureStrings = [...home.matchAll(/(?:title|text): '([^']+)'/g)].map((m) => m[1]);
    const dynamic = [...Object.values(CATEGORY_NAMES), ...Object.keys(OVERLAP_GROUPS), ...featureStrings];
    expect(dynamic.filter((k) => !ZH[k])).to.deep.equal([]);
    expect(catName('zh', 'DiningOut')).to.equal('餐饮');
    expect(catName('en', 'DiningOut')).to.equal('Food');
  });

  it('interpolates and falls back to English', () => {
    const zh = makeT('zh');
    expect(zh('Due in {n} days', { n: 3 })).to.equal('3 天后到期');
    expect(zh('A string nobody translated')).to.equal('A string nobody translated');
    expect(makeT('en')('Due in {n} days', { n: 3 })).to.equal('Due in 3 days');
  });
});
