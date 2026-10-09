# PlanSmart

AI personal finance assistant (FinTechathon 2026 International Track, Topic A: Personal Finance Assistant).
It reads a user's transactions, explains where the money goes, helps set budgets and savings goals, and warns
before overspending. English / 中文, light / dark mode, currency chosen at sign-up.

Technical documentation (architecture, algorithms, security design): [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Features

| Tab           | What it does                                                                                                                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Assistant** | Chat with the agent (Claude) in English or Chinese; voice input; click or drop a receipt or payment screenshot under the chat bar, AI reads it and you confirm every row. This month's everyday-spending calendar, with fixed costs listed apart. Chat history is kept. |
| **Insights**  | This month's spending against last month at the same point (interactive pace chart), a category pie chart with changes, then ranked recommendations with estimated yearly savings and bill alerts.                                                                      |
| **Record**    | Card-style bookkeeping (卡片式记账): tap a category, key in the amount. Budget bars per card. Searchable, filterable spending history grouped by day.                                                                                                                   |
| **Budgets**   | Every category's monthly budget in one table, with usual spending and progress. Budgets repeat every month.                                                                                                                                                             |
| **Goals**     | Savings goals with a glass jar of coins and notes that fills up (only new money drops in), and an automatic plan: per week / per month, whether it fits what's usually left over, which categories to trim, or a realistic date.                                        |

### Safety model

- **Read tier:** analysis tools run automatically and are logged.
- **Write tier:** the agent can only _propose_ changes (record spending, set budgets); nothing happens until the user presses Confirm.
- **Money movement, sandbox only:** the agent can move money from a simulated sandbox account into the user's own savings goals or pay a detected bill. Every move needs confirmation (plus an authenticator code if two-step sign-in is on), with limits of 500 a move and 1,000 a day, an atomic balance check, and before/after balances in the operation log. There is no tool for real money, paying anyone else, or editing transactions.
- **Two-step sign-in:** optional authenticator-app codes (TOTP), set up on the Account page.
- **Content-Security-Policy:** scripts only from the app itself or inline blocks with a per-request nonce.
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
npm test                  # 74 tests: auth, CSRF, permissions, bills, recommendations, goals, i18n, styles
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
