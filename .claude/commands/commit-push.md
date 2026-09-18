---
description: Commit the current changes and push them to the remote repository
---

Commit and push the pending work on the current branch:

1. Run `git status`, `git diff` (staged and unstaged), and `git log --oneline -10` to see what changed and match this repo's commit message style.
2. If there are no changes at all (staged, unstaged, or untracked), say so and stop — never create an empty commit.
3. Stage the relevant files. Prefer adding specific files over a blanket `git add -A`; after staging, review `git status` and double-check the contents of anything that looks sensitive (`.env`, credentials, keys) before committing.
4. If the working tree mixes clearly unrelated pieces of work, use judgment: bundle them into one commit if that matches how this repo/session has been working, or ask before committing something that looks like unfinished/experimental work.
5. Write a concise commit message focused on *why*, following the existing log style. If arguments were passed to this command ($ARGUMENTS), use them as the intent/summary for the message instead of inferring one.
6. Create the commit via a HEREDOC (`git commit -m "$(cat <<'EOF' ... EOF)"`), ending with the attribution line required by this session's system reminder.
7. Push to `origin` on the current branch (no force-push).
8. Report the resulting commit hash/message and confirm the push succeeded.

Follow the standard git safety rules: never use `--no-verify`, `--force`, or amend an existing commit unless explicitly asked.
