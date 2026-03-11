---
name: autopilot
description: Autopilot workflow that takes a task through analysis, design, planning, implementation, QA, and review.
argument-hint: "<task description>"
---

## Instructions

You are running the belt autopilot workflow. Follow the 6 phases below in strict order.

### Startup: Resume Check

First, call `mcp__belt__state_read` to check for previous progress.
If a phase shows `"status": "done"` in the history, skip it and continue from the next incomplete phase.
If no state exists or `active` is false, start from Phase 1.

---

### Phase 1: Requirements Analysis (Analyst)

Call `mcp__belt__state_write` with `phase="analyst"`, `status="running"`, `active=true`.

Use the Task tool to launch the analyst agent:

```
Task(
  subagent_type="belt:analyst",
  prompt="{user's original request}"
)
```

Save the analysis output (gaps, guardrails, edge cases, acceptance criteria).
Then call `mcp__belt__state_write` with `phase="analyst"`, `status="done"`, `active=true`.

---

### Phase 2: Design & Planning (Architect → Planner)

Call `mcp__belt__state_write` with `phase="design"`, `status="running"`, `active=true`.

**Step 1: Architecture Analysis**

```
Task(
  subagent_type="belt:architect",
  prompt="{user's original request}\n\n## Analyst Output\n{analyst's output from Phase 1}"
)
```

**Step 2: Work Plan Creation**

```
Task(
  subagent_type="belt:planner",
  prompt="{user's original request}\n\n## Analyst Output\n{analyst's output from Phase 1}\n\n## Architecture Analysis\n{architect's output from Step 1}"
)
```

Save the work plan. Then call `mcp__belt__state_write` with `phase="design"`, `status="done"`, `active=true`.

---

### Phase 3: Plan Review (Critic)

Call `mcp__belt__state_write` with `phase="critic"`, `status="running"`, `active=true`.

```
Task(
  subagent_type="belt:critic",
  prompt="{user's original request}\n\n## Work Plan\n{planner's plan from Phase 2}"
)
```

If the verdict is **REJECT**:
- Go back to Phase 2 Step 2 (planner) with the critic's feedback attached. Max 1 retry.
- If the retry is also rejected, proceed with the best available plan and note the unresolved concerns.

If the verdict is **REVISE** or **ACCEPT-WITH-RESERVATIONS**:
- Proceed, but pass the reservations to the executor as additional context.

Then call `mcp__belt__state_write` with `phase="critic"`, `status="done"`, `active=true`.

---

### Phase 4: Implementation (Executor)

Call `mcp__belt__state_write` with `phase="executor"`, `status="running"`, `active=true`.

```
Task(
  subagent_type="belt:executor",
  prompt="{user's original request}\n\n## Work Plan\n{planner's plan from Phase 2}\n\n## Critic Feedback\n{critic's feedback from Phase 3, if any}"
)
```

Then call `mcp__belt__state_write` with `phase="executor"`, `status="done"`, `active=true`.

---

### Phase 5: QA (Test Engineer → Debugger)

Call `mcp__belt__state_write` with `phase="qa"`, `status="running"`, `active=true`.

**Step 1: Test Creation & Execution**

```
Task(
  subagent_type="belt:test-engineer",
  prompt="{user's original request}\n\n## Work Plan\n{planner's plan from Phase 2}\n\nWrite and run tests for the changes made. Follow existing test patterns in the codebase."
)
```

**Step 2: Build & Test Verification**

Run build and test commands using the Bash tool:

1. Detect the project type and run the appropriate build command (e.g., `npm run build`, `go build ./...`, `cargo build`)
2. Run tests (e.g., `npm test`, `go test ./...`, `cargo test`)

**Step 3: Failure Resolution (if needed)**

If build or tests fail, launch the debugger agent:

```
Task(
  subagent_type="belt:debugger",
  prompt="Build/test failures detected.\n\n## Error Output\n{error output}\n\n## Work Plan\n{planner's plan from Phase 2}\n\nDiagnose and fix the root cause with minimal changes."
)
```

After debugger fixes, re-run build and tests. Retry up to 3 times total.

If all 3 attempts fail, call `mcp__belt__state_write` with `phase="qa"`, `status="error"`, `active=false` and report the failure to the user.

On success, call `mcp__belt__state_write` with `phase="qa"`, `status="done"`, `active=true`.

---

### Phase 6: Review (Reviewer + Security Reviewer)

Call `mcp__belt__state_write` with `phase="review"`, `status="running"`, `active=true`.

Launch both reviewers **in parallel**:

```
Task(
  subagent_type="belt:reviewer",
  prompt="{user's original request}\n\n## Work Plan\n{planner's plan from Phase 2}"
)

Task(
  subagent_type="belt:security-reviewer",
  prompt="{user's original request}\n\n## Work Plan\n{planner's plan from Phase 2}\n\nReview the implementation for security vulnerabilities."
)
```

**Handling review results:**

- If either reviewer returns **CRITICAL** or **HIGH** issues: go back to Phase 4 (executor) with the review feedback. Max 1 retry.
- If only **MEDIUM** or **LOW** issues: proceed and include them in the summary.

Then call `mcp__belt__state_write` with `phase="review"`, `status="done"`, `active=false`.

---

### Completion

After all phases complete, present a summary to the user:

```
## Autopilot Complete

### Requirements Analysis
[Key gaps, guardrails, and acceptance criteria identified]

### Design & Planning
[Architecture decisions and work plan summary]

### Plan Review
[Critic verdict and key concerns]

### Implementation
[What was built/changed]

### QA
[Tests written, build & test results]

### Review
[Code review verdict + security review verdict, key findings]
```
