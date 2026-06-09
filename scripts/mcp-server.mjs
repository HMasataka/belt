#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const STATE_DIR = resolve(process.cwd(), ".belt");

function statePath(mode) {
  return resolve(STATE_DIR, `state-${mode}.json`);
}

function readState(mode) {
  try {
    return JSON.parse(readFileSync(statePath(mode), "utf-8"));
  } catch {
    return { mode, phase: null, active: false, history: [] };
  }
}

function writeState(mode, state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(statePath(mode), JSON.stringify(state, null, 2) + "\n");
}

const server = new McpServer({ name: "belt", version: "0.1.0" });

server.tool(
  "state_write",
  "Save workflow state (phase progress and active flag)",
  {
    mode: z
      .enum(["autopilot", "cruise", "ship", "dispatch"])
      .default("autopilot")
      .describe("Workflow mode (autopilot, cruise, ship, or dispatch)"),
    phase: z
      .string()
      .describe("Current phase name (e.g. architect, executor, qa, reviewer)"),
    status: z.enum(["running", "done", "error"]).describe("Phase status"),
    active: z.boolean().describe("Whether the workflow is still active"),
    message: z.string().optional().describe("Optional status message"),
  },
  async ({ mode, phase, status, active, message }) => {
    const state = readState(mode);
    state.mode = mode;
    state.phase = phase;
    state.active = active;
    state.updatedAt = new Date().toISOString();
    if (message) state.message = message;

    if (!state.history) state.history = [];
    state.history.push({
      phase,
      status,
      timestamp: new Date().toISOString(),
      message,
    });

    writeState(mode, state);
    return {
      content: [
        {
          type: "text",
          text: `State saved: mode=${mode}, phase=${phase}, status=${status}, active=${active}`,
        },
      ],
    };
  },
);

server.tool(
  "state_read",
  "Read current workflow state",
  {
    mode: z
      .enum(["autopilot", "cruise", "ship", "dispatch"])
      .default("autopilot")
      .describe("Workflow mode to read (autopilot, cruise, ship, or dispatch)"),
  },
  async ({ mode }) => {
    const state = readState(mode);
    return {
      content: [{ type: "text", text: JSON.stringify(state, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
