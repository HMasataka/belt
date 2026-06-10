# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリの性質

`belt` は Claude Code プラグイン本体である。アプリケーションコードではなく、Claude Code に対する **エージェント定義 / スキル / フック / MCP サーバー** の集合体。プラグインは `.claude-plugin/marketplace.json` で公開され、`/plugin marketplace add HMasataka/belt` でマーケットプレイスを登録したのち `/plugin install belt@belt` でインストールされる（マーケットプレイス名・プラグイン名はどちらも `marketplace.json` の `name` = `belt`）。

開発時は手元のリポジトリそのものをプラグインとして読み込んで動かす。ビルド工程はなく、ファイルを編集すれば次回 Claude Code 起動時に反映される。

## ディレクトリ構成と役割

| ディレクトリ        | 役割                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ |
| `agents/*.md`       | サブエージェント定義（YAML frontmatter + プロンプト本文）                            |
| `skills/*/SKILL.md` | ユーザー向けスキル（`/belt:autopilot` 等で起動）。エージェントを Task ツールで束ねる |
| `hooks/hooks.json`  | Claude Code のライフサイクルフック登録（PreCompact / UserPromptSubmit / Stop）       |
| `scripts/*.mjs`     | フックスクリプト本体と MCP サーバー実装                                              |
| `.claude-plugin/`   | プラグインメタデータ（plugin.json, marketplace.json）                                |
| `.mcp.json`         | belt MCP サーバーの登録                                                              |

ランタイムの作業ディレクトリは利用者プロジェクト側であり、プラグインは利用者プロジェクトに `.belt/` を作って状態を書き込む（`.belt/state.json`、`.belt/phases/{prompts,outputs}/`、`.belt/spec.draft.md`、`.belt/spec.md`、`.belt/roadmap.md`、`.belt/breakdown.md`）。

## 主要ワークフロー

### autopilot（単発タスク用、6 フェーズ）

`Analyst → Architect+Planner → Critic → Executor(並列) → QA(Test+Debugger) → Reviewer×3` を順に回し、各フェーズの入出力を `.belt/phases/` にファイル保存しながら進む。Critic の REJECT、Reviewer の REQUEST_CHANGES、QA 失敗時はリトライし、QA が 2 回失敗すると Architect の根本原因診断を経て Phase 1 から全体リトライ（最大 2 回）。

### spec → spec-confirm → roadmap → 実行（大規模タスク用）

人間レビューポイントを挟む段階的ワークフロー:

1. `/belt:spec` — Analyst+Architect が要件を分析し、チェックボックス付き仕様ドラフトを `.belt/spec.draft.md` へ
2. ユーザーが採用要件にチェック
3. `/belt:spec-confirm` — `spec.draft.md` の Open Questions を AskUserQuestion で解消して要件に反映し、チェック済み要件のみを抽出してチェックボックスなしの仕様ドキュメントを `.belt/spec.md` へ。`spec.md` は確定済みなので Open Questions を残さない
4. ユーザーが `spec.md` を確認
5. `/belt:roadmap` — `.belt/spec.md` の全要件を入力に、Architect→Planner→Critic でマイルストーン分解、`.belt/roadmap.md` へ
6. ユーザーがロードマップを確認
7. 実装の進め方を 2 通りから選ぶ:
   - マイルストーン単位: `/belt:cruise` — roadmap.md の未完了マイルストーンを先頭から autopilot で回し、完了タスクをチェックしていく。途中再開可能
   - PR 単位（JIT）: `/belt:breakdown [v0.X]`（指定マイルストーン、省略時は最初の未完了）を Planner+Critic で「1 PR 粒度」に分解 `.belt/breakdown.md` へ → `/belt:ship` で PR を 1 つずつ executor で実装し、`reviewer` + `ai-antipattern-reviewer` の最小レビューを通してからチェック、全 PR 完了でマイルストーンを一括チェック + breakdown.md を削除。1 マイルストーンずつ分解→消化を繰り返す

cruise と ship はどちらも未完了マイルストーンを進めるが、cruise はマイルストーン単位で autopilot を、ship は breakdown 済みの PR 単位で executor を回す。役割を分離しているため、cruise は breakdown.md を見ない。ship は PR が既に 1 PR 粒度に分解済みであることを前提に実装を executor 1 段に絞り、各 PR の executor 完了後に `reviewer` + `ai-antipattern-reviewer` を並列起動して、受け入れ基準の充足と先行 PR との統合を PR 単位で確認する最小レビューゲートで品質を担保する。`REQUEST_CHANGES` なら executor を最大 2 回まで再実行する。

### dispatch（単発タスク用、executor + 2 レビュー）

roadmap / breakdown に依存しない単発リクエスト用。autopilot のような多段オーケストレーションは小タスクには重いため、実装を executor 1 段に絞り、ship と同じく `reviewer` + `ai-antipattern-reviewer` を並列起動して最小レビューゲートを通す。受け入れ基準はユーザーの依頼内容そのものとして扱う。`REQUEST_CHANGES` なら executor を最大 2 回まで再実行する。タスクが大きい場合は executor に渡す前に planner で実装単位への分解・順序付けを行い、その計画を executor のコンテキストに含める。ship との違いは PR/マイルストーンのチェック管理を持たない点と、大タスク時に前段 planner を挟む点。

### brainstorm

純粋な発散用のシングルエージェントスキル。サブエージェント連鎖はなし。

## オーケストレーションの設計原則

スキル（オーケストレーター）はサブエージェントを **Task ツール** で起動する。エージェント間でコンテキストを直接渡さず、`.belt/phases/` のファイル経由で受け渡す:

- **プロンプトファイル**: `.belt/phases/prompts/{name}-i{iteration}.md`（オーケストレーターが Write）
- **出力ファイル**: `.belt/phases/outputs/{name}-i{iteration}.md`（サブエージェントが Write）
- **iteration**: エージェント起動のたびに +1。リトライしても前回の出力が上書きされない
- **`latest_{name}`**: オーケストレーターが保持する「直近の出力ファイル名」。後続エージェントへの参照に使用
- **最小 Task prompt**: サブエージェントには「prompts/...md を読み、outputs/...md に書け」とだけ伝える（プロンプト本体はファイル側に置く）

サブエージェントは出力末尾に **ステータスタグ** を出す。オーケストレーターはタグで機械的にルーティングする（自然言語の判定文は無視）:

- Critic: `[STATUS:ACCEPT|REVISE|REJECT]`
- Reviewer 系: `[STATUS:APPROVE|REQUEST_CHANGES|COMMENT]`

Phase 6 のレビュー指摘には `finding_id`（`F-001`...）を付与し、リトライ時に `new / persists / resolved` を追跡する。

エージェントを追加・改修するときも、この「ファイル経由 + ステータスタグ + iteration 番号」の規約を維持すること。

## エージェントとモデル割り当て

| エージェント                       | モデル | 役割の要点                                                 |
| ---------------------------------- | ------ | ---------------------------------------------------------- |
| analyst                            | opus   | 要件ギャップ・受け入れ基準（読み取り専用、Write 不可）     |
| architect                          | opus   | アーキテクチャ判断・根本原因診断                           |
| planner                            | opus   | 計画作成。Group 単位の並列マーカーで executor 並列化を指示 |
| critic                             | opus   | 計画品質ゲート                                             |
| executor                           | sonnet | 実装。autopilot 内は complexity: high のときだけ opus。ship/dispatch では opus 固定 |
| test-engineer / debugger           | sonnet | テスト作成 / 失敗修正                                      |
| reviewer / ai-antipattern-reviewer | sonnet | コード品質 / AI 生成のコード・コメント・ドキュメントのアンチパターン |
| security-reviewer                  | opus   | セキュリティレビュー                                       |
| scout                              | haiku  | 高速偵察                                                   |

Phase 4 で planner が `complexity: high` を付けたタスクは Task の `model="opus"` で起動する。Phase 6 の 3 レビューアは 1 メッセージ内で並列起動する。Phase 4 も同一 Group 内タスクは 1 メッセージで並列起動。

`executor.md` の frontmatter は既定 `sonnet`。Task の `model` は frontmatter を上書きするため、呼び出し側で切り替える。ship/dispatch は上流の分析・設計フェーズを経ずいきなり実装に入るので、判断品質を確保するため complexity によらず `model="opus"` を固定で渡す。

## 共通ポリシー

`skills/autopilot/references/policies.md` に集約。**コーディング / テスト / レビュー / ファクトチェック / AI 生成コードのアンチパターン** を一括定義しており、各サブエージェントのプロンプトファイルに「`policies.md` を Read せよ」と参照を貼る形で適用する。ポリシー変更はこの 1 ファイルを編集すれば全エージェントに波及する。

特に厳しい禁止事項:

- フォールバック・デフォルト引数で値の流れを隠す
- 後方互換 / Legacy 対応の自発的追加
- 説明コメント（What / How）。Why のみ可
- any 型、エラー握りつぶし、未使用コード

## MCP サーバーとフック

### MCP サーバー (`scripts/mcp-server.mjs`)

`belt` MCP サーバーが 2 ツールを公開:

- `state_write({ phase, status, active, message })` — `.belt/state.json` にフェーズ状態を保存
- `state_read()` — 現在の状態を読み取る（autopilot のレジューム判定に使う）

各フェーズの開始時に `running`、終了時に `done` を `state_write` する。最終フェーズで `active=false` を立てるまでオートパイロットは「アクティブ」扱い。

### フック (`hooks/hooks.json`)

| イベント           | スクリプト             | 役割                                                                                       |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------------ |
| `PreCompact`       | `pre-compact-hook.mjs` | コンテキスト圧縮前に現在の autopilot 状態を `systemMessage` で再注入し、フェーズ継続を促す |
| `UserPromptSubmit` | `keyword-detector.mjs` | `autopilot/dispatch/spec/roadmap/cruise/ship/brainstorm` 等のキーワードを検出し、対応スキルを強制起動 |
| `Stop`             | `stop-hook.mjs`        | `state.active=true` の間は Stop をブロックし、ワークフロー完走を強制                       |

`keyword-detector.mjs` はコードブロックを除去してからマッチし、既に `/belt:` で明示起動された場合は二重起動を避ける。

## 開発時の注意

- **ビルド・テストフレームワークなし**。`package.json` の `dependencies` は MCP SDK と zod のみ。CI もなし
- フックスクリプトは Node ESM (`.mjs`)、stdin で JSON イベントを受け取り、stdout に JSON を返すプロトコル。pure な stdin/stdout 処理に保つこと（外部副作用なし）
- スキルや autopilot リファレンス（`skills/autopilot/references/*.md`）の文言は **オーケストレーターのロジックそのもの**。ステータスタグ名・フェーズ名・ファイル命名規則を変えると複数箇所が連動して破綻するため、変更時は autopilot SKILL.md・各エージェント・policies.md・prompt-template.md を横断的に確認
- エージェント `frontmatter` の `disallowedTools` は重要な安全装置（例: analyst は Write/Edit/Bash 不可）。読み取り専用で良いエージェントには明示的に付ける
- Markdown は `.markdownlint.json` で `MD013: 180` / `MD041: false` 設定。`/markdownlint-fix` スキルで整形できる
- 利用者環境の `.belt/` を直接いじって動作確認する場合、`.belt/phases/` を `rm -rf` してから autopilot を起動するとレジューム挙動と新規開始挙動を切り分けやすい
