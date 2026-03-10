# belt

Claude Code 用の最小構成オートパイロットプラグイン。

専用エージェントによる設計・実装・QA・レビューを自動で実行します。

## インストール

```claude
/plugin marketplace add HMasataka/belt
/plugin install belt@HMasataka-belt
```

## 使い方

```claude
/belt:autopilot <タスクの内容>
```

## 仕組み

belt は4フェーズのワークフローを実行します:

1. **設計** — Architect エージェント (opus, 読み取り専用) がコードベースを調査し、実装計画を作成
2. **実装** — Executor エージェント (sonnet, 読み書き可能) が計画を実装
3. **QA** — ビルドとテストを実行、失敗時は最大3回リトライ
4. **レビュー** — Reviewer エージェント (sonnet, 読み取り専用) が正確性・品質・セキュリティをチェック

MCP サーバーで状態を永続化するため、中断したワークフローを再開できます。

## アンインストール

```claude
/plugin uninstall belt@HMasataka-belt
/plugin marketplace remove HMasataka-belt
```
