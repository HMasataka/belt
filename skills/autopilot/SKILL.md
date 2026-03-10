# belt:autopilot

Autopilot workflow that takes a task through design, implementation, QA, and review.

---

## Instructions

You are running the belt autopilot workflow. Follow the 4 phases below in strict order.

### Startup: Resume Check

First, call `mcp__belt__state_read` to check for previous progress.
If a phase shows `"status": "done"` in the history, skip it and continue from the next incomplete phase.
If no state exists or `active` is false, start from Phase 1.

---

### Phase 1: Design (Architect)

Call `mcp__belt__state_write` with `phase="architect"`, `status="running"`, `active=true`.

Use the Task tool to launch the architect agent:

```
Task(
  subagent_type="architect",
  prompt="{user's original request}"
)
```

Save the plan output. Then call `mcp__belt__state_write` with `phase="architect"`, `status="done"`, `active=true`.

---

### Phase 2: Implement (Executor)

Call `mcp__belt__state_write` with `phase="executor"`, `status="running"`, `active=true`.

Use the Task tool to launch the executor agent:

```
Task(
  subagent_type="executor",
  prompt="{user's original request}\n\n{architect's plan from Phase 1}"
)
```

Then call `mcp__belt__state_write` with `phase="executor"`, `status="done"`, `active=true`.

---

### Phase 3: QA (Build & Test)

Call `mcp__belt__state_write` with `phase="qa"`, `status="running"`, `active=true`.

Run build and test commands using the Bash tool. Retry up to 3 times if there are failures:

1. Detect the project type and run the appropriate build command (e.g., `npm run build`, `go build ./...`, `cargo build`)
2. Run tests (e.g., `npm test`, `go test ./...`, `cargo test`)
3. If either fails, analyze the error, fix it, and retry (max 3 attempts)

If all 3 attempts fail, call `mcp__belt__state_write` with `phase="qa"`, `status="error"`, `active=false` and report the failure to the user.

On success, call `mcp__belt__state_write` with `phase="qa"`, `status="done"`, `active=true`.

---

### Phase 4: Review (Reviewer)

Call `mcp__belt__state_write` with `phase="reviewer"`, `status="running"`, `active=true`.

Use the Task tool to launch the reviewer agent:

```
Task(
  subagent_type="reviewer",
  prompt="{user's original request}\n\n{architect's plan from Phase 1}"
)
```

If the verdict is REQUEST_CHANGES with critical issues, go back to Phase 2 to fix them (max 1 retry).

Then call `mcp__belt__state_write` with `phase="reviewer"`, `status="done"`, `active=false`.

---

### Completion

After all phases complete, present a summary to the user:

```
## Autopilot Complete

### Design
[Brief summary of the plan]

### Implementation
[What was built/changed]

### QA
[Build & test results]

### Review
[Review verdict and key findings]
```
