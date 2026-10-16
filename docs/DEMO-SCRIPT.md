# Demo video script (5 minutes)

A shot list for recording the demo video (rules item 3, and the video half of item 6). Times are targets;
the whole thing should land just under 5:00. Record at 1440×900 or larger, browser zoom 100%, light mode.

The story: the assistant **understands** (questions, Chinese, a receipt), **decides** (insights that say what to do)
and **acts** (a budget, a savings goal, a warning when you go over), and every step is **under your control and logged**.

## Before recording

- [ ] `npm run seed` for fresh demo data (transactions, goals, operation log, budgets and fixed-cost
      corrections all reset), then sign in as **okafor.demo@fintechathon.test**, password `fintech1234`.
- [ ] Account page: currency **GBP**.
- [ ] Set `ANTHROPIC_MODEL=claude-haiku-5-5` in `.env` for rehearsals (cheap); switch back to the default for the take
      if you want Opus answers. Restart the server after changing it.
- [ ] Have a receipt photo ready on the desktop (any supermarket receipt).
- [ ] Start a **New chat** so old messages don't show.
- [ ] Internet on (the yen entry fetches today's exchange rate).
- [ ] Close other tabs and notifications. Language: **English** (the Chinese question is typed, the page stays English).
- [ ] Rehearse once, then `npm run seed` again before the real take (the rehearsal sets the Health budget and changes the goals).

## Shots

| Time      | Screen                                    | Action                                                                                                                                                                 | Voice-over (suggested)                                                                                                                                                                                                           |
| --------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Home page                                 | Scroll slowly                                                                                                                                                          | "MakeCents, 厘明 in Chinese, is a personal finance assistant where the AI doesn't just talk about your money, it completes tasks, always with you in control."                                                                   |
| 0:15–0:45 | Assistant                                 | Ask: **"Why was last month so expensive?"** Let the answer stream; point at the activity panel                                                                         | "It answers from this household's real transactions. On the right you see each step it takes: every tool call is a read, logged, and limited to this user's data."                                                               |
| 0:45–1:10 | Assistant                                 | Type: **"刚在东京吃拉面花了3000日元"**. Card: "Record −3000 JPY … · converted at today's rate"; **Confirm**                                                            | "Casual Chinese works too, and so does money spent abroad: three thousand yen becomes a proposal in yen, converted to pounds at today's rate when I confirm. The original amount is kept."                                       |
| 1:10–1:35 | Assistant                                 | Click the upload area, choose the receipt. Review sheet opens (note the **currency** picker); fix one field; **Save**                                                  | "Upload a receipt or a payment screenshot. Claude reads it into rows, even the currency, but nothing is saved until I've checked them. Text in the image is treated as data, never as instructions."                             |
| 1:35–1:50 | Record → Spending history                 | Point at the ramen row: **−£… / JP¥3,000 · JPY**. Then the scanned row: **pencil**, change the category, **Save changes**                                              | "Every payment records the currency it was paid in. And anything I added myself I can still edit or delete; imported bank history stays untouched."                                                                              |
| 1:50–2:25 | Insights                                  | Scroll to **What I'd do next**. Point at the total, then the Health card: evidence line, action naming **NHS prescription**. Click **Set this budget**                 | "Insights don't stop at charts. Each card shows the evidence, names what's behind it, here a prescription that pushed Health up 137%, and gives a concrete next step with a yearly saving. One click hands it to the assistant." |
| 2:25–2:45 | Assistant                                 | The question arrives ("Set my Health budget to 45 a month"); proposal card appears; **Confirm**                                                                        | "Changes are proposals. The card shows exactly what will change, and nothing happens until I confirm."                                                                                                                           |
| 2:45–3:00 | Insights                                  | Reload; the new top card: **Health is £… over budget**, "Pause Health for the remaining … days"                                                                        | "And the moment the budget exists, it watches it: this month is already over, so it tells me what to do for the rest of the month."                                                                                              |
| 3:00–3:15 | Insights → Fixed costs                    | Scroll to **Fixed costs each month**. Add **Cleaner**, category Other, **60**, due day **5**; **Add fixed cost**. Total goes up                                        | "Bills are detected automatically, but I can correct them, mark something as not fixed, or add one the bank can't see, like a cleaner paid in cash. Every plan and insight follows."                                             |
| 3:15–3:35 | Assistant                                 | Type: **"I just put 100 into my Family holiday jar"**. Card: "Put 100 into Family holiday"; **Confirm**                                                                | "No bank is connected, and it never touches real money. I tell it what I saved, it proposes the record, and nothing changes until I confirm."                                                                                    |
| 3:35–3:50 | Goals                                     | Open Goals; the Family holiday jar drops in "+£100". Then on Boiler replacement fund type **20**, **Take out**: coins fly out of the jar, "−£20"                       | "The goal updates and only that jar animates the money that just arrived. Take money out and you see it leave."                                                                                                                  |
| 3:50–4:15 | Assistant                                 | Type: **"paid 20 for another prescription"**. The card shows a red line: **Over budget: this takes Health to £… this month (budget 45)**. **Confirm** anyway           | "It's my money, so going over a budget is never blocked. It just warns me, on the card and in its reply, and the choice stays mine."                                                                                             |
| 4:15–4:42 | Operation log                             | Show the table: reads, the yen entry, the confirmed budget, the goal top-up, the over-budget record with its warning, the edit and fixed-cost change. **Download CSV** | "Everything is in the operation log: what the assistant read and proposed, what I confirmed or changed myself, and every warning. It downloads for audit."                                                                       |
| 4:42–5:00 | Assistant panel "What it's allowed to do" | Hold on the tiers                                                                                                                                                      | "Read automatically, propose with your confirmation, warn when you go over, and never touch real money. That's MakeCents."                                                                                                       |

## After recording

- [ ] Operation log → **Download CSV**, save it as `docs/evidence/demo-video-operation-log.csv`, commit and push.
- [ ] Check the video is 5:00 or less and in English (the Chinese message is fine: it shows the bilingual feature).

## If something goes wrong

- The agent talks about a "sandbox account" → you're on an old chat or old server; start a **New chat** and restart the server.
- No red warning on the prescription card → the Health budget wasn't confirmed earlier (check the operation log).
- The Health card isn't there → the data was used in a rehearsal;
  `npm run seed` resets it.
- No "over budget" card after confirming → the budget wasn't confirmed (check the operation log), or Insights wasn't reloaded.
