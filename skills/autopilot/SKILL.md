---
name: autopilot
description: 分析・設計・計画・実装・QA・レビューを通すオートパイロットワークフロー
argument-hint: "<タスクの説明>"
---

## 手順

belt のオートパイロットワークフローを実行する。以下の6フェーズを厳密な順序で実行すること。

### 起動: レジュームチェック

まず `mcp__belt__state_read` を呼び出して前回の進捗を確認する。
履歴にフェーズの `"status": "done"` がある場合、そのフェーズをスキップし次の未完了フェーズから続行する。
状態が存在しないか `active` が false の場合、Phase 1 から開始する。

---

### Phase 1: 要件分析 (Analyst)

`mcp__belt__state_write` を `phase="analyst"`, `status="running"`, `active=true` で呼び出す。

Task ツールで analyst エージェントを起動する:

```text
Task(
  subagent_type="belt:analyst",
  prompt="{ユーザーの元のリクエスト}"
)
```

分析出力（ギャップ、ガードレール、エッジケース、受け入れ基準）を保存する。
その後 `mcp__belt__state_write` を `phase="analyst"`, `status="done"`, `active=true` で呼び出す。

---

### Phase 2: 設計・計画 (Architect → Planner)

`mcp__belt__state_write` を `phase="design"`, `status="running"`, `active=true` で呼び出す。

#### Step 1: アーキテクチャ分析

```text
Task(
  subagent_type="belt:architect",
  prompt="{ユーザーの元のリクエスト}\n\n## Analyst 出力\n{Phase 1 の analyst 出力}"
)
```

#### Step 2: 作業計画の作成

```text
Task(
  subagent_type="belt:planner",
  prompt="{ユーザーの元のリクエスト}\n\n## Analyst 出力\n{Phase 1 の analyst 出力}\n\n## アーキテクチャ分析\n{Step 1 の architect 出力}"
)
```

作業計画を保存する。その後 `mcp__belt__state_write` を `phase="design"`, `status="done"`, `active=true` で呼び出す。

---

### Phase 3: 計画レビュー (Critic)

`mcp__belt__state_write` を `phase="critic"`, `status="running"`, `active=true` で呼び出す。

```text
Task(
  subagent_type="belt:critic",
  prompt="{ユーザーの元のリクエスト}\n\n## 作業計画\n{Phase 2 の planner 計画}"
)
```

判定が **REJECT** の場合:

- critic のフィードバックを添付して Phase 2 Step 2（planner）に戻る。リトライは最大3回。
- 3回すべて却下された場合、利用可能な最善の計画で続行し、未解決の懸念を記載する。

判定が **REVISE** または **ACCEPT-WITH-RESERVATIONS** の場合:

- 続行するが、留保事項を追加コンテキストとして executor に渡す。

その後 `mcp__belt__state_write` を `phase="critic"`, `status="done"`, `active=true` で呼び出す。

---

### Phase 4: 実装 (Executor - 並列実行)

`mcp__belt__state_write` を `phase="executor"`, `status="running"`, `active=true` で呼び出す。

planner の作業計画にはタスクが Group に整理されている。各 Group 内のタスクは独立しており並列実行できる。Group 間は逐次実行する（Group 1 → Group 2 → ...）。

計画内の各 Group について、その Group のすべてのタスクを並列の executor エージェントとして起動する。

各タスクの `complexity` に応じて `model` パラメータを切り替える:

- `complexity: high` → `model="opus"`
- `complexity: normal` または未指定 → `model="sonnet"`

```text
# Group 1: すべてのタスクを並列に起動（1メッセージで複数の Task 呼び出し）
Task(
  subagent_type="belt:executor",
  model="sonnet",
  prompt="{ユーザーの元のリクエスト}\n\n## 担当タスク\n{計画の Task 1.1 (complexity: normal)}\n\n## 作業計画全体（参照用）\n{planner の計画}\n\n## Critic フィードバック\n{critic のフィードバック（あれば）}"
)
Task(
  subagent_type="belt:executor",
  model="opus",
  prompt="{ユーザーの元のリクエスト}\n\n## 担当タスク\n{計画の Task 1.2 (complexity: high)}\n\n## 作業計画全体（参照用）\n{planner の計画}\n\n## Critic フィードバック\n{critic のフィードバック（あれば）}"
)

# Group 1 のすべてのタスクが完了するのを待ち、Group 2 に進む
```

ルール:

- 同じ Group 内のすべての Task 呼び出しは並列実行を有効にするために1つのメッセージに含めなければならない。
- Group 内のすべてのタスクが完了するのを待ってから次の Group を開始する。
- 計画に Group が1つしかないか、並列化マーカーがない場合、単一の executor として逐次実行する（非並列モードにフォールバック）。
- 各 executor は担当タスクのみを受け取り、作業計画全体はコンテキスト用の読み取り専用参照として添付する。
- `complexity: high` のタスクは `model="opus"` で起動する。それ以外は `model="sonnet"` で起動する。

その後 `mcp__belt__state_write` を `phase="executor"`, `status="done"`, `active=true` で呼び出す。

---

### Phase 5: QA (Test Engineer → Debugger)

`mcp__belt__state_write` を `phase="qa"`, `status="running"`, `active=true` で呼び出す。

#### Step 1: テスト作成・実行

```text
Task(
  subagent_type="belt:test-engineer",
  prompt="{ユーザーの元のリクエスト}\n\n## 作業計画\n{Phase 2 の planner 計画}\n\n変更に対するテストを作成・実行する。コードベースの既存テストパターンに従うこと。"
)
```

#### Step 2: ビルド・テスト検証

Bash ツールでビルドおよびテストコマンドを実行する:

1. プロジェクトタイプを検出し適切なビルドコマンドを実行する（例: `npm run build`, `go build ./...`, `cargo build`）
2. テストを実行する（例: `npm test`, `go test ./...`, `cargo test`）

#### Step 3: 失敗の解決（必要な場合）

ビルドまたはテストが失敗した場合、debugger エージェントを起動する:

```text
Task(
  subagent_type="belt:debugger",
  prompt="ビルド/テストの失敗を検出。\n\n## エラー出力\n{エラー出力}\n\n## 作業計画\n{Phase 2 の planner 計画}\n\n最小限の変更で根本原因を診断・修正すること。"
)
```

debugger の修正後、ビルドとテストを再実行する。合計最大3回までリトライ。

3回すべて失敗した場合、`mcp__belt__state_write` を `phase="qa"`, `status="error"`, `active=false` で呼び出し、ユーザーに失敗を報告する。

成功した場合、`mcp__belt__state_write` を `phase="qa"`, `status="done"`, `active=true` で呼び出す。

---

### Phase 6: レビュー (Reviewer + Security Reviewer)

`mcp__belt__state_write` を `phase="review"`, `status="running"`, `active=true` で呼び出す。

両方のレビューアを**並列で**起動する:

```text
Task(
  subagent_type="belt:reviewer",
  prompt="{ユーザーの元のリクエスト}\n\n## 作業計画\n{Phase 2 の planner 計画}"
)

Task(
  subagent_type="belt:security-reviewer",
  prompt="{ユーザーの元のリクエスト}\n\n## 作業計画\n{Phase 2 の planner 計画}\n\n実装のセキュリティ脆弱性をレビューすること。"
)
```

レビュー結果の処理:

- いずれかのレビューアが **CRITICAL** または **HIGH** の問題を返した場合: レビューフィードバック付きで Phase 4（executor）に戻る。リトライは最大3回。
- **MEDIUM** または **LOW** の問題のみの場合: 続行しサマリーに含める。

その後 `mcp__belt__state_write` を `phase="review"`, `status="done"`, `active=false` で呼び出す。

---

### 完了

すべてのフェーズが完了したら、ユーザーにサマリーを提示する:

```text
## オートパイロット完了

### 要件分析
[特定された主要なギャップ、ガードレール、受け入れ基準]

### 設計・計画
[アーキテクチャの判断と作業計画の概要]

### 計画レビュー
[Critic の判定と主要な懸念]

### 実装
[構築/変更された内容]

### QA
[作成されたテスト、ビルド・テスト結果]

### レビュー
[コードレビューの判定 + セキュリティレビューの判定、主要な発見事項]
```
