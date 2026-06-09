---
name: spec
description: 要件分析を行い、チェックボックス付きの仕様ドラフトを .belt/spec.draft.md に出力する
argument-hint: "<タスクの説明>"
---

## 手順

ユーザーのリクエストを分析し、人間がレビュー可能なチェックボックス付きの仕様ドラフトを `.belt/spec.draft.md` に出力する。

起動時に Bash ツールで `mkdir -p .belt/phases/prompts .belt/phases/outputs` を実行してディレクトリを作成する。

---

### Step 1: 要件分析 (Analyst)

Task ツールで analyst エージェントを起動し、ユーザーのリクエストを分析する。analyst の入力はユーザーリクエストのみのため、プロンプトファイルは不要:

```text
Task(
  subagent_type="belt:analyst",
  prompt="{ユーザーの元のリクエスト}\n\n作業結果を `.belt/phases/outputs/analyst.md` に Write ツールで保存してください。"
)
```

---

### Step 2: 技術調査 (Architect)

オーケストレーターが Write ツールで `.belt/phases/prompts/architect.md` にプロンプトファイルを作成する:

```markdown
## タスク

{ユーザーの元のリクエスト}

## 前フェーズの出力

以下のファイルを Read ツールで読み、コンテキストとして使用してください:

- `.belt/phases/outputs/analyst.md` — 要件分析結果

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

### Step 3: 深掘り・提案 (対話)

`.belt/phases/outputs/analyst.md` と `.belt/phases/outputs/architect.md` を Read ツールで読み込み、以下の観点で質問・提案を整理する:

- analyst が検出したギャップや曖昧な点
- architect が指摘した技術的トレードオフや選択肢
- 追加で検討すべき機能やアプローチの提案

これらを AskUserQuestion ツールで提示し、ユーザーの回答を得る。質問は最大4つに絞り、それぞれ選択肢を用意する。

ユーザーの回答を Step 1・Step 2 の出力に反映し、要件を補強する。

---

### Step 4: 仕様ドラフトの生成

`.belt/phases/outputs/analyst.md` と `.belt/phases/outputs/architect.md` を Read ツールで読み込み、Step 3 のユーザーの回答と統合し、以下のフォーマットで `.belt/spec.draft.md` に Write ツールで書き出す。

機能要件・非機能要件・エッジケース・リスクの各セクションの項目は未チェック (`- [ ]`) で出力する。Open Questions は採否を選ぶものではなく未解決事項を残しておくためのメモなので、チェックボックスではなく素のリスト (`-`) で出力する。analyst の出力から機能要件・非機能要件・エッジケースを、architect の出力から技術コンテキスト・制約を抽出して整理する。

出力フォーマット:

```markdown
# 仕様ドラフト: {タスク名}

## 技術コンテキスト

[architect の分析サマリー]

## 機能要件

- [ ] 要件1
- [ ] 要件2

## 非機能要件

- [ ] 制約1
- [ ] 制約2

## エッジケース・リスク

- [ ] リスク1
- [ ] リスク2

## Open Questions

- 未解決の質問1
- 未解決の質問2
```

---

### Step 5: 案内

仕様ドラフトの出力が完了したら、ユーザーに以下を案内して終了する:

```text
`.belt/spec.draft.md` に仕様ドラフトを出力しました。

採用する要件にチェック (`- [x]`) を入れてから `/spec-confirm` を実行すると、チェック済み要件のみを `.belt/spec.md` に書き出します。
```
