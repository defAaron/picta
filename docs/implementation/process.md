# How a Picta problem gets finished

The main agent is the orchestrator. It deploys subagents, watches them, and stops the delivery when the current numbered problem is done. Subagents write code. The orchestrator does not take over their files while they are running.

Numbered problems are delivered one at a time. Inside the current problem, subagents run in the waves that problem file lists. When one wave finishes, the orchestrator deploys the next wave. It does not open the next numbered problem.

One agent may own several subproblems when they share a file or are the same kind of work. Two agents must not edit the same file.

## What a subagent is told

Give each subagent only this:

- The problem file path and the subproblem ids it owns
- The files it may create or edit
- The files it must not touch
- The tests it must run
- Do not commit. Do not push. Do not read later problem files.

## When the problem is finished

Do these in order. Then stop.

1. Run `npm test`. Fix failures inside this problem only.
2. Run the security checks below if this problem added a route, an env file, a parser, or a provider client.
3. Replace `docs/implementation/handoff.md` using the handoff format below.
4. Stagger the problem into several commits, as in Git below. The handoff is the last of those commits. Do not push. Do not commit `.env`, `data/`, or `*.sqlite`.
5. Reply with the summary format below.
6. Start `npm run dev`. If port 3000 is taken, use the port Next prints. Put the URL in the reply.

The handoff is for the next agent. It exists so that agent does not reload the whole repo or the finished problem's history.

## Summary format

```markdown
## Problem N done

What changed:
- [user-visible behavior]
- [server behavior, if any]

How to test:
1. Open [url]
2. [click-by-click steps]

Not in this build:
- [the next problem's behavior, one line]
```

## Handoff format

Replace the whole file. Keep it under one screen.

```markdown
# Handoff

**Finished:** Problem N — [name]
**Next:** Problem N+1 — [name]
**Do this next:** [one sentence]

## Read

- docs/implementation/0N-....md
- docs/implementation/README.md (global constraints only)
- [source files the next problem will edit, and nothing else]

## Do not read

- Later problem files
- [finished files that are now stable]
- docs/prd.md and docs/architecture.md, unless the problem file names a heading

## Trust these

- [function or route]: [signature and what it guarantees]

## Do not redo

- [behavior that already works]
```

## Security checks

Run these before the commits. A failed check blocks every commit for this problem.

- `git status` shows no `.env`, `.env.local`, `data/`, or `*.sqlite`. Those patterns are in `.gitignore`. `.env.example` has blank values.
- Search the diff for `GEMINI_API_KEY`, `MAGIC_HOUR_API_KEY`, and any `Bearer ` value. None are committed. Client components do not read those env names.
- Each new route returns 400 for a bad body without calling a provider. A test proves it.
- Each route that calls Gemini or Magic Hour has a test where a rate-limit refusal happens and the provider mock records zero calls.
- Page text never appears in a SQLite write. The scene prompt may sit only on the in-flight row, and that row is deleted when the job ends.
- Log lines in the diff do not interpolate page text, image prompts, photo bytes, or keys.
- `X-Forwarded-For` is unused unless `TRUSTED_PROXY` is the string `true`.

## Git

Subagents do not commit. After the tests and security checks pass, the orchestrator makes the commits.

Stagger the finished problem so a later reader can find one change without reading the whole problem. Judge the boundaries from the waves and subproblems. A library and its tests belong in one commit. A screen and a route are their own commits. Order the commits so each one builds on the previous.

- A smaller problem gets 5–8 commits.
- A larger problem gets 10–16 commits.
- Do not put the whole problem in one commit.
- The handoff is its own last commit for that problem.
- Message: `feat:` or `docs:`, then what that slice is for, in one or two sentences.
- Do not push.
- Do not commit `.env`, `data/`, or `*.sqlite`.
- Do not amend a commit that was already shown to the user.
