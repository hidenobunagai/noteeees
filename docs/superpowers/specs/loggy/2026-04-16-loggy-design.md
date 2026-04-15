# Loggy — シンプル日記アプリ 設計書

## 概要

LoggyはAndroid向けのミニマルな日記アプリ。毎日テキストを書いて保存し、カレンダーで振り返ることだけに特化する。自分用の個人プロジェクト。

- **技術スタック**: Kotlin + Jetpack Compose
- **最小Androidバージョン**: API 29 (Android 10)
- **データ保存**: ローカルのみ (Room/SQLite)
- **UI言語**: 日本語のみ
- **アーキテクチャ**: Single-Activity + MVVM

## UIデザイン

### 画面構成（2画面のみ）

#### 画面1: カレンダー（ホーム）

- 月間カレンダー表示（月/火/水...の曜日ヘッダー付き）
- 日記がある日はドット（またはハイライト）で示す
- 日付をタップ → その日の日記プレビューをカレンダー下部に表示
- プレビューをタップ → 編集画面へ遷移
- 右下のFAB（+ボタン）で新規日記作成 → 編集画面へ遷移
- ヘッダーの◀ ▶で月を切り替え

#### 画面2: 日記編集

- トップバー: 「← 戻る」| 日付表示 | 「保存」ボタン
- テキスト入力エリア（複数行、改行可能）
- 下部ステータスバー: 文字数カウント + 最終保存時刻
- **自動保存**: テキスト変更から1秒後に自動保存（debounce）。手動保存ボタンもあり

### テーマ: ダークテーマ固定

- 背景: 濃いネイビー `#1a1a2e`
- アクセント: ブルー `#4a6fa5`
- テキスト: ライトグレー `#e0e0e0`
- セカンダリテキスト: `#888888`
- エラー/未保存: 赤系

## データモデル

Roomデータベース、テーブル1つ:

```
DiaryEntry
├── id: Long (PK, autoGenerate)
├── date: LocalDate (ユニーク制約 — 1日1エントリ)
├── content: String (日記本文、空文字も許可)
├── createdAt: LocalDateTime (作成日時)
└── updatedAt: LocalDateTime (更新日時)
```

- 1日1エントリが基本。同じ日に複数回書いた場合は上書き（upsert）
- `date`にユニーク制約で同日の重複を防止
- `content`は空文字も許可（下書き状態として扱う）

### DAO主要メソッド

- `upsert(entry: DiaryEntry)` — 挿入または更新
- `getByDate(date: LocalDate): Flow<DiaryEntry?>` — 日付で取得
- `getByMonth(year: Int, month: Int): Flow<List<DiaryEntry>>` — 月単位で取得（カレンダーのドット表示用）
- `delete(entry: DiaryEntry)` — 削除

## アーキテクチャ

### ディレクトリ構成

```
app/
├── data/
│   ├── local/
│   │   ├── AppDatabase.kt       # Room DB定義
│   │   ├── DiaryDao.kt          # DAOインターフェース
│   │   └── DiaryEntity.kt       # Room Entity + Mapper
│   ├── repository/
│   │   └── DiaryRepository.kt   # Repository（Daoのラッパー）
│   └── di/
│       └── AppModule.kt         # Hilt DIモジュール
├── ui/
│   ├── calendar/
│   │   ├── CalendarScreen.kt    # カレンダー画面Composable
│   │   └── CalendarViewModel.kt # カレンダー状態管理
│   ├── editor/
│   │   ├── EditorScreen.kt      # 編集画面Composable
│   │   └── EditorViewModel.kt   # 編集状態管理
│   └── theme/
│       └── Theme.kt             # ダークテーマ定義
├── navigation/
│   └── AppNavigation.kt         # Compose Navigation設定
└── MainActivity.kt              # Single Activity
```

### 主要ライブラリ

| ライブラリ            | 用途                |
| --------------------- | ------------------- |
| Jetpack Compose       | UI                  |
| Room                  | ローカルDB (SQLite) |
| Compose Navigation    | 画面遷移            |
| ViewModel + StateFlow | 状態管理            |
| Hilt                  | 依存注入            |
| Kotlinx DateTime      | 日付処理            |

### 自動保存の仕組み

1. `EditorViewModel`でテキスト変更を`MutableStateFlow`で保持
2. `stateIn` + `debounce(1000)` で1秒後に保存処理を発火
3. `DiaryRepository.upsert()`を呼び出し
4. 保存結果をStateFlowでUIに通知（保存時刻の更新）

### 画面遷移

```
カレンダー画面
  ├── 日付タップ → プレビュー表示（下部）→ タップ → 編集画面(date渡し)
  └── FABタップ → 編集画面(今日の日付)

編集画面
  └── ← 戻る → カレンダー画面
```

Navigation route: `editor/{year}/{month}/{day}`

## エラーハンドリング

- **DB操作失敗時**: Snackbarで「保存に失敗しました」を表示。リトライアクション付き
- **自動保存失敗時**: 下部の保存時刻を赤字で「未保存」と表示
- **読み込み失敗時**: 空状態を表示（クラッシュしない）

## テスト方針

自分用アプリなので最小限のテスト:

- **Unit test**: `DiaryRepository`のロジックテスト（in-memory Room DB使用）
- **Composable UI test**: カレンダー表示・FABタップでの画面遷移テスト
- **テストフレームワーク**: JUnit + Mockito/Turbine（Flowテスト用）

## スコープ外（YAGNI）

以下は今回実装しない:

- 写真・画像添付
- 気分タグ・カテゴリ
- 検索機能
- クラウド同期・バックアップ
- ウィジェット
- 通知・リマインダー
- 多言語対応
- ライトテーマ
- 統計・グラフ
- エクスポート機能
