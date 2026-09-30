# Kleeno — Git, GitHub and Publishing

How agents commit, push, merge and publish. Read before any commit, push, PR, merge, tag or visibility change (ESSENTIALS rule 56). On anything unclear or failing: stop and ask the user.

## 1. Setup (P0, once)
- Repo: `Ivan-Ryukendo/kleeno`, **private**, default branch `main`. The user confirms the name; the agent runs `gh repo create kleeno --private --source . --push`.
- Commit identity (repo-local, already set 2026-09-30): `user.email = 107222682+Ivan-Ryukendo@users.noreply.github.com`. Check with `git config user.email` before the first commit of every session. Never commit with a personal email.
- The user turns on, in GitHub → Settings → Emails: "Keep my email addresses private" and "Block command line pushes that expose my email".
- Local gitleaks: official release binary in `.tools/gitleaks/` (git-ignored, like Foundry). Add it to PATH in each shell, as for Foundry.
- GitHub Free has no branch protection on private repos. Until the repo is public (§5), the rules below are the protection.

## 2. Branches and deploys
- One branch per phase: `p1-thin-slice`, `p2-foundation`, … Small fixes between phases use `fix-<topic>`. Never work directly on `main`. Only exception: the P0 first commit, which creates `main`.
- `main` = production: from P2 on, every merge to `main` deploys to Vercel production. Only merge code whose CI is green and which the user has seen working.
- Vercel preview deployments stay off for branches, because Preview has no secrets (`docs/security.md` §2) and the app would fail its env check. Set this in P2 when Vercel is linked (project setting or `vercel.json` `git.deploymentEnabled`; check current Vercel docs).

## 3. Committing (every commit)
Commit only at the end of a phase, after the user has seen it working (CLAUDE.md flow), or when the user asks.

Before `git commit`, all of these must pass:
1. `git status` and `git diff --cached --name-only`: only intended files. Never stage `.env*` (except `.env.example`), `*.pem`, keystores, `*-recovery-file.json`, `.tools/`, `.npm-cache/`, `.next/`, `contracts/out/`, `.claude/settings.local.json`, real pilot data, or screenshots containing data.
2. `gitleaks git --pre-commit --staged -v` → no leaks. (Syntax differs between gitleaks versions: check `gitleaks --help`.)
3. `npm run lint`, `npm run typecheck`, `npm test`; `forge test` in `contracts/` if contracts changed; `npm run test:db` from P2 on.
4. `PROGRESS.md` updated and security row statuses set, so they ship in the same commit.

Also commit `package-lock.json`, the `contracts/lib/forge-std` submodule, and the Next.js block in `CLAUDE.md` (re-added by `next dev`).

Message:
```text
P1: thin slice: guarded payment on Arc testnet

- what changed, in plain words (3-6 lines)
- security rows: S01-S05 verified, S28 unverified (reason)

Co-Authored-By: <attribution line from the session instructions>
```

Never: `--no-verify`, `--amend` on pushed commits, force-push, history rewrites, deleting branches with unmerged work, or changing git config other than `user.email`/`user.name`. The only exception is the history clean-up in §5, and only with the user's approval.

## 4. Pushing and merging
1. `git push -u origin <branch>`.
2. `gh pr create --base main --title "P1: …" --body "…"`. The body holds the phase summary, the "Done when" results and the security row statuses, and ends with the PR attribution line from the session instructions. Register the PR with the thread (`link_pull_request`) if that tool exists.
3. `gh pr checks --watch`: CI (web, contracts, secrets) must be green. If it's red, fix it on the branch and push again; the stuck rule applies after 3 failed fixes. Never skip, weaken or disable a check or protected test to get green.
4. `gh pr merge --squash --delete-branch`, so there is one commit per phase on `main`.
5. From P2 on: open the production URL and confirm it loads, and that login works for P2+.
6. `git checkout main && git pull`.

Tags: `demo-freeze` on Oct 8 (`git tag demo-freeze && git push origin demo-freeze`). Nothing merges after that except additive fixes the user approves.

## 5. Going public (P5, before submission)
The hackathon requires a public repo link. Do these in order; the visibility flip needs the user's explicit OK on the day.
1. **Full-history secret scan:** `gitleaks git -v` over every commit → zero findings. If anything is found, the user rotates that key **first**. History is then cleaned only with the user's approval, and the scan re-runs.
2. **Tracked files:** `git ls-files`. No env files, keys, recovery files, real pilot data, names, or screenshots with data. Demo data is synthetic and labelled.
3. **Author emails:** `git log --format='%ae' | sort -u` shows only noreply addresses.
4. **README:** honest framing (Arc testnet, custodial wallets, no real funds, net amounts public on-chain). Demo logins go in the submission form, not in the README.
5. **License (user decides):** default is none, so the README says "All rights reserved". People may read the code but not reuse it.
6. **Flip:** `gh repo edit --visibility public --accept-visibility-change-consequences`.
7. **Right after:** enable secret scanning + push protection, Dependabot alerts, and a ruleset on `main` (require CI checks, block force-push and deletion).
8. Keep the repo public until judging ends. Afterwards the user may continue product work in a new private repo; forks and clones of the public one can't be recalled.

## 6. Hosting checks before submission (user decisions)
- **Supabase:** free projects pause after about a week without activity. Judging runs after Oct 10, so upgrade `kleeno-prod` to Pro for the judging weeks, or make sure it is used regularly. Pro also adds daily backups.
- **Vercel:** Hobby is for non-commercial use. It's fine for the hackathon; move to Pro before real pilot businesses use Kleeno.
- **OpenRouter:** the $5 cap may run out if many judges use the AI steps. Raise it for the judging window, or accept that AI steps pause.
- **Final smoke test:** open the live URL in a private window, log into the demo company, confirm SIMULATION works and that live payments are OFF there.

Check current pricing and terms on each provider's site; these limits change.
