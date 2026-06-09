---
name: cruise
description: roadmap.md / breakdown.md を順に autopilot で実行するループワークフロー
argument-hint: ""
---

## 手順

`.belt/breakdown.md` がある場合は **PR 単位**、無ければ `.belt/roadmap.md` の **マイルストーン単位** で autopilot を実行し、進捗をチェックボックスで管理する。

---

### 起動: 状態設定

`mcp__belt__state_write` を `mode="cruise"`, `phase="cruise"`, `status="running"`, `active=true` で呼び出す。

---

### Step 1: ロードマップの読み込み

Read ツールで `.belt/roadmap.md` を読み込む。

ファイルが存在しない場合、ユーザーに「先に `/belt:spec` → `/belt:spec-confirm` → `/belt:roadmap` を実行してください」と案内して終了する。

先頭の「アーキテクチャ方針」セクションを抽出して保持する。これは各 autopilot 実行時にコンテキストとして渡す。

---

### Step 2: 進行モードの判定

Bash ツールで `.belt/breakdown.md` の存在を確認する（例: `test -f .belt/breakdown.md && echo exists || echo none`）。

- 存在する → **PR モード**: Step 3a へ
- 存在しない → **マイルストーンモード**: Step 3b へ

---

### Step 3a: PR モードでの実行

Read ツールで `.belt/breakdown.md` を読み込む。

breakdown.md 冒頭の `# 分解: v0.X - ...` から対象マイルストーンを特定する。マイルストーンゴール・完動品としての価値も抽出して保持する。

最初の未チェック (`- [ ]`) PR セクション (`## PR-N: ...`) を特定する。

- 未チェック PR が存在する場合: 続行
- すべての PR がチェック済み (`- [x]`) の場合: Step 4a（マイルストーン完了処理）へ

`mcp__belt__state_write` を `mode="cruise"`, `phase="cruise"`, `status="running"`, `active=true`, `message="PR-N - タイトル"` で呼び出す。

対象 PR セクション全文を引数として Skill ツールで autopilot を呼び出す:

```text
Skill(
  skill="autopilot",
  args="以下の PR を 1 PR で完結する単位として実装してください。\n\n## アーキテクチャ方針\n{Step 1 で抽出した方針}\n\n## マイルストーン\nv0.X - マイルストーン名\n**ゴール**: ...\n**完動品としての価値**: ...\n\n## PR-N: タイトル\n\n**スコープ**: ...\n**受け入れ基準**:\n- ...\n**依存**: ..."
)
```

autopilot 完了後、Edit ツールで `.belt/breakdown.md` の該当 PR セクションのチェックボックスを `- [ ]` から `- [x]` に変更し、Step 3a の先頭に戻る。

---

### Step 4a: マイルストーン完了処理 (PR モード)

breakdown.md のすべての PR が完了したら:

1. breakdown.md 冒頭の対象マイルストーン (`v0.X`) を特定する
2. Edit ツールで `.belt/roadmap.md` の該当マイルストーンセクション内のすべての未チェックタスクを `- [x]` に変更する
3. Bash ツールで `rm .belt/breakdown.md` を実行する（次のマイルストーンの分解と混在させないため）
4. `mcp__belt__state_write` を `mode="cruise"`, `phase="cruise"`, `status="done"`, `active=false` で呼び出す
5. ユーザーに以下を案内して終了する:

```text
v0.X の全 PR を完了し、roadmap.md の該当マイルストーンをチェック済みにしました。

次のマイルストーンに進むには:
- PR 粒度で進める場合: `/belt:breakdown` を実行してから `/belt:cruise`
- マイルストーン単位で進める場合: そのまま `/belt:cruise`
```

---

### Step 3b: マイルストーンモードでの実行

ロードマップから最初の未チェックタスク (`- [ ]`) を含むマイルストーン (`## v0.X - ...` セクション) を特定する。

すべてのタスクがチェック済み (`- [x]`) の場合、全マイルストーン完了として Step 5 に進む。

特定したマイルストーンについて、`mcp__belt__state_write` を `mode="cruise"`, `phase="cruise"`, `status="running"`, `active=true`, `message="v0.X - マイルストーン名"` で呼び出す。

そのマイルストーン内の未チェックタスクを収集し、Skill ツールで autopilot スキルを呼び出す:

```text
Skill(
  skill="autopilot",
  args="以下のマイルストーンのタスクを実装してください。\n\n## アーキテクチャ方針\n{Step 1 で抽出したアーキテクチャ方針}\n\n## マイルストーン: v0.X - マイルストーン名\n\n**ゴール**: {マイルストーンのゴール}\n**完動品としての価値**: {マイルストーンの価値}\n\n## タスク\n{未チェックタスクの一覧}"
)
```

---

### Step 4b: 進捗の更新 (マイルストーンモード)

autopilot の完了後、Edit ツールで `.belt/roadmap.md` を更新する:

1. 完了したタスクのチェックボックスを `- [ ]` から `- [x]` に変更する
2. マイルストーン内の全タスクが完了した場合、何もしない（マイルストーン見出しはそのまま維持する）

更新後、Step 2 に戻り進行モードを再判定する（途中で breakdown.md が作成されている可能性に備える）。

---

### Step 5: 完了

すべてのマイルストーンが完了したら:

1. `mcp__belt__state_write` を `mode="cruise"`, `phase="cruise"`, `status="done"`, `active=false` で呼び出す
2. ユーザーにサマリーを提示する:

```text
## cruise 完了

すべてのマイルストーンの実装が完了しました。

### 完了マイルストーン
- v0.1 - マイルストーン名
- v0.2 - マイルストーン名
- ...
```
