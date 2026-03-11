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

事前準備として Read ツールで以下を読み込む:

- `skills/autopilot/references/prompt-template.md` — プロンプトファイルの共通テンプレートと最小 Task prompt
- `skills/autopilot/references/policies.md` — 共通ポリシー

#### 変数の初期化

- `iteration = 0` — エージェント起動のたびに +1 する（scout 含む全エージェント）

#### ファイル命名規則

全てのプロンプト・出力ファイルにイテレーション番号を付与する:

- プロンプト: `prompts/{name}-i{iteration}.md`
- 出力: `outputs/{name}-i{iteration}.md`
- 例: `prompts/planner-i5.md`, `outputs/critic-i6.md`

リトライで同じステップを再実行しても前回のファイルが上書きされない。

参照追跡: 各エージェント完了後、オーケストレーターは `latest_{name} = "{name}-i{iteration}.md"` を記録する。後続エージェントの参照には `latest_{name}` を使用する。

#### ステータスタグによるルーティング

サブエージェントは出力の最終行にステータスタグを出力する。オーケストレーターはタグで機械的にルーティングする（自然言語の判定文は参考にしない）。複数タグがある場合は最後のタグを採用する。

**Critic:**

- `[STATUS:ACCEPT]` → Phase 4 に進む
- `[STATUS:REVISE]` → Phase 4 に進む（留保事項を executor に渡す）
- `[STATUS:REJECT]` → planner をリトライ

**Reviewer / Security Reviewer / AI Antipattern Reviewer:**

- `[STATUS:APPROVE]` → 完了に進む
- `[STATUS:REQUEST_CHANGES]` → Phase 4 をリトライ
- `[STATUS:COMMENT]` → 完了に進む（サマリーに含める）

#### finding_id による指摘追跡

Phase 6 のレビューアは各指摘に一意の finding_id（`F-001`, `F-002`, ...）を付与する。リトライ時、レビューアは前回の出力を参照し、各 finding_id を追跡する:

- `new` — 今回新たに検出
- `persists` — 前回指摘し、未修正
- `resolved` — 前回指摘し、修正済み

同じ問題の堂々巡りを防ぎ、修正漏れを可視化する。

#### 通常エージェント

3ステップで実行:

1. **プロンプト構築**: テンプレートに従い Write ツールで `prompts/{name}-i{iteration}.md` を作成
2. **サブエージェント起動**: 最小 Task prompt で起動（テンプレート参照）
3. **ルーティング**: 戻り値のステータスタグで次の遷移を判定

各フェーズの「プロンプト仕様」に記載された変数をテンプレートに埋め込む。

#### Scout エージェント (例外)

Scout は `disallowedTools: Write` のため自分でファイルに書けない。

- Task prompt にリクエストをインラインで渡す（従来通り）
- 戻り値をオーケストレーターが `outputs/scout-{type}-i{iteration}.md` に Write で保存する

### 起動: レジュームチェック

`mcp__belt__state_read` で前回の進捗を確認する。

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

### Phase 1: 要件分析 (Scout → Analyst)

`state_write`: phase="analyst", status="running", active=true

#### Step 1: 並列偵察 (Scout × 3)

3つ並列で起動:

```text
Task(subagent_type="belt:scout", prompt="{リクエスト}\n\n既存の類似機能とパターンを洗い出してください。")
Task(subagent_type="belt:scout", prompt="{リクエスト}\n\n依存関係と影響範囲を調査してください。")
Task(subagent_type="belt:scout", prompt="{リクエスト}\n\nテストカバレッジと品質状況を確認してください。")
```

iteration を各 scout で +1 し、戻り値を保存: `outputs/scout-patterns-i{N}.md`, `outputs/scout-deps-i{N}.md`, `outputs/scout-tests-i{N}.md`

#### Step 2: 要件分析 (Analyst)

iteration +1。プロンプト仕様:

| 項目     | 値                                                                 |
| -------- | ------------------------------------------------------------------ |
| name     | analyst                                                            |
| 参照     | `latest_scout-patterns`, `latest_scout-deps`, `latest_scout-tests` |
| ポリシー | なし                                                               |
| 追加     | 全体リトライ時: `latest_qa-diagnosis` も参照に追加                 |

`state_write`: phase="analyst", status="done", active=true

---

### Phase 2: 設計・計画 (Scout → Architect → Planner)

`state_write`: phase="design", status="running", active=true

#### Step 1: 関連ファイルのスクリーニング (Scout)

iteration +1。

```text
Task(
  subagent_type="belt:scout",
  prompt="{リクエスト}\n\n## Analyst 出力\nRead: `.belt/phases/outputs/{latest_analyst}`\n\nこの変更に関連するファイルを全て列挙。ファイルパス、役割、変更が必要な理由を含めること。"
)
```

戻り値を保存: `outputs/scout-files-i{iteration}.md`

#### Step 2: アーキテクチャ分析 (Architect)

iteration +1。プロンプト仕様:

| 項目             | 値                                     |
| ---------------- | -------------------------------------- |
| name             | architect                              |
| 参照             | `latest_analyst`, `latest_scout-files` |
| ファクトチェック | あり                                   |
| ポリシー         | なし                                   |

#### Step 3: 作業計画の作成 (Planner)

iteration +1。プロンプト仕様:

| 項目             | 値                                   |
| ---------------- | ------------------------------------ |
| name             | planner                              |
| 参照             | `latest_analyst`, `latest_architect` |
| ファクトチェック | あり                                 |
| ポリシー         | なし                                 |

`state_write`: phase="design", status="done", active=true

---

### Phase 3: 計画レビュー (Critic)

`state_write`: phase="critic", status="running", active=true

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

`state_write`: phase="critic", status="done", active=true

---

### Phase 4: 実装 (Executor - 並列実行)

`state_write`: phase="executor", status="running", active=true

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

`state_write`: phase="executor", status="done", active=true

---

### Phase 5: QA (Test Engineer → Debugger)

`state_write`: phase="qa", status="running", active=true

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

1. iteration +1。Scout でエラーを分類:

```text
Task(subagent_type="belt:scout", prompt="以下のエラー出力を分類・整理。エラーの種類、関連ファイル、優先度を付けること。\n\n## エラー出力\n{エラー出力}")
```

戻り値を保存: `outputs/scout-errors-i{iteration}.md`

2. iteration +1。Debugger で修正:

| 項目     | 値                                      |
| -------- | --------------------------------------- |
| name     | debugger                                |
| 参照     | `latest_scout-errors`, `latest_planner` |
| ポリシー | あり                                    |
| 追加指示 | `## エラー出力\n{エラー出力}`           |

修正後ビルド・テスト再実行。最大2回リトライ。

#### 全体リトライ（2回失敗時）

1. iteration +1。architect に根本原因を診断させる（インライン prompt: エラー出力 + `latest_planner` 参照）
2. 診断結果を `outputs/qa-diagnosis-i{iteration}.md` に保存
3. リトライ < 2回: ファイルはクリアしない（イテレーション番号で区別）→ Phase 1 に戻る
4. リトライ = 2回: `state_write` phase="qa", status="error", active=false → ユーザーに失敗報告

成功: `state_write` phase="qa", status="done", active=true

---

### Phase 6: レビュー (Reviewer + Security Reviewer + AI Antipattern Reviewer)

`state_write`: phase="review", status="running", active=true

各レビューアで iteration +1。3つのプロンプトファイルを作成し**並列で**起動する:

| name                    | 追加指示                                                                                                                            | 参照             | ポリシー |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------- |
| reviewer                | —                                                                                                                                   | `latest_planner` | あり     |
| security-reviewer       | セキュリティ脆弱性をレビューすること                                                                                                | `latest_planner` | あり     |
| ai-antipattern-reviewer | AI 生成コード特有のアンチパターンをレビュー。幻覚 API、スコープクリープ、デッドコード、フォールバック濫用、不要な後方互換対応を検出 | `latest_planner` | あり     |

レビュー結果の処理（ステータスタグで判定）:

- いずれかが `[STATUS:REQUEST_CHANGES]`: レビューフィードバック付きで Phase 4 に戻る。最大3回リトライ。リトライ時は前回のレビュー出力を参照に追加し、レビューアが finding_id で修正状況を追跡できるようにする。
- 全員が `[STATUS:APPROVE]` または `[STATUS:COMMENT]`: 続行しサマリーに含める。

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
