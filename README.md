# skills

Agent skills by [Daniel Moka](https://danielmoka.com) — battle-tested practices from real codebases, packaged so your coding agent can execute them.

## Try one right now

Paste this into Claude Code, Cursor, or any agent that can fetch a URL:

```
Fetch the raw text of
https://raw.githubusercontent.com/dmoka/skills/main/skills/mutation-testing/SKILL.md
and the reference files it links (use curl, not a summarizing fetch tool),
then run its loop on this project.
```

That's the whole install for a first run. The "use curl" part matters: some
agents' built-in fetch tools summarize a page instead of returning it, which
quietly paraphrases the instructions away.

## The skills

| Skill | What it does |
|---|---|
| [`mutation-testing`](skills/mutation-testing/SKILL.md) | Measures whether your tests would actually catch bugs — not whether code ran. Detects your stack (JS/TS, C#, Java, Python, Rust, PHP…), sets up the right mutation tool, runs it scoped, explains every surviving mutant as the lie your suite is telling, then writes the killing tests. |
| [`pr-triage`](skills/pr-triage/SKILL.md) | Reads every open PR and tells you which ones need real attention first — critical, high, medium, low — judged from what each change actually does, not its size or title. Each judgement points at the line that drives it, and each PR opens a full reading tour. No setup. One folder of self-contained HTML plus JSON. |
| [`pr-tour`](skills/pr-tour/SKILL.md) | Turns one PR into a reading tour: the author's intent and claims first, then where to look and why, then files in the order a reviewer should read them — tests next to their code, lockfiles and renames collapsed last. Points attention, never gives a verdict. |
| [`grill-me`](skills/grill-me/SKILL.md) | Makes the agent interview you about a plan before it builds anything — one hard question at a time, each with its recommended answer, the codebase checked before you are asked. Refuses a bulk "agree with all". Adapted from Matt Pocock's skill (MIT). |

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

For one project:

```bash
git clone https://github.com/dmoka/skills
mkdir -p your-project/.claude/skills
cp -r skills/skills/mutation-testing your-project/.claude/skills/
```

For all your projects, copy it to `~/.claude/skills/` instead:

```bash
mkdir -p ~/.claude/skills
cp -r skills/skills/mutation-testing ~/.claude/skills/
```

Claude Code discovers it automatically. Other agents: point them at the
`SKILL.md` file, or paste its contents into your rules file.

## More

- Newsletter: [craftbettersoftware.com](https://craftbettersoftware.com) — software craftsmanship for the AI era, weekly
- Site: [danielmoka.com](https://danielmoka.com)
- Find more agent skills: [getagentictools.com](https://getagentictools.com)

MIT licensed. Steal it.
