---
name: cruise
description: roadmap.md のマイルストーンを順に autopilot で実行するループワークフロー
argument-hint: ""
---

## 手順

`.belt/roadmap.md` の未完了マイルストーンを先頭から順に autopilot で実装し、進捗をチェックボックスで管理する。

マイルストーンを PR 粒度に細分化して進めたい場合は `/belt:breakdown` で分解し、`/belt:ship` で PR 単位に消化する。cruise はマイルストーン単位の実行に専念する。

レビューは各 autopilot の Phase 6（`policies.md` のレビューポリシー準拠）で行われる。指摘を握りつぶさず、修正すべきか迷う指摘は修正に倒す（ship / dispatch と共通）。

---

### 起動: 状態設定

`mcp__belt__state_write` を `mode="cruise"`, `phase="cruise"`, `status="running"`, `active=true` で呼び出す。

---

### Step 1: ロードマップの読み込み

Read ツールで `.belt/roadmap.md` を読み込む。

ファイルが存在しない場合、ユーザーに「先に `/belt:spec` → `/belt:spec-confirm` → `/belt:roadmap` を実行してください」と案内して終了する。

先頭の「アーキテクチャ方針」セクションを抽出して保持する。これは各 autopilot 実行時にコンテキストとして渡す。

---

### Step 2: マイルストーンの実装ループ

ロードマップから最初の未チェックタスク (`- [ ]`) を含むマイルストーン (`## v0.X - ...` セクション) を特定する。

すべてのタスクがチェック済み (`- [x]`) の場合、全マイルストーン完了として Step 4 に進む。

特定したマイルストーンについて、`mcp__belt__state_write` を `mode="cruise"`, `phase="cruise"`, `status="running"`, `active=true`, `message="v0.X - マイルストーン名"` で呼び出す。

そのマイルストーン内の未チェックタスクを収集し、Skill ツールで autopilot スキルを呼び出す:

```text
Skill(
  skill="autopilot",
  args="以下のマイルストーンのタスクを実装してください。\n\n## アーキテクチャ方針\n{Step 1 で抽出したアーキテクチャ方針}\n\n## マイルストーン: v0.X - マイルストーン名\n\n**ゴール**: {マイルストーンのゴール}\n**完動品としての価値**: {マイルストーンの価値}\n\n## タスク\n{未チェックタスクの一覧}"
)
```

---

### Step 3: 進捗の更新

autopilot の完了後、Edit ツールで `.belt/roadmap.md` を更新する:

1. 完了したタスクのチェックボックスを `- [ ]` から `- [x]` に変更する
2. マイルストーン内の全タスクが完了しても、マイルストーン見出しはそのまま維持する

更新後、Step 2 に戻り次の未完了マイルストーンを処理する。

---

### Step 4: 完了

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
