#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const STATE_PATH = resolve(process.cwd(), ".belt", "state.json");

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return { phase: null, active: false, history: [] };
  }
}

function writeState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

const server = new McpServer({
  name: "belt",
  version: "0.1.0",
});

server.tool(
  "state_write",
  "Save autopilot workflow state (phase progress and active flag)",
  {
    phase: z
      .string()
      .describe("Current phase name (e.g. architect, executor, qa, reviewer)"),
    status: z.enum(["running", "done", "error"]).describe("Phase status"),
    active: z
      .boolean()
      .describe("Whether the autopilot workflow is still active"),
    message: z.string().optional().describe("Optional status message"),
  },
  async ({ phase, status, active, message }) => {
    const state = readState();
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

    writeState(state);
    return {
      content: [
        {
          type: "text",
          text: `State saved: phase=${phase}, status=${status}, active=${active}`,
        },
      ],
    };
  },
);

server.tool(
  "state_read",
  "Read current autopilot workflow state",
  {},
  async () => {
    const state = readState();
    return {
      content: [{ type: "text", text: JSON.stringify(state, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
