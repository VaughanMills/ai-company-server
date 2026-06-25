// ===========================================================================
//  AI COMPANY SERVER  —  Step 1: the COO agent with permanent memory
// ===========================================================================
//
//  WHAT THIS FILE IS:
//  This is the "back office" — a small program that runs on Render. It does
//  three jobs:
//    1. Holds your secret Anthropic API key (kept here, never in the website).
//    2. Remembers everything in a memory file that survives restarts.
//    3. Receives a message from your office page, asks the COO (Claude) to
//       think with full memory of the past, then saves the new exchange.
//
//  HOW TO CHANGE THE COO'S BRAIN:
//  The model is set in ONE place below (look for COO_MODEL). Swap it between
//  "claude-haiku-4-5", "claude-sonnet-4-6", or "claude-opus-4-8" anytime.
//
//  WHAT YOU DON'T EDIT:
//  Your API key does NOT go in this file. It goes into Render's "Environment"
//  settings as ANTHROPIC_API_KEY. This keeps it secret.
// ===========================================================================

import express from "express";
import cors from "cors";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";

// --- Configuration you may want to change later --------------------------

const COO_MODEL = "claude-sonnet-4-6"; // the COO's brain. Smart + affordable.

// The COO's personality and job description. Edit this to shape how it thinks.
const COO_SYSTEM_PROMPT = `You are the COO (Chief Operating Officer) of a small
print-on-demand company that designs products (mugs, t-shirts, posters) to sell
on platforms like Etsy and Shopify with no upfront inventory cost.

Your job is to oversee the whole operation and make decisions. You think
strategically about what is worth pursuing, weigh costs against likely returns,
and keep the company focused. You are practical, decisive, and honest about
risk. When you lack information, you say what you'd want researched rather than
guessing.

You have a permanent memory of past conversations and decisions, provided to
you below. Use it to stay consistent and build on what came before. You report
to the human owner, who has final say. You never spend money or take real-world
actions yourself — you recommend, and the owner approves.`;

// Where the permanent memory lives. On Render this folder is a persistent disk,
// so the file survives restarts and deploys.
const MEMORY_DIR = process.env.MEMORY_DIR || "./data";
const MEMORY_FILE = `${MEMORY_DIR}/coo-memory.json`;

// How many past exchanges to feed the COO each time (keeps costs sane).
const MEMORY_TURNS_TO_INCLUDE = 20;

// --- Setup ----------------------------------------------------------------

const app = express();
app.use(express.json());

// Serve the office page (public/index.html) and any other files in /public.
// This is what lets your Squarespace loader pull the latest interface.
app.use(express.static("public"));

// CORS = which websites are allowed to talk to this server. Once your
// Squarespace site is ready, you can tighten this to just your domain. For now
// it accepts your page so testing is easy.
app.use(cors());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Make sure the memory folder + file exist.
function ensureMemory() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ history: [] }, null, 2));
  }
}

function loadMemory() {
  ensureMemory();
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    return { history: [] };
  }
}

function saveMemory(mem) {
  ensureMemory();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

// --- Routes ---------------------------------------------------------------

// A simple health check so you can confirm the server is alive.
app.get("/health", (req, res) => {
  res.send("AI company server is running. The COO is ready.");
});

// The main endpoint: your office page sends a message here, the COO replies.
app.post("/coo", async (req, res) => {
  // Password check: every COO request must include the correct shared password.
  // The real password lives in Render settings as PORTAL_PASSWORD (kept secret).
  const provided = (req.body && req.body.password) || "";
  if (!process.env.PORTAL_PASSWORD || provided !== process.env.PORTAL_PASSWORD) {
    return res.status(401).json({ error: "Wrong or missing password." });
  }

  const userMessage = (req.body && req.body.message || "").trim();
  if (!userMessage) {
    return res.status(400).json({ error: "No message provided." });
  }

  // Special case: the portal sends this just to verify the password. The
  // password already passed the check above, so confirm without calling Claude.
  if (userMessage === "__unlock_check__") {
    return res.json({ ok: true });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "Server is missing its API key. Add ANTHROPIC_API_KEY in Render.",
    });
  }

  try {
    const mem = loadMemory();

    // Build the conversation from recent memory so the COO 'remembers'.
    const recent = mem.history.slice(-MEMORY_TURNS_TO_INCLUDE);
    const messages = [];
    for (const turn of recent) {
      messages.push({ role: "user", content: turn.user });
      messages.push({ role: "assistant", content: turn.coo });
    }
    messages.push({ role: "user", content: userMessage });

    const response = await anthropic.messages.create({
      model: COO_MODEL,
      max_tokens: 1024,
      system: COO_SYSTEM_PROMPT,
      messages,
    });

    const cooReply = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    // Save this exchange to permanent memory.
    mem.history.push({
      time: new Date().toISOString(),
      user: userMessage,
      coo: cooReply,
    });
    saveMemory(mem);

    res.json({ reply: cooReply });
  } catch (err) {
    console.error("COO error:", err);
    res.status(500).json({ error: "The COO had trouble thinking. Try again." });
  }
});

// Lets you view the whole memory. Protected by the same password.
// Use it like: /memory?password=YOUR_PASSWORD
app.get("/memory", (req, res) => {
  const provided = req.query.password || "";
  if (!process.env.PORTAL_PASSWORD || provided !== process.env.PORTAL_PASSWORD) {
    return res.status(401).json({ error: "Wrong or missing password." });
  }
  res.json(loadMemory());
});

// --- Start the server -----------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI company server listening on port ${PORT}`);
});
