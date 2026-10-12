# PlanSmart

AI personal finance assistant (FinTechathon 2026 International Track, Topic A: Personal Finance Assistant).
It reads a user's transactions, explains where the money goes, helps set budgets and savings goals, and warns
before overspending. English / 中文, light / dark mode, currency chosen at sign-up.

Submission documents:

- [Technical documentation](docs/TECHNICAL.md): architecture, core algorithms, security design
- [Security self-assessment](docs/SECURITY.md): permission tiers, controls, known-risk list
- [Test cases](docs/TEST-CASES.md): every automated test, generated from a real run
- [Execution evidence](docs/evidence/README.md): scripted sandbox scenario with its operation log (CSV/JSON)
- [Demo video script](docs/DEMO-SCRIPT.md) and [submission checklist](docs/SUBMISSION.md)

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
- **Operation log** (`/finance/audit`): every agent read, proposal, decision, refused attempt and money move, plus every change the user makes on the forms; downloadable as CSV or JSON.
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

## Run with Docker

Requires Docker with Compose. Runs PlanSmart and MongoDB together, in production mode.

```bash
cp .env.example .env      # set SESSION_SECRET (required) and ANTHROPIC_API_KEY (for chat and receipt reading)
docker compose up --build -d
docker compose run --rm app node scripts/seed-transactions.js   # demo households
# open http://localhost:8080 and sign in as okafor.demo@fintechathon.test / fintech1234
```

Generate a session secret with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
In production mode the app refuses to start with the placeholder secret, and the sign-in page hides the demo hint.

### Hosting it

Any Node 24 host works (e.g. Render, Railway, Fly.io) with a managed MongoDB (e.g. MongoDB Atlas):

1. Create the database and copy its connection string.
2. Deploy this repository (the Dockerfile, or `npm ci --omit=dev && node app.js`).
3. Set `NODE_ENV=production`, `MONGODB_URI`, `SESSION_SECRET`, `ANTHROPIC_API_KEY` and `BASE_URL=https://<your-domain>`
   (an `https` URL turns on secure cookies and HSTS).
4. Seed demo data once with `node scripts/seed-transactions.js`.
5. Set a monthly spending limit on the Anthropic API key, and consider `ANTHROPIC_MODEL=claude-haiku-5-5` for a
   public demo to keep each message cheap.

## Test

```bash
npm test                  # 78 tests: auth, CSRF, CSP, prompt injection, two-step sign-in, permissions, sandbox, bills, recommendations, goals, i18n, styles
npm run lint              # eslint + prettier
npm run check-tools       # smoke-test the agent's tools against seeded data
npm run evidence          # scripted sandbox scenario -> docs/evidence/ (operation log CSV/JSON + summary)
npm run test-cases        # regenerate docs/TEST-CASES.md from a test run
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

Third-party components, all used under their licences: npm dependencies under permissive licences (MIT, ISC,
Apache-2.0, BSD, MPL-2.0/Apache-2.0; see each package in `node_modules`); [Font Awesome Free](https://fontawesome.com)
icons (CC BY 4.0), fonts (SIL OFL 1.1) and code (MIT); Fraunces, Manrope and Inter from Google Fonts (SIL OFL 1.1);
Bootstrap (MIT). The AI features call Anthropic's Claude API under Anthropic's terms. Demo data is generated by
`scripts/seed-transactions.js`; no real personal data is used. The charts are our own code.
