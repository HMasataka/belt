---
name: breakdown
description: roadmap.md の1マイルストーンを 1 PR 粒度のタスクに分解し .belt/breakdown.md に出力する
argument-hint: "[v0.X]"
---

## 手順

`.belt/roadmap.md` の指定マイルストーン（または最初の未完了マイルストーン）を、1 PR で提出して違和感がない粒度のタスクに分解し、`.belt/breakdown.md` に出力する。

起動時に Bash ツールで `mkdir -p .belt/phases/prompts .belt/phases/outputs` を実行してディレクトリを作成する。

---

### Step 1: 対象マイルストーンの特定

Read ツールで `.belt/roadmap.md` を読み込む。ファイルが存在しない場合、ユーザーに「先に `/belt:spec` → `/belt:roadmap` を実行してください」と案内して終了する。

引数で `v0.X` が指定されている場合は該当マイルストーン (`## v0.X - ...` セクション) を抽出する。指定されていない場合は、最初の未チェックタスク (`- [ ]`) を含むマイルストーンを抽出する。すべてのタスクがチェック済み (`- [x]`) の場合、ユーザーに「全マイルストーンが完了しています」と案内して終了する。

引数で指定された `v0.X` が roadmap.md に見つからない場合、ユーザーにその旨を案内して終了する。

抽出した内容（マイルストーン名、ゴール、完動品としての価値、タスク一覧）と、roadmap.md 先頭の「アーキテクチャ方針」セクションを保持する。

---

### Step 2: PR 粒度への分解 (Planner)

オーケストレーターが Write ツールで `.belt/phases/prompts/planner.md` にプロンプトファイルを作成する:

```markdown
## タスク

以下のマイルストーンを「1 PR で提出して違和感がない粒度」のタスクに分解してください。

## アーキテクチャ方針

{Step 1 で抽出したアーキテクチャ方針}

## マイルストーン

{Step 1 で抽出したマイルストーンセクション全文（タスクリスト含む）}

## PR タスクの粒度の定義

各 PR タスクは以下を満たすこと:

- 規模: 数時間〜半日で完成する程度。コード行数は目安として数百行以下
- 単一の関心事: 1つのサブシステム/レイヤー/機能に閉じる
- レビュー可能性: 1 PR として違和感なくレビューできる
- 受け入れ基準が明確: 「完了した」と機械的に判定できる
- 依存順序: 後続 PR が依存するものを先に配置する
- 既存テストを壊さない順序: 各 PR の完了時点でビルド・テストが通る状態を保つ

過大であれば分割し、過小であれば隣接 PR と統合すること。

## 出力フォーマット

各 PR は以下の構造で出力すること:

- 見出し: `## PR-N: PRタイトル`（N は 1 から始まる連番）
- 直下にチェックボックス1行: `- [ ] このPRを完了する`
- `**スコープ**:` 行: 変更対象のファイル群やサブシステム
- `**受け入れ基準**:` 行と続く箇条書き: 機械的に判定可能な基準を複数行
- `**依存**:` 行: `なし` または `PR-X` への参照

冒頭にマイルストーンのゴールと完動品としての価値を保持すること。

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

---

### Step 3: 分解レビュー (Critic)

オーケストレーターが Write ツールで `.belt/phases/prompts/critic.md` にプロンプトファイルを作成する:

```markdown
## タスク

以下の PR 分解をレビューしてください。

## 分解対象

以下のファイルを Read ツールで読み、レビュー対象として使用してください:

- `.belt/phases/outputs/planner.md` — PR 粒度への分解

## 評価基準

- 各 PR が「1 PR で出して違和感がない粒度」に収まっているか（過大/過小がないか）
- 単一の関心事に閉じているか
- 依存関係が正しく順序付けられているか
- 受け入れ基準が機械的に判定可能か
- 元のマイルストーンの全タスクがカバーされているか
- 各 PR 完了時点でビルド・テストが通る順序になっているか

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

  以下のファイルを Read ツールで読み、フィードバックを反映して分解を改善してください:

  - `.belt/phases/outputs/critic.md` — Critic のフィードバック
  ```

- Step 2（planner）を再実行する。リトライは最大 3 回。
- 3 回すべて却下された場合、利用可能な最善の分解で続行する。

判定が **REVISE** または **ACCEPT-WITH-RESERVATIONS** の場合:

- 続行するが、留保事項を分解結果に注記として追加する。

---

### Step 4: breakdown.md の出力

`.belt/phases/outputs/planner.md` を Read ツールで読み込み、以下のフォーマットで `.belt/breakdown.md` に Write ツールで書き出す。既存の `.belt/breakdown.md` は上書きする。

出力フォーマット:

```markdown
# 分解: v0.X - マイルストーン名

**元のマイルストーンゴール**: {ゴール}
**完動品としての価値**: {価値}

## PR-1: PRタイトル

- [ ] このPRを完了する

**スコープ**: 変更対象のファイル群やサブシステム
**受け入れ基準**:
- 基準1
- 基準2
**依存**: なし

## PR-2: PRタイトル

- [ ] このPRを完了する

**スコープ**: ...
**受け入れ基準**:
- ...
**依存**: PR-1
```

---

### Step 5: 案内

分解の出力が完了したら、ユーザーに以下を案内して終了する:

```text
`.belt/breakdown.md` に v0.X の PR 分解を出力しました。

内容を確認し、`/belt:cruise` を実行すると PR 単位で autopilot による実装が開始されます。
```
