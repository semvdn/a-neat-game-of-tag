---
name: release-git
description: Use at the end of any codebase modification when validating, committing, and packaging a downloadable A NEAT Game of Tag repository with trustworthy Git history.
---

# Release and Git workflow

## Required validation

Run:

```bash
tsc -p tsconfig.check.json --noEmit
git diff --check
```

If dependencies are present or can be installed reliably, also run `npm run build`. State clearly when the build could not be run.

For behavior-specific changes, run focused deterministic checks in addition to TypeScript.

## Real commit requirement

Before packaging:

```bash
git status --short
git add -A
git commit -m "<accurate imperative subject>"
git log -1 --oneline
git status --porcelain
```

A `COMMIT_MESSAGE.txt` file does not count as a commit. Do not report a commit hash until `git log` shows it as `HEAD`.

## Package with history

Create the ZIP from the repository root while including `.git` and excluding bulky/generated content such as `node_modules` and `dist`.

Then verify the artifact, not only the working directory:

1. test ZIP integrity;
2. extract into a new temporary directory;
3. confirm `.git` exists;
4. run `git log -1 --oneline` and verify the expected new hash/subject;
5. run `git status --porcelain` and require empty output;
6. run `git fsck --no-reflogs`.

Only after these checks should the ZIP be handed off.
