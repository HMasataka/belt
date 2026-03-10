#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STATE_PATH = resolve(process.cwd(), ".belt", "state.json");

// Read stop event from stdin
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const event = JSON.parse(input);

// Always allow through for context_limit or user_abort
if (
  event.stop_hook_type === "context_limit" ||
  event.stop_hook_type === "user_abort"
) {
  console.log(JSON.stringify({ decision: "allow" }));
  process.exit(0);
}

// Check if autopilot is active
try {
  const state = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  if (state.active) {
    console.log(
      JSON.stringify({
        decision: "block",
        reason: `belt autopilot is still active (phase: ${state.phase}). Workflow must complete all phases.`,
      }),
    );
    process.exit(0);
  }
} catch {
  // No state file = not active
}

console.log(JSON.stringify({ decision: "allow" }));
