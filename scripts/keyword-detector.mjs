#!/usr/bin/env node

const KEYWORDS = [
  { name: "autopilot", pattern: /\b(autopilot|auto[\s-]?pilot)\b(?!\.)/i },
  { name: "spec-confirm", pattern: /\b(spec[\s-]?confirm)(?!\.)\b|仕様(書?を?)?確定/i },
  { name: "spec", pattern: /\b(spec|仕様書?)(?!\.)\b/i },
  { name: "roadmap", pattern: /\b(roadmap|ロードマップ)(?!\.)\b/i },
  { name: "cruise", pattern: /\b(cruise|クルーズ)(?!\.)\b/i },
  { name: "breakdown", pattern: /\b(breakdown)(?!\.)\b|PR分解|タスク分解|ブレークダウン/i },
  { name: "brainstorm", pattern: /\b(brainstorm|ブレスト|壁打ち)(?!\.)\b/i },
];

// Read stdin
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

let prompt = "";
try {
  const data = JSON.parse(input);
  if (data.prompt) {
    prompt = data.prompt;
  } else if (data.message?.content) {
    prompt = data.message.content;
  } else if (Array.isArray(data.parts)) {
    prompt = data.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ");
  }
} catch {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

if (!prompt) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// Strip code blocks to prevent false positives
const cleaned = prompt.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");

// Find first matching keyword (priority order)
const match = KEYWORDS.find((k) => k.pattern.test(cleaned));

if (!match) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// Already an explicit /belt: invocation — don't double-trigger
if (/\/belt:/.test(prompt)) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const additionalContext = `[KEYWORD DETECTED: ${match.name.toUpperCase()}]

You MUST invoke the skill using the Skill tool:

Skill: belt:${match.name}

User request:
${prompt}

IMPORTANT: Invoke the skill IMMEDIATELY. Do not proceed without loading the skill instructions.`;

console.log(
  JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  }),
);
