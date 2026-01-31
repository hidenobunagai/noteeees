# Memory Notes

AI メモリーとして機能する単一ファイル型ノートシステム。GitHub Copilot、Claude Code、Codex など複数の AI ツールで利用可能。

## 機能

- **Quick Add** (`Cmd+Shift+N`): ワンライナーで素早くメモを追加
- **Add Entry** (`Cmd+Shift+M`): スニペット付きでエントリを追加
- **タグ補完**: 過去に使ったタグをサジェスト
- **検索**: タグ・日付でフィルタ
- **サイドバー**: タグ別にエントリを一覧表示
- **リマインダー**: `@YYYY-MM-DD` で期限を設定

## 使い方

1. `Notes: Run Setup` で保存先フォルダを設定
2. `Cmd+Shift+N` でメモを追加
3. AI に質問: `#file:memory.md 来週の予定は？`

## 設定

| 設定 | 説明 |
|-----|------|
| `notes.notesDirectory` | メモの保存先 |
| `notes.dateFormat` | 日付フォーマット |
| `notes.entryPosition` | 新規エントリの挿入位置 (top/bottom) |
