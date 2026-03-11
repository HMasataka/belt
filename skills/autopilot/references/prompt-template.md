# プロンプトファイル共通テンプレート

オーケストレーターが `.belt/phases/prompts/{name}-i{iteration}.md` に書き出すプロンプトファイルの共通構造。

各フェーズの「プロンプト仕様」に記載された変数を埋め込んで使用する。

---

## ファイル命名規則

全ファイルにイテレーション番号 `-i{iteration}` を付与する。エージェント起動のたびに iteration を +1 する。

- プロンプト: `prompts/{name}-i{iteration}.md`
- 出力: `outputs/{name}-i{iteration}.md`
- 例: `prompts/planner-i5.md` → `outputs/planner-i5.md`

リトライ時は iteration が進むため前回のファイルが上書きされない:

```text
outputs/planner-i5.md    ← 初回の計画
outputs/critic-i6.md     ← critic が REJECT
outputs/planner-i7.md    ← リトライした計画（i5 は残る）
outputs/critic-i8.md     ← 再レビュー
```

**参照追跡:** 各エージェント完了後、`latest_{name}` を更新する。後続エージェントの参照にはファイル名ではなく `latest_{name}` を使い、オーケストレーターが実際のファイルパスに解決する。

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

- `.belt/phases/outputs/{latest_参照1 の実ファイル名}` — {説明}
- `.belt/phases/outputs/{latest_参照2 の実ファイル名}` — {説明}

## 出力先

作業結果を `.belt/phases/outputs/{name}-i{iteration}.md` に Write ツールで保存してください。
```

---

## 最小 Task prompt

```text
Task(
  subagent_type="belt:{name}",
  prompt="`.belt/phases/prompts/{name}-i{iteration}.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/{name}-i{iteration}.md` に Write ツールで保存してください。"
)
```

executor の場合は `model` パラメータを追加:

```text
Task(
  subagent_type="belt:executor",
  model="{complexity に応じて sonnet または opus}",
  prompt="`.belt/phases/prompts/executor-g{G}t{T}-i{iteration}.md` を Read ツールで読み、指示に従ってください。作業結果を `.belt/phases/outputs/executor-g{G}t{T}-i{iteration}.md` に Write ツールで保存してください。"
)
```

---

## Scout エージェント（例外）

Scout は `disallowedTools: Write` のためテンプレートを使わない。

- Task prompt にリクエストをインラインで渡す
- 戻り値をオーケストレーターが `.belt/phases/outputs/scout-{type}-i{iteration}.md` に Write で保存する
