const features = [
  {
    icon: 'fa-magnifying-glass-chart',
    title: 'Spending insights',
    text: 'Ask in plain English: why was last month expensive? Which subscriptions am I not using?',
  },
  { icon: 'fa-bullseye', title: 'Budgets that fit', text: 'Budgets proposed from your real spending history, applied only when you confirm.' },
  { icon: 'fa-bell', title: 'Early warnings', text: 'See which categories are over, nearly over, or on pace to exceed this month.' },
  { icon: 'fa-shield-halved', title: 'Safe by design', text: 'Tiered permissions, human confirmation for every change, full operation log.' },
];

exports.index = (req, res) => {
  if (req.user) return res.redirect('/finance');
  res.render('home', { title: 'Home', features });
};
