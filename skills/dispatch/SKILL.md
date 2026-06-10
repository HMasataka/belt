---
name: dispatch
description: 単発タスクを（大きい場合は planner で計画してから）executor で実装し、reviewer + ai-antipattern-reviewer の最小レビューを通す（roadmap 非依存）
argument-hint: "<タスクの説明>"
---

## 手順

ユーザーの単発リクエストを `executor` で実装し、`reviewer` + `ai-antipattern-reviewer` の最小レビューに通してから完了する。タスクが大きい場合は executor に渡す前に planner で実装単位への分解・順序付けを行う。roadmap.md / breakdown.md には依存しない。

autopilot のような多段オーケストレーション（Analyst→Architect→Planner→Critic→QA→3 レビュー）は単発の小タスクには重いため、dispatch は実装を executor 1 段に絞り、品質は後段の 2 レビューゲートで担保する。

`/belt:ship` は breakdown 済みの PR 群を消化する専用スキルだが、dispatch は roadmap と無関係な単発の依頼に同じ「実装 + 2 レビュー」を適用する。受け入れ基準はユーザーの依頼内容そのものとして扱う。

変数 `iteration = 0` を持ち、実装→レビューのサイクルごとに +1 する（リトライで前回の実装・レビューファイルが上書きされないようにするため）。

起動時に Bash ツールで `mkdir -p .belt/phases/prompts .belt/phases/outputs` を実行してディレクトリを作成する。

---

### 起動: 状態設定

`mcp__belt__state_write` を `mode="dispatch"`, `phase="dispatch"`, `status="running"`, `active=true`, `message="{タスクの要約}"` で呼び出す。

---

### Step 1: タスク規模の判定（大きい場合は planner を挟む）

ユーザーの依頼を読み、規模を判定する。次のいずれかに当てはまれば「大きいタスク」とみなす:

- 独立した成果物・変更点が複数ある
- 複数のモジュール／レイヤーにまたがる
- 受け入れ基準が多く、実装単位の順序や依存の整理が必要

小さい・単一のタスクなら planner を挟まず Step 2 へ進む。executor が単体で実装するため、小タスクでは前段 planner は不要。

大きいタスクの場合、executor に渡す前に planner で実装単位への分解と順序付けを行う。オーケストレーターが Write ツールで `.belt/phases/prompts/dispatch-planner.md` を作成する:

```markdown
## タスク

{ユーザーの元のリクエスト}

## 計画の観点

- 依頼を 1 回の executor 実行で完結できる実装単位に分解する
- 依存関係に基づいて順序付けする
- 各単位のスコープと受け入れ基準を明示する
- スコープ外・やらないことを明記する

## 共通ポリシー

以下のファイルを Read ツールで読み、ポリシーに従ってください:

- `skills/autopilot/references/policies.md`

## 出力先

作業結果を `.belt/phases/outputs/dispatch-planner.md` に Write ツールで保存してください。
```

最小 Task prompt で planner を起動する:

```text
Task(
  subagent_type="belt:planner",
  prompt="`.belt/phases/prompts/dispatch-planner.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/dispatch-planner.md` に Write ツールで保存してください。"
)
```

planner の出力は Step 2 で executor のコンテキストとして渡す。

---

### Step 2: 実装

冒頭で `iteration` を +1 する。この実装と続く Step 3 のレビューは同じ `iteration` 番号のファイルを使う。

Bash ツールで `git rev-parse HEAD` を実行し、レビュー差分の基準コミットとして `baseline` に保持する（executor 実行前の状態）。

オーケストレーターが Write ツールで `.belt/phases/prompts/dispatch-executor-i{iteration}.md` を作成する:

```markdown
## タスク

{ユーザーの元のリクエスト}

## 計画

{`.belt/phases/outputs/dispatch-planner.md` の内容。Step 1 で planner を実行した場合のみ。挟まなかった場合はこのセクションを省く}

## 受け入れ基準

ユーザーの依頼内容そのものを受け入れ基準とする。依頼を満たす実装をリポジトリに直接行うこと。

## 共通ポリシー

以下のファイルを Read ツールで読み、ポリシーに従ってください:

- `skills/autopilot/references/policies.md`

## 出力先

実装はリポジトリに直接行う。実装した内容の要約（変更ファイルと要点）を `.belt/phases/outputs/dispatch-executor-i{iteration}.md` に Write ツールで保存してください。
```

タスクの complexity を判定し、`model` を明示して Task を起動する（複数モジュールにまたがる・設計判断を要するなど難度が高ければ `opus`、それ以外は `sonnet`）:

```text
Task(
  subagent_type="belt:executor",
  model="{complexity が high なら opus、それ以外は sonnet}",
  prompt="`.belt/phases/prompts/dispatch-executor-i{iteration}.md` を Read ツールで読み、指示に従って実装してください。実装した内容の要約を `.belt/phases/outputs/dispatch-executor-i{iteration}.md` に Write ツールで保存してください。"
)
```

executor 完了後、Step 3（レビュー）へ進む。

---

### Step 3: レビュー (reviewer + ai-antipattern-reviewer)

executor が完了した変更を最小レビューに通す。Step 2 で +1 した `iteration` をそのまま使い、この Step 内で作成する差分・プロンプト・出力ファイルもすべて同じ `iteration` 番号にする。

1. **差分の取得**: Bash ツールで `git --no-pager diff {baseline}` と `git --no-pager diff --stat {baseline}` を実行し、依頼開始時点からの変更を取得する。出力を Write ツールで `.belt/phases/outputs/dispatch-changes-i{iteration}.md` に保存する。差分が空の場合は executor が実装を行っていない異常なので、ユーザーに報告して `status="error"`, `active=false` で終了する。

2. **プロンプトファイルの作成**: `reviewer` と `ai-antipattern-reviewer` の 2 つのプロンプトファイルを Write する。

   `.belt/phases/prompts/dispatch-reviewer-i{iteration}.md`:

   ```markdown
   ## タスク

   以下の依頼に対する変更が、依頼内容を満たし既存コードと整合しているかをレビューしてください。コード品質・セキュリティ・依頼の充足・統合の破綻を観点とする。

   ## 依頼

   {ユーザーの元のリクエスト}

   ## 変更内容

   以下のファイルを Read ツールで読み、レビュー対象としてください:

   - `.belt/phases/outputs/dispatch-changes-i{iteration}.md` — 依頼開始時点からの差分

   ## 共通ポリシー

   以下のファイルを Read ツールで読み、ポリシーに従ってください:

   - `skills/autopilot/references/policies.md`

   各指摘に finding_id（`F-001`...）を付与し、出力末尾に `[STATUS:APPROVE|REQUEST_CHANGES|COMMENT]` を出力してください。修正すべきか迷う指摘は `REQUEST_CHANGES` に倒し、見送らないこと。

   ## 出力先

   作業結果を `.belt/phases/outputs/dispatch-reviewer-i{iteration}.md` に Write ツールで保存してください。
   ```

   `.belt/phases/prompts/dispatch-antipattern-i{iteration}.md` も同じ構造で作成し、タスクを「AI 生成のコード・コメント・ドキュメント特有のアンチパターンを検出する（コード: 幻覚 API、スコープクリープ、デッドコード、フォールバック濫用、不要な後方互換対応 / コメント: What・How の説明コメント、自明なコメント、経緯コメント、コメントアウト残骸 / ドキュメント: 無駄な強調、歴史的経緯にひっぱられた記載、現状と矛盾する旧記述、AI 臭）」に差し替え、出力先を `.belt/phases/outputs/dispatch-antipattern-i{iteration}.md` にする。変更内容の参照に追加・改修したドキュメントが含まれる場合はそれも対象とする。

3. **並列起動**: 2 つの Task を 1 メッセージ内で並列起動する。

   ```text
   Task(subagent_type="belt:reviewer", prompt="`.belt/phases/prompts/dispatch-reviewer-i{iteration}.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/dispatch-reviewer-i{iteration}.md` に Write ツールで保存してください。")
   Task(subagent_type="belt:ai-antipattern-reviewer", prompt="`.belt/phases/prompts/dispatch-antipattern-i{iteration}.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/dispatch-antipattern-i{iteration}.md` に Write ツールで保存してください。")
   ```

4. **ルーティング**（両出力の最終行のステータスタグで機械的に判定する）:
   - 両方が `[STATUS:APPROVE]` または `[STATUS:COMMENT]`: レビュー通過。Step 4（完了）へ進む（COMMENT はサマリーに含める）。
   - いずれかが `[STATUS:REQUEST_CHANGES]`: 修正のため Step 2 に戻って executor を再実行する。再実行では `iteration` が +1 され、`dispatch-executor-i{iteration}.md` プロンプトの末尾にレビュー指摘への参照（前 `iteration` の `dispatch-reviewer-i{iteration}.md` と `dispatch-antipattern-i{iteration}.md` を Read して反映するよう指示）を追加する。完了後この Step 3 を新しい `iteration` で再レビューする。リトライは最大 2 回。リトライ時、レビューアは前回出力を参照に追加して finding_id を `new / persists / resolved` で追跡する。2 回リトライしても `REQUEST_CHANGES` が残る場合、未解決の指摘をユーザーに提示し、`status="error"`, `active=false` で終了する。

---

### Step 4: 完了

`mcp__belt__state_write` を `mode="dispatch"`, `phase="dispatch"`, `status="done"`, `active=false` で呼び出し、ユーザーにサマリーを提示する:

```text
## dispatch 完了

依頼の実装と最小レビュー（reviewer + ai-antipattern-reviewer）が完了しました。

### レビュー結果
[APPROVE / COMMENT の要約。COMMENT があれば内容を記載]
```
