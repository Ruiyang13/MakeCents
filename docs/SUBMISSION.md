# Submission checklist

FinTechathon 2026 International Track, Topic A. Deadline: **20 October 2026, 23:59 (UTC+8)**; registration closes at the same time.

| #   | Required by the rules                                                   | Where it is                                                                                                                    | Status                                                                 |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | Technical documentation: architecture, core algorithms, security design | [TECHNICAL.md](TECHNICAL.md)                                                                                                   | Done                                                                   |
| 2   | Presentation deck, 10 minutes or less                                   | Slides artifact (link from the team), speaker notes on every slide; export PDF/PPTX from it                                    | Draft done: fill in the team name on the cover notes, rehearse to time |
| 3   | Demo video, 5 minutes or less                                           | Script: [DEMO-SCRIPT.md](DEMO-SCRIPT.md)                                                                                       | To record                                                              |
| 4   | Source code: README, GitHub link, deployment instructions, test cases   | [README](../README.md) (local, Docker, hosting), [TEST-CASES.md](TEST-CASES.md), github.com/Ruiyang13/Plansmart                | Done; make sure the judges can open the repository                     |
| 5   | Security self-assessment: permission tiers and known-risk list          | [SECURITY.md](SECURITY.md)                                                                                                     | Done                                                                   |
| 6   | Execution evidence: sandbox operation logs and demo video               | [evidence/](evidence/README.md) (`npm run evidence`), plus the operation log downloaded from the app after recording the video | Logs done; video to record                                             |

## Before submitting

- [ ] Run `npm test`, `npm run evidence` and `npm run test-cases` once more and commit the regenerated files.
- [ ] After recording the video, download the operation log (Operation log → Download CSV) and add it to `docs/evidence/`.
- [ ] Repository visibility: public, or judges invited (it is private now: GitHub returns 404 to visitors).
- [ ] Decide the project's own licence: `package.json` says MIT but there is no `LICENSE` file. Add one (e.g. MIT) or set
      `"license": "UNLICENSED"` to keep all rights; the rules leave IP with the team either way.
- [ ] Every document and the video in English.
- [ ] Team registered; team composition meets the rules (2–5 members, at least 60% non-Chinese nationals, enrolled at overseas universities).
- [ ] Decide who attends the final in Shenzhen (21–23 November 2026); at least one member in person.
