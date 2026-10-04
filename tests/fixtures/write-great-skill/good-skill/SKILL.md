---
name: good-skill
description: "Cut a release of the web app. Use when the user says release, ship, cut a version, tag a release or publish. Builds, tests, tags and pushes through scripts/release.sh; dry run first, never pushes without approval."
---

# Release

## Steps

1. **Check.** Run `scripts/release.sh 1.2.3`. Done when it prints the dry run.
2. **Push.** Read [references/notes.md](references/notes.md) when a tag already exists. Done when the tag is on origin.

## Gotchas

- Never force-push a tag.
