---
name: ship
description: breakdown.md の PR を 1 PR ずつ autopilot で実装し、完了したマイルストーンをチェックするループ
argument-hint: ""
---

## 手順

`.belt/breakdown.md` の未チェック PR を先頭から 1 つずつ autopilot で実装し、各 PR を `reviewer` + `ai-antipattern-reviewer` の最小レビューに通してからチェックする。全 PR が完了したら roadmap.md の対象マイルストーンをチェック済みにし、breakdown.md を削除する。

`/belt:breakdown` で 1 マイルストーンを PR 粒度に分解したあと、その PR 群を消化するための専用スキル。マイルストーン単位で進める場合は `/belt:cruise` を使う。

autopilot は内部の Phase 6 でタスク単位のレビューを済ませている。ship のレビューはそれと角度を変え、**PR が breakdown の受け入れ基準・スコープを満たしているか / 先行 PR との統合が壊れていないか** を PR 単位で 1 パス確認する位置づけ。

変数 `iteration = 0` を持ち、レビューエージェント起動のたびに +1 する（ファイルがリトライで上書きされないようにするため）。

---

### 起動: 状態設定

`mcp__belt__state_write` を `mode="ship"`, `phase="ship"`, `status="running"`, `active=true` で呼び出す。

---

### Step 1: breakdown の読み込み

Read ツールで `.belt/breakdown.md` を読み込む。ファイルが存在しない場合、ユーザーに「先に `/belt:breakdown [v0.X]` を実行して PR 分解を生成してください」と案内して終了する。

breakdown.md 冒頭の `# 分解: v0.X - ...` から対象マイルストーンを特定し、マイルストーンゴール・完動品としての価値も抽出して保持する。

Read ツールで `.belt/roadmap.md` を読み込み、先頭の「アーキテクチャ方針」セクションを抽出して保持する（各 autopilot 実行時のコンテキストに使う）。roadmap.md が存在しない場合はアーキテクチャ方針なしで続行する。

---

### Step 2: PR の実装

最初の未チェック (`- [ ]`) PR セクション (`## PR-N: ...`) を特定する。

- すべての PR がチェック済み (`- [x]`) の場合: Step 4（マイルストーン完了処理）へ
- 未チェック PR が存在する場合: 以下を実行する

Bash ツールで `git rev-parse HEAD` を実行し、レビュー差分の基準コミットとして `baseline` に保持する（autopilot 実行前の状態）。

`mcp__belt__state_write` を `mode="ship"`, `phase="ship"`, `status="running"`, `active=true`, `message="PR-N - タイトル"` で呼び出す。

対象 PR セクション全文を引数として Skill ツールで autopilot を呼び出す:

```text
Skill(
  skill="autopilot",
  args="以下の PR を 1 PR で完結する単位として実装してください。\n\n## アーキテクチャ方針\n{Step 1 で抽出した方針}\n\n## マイルストーン\nv0.X - マイルストーン名\n**ゴール**: ...\n**完動品としての価値**: ...\n\n## PR-N: タイトル\n\n**スコープ**: ...\n**受け入れ基準**:\n- ...\n**依存**: ..."
)
```

autopilot 完了後、Step 3（PR レビュー）へ進む。

---

### Step 3: PR レビュー (reviewer + ai-antipattern-reviewer)

autopilot が完了した PR を、マージ前提の単位として最小レビューに通す。冒頭で `iteration` を +1 し、この Step 内で作成する差分・プロンプト・出力ファイルはすべて同じ `iteration` 番号を使う。

1. **差分の取得**: Bash ツールで `git --no-pager diff {baseline}` と `git --no-pager diff --stat {baseline}` を実行し、PR 開始時点からの変更を取得する。出力を Write ツールで `.belt/phases/outputs/ship-pr{N}-changes-i{iteration}.md` に保存する。差分が空の場合は autopilot が実装を行っていない異常なので、ユーザーに報告して `status="error"`, `active=false` で終了する。

2. **プロンプトファイルの作成**: `reviewer` と `ai-antipattern-reviewer` の 2 つのプロンプトファイルを Write する。

   `.belt/phases/prompts/ship-reviewer-i{iteration}.md`:

   ```markdown
   ## タスク

   以下の PR の変更が受け入れ基準とスコープを満たし、先行 PR と整合しているかをレビューしてください。コード品質・セキュリティ・受け入れ基準の充足・統合の破綻を観点とする。

   ## PR

   ## PR-N: タイトル
   **スコープ**: ...
   **受け入れ基準**:
   - ...
   **依存**: ...

   ## アーキテクチャ方針

   {Step 1 で抽出した方針}

   ## 変更内容

   以下のファイルを Read ツールで読み、レビュー対象としてください:

   - `.belt/phases/outputs/ship-pr{N}-changes-i{iteration}.md` — PR 開始時点からの差分

   ## 共通ポリシー

   以下のファイルを Read ツールで読み、ポリシーに従ってください:

   - `skills/autopilot/references/policies.md`

   各指摘に finding_id（`F-001`...）を付与し、出力末尾に `[STATUS:APPROVE|REQUEST_CHANGES|COMMENT]` を出力してください。

   ## 出力先

   作業結果を `.belt/phases/outputs/ship-reviewer-i{iteration}.md` に Write ツールで保存してください。
   ```

   `.belt/phases/prompts/ship-antipattern-i{iteration}.md` も同じ構造で作成し、タスクを「AI 生成コード特有のアンチパターン（幻覚 API、スコープクリープ、デッドコード、フォールバック濫用、不要な後方互換対応）を検出する」に差し替え、出力先を `.belt/phases/outputs/ship-antipattern-i{iteration}.md` にする。

3. **並列起動**: 2 つの Task を 1 メッセージ内で並列起動する。

   ```text
   Task(subagent_type="belt:reviewer", prompt="`.belt/phases/prompts/ship-reviewer-i{iteration}.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/ship-reviewer-i{iteration}.md` に Write ツールで保存してください。")
   Task(subagent_type="belt:ai-antipattern-reviewer", prompt="`.belt/phases/prompts/ship-antipattern-i{iteration}.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/ship-antipattern-i{iteration}.md` に Write ツールで保存してください。")
   ```

4. **ルーティング**（両出力の最終行のステータスタグで機械的に判定する）:

   - 両方が `[STATUS:APPROVE]` または `[STATUS:COMMENT]`: レビュー通過。Edit ツールで `.belt/breakdown.md` の該当 PR セクションのチェックボックスを `- [x]` に変更し、Step 2 の先頭に戻る（COMMENT はマイルストーン完了時のサマリーに含める）。
   - いずれかが `[STATUS:REQUEST_CHANGES]`: 修正のため autopilot を再実行する。Step 2 の autopilot 呼び出しの args 末尾にレビュー指摘への参照（`.belt/phases/outputs/ship-reviewer-i{iteration}.md` と `ship-antipattern-i{iteration}.md` を Read して反映するよう指示）を追加して再実行し、完了後この Step 3 を `iteration` を進めて再レビューする。リトライは最大 2 回。リトライ時、レビューアは前回出力を参照に追加して finding_id を `new / persists / resolved` で追跡する。2 回リトライしても `REQUEST_CHANGES` が残る場合、未解決の指摘をユーザーに提示し、`status="error"`, `active=false` で終了する。

---

### Step 4: マイルストーン完了処理

breakdown.md のすべての PR が完了したら:

1. breakdown.md 冒頭の対象マイルストーン (`v0.X`) を特定する
2. Edit ツールで `.belt/roadmap.md` の該当マイルストーンセクション内のすべての未チェックタスクを `- [x]` に変更する
3. Bash ツールで `rm .belt/breakdown.md` を実行する（次のマイルストーンの分解と混在させないため）
4. `mcp__belt__state_write` を `mode="ship"`, `phase="ship"`, `status="done"`, `active=false` で呼び出す
5. ユーザーに以下を案内して終了する:

```text
v0.X の全 PR を完了し、roadmap.md の該当マイルストーンをチェック済みにしました。

次のマイルストーンに進むには:
- PR 粒度で進める場合: `/belt:breakdown` を実行してから `/belt:ship`
- マイルストーン単位で進める場合: `/belt:cruise`
```
