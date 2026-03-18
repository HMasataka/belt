---
name: autopilot
description: 分析・設計・計画・実装・QA・レビューを通すオートパイロットワークフロー
argument-hint: "<タスクの説明>"
---

## 手順

belt のオートパイロットワークフローを実行する。以下の6フェーズを厳密な順序で実行すること。

### 全体リトライ

Phase 5 (QA) で2回リトライしても失敗した場合、Phase 1 からやり直す。全体リトライは最大2回まで。

- 全体リトライ時は architect に失敗の根本原因を診断させ、その結果を `outputs/qa-diagnosis-i{iteration}.md` に保存する
- `.belt/phases/` 内のファイルはクリアしない（イテレーション番号で前回と区別される）。state をリセットする
- Phase 1 の analyst には元のリクエストに加えて QA 診断結果への参照を渡す
- 全体リトライ2回目も QA 失敗した場合、`active=false` で終了しユーザーに失敗を報告する

### 共通実行パターン

各フェーズではプロンプトファイルと出力ファイルを `.belt/phases/` に保存する。

事前準備として Read ツールで以下を読み込み、記載されたルールに従う:

- `skills/autopilot/references/prompt-template.md` — 変数初期化、ファイル命名規則、ステータスタグ、finding_id、エージェント実行パターン、テンプレート、最小 Task prompt
- `skills/autopilot/references/policies.md` — 共通ポリシー

### 起動: レジュームチェック

`mcp__belt__state_read` (mode="autopilot") で前回の進捗を確認する。

**新規開始** (状態なし or `active=false`):

- `rm -rf .belt/phases/` → `mkdir -p .belt/phases/prompts .belt/phases/outputs`
- `iteration = 0`
- Phase 1 から開始

**レジューム** (`active=true`):

- `mkdir -p .belt/phases/prompts .belt/phases/outputs`（存在確認）
- `outputs/` 内の既存ファイルから最大のイテレーション番号を取得し `iteration` に設定する
- 各エージェントの `latest_{name}` を既存ファイルから復元する
- `"status": "done"` のフェーズをスキップし次の未完了フェーズから続行

---

### Phase 1: 要件分析 (Analyst)

`state_write` (mode="autopilot"): phase="analyst", status="running", active=true

iteration +1。プロンプト仕様:

| 項目     | 値                                                 |
| -------- | -------------------------------------------------- |
| name     | analyst                                            |
| 参照     | なし                                               |
| ポリシー | なし                                               |
| 追加     | 全体リトライ時: `latest_qa-diagnosis` も参照に追加 |

`state_write` (mode="autopilot"): phase="analyst", status="done", active=true

---

### Phase 2: 設計・計画 (Architect → Planner)

`state_write` (mode="autopilot"): phase="design", status="running", active=true

#### Step 1: アーキテクチャ分析 (Architect)

iteration +1。プロンプト仕様:

| 項目             | 値               |
| ---------------- | ---------------- |
| name             | architect        |
| 参照             | `latest_analyst` |
| ファクトチェック | あり             |
| ポリシー         | なし             |

#### Step 2: 作業計画の作成 (Planner)

iteration +1。プロンプト仕様:

| 項目             | 値                                   |
| ---------------- | ------------------------------------ |
| name             | planner                              |
| 参照             | `latest_analyst`, `latest_architect` |
| ファクトチェック | あり                                 |
| ポリシー         | なし                                 |

`state_write` (mode="autopilot"): phase="design", status="done", active=true

---

### Phase 3: 計画レビュー (Critic)

`state_write` (mode="autopilot"): phase="critic", status="running", active=true

iteration +1。プロンプト仕様:

| 項目     | 値               |
| -------- | ---------------- |
| name     | critic           |
| 参照     | `latest_planner` |
| ポリシー | なし             |

`[STATUS:REJECT]` の場合:

- iteration +1。新しい `prompts/planner-i{iteration}.md` を作成し `latest_critic` への参照を追加。planner を再実行。最大3回リトライ。
- 3回却下: 最善の計画で続行し未解決の懸念を記載。

`[STATUS:REVISE]` の場合:

- 続行。留保事項を executor のプロンプトに含める。

`[STATUS:ACCEPT]` の場合:

- Phase 4 に進む。

`state_write` (mode="autopilot"): phase="critic", status="done", active=true

---

### Phase 4: 実装 (Executor - 並列実行)

`state_write` (mode="autopilot"): phase="executor", status="running", active=true

planner の計画の Group 単位で並列実行。Group 間は逐次。

各タスクで iteration +1。プロンプト仕様:

| 項目     | 値                                          |
| -------- | ------------------------------------------- |
| name     | executor-g{G}t{T}                           |
| 追加指示 | `## 担当タスク\n{計画の Task G.T の詳細}`   |
| 参照     | `latest_planner`, `latest_critic`（あれば） |
| ポリシー | あり                                        |
| model    | complexity: high → opus, それ以外 → sonnet  |

ルール:

- 同一 Group の全 Task は1メッセージで並列起動
- Group 完了を待ってから次の Group へ
- Group が1つ or 並列化マーカーなし → 逐次実行にフォールバック

`state_write` (mode="autopilot"): phase="executor", status="done", active=true

---

### Phase 5: QA (Test Engineer → Debugger)

`state_write` (mode="autopilot"): phase="qa", status="running", active=true

#### Step 1: テスト作成・実行 (Test Engineer)

iteration +1。プロンプト仕様:

| 項目     | 値                                                           |
| -------- | ------------------------------------------------------------ |
| name     | test-engineer                                                |
| 参照     | `latest_planner`                                             |
| ポリシー | あり                                                         |
| 追加指示 | 変更に対するテストを作成・実行。既存テストパターンに従うこと |

#### Step 2: ビルド・テスト検証

Bash でビルドとテストを実行（`go build ./...`, `go test ./...` 等）。

#### Step 3: 失敗の解決（必要な場合）

iteration +1。Debugger で修正:

| 項目     | 値                            |
| -------- | ----------------------------- |
| name     | debugger                      |
| 参照     | `latest_planner`              |
| ポリシー | あり                          |
| 追加指示 | `## エラー出力\n{エラー出力}` |

修正後ビルド・テスト再実行。最大2回リトライ。

#### 全体リトライ（2回失敗時）

1. iteration +1。architect に根本原因を診断させる（インライン prompt: エラー出力 + `latest_planner` 参照）
2. 診断結果を `outputs/qa-diagnosis-i{iteration}.md` に保存
3. リトライ < 2回: ファイルはクリアしない（イテレーション番号で区別）→ Phase 1 に戻る
4. リトライ = 2回: `state_write` (mode="autopilot") phase="qa", status="error", active=false → ユーザーに失敗報告

成功: `state_write` (mode="autopilot") phase="qa", status="done", active=true

---

### Phase 6: レビュー (Reviewer + Security Reviewer + AI Antipattern Reviewer)

`state_write` (mode="autopilot"): phase="review", status="running", active=true

各レビューアで iteration +1。3つのプロンプトファイルを作成し**並列で**起動する:

| name                    | 追加指示                                                                                                                            | 参照             | ポリシー |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------- |
| reviewer                | —                                                                                                                                   | `latest_planner` | あり     |
| security-reviewer       | セキュリティ脆弱性をレビューすること                                                                                                | `latest_planner` | あり     |
| ai-antipattern-reviewer | AI 生成コード特有のアンチパターンをレビュー。幻覚 API、スコープクリープ、デッドコード、フォールバック濫用、不要な後方互換対応を検出 | `latest_planner` | あり     |

レビュー結果の処理（ステータスタグで判定）:

- いずれかが `[STATUS:REQUEST_CHANGES]`: レビューフィードバック付きで Phase 4 に戻る。最大3回リトライ。リトライ時は前回のレビュー出力を参照に追加し、レビューアが finding_id で修正状況を追跡できるようにする。
- 全員が `[STATUS:APPROVE]` または `[STATUS:COMMENT]`: 続行しサマリーに含める。

`state_write` (mode="autopilot"): phase="review", status="done", active=false

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
