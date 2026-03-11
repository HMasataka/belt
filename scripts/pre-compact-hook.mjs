#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STATE_PATH = resolve(process.cwd(), ".belt", "state.json");

// Read pre-compact event from stdin
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

// Check if autopilot is active
let state;
try {
  state = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
} catch {
  // No state file = not active
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

if (!state.active) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// Build system message with current state
const lines = [
  "# belt autopilot 状態 (圧縮前スナップショット)",
  "",
  `**現在のフェーズ:** ${state.phase} (running)`,
  `**最終更新:** ${state.updatedAt || "unknown"}`,
];

if (state.message) {
  lines.push(`**メッセージ:** ${state.message}`);
}

// Add completed phases from history
const donePhases = (state.history || []).filter((h) => h.status === "done");
if (donePhases.length > 0) {
  lines.push("", "## 完了済みフェーズ");
  for (const h of donePhases) {
    lines.push(`- ${h.phase}: done (${h.timestamp})`);
  }
}

lines.push(
  "",
  "**重要:** autopilot がアクティブです。現在のフェーズから作業を継続してください。",
);

console.log(
  JSON.stringify({ continue: true, systemMessage: lines.join("\n") }),
);
