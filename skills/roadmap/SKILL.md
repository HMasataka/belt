---
name: roadmap
description: spec.md からロードマップを生成し .belt/roadmap.md に出力する
argument-hint: ""
---

## 手順

`.belt/spec.md` を基に、マイルストーン付きのロードマップを `.belt/roadmap.md` に出力する。

起動時に Bash ツールで `mkdir -p .belt/phases/prompts .belt/phases/outputs` を実行してディレクトリを作成する。

---

### Step 1: 仕様の読み込み

Read ツールで `.belt/spec.md` を読み込む。ファイルが存在しない場合、ユーザーに「先に `/belt:spec` → `/belt:spec-confirm` を実行してください」と案内して終了する。

機能要件・非機能要件・エッジケース・リスクの各セクションの項目をすべて要件として抽出する。技術コンテキストのセクションもそのまま保持する。

---

### Step 2: アーキテクチャ設計 (Architect)

オーケストレーターが Write ツールで `.belt/phases/prompts/architect.md` にプロンプトファイルを作成する:

```markdown
## タスク

以下の要件に基づいてアーキテクチャ設計を行ってください。

## 技術コンテキスト

{spec.md の技術コンテキストセクション}

## 要件

{Step 1 で抽出した要件}

## 設計の観点

- レイヤー構成と責務分離
- 依存関係の分析
- 拡張性の設計方針

## 出力先

作業結果を `.belt/phases/outputs/architect.md` に Write ツールで保存してください。
```

最小 Task prompt で architect を起動する:

```text
Task(
  subagent_type="belt:architect",
  prompt="`.belt/phases/prompts/architect.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/architect.md` に Write ツールで保存してください。"
)
```

---

### Step 3: タスク分解 (Planner)

オーケストレーターが Write ツールで `.belt/phases/prompts/planner.md` にプロンプトファイルを作成する:

```markdown
## タスク

以下の設計と要件からマイルストーン付きのロードマップを作成してください。

## 前フェーズの出力

以下のファイルを Read ツールで読み、コンテキストとして使用してください:

- `.belt/phases/outputs/architect.md` — アーキテクチャ設計

## 要件

{Step 1 で抽出した要件}

## 設計原則

- 完動品の原則: 各マイルストーンは単体で動作するソフトウェアを生み出すこと
- 依存関係に基づく順序付け: 後続タスクが依存するものを先に配置
- コアから拡張へ: 基盤機能を先に、付加機能を後に
- マイルストーン粒度: 1-2週間目安、4週間を超える場合は分割。v0.XX のバージョン番号がいくら増えても構わないので、マイルストーンのサイズ調整（適切な粒度への分割）を優先すること
- 価値の評価: Must Have → Should Have → Nice to Have の優先順位

## 出力フォーマット

- 各マイルストーンに version (v0.1, v0.2, ...), 名前, ゴール, 完動品としての価値, タスク一覧を含める
- 各タスクは autopilot で実行可能な粒度にする

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

### Step 4: ロードマップレビュー (Critic)

オーケストレーターが Write ツールで `.belt/phases/prompts/critic.md` にプロンプトファイルを作成する:

```markdown
## タスク

以下のロードマップをレビューしてください。

## ロードマップ

以下のファイルを Read ツールで読み、レビュー対象として使用してください:

- `.belt/phases/outputs/planner.md` — ロードマップ

## 評価基準

- 各マイルストーンが完動品の原則を満たしているか
- 依存関係の順序が正しいか
- タスク粒度が autopilot で実行可能か
- spec.md の要件がすべてカバーされているか

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

  以下のファイルを Read ツールで読み、フィードバックを反映して計画を改善してください:

  - `.belt/phases/outputs/critic.md` — Critic のフィードバック
  ```

- Step 3（planner）を再実行する。リトライは最大3回。
- 3回すべて却下された場合、利用可能な最善の計画で続行する。

判定が **REVISE** または **ACCEPT-WITH-RESERVATIONS** の場合:

- 続行するが、留保事項をロードマップに注記として追加する。

---

### Step 5: ロードマップの出力

最終的なロードマップを以下のフォーマットで `.belt/roadmap.md` に Write ツールで書き出す。

`.belt/phases/outputs/planner.md` と `.belt/phases/outputs/architect.md` を Read ツールで読み込み、統合する。

各タスクはすべて未チェック (`- [ ]`) で出力する。

出力フォーマット:

```markdown
# ロードマップ: {タスク名}

## アーキテクチャ方針

[architect の設計サマリー]

## v0.1 - マイルストーン名

**ゴール**: 一言で説明
**完動品としての価値**: このバージョンで何ができるようになるか

- [ ] タスク1
- [ ] タスク2

## v0.2 - マイルストーン名

**ゴール**: ...
**完動品としての価値**: ...

- [ ] タスク3
- [ ] タスク4
```

---

### Step 6: 案内

ロードマップの出力が完了したら、ユーザーに以下を案内して終了する:

```text
`.belt/roadmap.md` にロードマップを出力しました。

内容を確認し、`/cruise` を実行するとマイルストーン順に autopilot で実装を開始します。
```
