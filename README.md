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

| スキル      | 説明                                                                 |
| ----------- | -------------------------------------------------------------------- |
| `autopilot` | 分析・設計・計画・実装・QA・レビューの6フェーズを一括実行            |
| `spec`      | 要件分析を行い、チェックボックス付き仕様書を `.belt/spec.md` に出力  |
| `roadmap`   | `spec.md` のチェック済み要件からマイルストーン付きロードマップを生成 |
| `cruise`    | `roadmap.md` のマイルストーンを順に autopilot で実行するループ       |

## 仕組み

### autopilot

6フェーズのワークフローを実行します。

1. **要件分析** — Analyst (opus) がギャップ・ガードレール・エッジケースを分析
1. **設計・計画** — Architect → Planner (opus) が実装計画を作成
1. **計画レビュー** — Critic (opus) が計画を評価、REJECT 時は最大3回リトライ
1. **実装** — Executor がグループ単位で並列実行 (complexity: high は opus、normal は sonnet)
1. **QA** — Test Engineer + ビルド・テスト検証、失敗時は Debugger で最大2回リトライ
1. **レビュー** — Reviewer + Security Reviewer (sonnet) が品質・セキュリティをチェック

QA が2回失敗すると Architect が根本原因を診断し Phase 1 からやり直します（全体リトライ最大2回）。

```mermaid
flowchart TD
    Start([autopilot 開始]) --> Resume{state_read}
    Resume -->|新規| Clean[".belt/phases/ クリア"]
    Resume -->|レジューム| Restore["phases/ から復元"]
    Clean --> P1
    Restore --> P1

    P1["Phase 1: Analyst<br>要件分析"] --> P2
    P2["Phase 2: Architect → Planner<br>設計・計画"] --> P3
    P3{"Phase 3: Critic<br>計画レビュー"}
    P3 -->|REJECT| P2R{"リトライ<br>3回目?"}
    P2R -->|No| P2
    P2R -->|Yes| P4
    P3 -->|ACCEPT| P4

    P4["Phase 4: Executor<br>実装 (並列)<br>high→opus / normal→sonnet"]
    P4 --> P5

    P5["Phase 5: QA<br>Test Engineer → Debugger"]
    P5 -->|成功| P6
    P5 -->|失敗| QARetry{"QA リトライ<br>2回目?"}
    QARetry -->|No| P5
    QARetry -->|Yes| Diag["Architect で根本原因診断"]
    Diag --> FullRetry{"全体リトライ<br>2回目?"}
    FullRetry -->|No| P1
    FullRetry -->|Yes| Fail([失敗終了])

    P6{"Phase 6: Review<br>Reviewer + Security<br>(並列)"}
    P6 -->|CRITICAL/HIGH| P4R{"リトライ<br>3回目?"}
    P4R -->|No| P4
    P4R -->|Yes| Done
    P6 -->|OK| Done([完了])
```

### spec → roadmap → cruise

大規模タスクを段階的に進めるワークフローです。
各スキルの間に人間のレビューポイントがあります。

1. **spec** — Analyst と Architect が要件を分析、AskUserQuestion で深掘り、チェックボックス付き仕様書を `.belt/spec.md` に出力
1. **人間のレビュー** — spec.md のチェックボックスで採用する要件を選択
1. **roadmap** — チェック済み要件から Architect が設計、Planner がマイルストーンに分解、Critic がレビュー、`.belt/roadmap.md` に出力
1. **人間のレビュー** — roadmap.md の内容を確認
1. **cruise** — 各マイルストーンを autopilot で順次実行し、完了タスクのチェックボックスを更新。中断後も `/cruise` で再開可能

```mermaid
flowchart TD
    subgraph spec ["/spec"]
        S1["Analyst<br>要件分析"] --> S2["Architect<br>技術調査"]
        S2 --> S3["AskUserQuestion<br>深掘り・提案"]
        S3 --> S4["仕様書生成<br>.belt/spec.md"]
    end

    S4 --> Human1{{"人間がレビュー<br>チェックボックスで<br>要件を選択"}}

    subgraph roadmap ["/roadmap"]
        R1["spec.md 読み込み<br>チェック済み項目のみ抽出"]
        R1 --> R2["Architect<br>アーキテクチャ設計"]
        R2 --> R3["Planner<br>マイルストーン分解"]
        R3 --> R4{"Critic<br>レビュー"}
        R4 -->|REJECT| R3R{"リトライ<br>3回目?"}
        R3R -->|No| R3
        R3R -->|Yes| R5
        R4 -->|ACCEPT| R5["ロードマップ生成<br>.belt/roadmap.md"]
    end

    Human1 --> R1

    R5 --> Human2{{"人間がレビュー<br>内容を確認"}}

    subgraph cruise ["/cruise"]
        C1["roadmap.md 読み込み"]
        C1 --> C2{"未完了マイルストーン<br>あり?"}
        C2 -->|Yes| C3["autopilot 実行<br>(マイルストーン単位)"]
        C3 --> C4["roadmap.md<br>チェック更新"]
        C4 --> C2
        C2 -->|No| C5([cruise 完了])
    end

    Human2 --> C1
```

MCP サーバーで状態を永続化するため、中断したワークフローを再開できます。

## アンインストール

```claude
/plugin uninstall belt@HMasataka-belt
/plugin marketplace remove HMasataka-belt
```
