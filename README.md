# PlanSmart

AI personal finance assistant (FinTechathon 2026 International Track, Topic A: Personal Finance Assistant).
It reads a user's transactions, explains where the money goes, helps set budgets and savings goals, and warns
before overspending. English / 中文, light / dark mode.

## Features

| Tab           | What it does                                                                                                                                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Assistant** | Chat with the agent (Claude) in English or Chinese; voice input; **+** uploads a receipt or payment screenshot, AI reads it and you confirm every row. This month's everyday-spending calendar, with fixed costs listed apart. Chat history is kept. |
| **Insights**  | Ranked recommendations with evidence and estimated yearly savings; day-by-day everyday spending; everyday and fixed-bill composition (Lieflat Charts, Wire style); detected recurring bills, price rises, overlapping subscriptions.                 |
| **Record**    | Card-style bookkeeping (卡片式记账): tap a category, key in the amount. Budget bars per card. Searchable, filterable spending history grouped by day.                                                                                                |
| **Budgets**   | Every category's monthly budget in one table, with usual spending and progress. Budgets repeat every month.                                                                                                                                          |
| **Goals**     | Savings goals with a piggy bank that fills up, and an automatic plan: per week / per month, whether it fits what's usually left over, which categories to trim, or a realistic date.                                                                 |

### Safety model

- **Read tier:** analysis tools run automatically and are logged.
- **Write tier:** the agent can only _propose_ changes (record spending, set budgets); nothing happens until the user presses Confirm.
- **No money movement:** there is no tool for payments or transfers.
- Every tool call is recorded in an operation log (`/finance/audit`).
- Scanned images: text in the image is treated as data; every row is validated and reviewed by the user before saving.

## Run locally

Requires Node 24+ and a local MongoDB.

```bash
npm install
cp .env.example .env      # then set SESSION_SECRET and ANTHROPIC_API_KEY in .env
npm run seed              # 3 demo households (password fintech1234), incl. demo savings goals
npm start                 # http://localhost:8080
```

`npm run seed -- --goals-only` recreates only the demo savings goals and leaves transactions alone.
Never commit `.env` (it holds the API key); it is in `.gitignore`.

## Test

```bash
npm test                  # 64 tests: auth, CSRF, permissions, bills, recommendations, goals, i18n, styles
npm run lint              # eslint + prettier
npm run check-tools       # smoke-test the agent's tools against seeded data
```

Tests use an in-memory MongoDB and stub the Claude calls, so they need no API key.

## Structure

```
app.js            Express app: security middleware, routes
config/           login (passport), flash messages, categories, i18n (English keys + i18n-zh.json)
controllers/      finance-agent (agent, tools, permissions, calendar), bills, recommendations,
                  records (card entry + receipt scan), budgets, goals, user (accounts), home
models/           User, Transaction, Budget, SavingsGoal, ChatThread, AgentAction (audit log + pending confirmations)
views/            Pug templates (not auto-formatted: the Prettier Pug plugin breaks some valid templates)
public/           CSS and browser JS
scripts/          demo data seed, tool smoke test
test/             mocha tests
```

## Credits

The chat streaming (SSE) and MongoDB checkpoint pattern in `controllers/finance-agent.js` and
`views/finance/agent.pug` were adapted from [hackathon-starter](https://github.com/sahat/hackathon-starter)
(MIT, © Sahat Yalkabov). See `THIRD_PARTY_LICENSE-hackathon-starter.txt`.
Charts follow the Lieflat Charts templates.
