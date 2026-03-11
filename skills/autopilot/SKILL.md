---
name: autopilot
description: 分析・設計・計画・実装・QA・レビューを通すオートパイロットワークフロー
argument-hint: "<タスクの説明>"
---

## 手順

belt のオートパイロットワークフローを実行する。以下の6フェーズを厳密な順序で実行すること。

### 全体リトライ

Phase 5 (QA) で2回リトライしても失敗した場合、Phase 1 からやり直す。全体リトライは最大2回まで。

- 全体リトライ時は architect に失敗の根本原因を診断させ、その結果を `.belt/phases/outputs/qa-diagnosis.md` に保存する
- `.belt/phases/` 内の `outputs/qa-diagnosis.md` 以外のファイル・ディレクトリをクリアし、state をリセットする
- Phase 1 の analyst には元のリクエストに加えて QA 診断結果への参照を渡す
- 全体リトライ2回目も QA 失敗した場合、`active=false` で終了しユーザーに失敗を報告する

### フェーズ出力の永続化

各フェーズではプロンプトファイルと出力ファイルを `.belt/phases/` ディレクトリに保存する。これにより compact やセッション切断後もフェーズ出力を復元できる。

ディレクトリ構造:

```text
.belt/phases/
├── prompts/          # オーケストレーターが書き、サブエージェントが読む
│   ├── analyst.md
│   ├── architect.md
│   ├── planner.md
│   ├── critic.md
│   ├── executor-g{G}t{T}.md
│   ├── test-engineer.md
│   ├── debugger.md
│   ├── reviewer.md
│   └── security-reviewer.md
└── outputs/          # サブエージェントが書き、後続サブエージェントが読む
    ├── scout-patterns.md
    ├── scout-deps.md
    ├── scout-tests.md
    ├── scout-files.md
    ├── analyst.md
    ├── architect.md
    ├── planner.md
    ├── critic.md
    ├── executor-g{G}t{T}.md
    ├── test-engineer.md
    ├── debugger.md
    ├── reviewer.md
    ├── security-reviewer.md
    ├── scout-errors.md
    └── qa-diagnosis.md
```

### 共通実行パターン

#### 通常エージェント (analyst, architect, planner, critic, executor, etc.)

3ステップで実行:

1. **プロンプト構築**: オーケストレーターが Write ツールで `.belt/phases/prompts/{name}.md` にプロンプトファイルを作成。内容はユーザーリクエスト + 前フェーズ出力ファイルへの参照パス + フェーズ固有の指示
2. **サブエージェント起動**: Task prompt は最小限のテンプレート:
   ```
   `.belt/phases/prompts/{name}.md` を Read ツールで読み、指示に従ってください。
   作業結果を `.belt/phases/outputs/{name}.md` に Write ツールで保存してください。
   ```
3. **ルーティング**: サブエージェントの戻り値（短いステータスのみ）で次の遷移を判定

#### Scout エージェント (例外)

Scout は `disallowedTools: Write` のため自分でファイルに書けない。

- プロンプトファイルは不要（scout の入力は短い）
- Task prompt にリクエストをインラインで渡す（従来通り）
- Scout の戻り値をオーケストレーターが `.belt/phases/outputs/scout-*.md` に Write で保存する

### 起動: レジュームチェック

まず `mcp__belt__state_read` を呼び出して前回の進捗を確認する。

**新規開始** (状態が存在しないか `active` が false の場合):

- Bash ツールで `rm -rf .belt/phases/` を実行し、前回のフェーズ出力をクリアする
- Bash ツールで `mkdir -p .belt/phases/prompts .belt/phases/outputs` を実行してディレクトリを作成する
- Phase 1 から開始する

**レジューム** (`active` が true の場合):

- `.belt/phases/` のファイルはクリアしない
- Bash ツールで `mkdir -p .belt/phases/prompts .belt/phases/outputs` を実行してディレクトリが存在することを確認する
- 完了済みフェーズの出力は `.belt/phases/outputs/` に保存されているため、後続フェーズのプロンプトファイルで参照パスとして指定する
- 履歴にフェーズの `"status": "done"` がある場合、そのフェーズをスキップし次の未完了フェーズから続行する

---

### Phase 1: 要件分析 (Scout → Analyst)

`mcp__belt__state_write` を `phase="analyst"`, `status="running"`, `active=true` で呼び出す。

#### Step 1: 並列偵察 (Scout × 3)

scout エージェントを3つ並列で起動し、コードベースの情報を収集する:

```text
Task(
  subagent_type="belt:scout",
  prompt="{ユーザーの元のリクエスト}\n\n既存の類似機能とパターンを洗い出してください。"
)
Task(
  subagent_type="belt:scout",
  prompt="{ユーザーの元のリクエスト}\n\n依存関係と影響範囲を調査してください。"
)
Task(
  subagent_type="belt:scout",
  prompt="{ユーザーの元のリクエスト}\n\nテストカバレッジと品質状況を確認してください。"
)
```

各 scout の戻り値をオーケストレーターが Write ツールで以下に保存する:

- `.belt/phases/outputs/scout-patterns.md` — 類似機能とパターン
- `.belt/phases/outputs/scout-deps.md` — 依存関係と影響範囲
- `.belt/phases/outputs/scout-tests.md` — テストカバレッジと品質状況

#### Step 2: 要件分析 (Analyst)

オーケストレーターが Write ツールで `.belt/phases/prompts/analyst.md` にプロンプトファイルを作成する:

```markdown
## タスク

{ユーザーの元のリクエスト}

## Scout 調査結果

以下のファイルを Read ツールで読み、コンテキストとして使用してください:

- `.belt/phases/outputs/scout-patterns.md` — 類似機能とパターン
- `.belt/phases/outputs/scout-deps.md` — 依存関係と影響範囲
- `.belt/phases/outputs/scout-tests.md` — テストカバレッジと品質状況

{全体リトライ時のみ以下を追加:}

## QA 診断結果

以下のファイルも Read ツールで読み、前回の失敗原因を考慮してください:

- `.belt/phases/outputs/qa-diagnosis.md`

## 出力先

作業結果を `.belt/phases/outputs/analyst.md` に Write ツールで保存してください。
```

最小 Task prompt で analyst を起動する:

```text
Task(
  subagent_type="belt:analyst",
  prompt="`.belt/phases/prompts/analyst.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/analyst.md` に Write ツールで保存してください。"
)
```

その後 `mcp__belt__state_write` を `phase="analyst"`, `status="done"`, `active=true` で呼び出す。

---

### Phase 2: 設計・計画 (Scout → Architect → Planner)

`mcp__belt__state_write` を `phase="design"`, `status="running"`, `active=true` で呼び出す。

#### Step 1: 関連ファイルのスクリーニング (Scout)

scout エージェントで変更に関連するファイルを事前に絞り込む:

```text
Task(
  subagent_type="belt:scout",
  prompt="{ユーザーの元のリクエスト}\n\n## Analyst 出力\n以下のファイルを Read ツールで読んでコンテキストとして使用してください:\n- `.belt/phases/outputs/analyst.md`\n\nこの変更に関連するファイルを全て列挙してください。ファイルパス、役割、変更が必要な理由を含めること。"
)
```

scout の戻り値をオーケストレーターが Write ツールで `.belt/phases/outputs/scout-files.md` に保存する。

#### Step 2: アーキテクチャ分析

オーケストレーターが Write ツールで `.belt/phases/prompts/architect.md` にプロンプトファイルを作成する:

```markdown
## タスク

{ユーザーの元のリクエスト}

## 前フェーズの出力

以下のファイルを Read ツールで読み、コンテキストとして使用してください:

- `.belt/phases/outputs/analyst.md` — 要件分析結果
- `.belt/phases/outputs/scout-files.md` — 関連ファイル一覧

## 出力先

作業結果を `.belt/phases/outputs/architect.md` に Write ツールで保存してください。
```

最小 Task prompt で architect を起動する:

```text
Task(
  subagent_type="belt:architect",
  prompt="`.belt/phases/prompts/architect.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/architect.md` に Write ツールで保存してください。"
)
```

#### Step 3: 作業計画の作成

オーケストレーターが Write ツールで `.belt/phases/prompts/planner.md` にプロンプトファイルを作成する:

```markdown
## タスク

{ユーザーの元のリクエスト}

## 前フェーズの出力

以下のファイルを Read ツールで読み、コンテキストとして使用してください:

- `.belt/phases/outputs/analyst.md` — 要件分析結果
- `.belt/phases/outputs/architect.md` — アーキテクチャ分析結果

## 出力先

作業結果を `.belt/phases/outputs/planner.md` に Write ツールで保存してください。
```

最小 Task prompt で planner を起動する:

```text
Task(
  subagent_type="belt:planner",
  prompt="`.belt/phases/prompts/planner.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/planner.md` に Write ツールで保存してください。"
)
```

その後 `mcp__belt__state_write` を `phase="design"`, `status="done"`, `active=true` で呼び出す。

---

### Phase 3: 計画レビュー (Critic)

`mcp__belt__state_write` を `phase="critic"`, `status="running"`, `active=true` で呼び出す。

オーケストレーターが Write ツールで `.belt/phases/prompts/critic.md` にプロンプトファイルを作成する:

```markdown
## タスク

{ユーザーの元のリクエスト}

## 作業計画

以下のファイルを Read ツールで読み、レビュー対象として使用してください:

- `.belt/phases/outputs/planner.md` — 作業計画

## 出力先

作業結果を `.belt/phases/outputs/critic.md` に Write ツールで保存してください。
```

最小 Task prompt で critic を起動する:

```text
Task(
  subagent_type="belt:critic",
  prompt="`.belt/phases/prompts/critic.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/critic.md` に Write ツールで保存してください。"
)
```

判定が **REJECT** の場合:

- オーケストレーターが `.belt/phases/prompts/planner.md` を上書きし、critic フィードバックへの参照を追加する:

  ```markdown
  ## Critic フィードバック

  以下のファイルを Read ツールで読み、フィードバックを反映して計画を改善してください:

  - `.belt/phases/outputs/critic.md` — Critic のフィードバック
  ```

- Phase 2 Step 3（planner）を再実行する。リトライは最大3回。
- 3回すべて却下された場合、利用可能な最善の計画で続行し、未解決の懸念を記載する。

判定が **REVISE** または **ACCEPT-WITH-RESERVATIONS** の場合:

- 続行するが、留保事項を追加コンテキストとして executor のプロンプトファイルに含める。

その後 `mcp__belt__state_write` を `phase="critic"`, `status="done"`, `active=true` で呼び出す。

---

### Phase 4: 実装 (Executor - 並列実行)

`mcp__belt__state_write` を `phase="executor"`, `status="running"`, `active=true` で呼び出す。

planner の作業計画にはタスクが Group に整理されている。各 Group 内のタスクは独立しており並列実行できる。Group 間は逐次実行する（Group 1 → Group 2 → ...）。

計画内の各 Group について、その Group のすべてのタスクのプロンプトファイルを作成し、並列の executor エージェントとして起動する。

各タスクの `complexity` に応じて `model` パラメータを切り替える:

- `complexity: high` → `model="opus"`
- `complexity: normal` または未指定 → `model="sonnet"`

各タスクについて、オーケストレーターが Write ツールで `.belt/phases/prompts/executor-g{G}t{T}.md` にプロンプトファイルを作成する:

```markdown
## タスク

{ユーザーの元のリクエスト}

## 担当タスク

{計画の Task G.T の詳細}

## 参照ファイル

以下のファイルを Read ツールで読み、コンテキストとして使用してください:

- `.belt/phases/outputs/planner.md` — 作業計画全体（参照用）
- `.belt/phases/outputs/critic.md` — Critic フィードバック（あれば）

## 出力先

作業結果を `.belt/phases/outputs/executor-g{G}t{T}.md` に Write ツールで保存してください。
```

最小 Task prompt で executor を起動する:

```text
# Group 1: すべてのタスクを並列に起動（1メッセージで複数の Task 呼び出し）
Task(
  subagent_type="belt:executor",
  model="sonnet",
  prompt="`.belt/phases/prompts/executor-g1t1.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/executor-g1t1.md` に Write ツールで保存してください。"
)
Task(
  subagent_type="belt:executor",
  model="opus",
  prompt="`.belt/phases/prompts/executor-g1t2.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/executor-g1t2.md` に Write ツールで保存してください。"
)

# Group 1 のすべてのタスクが完了するのを待ち、Group 2 に進む
```

ルール:

- 同じ Group 内のすべての Task 呼び出しは並列実行を有効にするために1つのメッセージに含めなければならない。
- Group 内のすべてのタスクが完了するのを待ってから次の Group を開始する。
- 計画に Group が1つしかないか、並列化マーカーがない場合、単一の executor として逐次実行する（非並列モードにフォールバック）。
- 各 executor は担当タスクのみをプロンプトファイルで受け取り、作業計画全体はファイル参照として添付する。
- `complexity: high` のタスクは `model="opus"` で起動する。それ以外は `model="sonnet"` で起動する。

その後 `mcp__belt__state_write` を `phase="executor"`, `status="done"`, `active=true` で呼び出す。

---

### Phase 5: QA (Test Engineer → Debugger)

`mcp__belt__state_write` を `phase="qa"`, `status="running"`, `active=true` で呼び出す。

#### Step 1: テスト作成・実行

オーケストレーターが Write ツールで `.belt/phases/prompts/test-engineer.md` にプロンプトファイルを作成する:

```markdown
## タスク

{ユーザーの元のリクエスト}

## 参照ファイル

以下のファイルを Read ツールで読み、コンテキストとして使用してください:

- `.belt/phases/outputs/planner.md` — 作業計画

変更に対するテストを作成・実行する。コードベースの既存テストパターンに従うこと。

## 出力先

作業結果を `.belt/phases/outputs/test-engineer.md` に Write ツールで保存してください。
```

最小 Task prompt で test-engineer を起動する:

```text
Task(
  subagent_type="belt:test-engineer",
  prompt="`.belt/phases/prompts/test-engineer.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/test-engineer.md` に Write ツールで保存してください。"
)
```

#### Step 2: ビルド・テスト検証

Bash ツールでビルドおよびテストコマンドを実行する:

1. プロジェクトタイプを検出し適切なビルドコマンドを実行する（例: `npm run build`, `go build ./...`, `cargo build`）
2. テストを実行する（例: `npm test`, `go test ./...`, `cargo test`）

#### Step 3: 失敗の解決（必要な場合）

ビルドまたはテストが失敗した場合、まず scout でエラーを分類・整理する:

```text
Task(
  subagent_type="belt:scout",
  prompt="以下のエラー出力を分類・整理してください。エラーの種類、関連ファイル、優先度を付けること。\n\n## エラー出力\n{エラー出力}"
)
```

scout の戻り値をオーケストレーターが Write ツールで `.belt/phases/outputs/scout-errors.md` に保存する。

scout の整理結果を元に debugger エージェントのプロンプトファイルを作成する。オーケストレーターが Write ツールで `.belt/phases/prompts/debugger.md` にプロンプトファイルを作成する:

```markdown
## タスク

ビルド/テストの失敗を検出。最小限の変更で根本原因を診断・修正すること。

## 参照ファイル

以下のファイルを Read ツールで読み、コンテキストとして使用してください:

- `.belt/phases/outputs/scout-errors.md` — エラー分類 (Scout 整理)
- `.belt/phases/outputs/planner.md` — 作業計画

## エラー出力

{エラー出力}

## 出力先

作業結果を `.belt/phases/outputs/debugger.md` に Write ツールで保存してください。
```

最小 Task prompt で debugger を起動する:

```text
Task(
  subagent_type="belt:debugger",
  prompt="`.belt/phases/prompts/debugger.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/debugger.md` に Write ツールで保存してください。"
)
```

debugger の修正後、ビルドとテストを再実行する。合計最大2回までリトライ。

2回すべて失敗した場合、全体リトライを試みる:

1. architect に失敗の根本原因を診断させる:

```text
Task(
  subagent_type="belt:architect",
  prompt="QA が繰り返し失敗しました。根本原因を診断し、次の実装サイクルへの改善提案を出力してください。\n\n## エラー出力\n{直近のエラー出力}\n\n## 作業計画\n`.belt/phases/outputs/planner.md` を Read ツールで読んでください。"
)
```

1. 診断結果を Write ツールで `.belt/phases/outputs/qa-diagnosis.md` に保存する
1. 全体リトライ回数が2回未満の場合:
   - Bash ツールで `.belt/phases/` 内の `outputs/qa-diagnosis.md` 以外のファイル・ディレクトリを削除する
   - Bash ツールで `mkdir -p .belt/phases/prompts .belt/phases/outputs` を実行してディレクトリを再作成する
   - `mcp__belt__state_write` を `phase="analyst"`, `status="running"`, `active=true` で呼び出す
   - Phase 1 に戻る。analyst のプロンプトファイルには元のリクエストに加えて `.belt/phases/outputs/qa-diagnosis.md` への参照を含める
1. 全体リトライ回数が2回に達した場合:
   - `mcp__belt__state_write` を `phase="qa"`, `status="error"`, `active=false` で呼び出し、ユーザーに失敗と診断結果を報告する

成功した場合、`mcp__belt__state_write` を `phase="qa"`, `status="done"`, `active=true` で呼び出す。

---

### Phase 6: レビュー (Reviewer + Security Reviewer)

`mcp__belt__state_write` を `phase="review"`, `status="running"`, `active=true` で呼び出す。

オーケストレーターが Write ツールで `.belt/phases/prompts/reviewer.md` と `.belt/phases/prompts/security-reviewer.md` にプロンプトファイルを作成する:

**reviewer.md:**

```markdown
## タスク

{ユーザーの元のリクエスト}

## 参照ファイル

以下のファイルを Read ツールで読み、コンテキストとして使用してください:

- `.belt/phases/outputs/planner.md` — 作業計画

## 出力先

作業結果を `.belt/phases/outputs/reviewer.md` に Write ツールで保存してください。
```

**security-reviewer.md:**

```markdown
## タスク

{ユーザーの元のリクエスト}

実装のセキュリティ脆弱性をレビューすること。

## 参照ファイル

以下のファイルを Read ツールで読み、コンテキストとして使用してください:

- `.belt/phases/outputs/planner.md` — 作業計画

## 出力先

作業結果を `.belt/phases/outputs/security-reviewer.md` に Write ツールで保存してください。
```

両方のレビューアを**並列で**起動する:

```text
Task(
  subagent_type="belt:reviewer",
  prompt="`.belt/phases/prompts/reviewer.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/reviewer.md` に Write ツールで保存してください。"
)

Task(
  subagent_type="belt:security-reviewer",
  prompt="`.belt/phases/prompts/security-reviewer.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/security-reviewer.md` に Write ツールで保存してください。"
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
