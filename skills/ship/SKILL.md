---
name: ship
description: breakdown.md の PR を 1 PR ずつ autopilot で実装し、完了したマイルストーンをチェックするループ
argument-hint: ""
---

## 手順

`.belt/breakdown.md` の未チェック PR を先頭から 1 つずつ autopilot で実装し、進捗をチェックボックスで管理する。全 PR が完了したら roadmap.md の対象マイルストーンをチェック済みにし、breakdown.md を削除する。

`/belt:breakdown` で 1 マイルストーンを PR 粒度に分解したあと、その PR 群を消化するための専用スキル。マイルストーン単位で進める場合は `/belt:cruise` を使う。

---

### 起動: 状態設定

`mcp__belt__state_write` を `mode="ship"`, `phase="ship"`, `status="running"`, `active=true` で呼び出す。

---

### Step 1: breakdown の読み込み

Read ツールで `.belt/breakdown.md` を読み込む。ファイルが存在しない場合、ユーザーに「先に `/belt:breakdown [v0.X]` を実行して PR 分解を生成してください」と案内して終了する。

breakdown.md 冒頭の `# 分解: v0.X - ...` から対象マイルストーンを特定し、マイルストーンゴール・完動品としての価値も抽出して保持する。

Read ツールで `.belt/roadmap.md` を読み込み、先頭の「アーキテクチャ方針」セクションを抽出して保持する（各 autopilot 実行時のコンテキストに使う）。roadmap.md が存在しない場合はアーキテクチャ方針なしで続行する。

---

### Step 2: PR の実装ループ

最初の未チェック (`- [ ]`) PR セクション (`## PR-N: ...`) を特定する。

- すべての PR がチェック済み (`- [x]`) の場合: Step 3（マイルストーン完了処理）へ
- 未チェック PR が存在する場合: 以下を実行する

`mcp__belt__state_write` を `mode="ship"`, `phase="ship"`, `status="running"`, `active=true`, `message="PR-N - タイトル"` で呼び出す。

対象 PR セクション全文を引数として Skill ツールで autopilot を呼び出す:

```text
Skill(
  skill="autopilot",
  args="以下の PR を 1 PR で完結する単位として実装してください。\n\n## アーキテクチャ方針\n{Step 1 で抽出した方針}\n\n## マイルストーン\nv0.X - マイルストーン名\n**ゴール**: ...\n**完動品としての価値**: ...\n\n## PR-N: タイトル\n\n**スコープ**: ...\n**受け入れ基準**:\n- ...\n**依存**: ..."
)
```

autopilot 完了後、Edit ツールで `.belt/breakdown.md` の該当 PR セクションのチェックボックスを `- [ ]` から `- [x]` に変更し、Step 2 の先頭に戻る。

---

### Step 3: マイルストーン完了処理

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
