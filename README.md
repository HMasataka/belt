# belt

Claude Code 用の最小構成オートパイロットプラグイン。

専用エージェントによる分析・設計・実装・QA・レビューを自動で実行します。

## インストール

```claude
/plugin marketplace add HMasataka/belt
/plugin install belt@HMasataka-belt
```

## 使い方

### 単一タスク

```claude
/belt:autopilot <タスクの内容>
```

### 大規模プロジェクト

段階的に要件定義からロードマップ作成、実装まで進めるワークフローです。
各ステップの間で人間がレビュー・取捨選択できます。

```claude
/belt:spec <プロジェクトの説明>    # 仕様書を生成 → .belt/spec.md
# spec.md のチェックボックスで採用する要件を選択
/belt:roadmap                      # ロードマップを生成 → .belt/roadmap.md
# roadmap.md の内容を確認
/belt:cruise                       # マイルストーン順に autopilot で実装
```

## スキル一覧

| スキル | 説明 |
|--------|------|
| `autopilot` | 分析・設計・計画・実装・QA・レビューの6フェーズを一括実行 |
| `spec` | 要件分析を行い、チェックボックス付き仕様書を `.belt/spec.md` に出力 |
| `roadmap` | `spec.md` のチェック済み要件からマイルストーン付きロードマップを生成 |
| `cruise` | `roadmap.md` のマイルストーンを順に autopilot で実行するループ |

## 仕組み

### autopilot

6フェーズのワークフローを実行します:

1. **要件分析** — Analyst エージェント (opus) がギャップ・ガードレール・エッジケースを分析
2. **設計・計画** — Architect → Planner エージェント (opus) が実装計画を作成
3. **計画レビュー** — Critic エージェント (opus) が計画を評価、最大3回リトライ
4. **実装** — Executor エージェント (sonnet) が計画を実装（グループ単位で並列実行）
5. **QA** — ビルドとテストを実行、失敗時は Debugger で最大3回リトライ
6. **レビュー** — Reviewer + Security Reviewer エージェント (sonnet) が品質・セキュリティをチェック

### spec → roadmap → cruise

大規模タスクを段階的に進めるワークフローです:

1. **spec** — Analyst と Architect が要件を分析し、チェックボックス付き仕様書を出力
2. **roadmap** — チェック済み要件から Architect が設計、Planner がマイルストーンに分解、Critic がレビュー
3. **cruise** — 各マイルストーンを autopilot で順次実行し、進捗をチェックボックスで管理

MCP サーバーで状態を永続化するため、中断したワークフローを再開できます。

## アンインストール

```claude
/plugin uninstall belt@HMasataka-belt
/plugin marketplace remove HMasataka-belt
```
