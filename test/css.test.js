const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');

// Guard against stylesheet edits silently dropping the rules whole pages rely on
// (this happened once: the Budgets table and money inputs lost all their styling).
describe('Stylesheet', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/css/main.css'), 'utf8');
  const required = {
    budgets: ['.budget-table', '.budget-input', '.budget-table .progress-col'],
    record: ['.rec-grid', '.rec-card', '.rec-budget', '.rec-keypad', '.rec-sheet', '.hist-row', '.hist-search', '.hist-filter'],
    goals: ['.goals-grid', '.goal-card', '.jar', '.goal-plan'],
    assistant: ['.chat-log', '.composer', '.cal-cell', '.hm-gradient', '.approval'],
    insights: ['.lf-card', '.lf-hero', '.cat-rows', '.lf-tag', '.rec-items', '.rec-saving'],
  };
  for (const [page, selectors] of Object.entries(required)) {
    it(`has the ${page} page styles`, () => {
      const missing = selectors.filter((s) => !css.includes(`${s} {`) && !css.includes(`${s},`));
      expect(missing).to.deep.equal([]);
    });
  }
});
