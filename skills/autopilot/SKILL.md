---
name: autopilot
description: 分析・設計・計画・実装・QA・レビューを通すオートパイロットワークフロー
argument-hint: "<タスクの説明>"
---

## 手順

belt のオートパイロットワークフローを実行する。以下の6フェーズを厳密な順序で実行すること。

### 全体リトライ

Phase 5 (QA) で2回リトライしても失敗した場合、Phase 1 からやり直す。全体リトライは最大2回まで。

- 全体リトライ時は architect に失敗の根本原因を診断させ、その結果を `outputs/qa-diagnosis.md` に保存する
- `.belt/phases/` 内の `outputs/qa-diagnosis.md` 以外のファイル・ディレクトリをクリアし、state をリセットする
- Phase 1 の analyst には元のリクエストに加えて QA 診断結果への参照を渡す
- 全体リトライ2回目も QA 失敗した場合、`active=false` で終了しユーザーに失敗を報告する

### 共通実行パターン

各フェーズではプロンプトファイルと出力ファイルを `.belt/phases/` に保存する。

事前準備として Read ツールで以下を読み込む:

- `skills/autopilot/references/prompt-template.md` — プロンプトファイルの共通テンプレートと最小 Task prompt
- `skills/autopilot/references/policies.md` — 共通ポリシー

#### 通常エージェント

3ステップで実行:

1. **プロンプト構築**: テンプレートに従い Write ツールで `prompts/{name}.md` を作成
2. **サブエージェント起動**: 最小 Task prompt で起動（テンプレート参照）
3. **ルーティング**: 戻り値（短いステータスのみ）で次の遷移を判定

各フェーズの「プロンプト仕様」に記載された変数をテンプレートに埋め込む。

#### Scout エージェント (例外)

Scout は `disallowedTools: Write` のため自分でファイルに書けない。

- Task prompt にリクエストをインラインで渡す（従来通り）
- 戻り値をオーケストレーターが `outputs/scout-*.md` に Write で保存する

### 起動: レジュームチェック

`mcp__belt__state_read` で前回の進捗を確認する。

**新規開始** (状態なし or `active=false`):

- `rm -rf .belt/phases/` → `mkdir -p .belt/phases/prompts .belt/phases/outputs`
- Phase 1 から開始

**レジューム** (`active=true`):

- `mkdir -p .belt/phases/prompts .belt/phases/outputs`（存在確認）
- `"status": "done"` のフェーズをスキップし次の未完了フェーズから続行

---

### Phase 1: 要件分析 (Scout → Analyst)

`state_write`: phase="analyst", status="running", active=true

#### Step 1: 並列偵察 (Scout × 3)

3つ並列で起動:

```text
Task(subagent_type="belt:scout", prompt="{リクエスト}\n\n既存の類似機能とパターンを洗い出してください。")
Task(subagent_type="belt:scout", prompt="{リクエスト}\n\n依存関係と影響範囲を調査してください。")
Task(subagent_type="belt:scout", prompt="{リクエスト}\n\nテストカバレッジと品質状況を確認してください。")
```

戻り値を保存: `outputs/scout-patterns.md`, `outputs/scout-deps.md`, `outputs/scout-tests.md`

#### Step 2: 要件分析 (Analyst)

プロンプト仕様:

| 項目     | 値                                                     |
| -------- | ------------------------------------------------------ |
| name     | analyst                                                |
| 参照     | `scout-patterns.md`, `scout-deps.md`, `scout-tests.md` |
| ポリシー | なし                                                   |
| 追加     | 全体リトライ時: `qa-diagnosis.md` も参照に追加         |

`state_write`: phase="analyst", status="done", active=true

---

### Phase 2: 設計・計画 (Scout → Architect → Planner)

`state_write`: phase="design", status="running", active=true

#### Step 1: 関連ファイルのスクリーニング (Scout)

```text
Task(
  subagent_type="belt:scout",
  prompt="{リクエスト}\n\n## Analyst 出力\nRead: `.belt/phases/outputs/analyst.md`\n\nこの変更に関連するファイルを全て列挙。ファイルパス、役割、変更が必要な理由を含めること。"
)
```

戻り値を保存: `outputs/scout-files.md`

#### Step 2: アーキテクチャ分析 (Architect)

プロンプト仕様:

| 項目             | 値                             |
| ---------------- | ------------------------------ |
| name             | architect                      |
| 参照             | `analyst.md`, `scout-files.md` |
| ファクトチェック | あり                           |
| ポリシー         | なし                           |

#### Step 3: 作業計画の作成 (Planner)

プロンプト仕様:

| 項目             | 値                           |
| ---------------- | ---------------------------- |
| name             | planner                      |
| 参照             | `analyst.md`, `architect.md` |
| ファクトチェック | あり                         |
| ポリシー         | なし                         |

`state_write`: phase="design", status="done", active=true

---

### Phase 3: 計画レビュー (Critic)

`state_write`: phase="critic", status="running", active=true

プロンプト仕様:

| 項目     | 値           |
| -------- | ------------ |
| name     | critic       |
| 参照     | `planner.md` |
| ポリシー | なし         |

**REJECT** の場合:

- `prompts/planner.md` を上書きし `outputs/critic.md` への参照を追加。planner を再実行。最大3回リトライ。
- 3回却下: 最善の計画で続行し未解決の懸念を記載。

**REVISE / ACCEPT-WITH-RESERVATIONS** の場合:

- 続行。留保事項を executor のプロンプトに含める。

`state_write`: phase="critic", status="done", active=true

---

### Phase 4: 実装 (Executor - 並列実行)

`state_write`: phase="executor", status="running", active=true

planner の計画の Group 単位で並列実行。Group 間は逐次。

各タスクのプロンプト仕様:

| 項目     | 値                                         |
| -------- | ------------------------------------------ |
| name     | executor-g{G}t{T}                          |
| 追加指示 | `## 担当タスク\n{計画の Task G.T の詳細}`  |
| 参照     | `planner.md`, `critic.md`（あれば）        |
| ポリシー | あり                                       |
| model    | complexity: high → opus, それ以外 → sonnet |

ルール:

- 同一 Group の全 Task は1メッセージで並列起動
- Group 完了を待ってから次の Group へ
- Group が1つ or 並列化マーカーなし → 逐次実行にフォールバック

`state_write`: phase="executor", status="done", active=true

---

### Phase 5: QA (Test Engineer → Debugger)

`state_write`: phase="qa", status="running", active=true

#### Step 1: テスト作成・実行 (Test Engineer)

プロンプト仕様:

| 項目     | 値                                                           |
| -------- | ------------------------------------------------------------ |
| name     | test-engineer                                                |
| 参照     | `planner.md`                                                 |
| ポリシー | あり                                                         |
| 追加指示 | 変更に対するテストを作成・実行。既存テストパターンに従うこと |

#### Step 2: ビルド・テスト検証

Bash でビルドとテストを実行（`go build ./...`, `go test ./...` 等）。

#### Step 3: 失敗の解決（必要な場合）

1. Scout でエラーを分類:

```text
Task(subagent_type="belt:scout", prompt="以下のエラー出力を分類・整理。エラーの種類、関連ファイル、優先度を付けること。\n\n## エラー出力\n{エラー出力}")
```

戻り値を保存: `outputs/scout-errors.md`

2. Debugger で修正:

| 項目     | 値                              |
| -------- | ------------------------------- |
| name     | debugger                        |
| 参照     | `scout-errors.md`, `planner.md` |
| ポリシー | あり                            |
| 追加指示 | `## エラー出力\n{エラー出力}`   |

修正後ビルド・テスト再実行。最大2回リトライ。

#### 全体リトライ（2回失敗時）

1. architect に根本原因を診断させる（インライン prompt: エラー出力 + planner.md 参照）
2. 診断結果を `outputs/qa-diagnosis.md` に保存
3. リトライ < 2回: `outputs/qa-diagnosis.md` 以外をクリア → `mkdir -p` → Phase 1 に戻る
4. リトライ = 2回: `state_write` phase="qa", status="error", active=false → ユーザーに失敗報告

成功: `state_write` phase="qa", status="done", active=true

---

### Phase 6: レビュー (Reviewer + Security Reviewer + AI Antipattern Reviewer)

`state_write`: phase="review", status="running", active=true

3つのプロンプトファイルを作成し**並列で**起動する:

| name                    | 追加指示                                                                                                                            | 参照         | ポリシー |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------- |
| reviewer                | —                                                                                                                                   | `planner.md` | あり     |
| security-reviewer       | セキュリティ脆弱性をレビューすること                                                                                                | `planner.md` | あり     |
| ai-antipattern-reviewer | AI 生成コード特有のアンチパターンをレビュー。幻覚 API、スコープクリープ、デッドコード、フォールバック濫用、不要な後方互換対応を検出 | `planner.md` | あり     |

レビュー結果の処理:

- いずれかが **CRITICAL** / **HIGH**: レビューフィードバック付きで Phase 4 に戻る。最大3回リトライ。
- **MEDIUM** / **LOW** のみ: 続行しサマリーに含める。

`state_write`: phase="review", status="done", active=false

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
[コードレビュー + セキュリティレビュー + AI Antipattern レビューの判定、主要な発見事項]
```
