// Categories for quick entry (the Record tab) and for the agent's add_transaction tool.
// `key` is what gets stored on Transaction.category; it matches the names already in the data.
exports.QUICK_CATEGORIES = [
  { key: 'DiningOut', label: 'Food', zh: '餐饮', icon: 'fa-utensils' },
  { key: 'Groceries', label: 'Groceries', zh: '买菜', icon: 'fa-basket-shopping' },
  { key: 'Transport', label: 'Transport', zh: '交通', icon: 'fa-bus' },
  { key: 'Shopping', label: 'Shopping', zh: '购物', icon: 'fa-bag-shopping' },
  { key: 'Clothing', label: 'Clothes', zh: '服饰', icon: 'fa-shirt' },
  { key: 'Entertainment', label: 'Fun', zh: '娱乐', icon: 'fa-film' },
  { key: 'Health', label: 'Health', zh: '医疗', icon: 'fa-heart-pulse' },
  { key: 'Utilities', label: 'Bills', zh: '账单', icon: 'fa-bolt' },
  { key: 'Travel', label: 'Travel', zh: '旅行', icon: 'fa-plane' },
  { key: 'Education', label: 'Study', zh: '学习', icon: 'fa-graduation-cap' },
  { key: 'Other', label: 'Other', zh: '其他', icon: 'fa-ellipsis' },
  { key: 'Income', label: 'Income', zh: '收入', icon: 'fa-sack-dollar', income: true },
];

exports.ALL_CATEGORY_KEYS = [...new Set([...exports.QUICK_CATEGORIES.map((c) => c.key), 'Subscriptions'])];

// Friendly display names for every stored category key (translated via the i18n dictionary).
exports.CATEGORY_NAMES = {
  ...Object.fromEntries(exports.QUICK_CATEGORIES.map((c) => [c.key, c.label])),
  Utilities: 'Utilities',
  Subscriptions: 'Subscriptions',
  Rent: 'Rent',
  Mortgage: 'Mortgage',
  Insurance: 'Insurance',
  Phone: 'Phone',
  Childcare: 'Childcare',
  Savings: 'Savings',
  Fees: 'Fees',
};

// Icon + colour tone for any stored category (history rows); fixed-cost categories have no quick card.
exports.CATEGORY_STYLE = {
  ...Object.fromEntries(exports.QUICK_CATEGORIES.map((c, i) => [c.key, { icon: c.icon, tone: i % 5 }])),
  Subscriptions: { icon: 'fa-repeat', tone: 3 },
  Rent: { icon: 'fa-house', tone: 0 },
  Mortgage: { icon: 'fa-house', tone: 0 },
  Insurance: { icon: 'fa-shield-halved', tone: 3 },
  Phone: { icon: 'fa-mobile-screen', tone: 2 },
  Childcare: { icon: 'fa-baby', tone: 1 },
  Savings: { icon: 'fa-piggy-bank', tone: 4 },
  Fees: { icon: 'fa-receipt', tone: 1 },
};
