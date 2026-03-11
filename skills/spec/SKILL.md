---
name: spec
description: 要件分析を行い、チェックボックス付きの仕様書を .belt/spec.md に出力する
argument-hint: "<タスクの説明>"
---

## 手順

ユーザーのリクエストを分析し、人間がレビュー可能なチェックボックス付き仕様書を `.belt/spec.md` に出力する。

---

### Step 1: 要件分析 (Analyst)

Task ツールで analyst エージェントを起動し、ユーザーのリクエストを分析する:

```text
Task(
  subagent_type="belt:analyst",
  prompt="{ユーザーの元のリクエスト}"
)
```

分析出力（ギャップ、ガードレール、エッジケース、受け入れ基準）を保存する。

---

### Step 2: 技術調査 (Architect)

Task ツールで architect エージェントを起動し、コードベースの技術的制約と推奨を調査する:

```text
Task(
  subagent_type="belt:architect",
  prompt="{ユーザーの元のリクエスト}\n\n## Analyst 出力\n{Step 1 の analyst 出力}"
)
```

---

### Step 3: 深掘り・提案 (対話)

Step 1（analyst）と Step 2（architect）の出力から、以下の観点で質問・提案を整理する:

- analyst が検出したギャップや曖昧な点
- architect が指摘した技術的トレードオフや選択肢
- 追加で検討すべき機能やアプローチの提案

これらを AskUserQuestion ツールで提示し、ユーザーの回答を得る。質問は最大4つに絞り、それぞれ選択肢を用意する。

ユーザーの回答を Step 1・Step 2 の出力に反映し、要件を補強する。

---

### Step 4: 仕様書の生成

Step 1（analyst）、Step 2（architect）、Step 3（ユーザーの回答）を統合し、以下のフォーマットで `.belt/spec.md` に Write ツールで書き出す。

各セクションの項目はすべて未チェック (`- [ ]`) で出力する。analyst の出力から機能要件・非機能要件・エッジケースを、architect の出力から技術コンテキスト・制約を抽出して整理する。

出力フォーマット:

```markdown
# 仕様: {タスク名}

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

- [ ] 未解決の質問1
- [ ] 未解決の質問2
```

---

### Step 5: 案内

仕様書の出力が完了したら、ユーザーに以下を案内して終了する:

```text
`.belt/spec.md` に仕様書を出力しました。

採用する要件にチェック (`- [x]`) を入れてから `/roadmap` を実行してください。
```
