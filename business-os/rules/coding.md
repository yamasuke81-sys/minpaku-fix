# コーディング規約

## 全般
- コメントは日本語
- GAS は V8 ランタイム（const/let/アロー関数OK）
- 関数名は camelCase
- プライベート関数は末尾 `_`（例: `calculateScore_`）
- シート名は日本語定数（例: `const SHEET_SHIFT = 'シフト';`）
- タイムゾーン: Asia/Tokyo ハードコード

## GAS 固有
- `PropertiesService` でAPIキーや設定値を管理
- `CacheService` でパフォーマンス最適化（重い読み取りはキャッシュ）
- `getLastRow() - 1` でデータ行数を取得（off-by-one防止、minpaku-fixの教訓）
- `LockService` で同時実行制御
- トリガーは `ScriptApp.newTrigger()` で管理

## フロントエンド
- Bootstrap 5 + バニラ JS（フレームワーク不使用）
- モバイルファースト
- `google.script.run` でバックエンド呼び出し
- エラーハンドリングは `withFailureHandler` 必須

## バージョン管理
- フォーマット: v{MMDD}{連番アルファベット}
- 各アプリ独立でバージョン管理
- 変更したアプリのバージョンのみ更新

## セキュリティ
- APIキー、パスワード、トークンは絶対にコードにハードコードしない
- `PropertiesService.getScriptProperties()` で管理
- `.gitignore` に `deploy-config.json` を含める
