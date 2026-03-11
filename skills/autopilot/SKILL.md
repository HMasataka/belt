---
name: autopilot
description: 分析・設計・計画・実装・QA・レビューを通すオートパイロットワークフロー
argument-hint: "<タスクの説明>"
---

## 手順

belt のオートパイロットワークフローを実行する。以下の6フェーズを厳密な順序で実行すること。

### 全体リトライ

Phase 5 (QA) で2回リトライしても失敗した場合、Phase 1 からやり直す。全体リトライは最大2回まで。

- 全体リトライ時は architect に失敗の根本原因を診断させ、その結果を `.belt/phases/qa-diagnosis.md` に保存する
- `.belt/phases/` をクリアし（qa-diagnosis.md は残す）、state をリセットする
- Phase 1 の analyst には元のリクエストに加えて QA 診断結果を渡す
- 全体リトライ2回目も QA 失敗した場合、`active=false` で終了しユーザーに失敗を報告する

### フェーズ出力の永続化

各フェーズの出力は `.belt/phases/` ディレクトリに Write ツールで保存する。これにより compact やセッション切断後もフェーズ出力を復元できる。

保存先:

- `.belt/phases/analyst.md` — Phase 1 の出力
- `.belt/phases/architect.md` — Phase 2 Step 1 の出力
- `.belt/phases/planner.md` — Phase 2 Step 2 の出力
- `.belt/phases/critic.md` — Phase 3 の出力

後続フェーズでは、会話コンテキストに前フェーズの出力がない場合（compact 後など）、Read ツールでこれらのファイルから読み込んで使用する。

### 起動: レジュームチェック

まず `mcp__belt__state_read` を呼び出して前回の進捗を確認する。

**新規開始** (状態が存在しないか `active` が false の場合):

- Bash ツールで `rm -rf .belt/phases/` を実行し、前回のフェーズ出力をクリアする
- Phase 1 から開始する

**レジューム** (`active` が true の場合):

- `.belt/phases/` のファイルはクリアしない
- 完了済みフェーズの出力を Read ツールで `.belt/phases/` から読み込み、後続フェーズのコンテキストとして使用する
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

#### Step 2: 要件分析 (Analyst)

scout の3つの出力を統合し、analyst エージェントに渡す:

```text
Task(
  subagent_type="belt:analyst",
  prompt="{ユーザーの元のリクエスト}\n\n## Scout 調査結果\n{Step 1 の scout 出力3つ}"
)
```

分析出力（ギャップ、ガードレール、エッジケース、受け入れ基準）を Write ツールで `.belt/phases/analyst.md` に保存する。
その後 `mcp__belt__state_write` を `phase="analyst"`, `status="done"`, `active=true` で呼び出す。

---

### Phase 2: 設計・計画 (Scout → Architect → Planner)

`mcp__belt__state_write` を `phase="design"`, `status="running"`, `active=true` で呼び出す。

#### Step 1: 関連ファイルのスクリーニング (Scout)

scout エージェントで変更に関連するファイルを事前に絞り込む:

```text
Task(
  subagent_type="belt:scout",
  prompt="{ユーザーの元のリクエスト}\n\n## Analyst 出力\n{Phase 1 の analyst 出力}\n\nこの変更に関連するファイルを全て列挙してください。ファイルパス、役割、変更が必要な理由を含めること。"
)
```

#### Step 2: アーキテクチャ分析

scout が絞り込んだファイル一覧を architect に渡し、深い設計分析を行う:

```text
Task(
  subagent_type="belt:architect",
  prompt="{ユーザーの元のリクエスト}\n\n## Analyst 出力\n{Phase 1 の analyst 出力}\n\n## 関連ファイル (Scout 調査)\n{Step 1 の scout 出力}"
)
```

architect の出力を Write ツールで `.belt/phases/architect.md` に保存する。

#### Step 3: 作業計画の作成

```text
Task(
  subagent_type="belt:planner",
  prompt="{ユーザーの元のリクエスト}\n\n## Analyst 出力\n{Phase 1 の analyst 出力}\n\n## アーキテクチャ分析\n{Step 2 の architect 出力}"
)
```

作業計画を Write ツールで `.belt/phases/planner.md` に保存する。その後 `mcp__belt__state_write` を `phase="design"`, `status="done"`, `active=true` で呼び出す。

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

critic の出力を Write ツールで `.belt/phases/critic.md` に保存する。その後 `mcp__belt__state_write` を `phase="critic"`, `status="done"`, `active=true` で呼び出す。

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

ビルドまたはテストが失敗した場合、まず scout でエラーを分類・整理し、debugger に渡す:

```text
Task(
  subagent_type="belt:scout",
  prompt="以下のエラー出力を分類・整理してください。エラーの種類、関連ファイル、優先度を付けること。\n\n## エラー出力\n{エラー出力}"
)
```

scout の整理結果を元に debugger エージェントを起動する:

```text
Task(
  subagent_type="belt:debugger",
  prompt="ビルド/テストの失敗を検出。\n\n## エラー分類 (Scout 整理)\n{scout の整理結果}\n\n## エラー出力\n{エラー出力}\n\n## 作業計画\n{Phase 2 の planner 計画}\n\n最小限の変更で根本原因を診断・修正すること。"
)
```

debugger の修正後、ビルドとテストを再実行する。合計最大2回までリトライ。

2回すべて失敗した場合、全体リトライを試みる:

1. architect に失敗の根本原因を診断させる:

```text
Task(
  subagent_type="belt:architect",
  prompt="QA が繰り返し失敗しました。根本原因を診断し、次の実装サイクルへの改善提案を出力してください。\n\n## エラー出力\n{直近のエラー出力}\n\n## 作業計画\n{Phase 2 の planner 計画}"
)
```

1. 診断結果を Write ツールで `.belt/phases/qa-diagnosis.md` に保存する
1. 全体リトライ回数が2回未満の場合:
   - Bash ツールで `.belt/phases/` 内の `qa-diagnosis.md` 以外のファイルを削除する
   - `mcp__belt__state_write` を `phase="analyst"`, `status="running"`, `active=true` で呼び出す
   - Phase 1 に戻る。analyst には元のリクエストに加えて `.belt/phases/qa-diagnosis.md` の内容を渡す
1. 全体リトライ回数が2回に達した場合:
   - `mcp__belt__state_write` を `phase="qa"`, `status="error"`, `active=false` で呼び出し、ユーザーに失敗と診断結果を報告する

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
