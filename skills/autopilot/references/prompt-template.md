# プロンプトファイル共通テンプレート

オーケストレーターが `.belt/phases/prompts/{name}.md` に書き出すプロンプトファイルの共通構造。

各フェーズの「プロンプト仕様」に記載された変数を埋め込んで使用する。

---

## テンプレート

```markdown
## タスク

{ユーザーの元のリクエスト}

{追加指示があれば記載}

{ファクトチェック=あり の場合:}

## ファクトチェック

設計・計画で使用する情報は必ずソース・オブ・トゥルースで裏取りすること。コードの振る舞い→実際のソースコード、設定値→実際の設定ファイル、API→実際の実装コード、型→型定義ファイル、依存関係→パッケージマニフェスト。推測で判断しない。

{ポリシー=あり の場合:}

## 共通ポリシー

以下のファイルを Read ツールで読み、ポリシーに従ってください:

- `skills/autopilot/references/policies.md`

{参照ファイルがある場合:}

## 参照ファイル

以下のファイルを Read ツールで読み、コンテキストとして使用してください:

- `.belt/phases/outputs/{参照1}` — {説明}
- `.belt/phases/outputs/{参照2}` — {説明}

## 出力先

作業結果を `.belt/phases/outputs/{name}.md` に Write ツールで保存してください。
```

---

## 最小 Task prompt

```text
Task(
  subagent_type="belt:{name}",
  prompt="`.belt/phases/prompts/{name}.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/{name}.md` に Write ツールで保存してください。"
)
```

executor の場合は `model` パラメータを追加:

```text
Task(
  subagent_type="belt:executor",
  model="{complexity に応じて sonnet または opus}",
  prompt="`.belt/phases/prompts/executor-g{G}t{T}.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/executor-g{G}t{T}.md` に Write ツールで保存してください。"
)
```

---

## Scout エージェント（例外）

Scout は `disallowedTools: Write` のためテンプレートを使わない。

- Task prompt にリクエストをインラインで渡す
- 戻り値をオーケストレーターが `.belt/phases/outputs/scout-*.md` に Write で保存する
