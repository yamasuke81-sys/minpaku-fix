# 民泊予約・清掃管理 Webアプリ - 開発引き継ぎ資料

## 必須ルール: 修正後のデプロイコマンド出力
**コード修正をコミット＆プッシュした後は、必ず以下の形式でデプロイコマンドを出力すること。**
ユーザーがWindows PCのターミナルにコピペしてすぐデプロイできるようにする。

```
cd C:\Users\yamas\minpaku-fix && git fetch origin && git checkout -f <ブランチ名> && git reset --hard origin/<ブランチ名> && node deploy-all.js
```

- `<ブランチ名>` は現在の作業ブランチ名に置き換える
- 修正の説明の最後に必ずこのコマンドブロックを出力する
- ユーザーが「デプロイして」と言わなくても、コード変更をプッシュしたら毎回出す

## プロジェクト概要
Google Apps Script + スプレッドシート製の民泊予約・清掃管理Webアプリ。
ファイルは `Code.gs`（サーバーサイド）と `index.html`（フロントエンド）の2つのみ。

## アーキテクチャ
- **バックエンド**: Code.gs (Google Apps Script) - スプレッドシートをDB代わりに使用
- **フロントエンド**: index.html - Bootstrap 5 + FullCalendar 6 のSPA
- **通信**: `google.script.run` でサーバー関数を呼び出し、JSON文字列で結果を返す
- **デプロイ**: Apps Script Webアプリとして2つ（オーナー用/スタッフ用）デプロイ

## 主要シート一覧
| シート名 | 用途 |
|---|---|
| `フォームの回答 1` | 予約データ本体（iCal同期含む） |
| `清掃スタッフ` | スタッフ名簿（名前・メール） |
| `スタッフ共有用` | スタッフに見せる予約情報 |
| `募集` | 清掃募集エントリ（15列: 日付, 行番号, 通知日時, ステータス, 選定スタッフ, リマインド, 作成日, BookingID, 告知方法, +次回予約キャッシュ6列） |
| `募集_立候補` | スタッフの立候補記録（7列: 募集ID, スタッフ名, メール, 日時, メモ, ステータス, 保留理由） |
| `募集設定` | 募集開始週数・最少回答者数等 |
| `設定_連携` | iCal同期URL（プラットフォーム名, URL, 有効/無効, 最終同期） |
| `キャンセル申請` | スタッフの出勤キャンセル要望 |
| `通知履歴` | 立候補・予約追加等の通知ログ |
| `サブオーナー` | サブオーナーのメール一覧 |

## 重要な関数（Code.gs）

### データ取得
- `getData()` - 予約一覧を取得（フロントエンドのメインデータソース）
- `getRecruitmentStatusMap()` - カレンダー用: 予約行番号→募集ステータス・立候補者マップ
- `getRecruitmentList()` - 募集一覧取得
- `getRecruitmentForBooking(bookingRowNumber)` - 特定予約の募集詳細

### iCal同期
- `syncFromICal()` - iCal URLから予約取得。**削除ロジック注意**（下記参照）
- `parseICal_(icalText, platformName)` - iCalテキストをパース

### 募集・立候補
- `volunteerForRecruitment(recruitId, ...)` - スタッフ立候補
- `cancelVolunteerForRecruitment(recruitId, ...)` - 立候補取消
- `holdForRecruitment(recruitId, ...)` - 保留設定

### カラムマップ
- `buildColumnMap(headers)` - フォームの回答1用（日本語ヘッダー）
- `buildColumnMapFromSource_(headers)` - スタッフ共有用シート対応

## 既知の注意点

### getLastRow() off-by-one（要修正箇所多数）
`sheet.getRange(2, 1, sheet.getLastRow(), cols)` は numRows に `getLastRow()` を渡しており、
実際には `getLastRow() - 1` が正しい。現在約50箇所に存在。
多くはガード条件で問題にならないが、syncFromICal の削除ロジックでは修正済み。

### iCal同期の削除ロジック（2026-02-28修正済み）
`syncFromICal` はiCalフィードにない既存予約を**自動削除**する。
修正で以下の安全チェックを追加:
- iCalフィードが空の場合は削除しない
- 過去の予約（チェックアウト日 < 今日）は削除対象外

### parseICal_ のキャンセルフィルタ（2026-02-28修正済み）
旧: `/cancel/i.test(sum)` → "Non-cancellable" 等を誤除外
新: `STATUS:CANCELLED` + SUMMARY完全一致のみ除外

### フロントエンド重複排除マージ（2026-02-28修正済み）
同一日付の予約をマージする際、プレースホルダ名（Not available等）より実名を優先するよう修正。

## 2026-02-28 修正内容
1. **parseICal_**: SUMMARYの`/cancel/i`部分一致を厳密化（Booking.comの有効予約がキャンセル扱いになるバグ修正）
2. **syncFromICal**: iCalフィード空時の削除スキップ、過去予約の削除対象除外、off-by-one修正
3. **buildCalendarEvents**: 重複排除マージでプレースホルダ名より実名を優先
4. **HTTP 500/401/403**: エラーメッセージにURL再取得の案内を追加

## 次回やること
1. デプロイ後の動作確認（Booking.com予約が正しく表示されるか、iCal同期が正常に動くか）
2. Airbnb iCal URLの再取得（HTTP 500 はURL期限切れの可能性大）
3. 残りの `getLastRow()` off-by-one 修正（約50箇所）
4. 「募集」シートの重複エントリクリーンアップ（必要に応じて）
