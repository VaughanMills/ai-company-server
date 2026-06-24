# AI Company Server

This is the backend ("back office") for our AI company. It runs a COO agent
powered by Claude that has permanent memory of past conversations and decisions.

## What's here

- `server.js` — the program that runs on Render. Holds the API key, stores
  memory, and lets the COO think.
- `package.json` — lists what the server needs to run.
- `test-page.html` — a simple page to chat with the COO once it's live.
- `README.md` — this file.

## How the pieces fit

```
Your web page  ->  this server (on Render)  ->  Claude API
  (the face)        (holds key + memory)         (the brain)
```

The web page never talks to Claude directly. It talks to this server, which
keeps the secret API key safe and remembers everything.

## The COO's memory

The COO has no memory on its own. This server keeps a file (`data/coo-memory.json`)
on a Render persistent disk, so it survives restarts. Each time you chat, the
server feeds recent history to the COO, then saves the new exchange.

## Deploy steps (high level)

1. Put these files in a GitHub repository.
2. On Render, create a new Web Service connected to that repository.
3. Add a persistent disk (mounted at `/data`) so memory is permanent.
4. Add an environment variable `ANTHROPIC_API_KEY` with the key (kept secret).
5. Set environment variable `MEMORY_DIR` to `/data`.
6. Deploy. Visit the server URL — it should say the COO is ready.
7. Put your Render URL into `test-page.html` and chat with the COO.

## Changing the COO's brain

In `server.js`, find `COO_MODEL`. Set it to one of:
- `claude-haiku-4-5` (cheapest)
- `claude-sonnet-4-6` (balanced — the current default)
- `claude-opus-4-8` (most capable, priciest)

## Roadmap

- [x] Step 1: COO agent with permanent memory (this).
- [ ] Step 2: virtual office page (visual control room).
- [ ] Step 3: Engineer + R&D agents the COO can delegate to.
- [ ] Step 4: lock it behind a Squarespace page.
