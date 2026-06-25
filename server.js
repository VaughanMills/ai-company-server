// ===========================================================================
//  AI COMPANY SERVER  —  the COO plus the team (R&D, Engineer, Marketing)
// ===========================================================================
//
//  WHAT THIS FILE IS:
//  The "back office" running on Render. It:
//    1. Holds your secret API key and shared portal password.
//    2. Keeps permanent memory on the persistent disk.
//    3. Runs the COO and the team. You approve each step; the COO delegates
//       to one worker at a time, the worker thinks, and reports back.
//
//  THE TEAM:
//    - COO        : directs and decides. No web search (it delegates research).
//    - R&D        : finds what to make. HAS web search (live trends).
//    - Engineer   : designs the product. No web search (designs from brief).
//    - Marketing  : writes listings to sell. HAS web search (keywords/trends).
//
//  HOW DELEGATION WORKS (approve-each-step):
//    You send the COO a goal. The COO replies with its thinking and, when it
//    wants a worker to act, includes a line like:  DELEGATE: rnd | <task>
//    The portal shows you that proposed step with an Approve button. When you
//    approve, the server runs that one worker, saves the result, and hands it
//    back to the COO for the next move. Nothing runs without your click.
// ===========================================================================

import express from "express";
import cors from "cors";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";

// --- Configuration --------------------------------------------------------

// Which AI provider powers each agent: "claude" or "grok".
// R&D is on Grok as a test; the rest stay on Claude. Flip any back anytime.
const PROVIDER = {
  coo: "claude",
  rnd: "grok",
  engineer: "grok",
  marketing: "grok",
};

const MODELS = {
  coo: "claude-sonnet-4-6",
  rnd: "grok-4.3",
  engineer: "grok-4.3",
  marketing: "grok-4.3",
};

const WEB_SEARCH = {
  coo: false,
  rnd: true,
  engineer: false,
  marketing: true,
};

const PROMPTS = {
  coo: `You are the COO of a small print-on-demand company that designs products
(mugs, t-shirts, posters) to sell on Etsy and Shopify with no upfront inventory.

You direct a team and make the decisions. Your team:
- R&D: researches what is selling and what to make (has live web access).
- Engineer: designs the actual product concept and the text/art on it.
- Marketing: writes the listing (title, description, keywords, price).

You think strategically, weigh effort vs. likely return, and keep the company
focused. You report to the human owner, who has final say and publishes things.
You never spend money or take real-world actions — you recommend.

IMPORTANT - how you delegate: when you want a worker to do something, end your
reply with ONE line in exactly this format:
DELEGATE: <rnd|engineer|marketing> | <the specific task for them>
Only delegate one worker at a time. If you are NOT delegating (just talking to
the owner, or the cycle is complete), end with:
DONE

PIPELINE ORDER - follow this for any new product idea:
1. R&D first: even if the owner suggests a product, send R&D to research the
   market, validate demand, and sharpen the angle BEFORE designing. Do NOT
   invent the product yourself and skip to the Engineer.
2. Engineer next: only after R&D reports, brief the Engineer to design it.
3. Marketing last: after the design is approved, have Marketing write the listing.
The only time you may skip R&D is if the owner explicitly says to skip research
or to go straight to design.

Use the memory of past work to stay consistent and build on what came before.
BE CONCISE. Keep your replies short and decisive, but always start a new product
with R&D as described above.

PRIORITY RULE: The owner's MOST RECENT instruction is always the current
priority. Past ideas or unfinished products in memory are a BACKLOG, not
obligations - do NOT insist on finishing old work before doing what the owner
just asked. If the owner gives you a new direction, focus on that now. You may
briefly mention a relevant unfinished idea ("note: the Coffee Mom mug is still
in our backlog"), but only pick it back up if the owner asks you to. The owner
decides what to work on; you follow their current lead.`,

  rnd: `You are the R&D agent for a print-on-demand company. Your job is to find
what to make: trending niches, product ideas, and gaps where designs sell well.
You have live web access AND live access to X (Twitter) - use them to find what
is actually selling and what people are talking about right now, not guesses from
old knowledge. When relevant, check X for emerging trends, viral phrases, and what
merchandise people are reacting to. Be specific and practical.

BE CONCISE. Do at most 2-3 searches total. Report your TOP 3 opportunities only,
each as 2-3 tight sentences. No long preamble, no filler. The COO needs a quick,
ranked shortlist it can act on - not an essay. You do not design or write listings.`,

  engineer: `You are the Engineer (designer) for a print-on-demand company. Given
a brief from the COO, you design the actual product: the concept, the visual
idea, and the exact text or art that goes on the mug/shirt/poster. Be concrete -
describe the design clearly enough that a human could create it. You do not
research trends or write the sales listing; you design. BE CONCISE - give the
design clearly in a compact format, no long rationale essays.`,

  marketing: `You are the Marketing agent for a print-on-demand company. Given a
finished product concept, you write the sales listing: an Etsy/Shopify title,
a description, relevant keywords/tags, and a suggested price. You have live web
access - use it to check what keywords and pricing real successful listings use.
Be specific and ready-to-publish. You do not research product ideas or design.

STRICT RULES:
- NEVER invent customer reviews, testimonials, ratings, or any social proof.
  The product has no reviews yet. Do not include a "from happy customers" or
  similar section. Fabricated reviews violate Etsy policy.
- ALWAYS finish with a clear recommended retail price and a one-line
  justification. Never leave the price blank or unfinished.
- Provide exactly: (1) title, (2) a SHORT description, (3) 13 tags, (4) price.
- BE CONCISE. Do at most 2 web searches. Keep the description tight - a few
  punchy lines, not paragraphs. Complete all four parts before ending.`,
};

const MEMORY_DIR = process.env.MEMORY_DIR || "./data";
const MEMORY_FILE = `${MEMORY_DIR}/coo-memory.json`;
const MEMORY_TURNS_TO_INCLUDE = 8;

// --- Setup ----------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use(cors());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function ensureMemory() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ history: [] }, null, 2));
  }
}
function loadMemory() {
  ensureMemory();
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")); }
  catch { return { history: [] }; }
}
function saveMemory(mem) {
  ensureMemory();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

function passwordOk(provided) {
  return process.env.PORTAL_PASSWORD && provided === process.env.PORTAL_PASSWORD;
}

function recentContext() {
  const mem = loadMemory();
  const recent = mem.history.slice(-MEMORY_TURNS_TO_INCLUDE);
  return recent.map(t => {
    const who = t.agent ? t.agent.toUpperCase() : "OWNER/COO";
    return `[${who}] ${t.user ? "Owner: " + t.user + "\n" : ""}${t.text || t.coo || ""}`;
  }).join("\n\n");
}

async function runAgent(agent, taskText) {
  const context = recentContext();
  const userContent =
    (context ? `Company memory so far:\n${context}\n\n---\n\n` : "") + taskText;

  if (PROVIDER[agent] === "grok") {
    return runGrokAgent(agent, userContent);
  }

  const tools = WEB_SEARCH[agent]
    ? [{ type: "web_search_20250305", name: "web_search" }]
    : undefined;

  const response = await anthropic.messages.create({
    model: MODELS[agent],
    max_tokens: 700,
    system: PROMPTS[agent],
    messages: [{ role: "user", content: userContent }],
    ...(tools ? { tools } : {}),
  });

  return response.content
    .map(b => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

// Calls Grok (xAI) via its OpenAI-compatible Responses endpoint.
// Uses Grok's own web_search tool for live data when the agent needs it.
async function runGrokAgent(agent, userContent) {
  if (!process.env.XAI_API_KEY) {
    return "[R&D is set to Grok, but the server is missing its XAI_API_KEY. Add it in Render.]";
  }
  const body = {
    model: MODELS[agent],
    input: [
      { role: "system", content: PROMPTS[agent] },
      { role: "user", content: userContent },
    ],
  };
  if (WEB_SEARCH[agent]) body.tools = [{ type: "web_search" }, { type: "x_search" }];

  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + process.env.XAI_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Grok error:", res.status, errText);
    return "[Grok had trouble responding. Status " + res.status + ". You can switch R&D back to Claude in the server config.]";
  }

  const data = await res.json();
  // The Responses API returns output items; pull the text out of them.
  let out = "";
  if (typeof data.output_text === "string") {
    out = data.output_text;
  } else if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.content && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === "output_text" && c.text) out += c.text;
          else if (typeof c.text === "string") out += c.text;
        }
      }
    }
  }
  let cleaned = (out || "[Grok returned an empty response.]").trim();
  // Remove inline citation markers like [[1]](url) or [1](url) that Grok adds.
  cleaned = cleaned
    .replace(/\[\[\d+\]\]\([^)]*\)/g, "")
    .replace(/\[\d+\]\([^)]*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned;
}

function parseDelegation(text) {
  const m = text.match(/DELEGATE:\s*(rnd|engineer|marketing)\s*\|\s*([\s\S]+)/i);
  if (!m) return null;
  return { to: m[1].toLowerCase(), task: m[2].trim() };
}

// --- Routes ---------------------------------------------------------------

app.get("/health", (req, res) => {
  res.send("AI company server is running. The team is ready.");
});

app.post("/coo", async (req, res) => {
  if (!passwordOk(req.body && req.body.password)) {
    return res.status(401).json({ error: "Wrong or missing password." });
  }
  const userMessage = (req.body && req.body.message || "").trim();
  if (!userMessage) return res.status(400).json({ error: "No message provided." });
  if (userMessage === "__unlock_check__") return res.json({ ok: true });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is missing its API key." });
  }

  try {
    const reply = await runAgent("coo", "Owner says: " + userMessage);

    const mem = loadMemory();
    mem.history.push({ time: new Date().toISOString(), agent: "coo",
      user: userMessage, text: reply });
    saveMemory(mem);

    const delegation = parseDelegation(reply);
    const shown = reply.replace(/\n?(DELEGATE:[\s\S]+|DONE)\s*$/i, "").trim();
    res.json({ reply: shown, delegation });
  } catch (err) {
    console.error("COO error:", err);
    res.status(500).json({ error: "The COO had trouble thinking. Try again." });
  }
});

app.post("/approve", async (req, res) => {
  if (!passwordOk(req.body && req.body.password)) {
    return res.status(401).json({ error: "Wrong or missing password." });
  }
  const to = (req.body && req.body.to || "").toLowerCase();
  const task = (req.body && req.body.task || "").trim();
  if (!["rnd", "engineer", "marketing"].includes(to) || !task) {
    return res.status(400).json({ error: "Invalid delegation." });
  }

  try {
    const workerReply = await runAgent(to, "Task from the COO: " + task);
    let mem = loadMemory();
    mem.history.push({ time: new Date().toISOString(), agent: to, text: workerReply });
    saveMemory(mem);

    const cooReply = await runAgent("coo",
      `Your ${to.toUpperCase()} just reported back on the task "${task}".\n\n` +
      `Their report:\n${workerReply}\n\n` +
      `Review it and decide the next step (delegate again, or finish).`);
    mem = loadMemory();
    mem.history.push({ time: new Date().toISOString(), agent: "coo", text: cooReply });
    saveMemory(mem);

    const delegation = parseDelegation(cooReply);
    const shownCoo = cooReply.replace(/\n?(DELEGATE:[\s\S]+|DONE)\s*$/i, "").trim();

    res.json({ worker: to, workerReply, cooReply: shownCoo, delegation });
  } catch (err) {
    console.error("Approve error:", err);
    res.status(500).json({ error: "Something went wrong running that step." });
  }
});

app.get("/memory", (req, res) => {
  if (!passwordOk(req.query.password)) {
    return res.status(401).json({ error: "Wrong or missing password." });
  }
  res.json(loadMemory());
});

// --- Start ----------------------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI company server listening on port ${PORT}`);
});
