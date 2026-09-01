# skills

Agent skills by [Daniel Moka](https://danielmoka.com) — battle-tested practices from real codebases, packaged so your coding agent can execute them.

## Try one right now

Paste this into Claude Code, Cursor, or any agent that can fetch a URL:

```
Read https://raw.githubusercontent.com/dmoka/skills/main/skills/mutation-testing/SKILL.md
and the reference files it links, then run its loop on this project.
```

That's the whole install for a first run.

## The skills

| Skill | What it does |
|---|---|
| [`mutation-testing`](skills/mutation-testing/SKILL.md) | Measures whether your tests would actually catch bugs — not whether code ran. Detects your stack (JS/TS, C#, Java, Python, Rust, PHP…), sets up the right mutation tool, runs it scoped, explains every surviving mutant as the lie your suite is telling, then writes the killing tests. |

## Why mutation testing

100% code coverage is not a quality metric. Coverage tells you what code was
executed — not whether a single assertion would fail if the code were wrong.
Mutation testing plants small bugs and checks that your tests notice. Every
surviving mutant is a blind spot with a name.

**See it catch a real bug:** [the YouTube video](https://youtu.be/0K-5p6SgjSM)
where an AI tester team finds a refund bug a green, 95%-mutation-score suite
missed — and the demo repo, [ticket-bay](https://github.com/dmoka/ticket-bay),
you can run yourself.

## Install permanently (Claude Code)

```bash
git clone https://github.com/dmoka/skills
cp -r skills/skills/mutation-testing your-project/.claude/skills/
```

Claude Code discovers it automatically. Other agents: point them at the
`SKILL.md` file, or paste its contents into your rules file.

## More

- Newsletter: [craftbettersoftware.com](https://craftbettersoftware.com) — software craftsmanship for the AI era, weekly
- Site: [danielmoka.com](https://danielmoka.com)
- Find more agent skills: [getagentictools.com](https://getagentictools.com)

MIT licensed. Steal it.
