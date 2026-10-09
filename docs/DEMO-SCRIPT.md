# Demo video script (5 minutes)

A shot list for recording the demo video (rules item 3, and the video half of item 6). Times are targets;
the whole thing should land just under 5:00. Record at 1440×900 or larger, browser zoom 100%, light mode.

## Before recording

- [ ] `npm run seed` for fresh demo data, then sign in as **okafor.demo@fintechathon.test** (password in the README).
- [ ] Account page: currency **GBP**. Two-step sign-in **on** (scan the QR with your phone) so the money step shows the code.
- [ ] Set `ANTHROPIC_MODEL=claude-haiku-5-5` in `.env` for rehearsals (cheap); switch back to the default for the take
      if you want Opus answers. Restart the server after changing it.
- [ ] Have a receipt photo ready on the desktop (any supermarket receipt).
- [ ] Start a **New chat** so old messages don't show.
- [ ] Close other tabs and notifications.

## Shots

| Time      | Screen                                    | Action                                                                                                                                | Voice-over (suggested)                                                                                                                                                                                        |
| --------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | Home page                                 | Scroll slowly                                                                                                                         | "PlanSmart is a personal finance assistant where the AI doesn't just talk about your money, it completes tasks: it analyses, proposes, and moves money in a sandbox, always with you in control."             |
| 0:20–0:55 | Assistant                                 | Ask: **"Why was last month so expensive?"** Let the answer stream; point at the activity panel                                        | "It answers from the household's real transactions. On the right you can see each step it takes: every tool call is a read, logged, scoped to this user."                                                     |
| 0:55–1:25 | Assistant                                 | Ask: **"我上个月花最多的是什么？"**                                                                                                   | "It understands casual English and Chinese and answers in the language you write in."                                                                                                                         |
| 1:25–2:00 | Assistant                                 | Click the upload area, choose the receipt. Review sheet opens; edit one field; **Save**                                               | "Upload a receipt or payment screenshot. Claude reads it into rows, but nothing is saved until you check them. Text in the image is treated as data, never as instructions."                                  |
| 2:00–2:35 | Assistant                                 | Ask: **"Set me a realistic eating-out budget."** Card appears; **Confirm**                                                            | "Changes are proposals. The budget card shows exactly what will change, and nothing happens until I confirm."                                                                                                 |
| 2:35–3:20 | Assistant                                 | Ask: **"Move 100 from my sandbox account into my Family holiday goal."** Red card; **Confirm**; enter the 6-digit code from the phone | "Now it moves money, in a simulated sandbox account. Only to my own goals or detected bills, 500 per move, 1,000 a day, and because two-step sign-in is on, it needs a fresh code from my authenticator app." |
| 3:20–3:35 | Goals                                     | Open Goals; the Family holiday jar drops in "+£100"                                                                                   | "The goal updates, and only that jar animates the money that just arrived."                                                                                                                                   |
| 3:35–3:55 | Assistant                                 | Ask: **"Move 600 into Family holiday."** It explains the limit                                                                        | "Ask for more than the limit and it can't; the rule is enforced in code, not just in the prompt."                                                                                                             |
| 3:55–4:25 | Operation log                             | Show the table: reads, the confirmed budget, the money move with balance before → after, the refused attempt. Click **Download CSV**  | "Everything is in the operation log: what the assistant read, proposed and moved, what I confirmed, what was refused and why, with balances before and after. It downloads as CSV or JSON for audit."         |
| 4:25–4:45 | Insights                                  | Hover the pace chart, then a pie slice                                                                                                | "Insights compare this month with the same point last month, and keep fixed bills apart from everyday spending."                                                                                              |
| 4:45–5:00 | Assistant panel "What it's allowed to do" | Hold on the four tiers                                                                                                                | "Read automatically, propose with your confirmation, move money only in the sandbox with limits and a code, and never touch real money. That's PlanSmart."                                                    |

## If something goes wrong

- The agent says it can't move money → you're on an old chat or old server; start a **New chat** and restart the server.
- No code box appears on Confirm → two-step sign-in isn't on for this account (Account page).
- A move is refused for the daily limit, or the data looks used → `npm run seed` resets the demo households: transactions,
  goals, sandbox balance (back to 2,500) and operation log.
