# Project Instructions

## 1. プロジェクト概要

* **プロジェクト名**: 民泊管理アプリ（minpaku-fix）
* **目的**: 民泊施設の予約管理・清掃スタッフ募集・スケジュール管理を一元化
* **対象ユーザー**:
  - オーナー: 施設オーナー。予約管理・スタッフ選定・請求書発行を行う
  - スタッフ: 清掃スタッフ。募集への回答・チェックリスト記入・スケジュール確認を行う
* **公開先**: Google Apps Script（GAS）Web App として2つの独立したデプロイ
  - メインアプリ（オーナー＋スタッフ兼用、`?staff=1` でスタッフモード切替）
  - チェックリストアプリ（スタッフ専用・モバイル最適化）
* **技術スタック**:
  - バックエンド: Google Apps Script（V8ランタイム）
  - フロントエンド: HTML5 + Bootstrap 5.3.2 + FullCalendar 6.1.10
  - データベース: Google スプレッドシート（外部DB不使用。シートがそのままDB）
  - デプロイ: Node.js + clasp CLI（`deploy-all.js`で両アプリ一括デプロイ）
  - テスト: Python（pytest）
  - タイムゾーン: Asia/Tokyo（ハードコード）

### 技術スタック選定理由
* Google Workspace エコシステム内で完結（追加インフラ不要）
* オーナーが Google スプレッドシートで直接データ確認・編集可能
* GAS の Web App 機能で認証付き公開が容易

## 2. ページ構成

### メインアプリ（`index.html` + `Code.gs`）
* **カレンダー画面** — 予約（宿泊）と清掃イベントを FullCalendar で表示。月/週/リスト切替
* **清掃詳細モーダル** — 次回予約情報、募集ステータス、スタッフ回答状況、清掃担当表示
* **予約詳細モーダル** — チェックイン/アウト、宿泊者名、人数、BBQ、駐車場、メモ
* **スタッフ募集一覧** — 募集中の清掃案件一覧。回答（◎△×）送信、告知（メール/LINE）
* **スタッフ管理** — スタッフ登録・編集・有効/無効切替
* **請求書** — スタッフ報酬の月別集計・PDF生成・メール送信
* **iCal同期** — Airbnb/Booking.com の iCal URL から予約を自動取得
* **設定画面** — オーナー情報、サブオーナー、募集設定、連携設定、セル数最適化

### チェックリストアプリ（`checklist-app/checklist.html` + `checklist-app/Code.gs`）
* モバイル最適化された清掃チェックリスト
* 写真撮影・アップロード機能
* 備品補充記録
* スタッフメモ

## 3. デザイン・トーン

* **カラー**: Bootstrap 5 のデフォルトテーマベース（カスタム CSS で微調整）
* **フォント**: システムフォント（Bootstrap デフォルト）
* **レイアウト**: モバイルファースト。スタッフは基本スマホで操作
* **トーン**: 機能優先。業務アプリとして直感的に操作できることを重視

## 4. ファイル構成

```
minpaku-fix/
├── Code.gs                     # メインアプリ バックエンド（~9,600行、232関数）
├── index.html                  # メインアプリ フロントエンド（~8,500行）
├── appsscript.json             # GAS マニフェスト（メインアプリ）
├── checklist-app/
│   ├── Code.gs                 # チェックリストアプリ バックエンド（~2,950行）
│   ├── checklist.html          # チェックリストアプリ フロントエンド（~4,720行）
│   └── appsscript.json         # GAS マニフェスト（チェックリスト）
├── deploy.js                   # メインアプリ デプロイスクリプト
├── deploy-all.js               # 両アプリ一括デプロイ
├── deploy-all.bat              # Windows バッチラッパー
├── deploy-config.json          # デプロイ設定（git ignored）
├── package.json                # Node.js 依存関係（@google/clasp）
├── CLAUDE.md                   # このファイル
├── tests/
│   └── test_app.py             # Python テストスイート
└── manual-generator/           # スクリプトドキュメント生成ツール
```

## 5. スプレッドシート構成（DB設計）

### 主要データシート
| シート名 | 用途 | 主要カラム |
|---|---|---|
| `フォームの回答 1` | 予約データ（Google Form 由来） | チェックイン/アウト, 氏名, 宿泊人数, 清掃担当, メモ |
| `募集` | 清掃スタッフ募集 | チェックアウト日, 予約行番号, ステータス(募集中/選定済/スタッフ確定済み), 選定スタッフ |
| `募集_立候補` | スタッフの回答データ | 募集ID(r行番号), スタッフ名, メール, 回答日時, メモ, ステータス(◎/△/×) |
| `清掃スタッフ` | スタッフマスタ | スタッフ名, メール, 電話, 銀行情報, 有効フラグ, 表示順 |
| `スタッフ共有用` | スタッフ向け予約詳細 | チェックイン/アウト, 人数, BBQ, 国籍, ベッド数 |

### 設定シート
| シート名 | 用途 |
|---|---|
| `設定_オーナー` | オーナーメールアドレス等 |
| `サブオーナー` | サブオーナーアクセス制御 |
| `仕事内容マスタ` | 報酬の仕事種別と料金 |
| `スタッフ報酬` | 報酬記録 |
| `特別料金` | 特別料金オーバーライド |
| `募集設定` | 募集開始週数、最少回答者数等 |
| `設定_連携` | iCal URL 等の外部連携設定 |
| `通知履歴` | 通知ログ |

### チェックリスト関連シート
| シート名 | 用途 |
|---|---|
| `チェックリストマスタ` | チェック項目テンプレート |
| `撮影箇所マスタ` | 写真撮影ポイント |
| `チェックリスト記録` | チェックリスト完了記録 |
| `チェックリスト写真` | 写真メタデータ |
| `要補充記録` | 備品補充記録 |

### 重要なデータフロー
```
ブラウザ (index.html)
  ↓ google.script.run
Code.gs (GAS バックエンド)
  ↓ SpreadsheetApp API
Google スプレッドシート (DB)
```

### キャッシュ戦略
* **サーバー側**: `CacheService`（チャンク分割、90秒TTL、100KBチャンク）
  - `getInitData()` → 起動データをキャッシュ
  - 全書き込み操作で `invalidateInitDataCache_()` を呼んで無効化
  - `getAllActiveStaff_()` → スタッフリストを 600秒キャッシュ
* **クライアント側**: `window._recruitFullMap` でページリロードまでデータ保持

### 重要な設計パターン
1. **トリガーベース自動ソート**: `onFormSubmit → mergeFormResponseToExistingBooking_ → sortFormResponses_ → checkAndCreateRecruitments`
2. **動的カラムマッピング**: `buildColumnMap()` がヘッダーからカラムインデックスを自動検出
3. **RIDベース参照**: `募集_立候補` が `r{行番号}` で `募集` シートの行を参照
4. **Upsert パターン**: `respondToRecruitment()` が既存回答を検索→あれば更新、なければ新規挿入

## 6. 設計方針・コーディング規約

* コメントは日本語
* GAS は V8 ランタイム（`const`/`let`/アロー関数使用可、ただし既存コードは `var` 混在）
* フロントエンドは Bootstrap 5 + バニラ JS（フレームワーク不使用）
* シート名は日本語定数（`SHEET_RECRUIT` = `'募集'` 等）
* 関数名は camelCase、プライベート関数は末尾 `_`（例: `invalidateInitDataCache_`）

## 7. バージョン番号の更新（必須・絶対忘れないこと）

コードを変更するたびに、以下のバージョン番号を必ず更新すること。
フォーマット: `v{MMDD}{連番アルファベット}` 例: v0218a, v0218b, ...

### 1. メインアプリ（オーナー・スタッフ共通）
- **ファイル**: `index.html`
- **場所**: `id="deployVersion"` のバッジテキスト（969行付近）
- **現在値**: `v0226a`

### 2. チェックリストアプリ
- **ファイル**: `checklist-app/checklist.html`
- **場所**: `header-title` 内の `<span>` タグ（1444行付近）
- **現在値**: `v0219f`

### 更新ルール
- 同日中の変更: アルファベットを1つ進める（例: v0218r → v0218s）
- 日付が変わった場合: 新しい日付+a（例: v0219a）
- メインアプリだけ変更した場合でもメインアプリのバージョンを更新
- チェックリストアプリだけ変更した場合でもチェックリストのバージョンを更新
- **両方変更した場合は両方更新**

## 8. Deploy Command

Every response that includes a code change MUST end with the following deploy command block:

```
cd C:\Users\yamas\minpaku-fix && git fetch origin && git checkout -f claude/review-handoff-docs-5WgKR && git reset --hard origin/claude/review-handoff-docs-5WgKR && node deploy-all.js
```

## 9. 実装ステータス

### 今回のセッション（2026-02-26）で対応した内容

| 項目 | ステータス | 詳細 |
|---|---|---|
| スタッフ回答状況「未回答」表示バグ | ✅ 完了 | 4つのバグの連鎖が原因。すべて修正済み |

### 修正したバグ（詳細）

#### バグ1: `getRecruitmentStatusMap()` 重複エントリ上書き
- **症状**: 同じ予約に対して `募集` シートに重複エントリがあると、回答データのない方で上書きされ「未回答」表示になる
- **原因**: `map[currentRowNum] = {...}` が無条件上書き
- **修正**: 回答データ（非「未回答」）が多い方を優先保持するロジック追加
- **箇所**: `Code.gs` `getRecruitmentStatusMap()` 内（旧7242行付近）

#### バグ2: `checkAndCreateRecruitments()` 重複募集エントリ作成
- **症状**: ソート後に行番号が変わると、同じ予約に対する `募集` エントリが二重作成される
- **原因**: `existingRowNums` が行番号のみでチェック、ソート後の行番号不一致を検出できない
- **修正**: チェックアウト日ベースの重複防止チェックを追加
- **箇所**: `Code.gs` `checkAndCreateRecruitments()` 内（旧7706行付近）

#### バグ3: `syncRecruitBookingRowsAfterSort_()` 同日複数予約非対応
- **症状**: 同じチェックアウト日の予約が複数あると、2件目以降の行番号マッピングが失敗
- **原因**: `coToRow` マップが `!coToRow[coStr]` で最初の1件しか記録しない
- **修正**: 配列管理 + 旧行番号近接値選択 + 使用済み追跡
- **箇所**: `Code.gs` `syncRecruitBookingRowsAfterSort_()` 全体（55行付近）

#### バグ4: `getLastRow()` off-by-one エラー
- **症状**: 全関数で1行余分（空行）を読み取り
- **原因**: `getRange(2, 1, sheet.getLastRow(), cols)` → `getLastRow()` 行分を row 2 から読むため row N+1 まで読んでしまう
- **修正**: `getLastRow() - 1` に統一（13関数を修正）
- **箇所**: `respondToRecruitment`, `cancelVolunteerForRecruitment`, `holdForRecruitment_legacy_`, `getRecruitmentStatusMap`, `getRecruitmentForBooking`, `deleteBooking`, `deleteRecruitment`, `approveCancelRequest`, `checkAndSendReminders` 等

#### `getRecruitmentStatusMap()` 内の `coToCurrentRow` も同日複数予約対応に修正
- `coToCurrentRows`（配列）に変更し、使用済み行番号追跡で二重割り当て防止

## 10. 既知の課題・バグ一覧

| 課題 | 優先度 | 詳細 |
|---|---|---|
| `募集` シートに既存の重複エントリが残っている可能性 | 中 | 今回の修正で新規作成は防止したが、過去に作られた重複は残存。表示上は修正済み（回答データ優先ロジック）だが、スプシ上のデータクリーンアップは未実施 |
| 残りの `getLastRow()` off-by-one | 低 | 主要関数は修正済みだが、補助的な関数にまだ残っている箇所がある（実害は少ない） |
| `.clasprc.json` の権限エラー | 低 | デプロイ時に `EPERM` エラーが出るが、デプロイ自体は成功する。`icacls` で権限付与すれば解消 |

## 11. 次回セッションでやるべきことリスト

1. **デプロイ後の動作確認**: 過去の日付のスタッフ回答状況が正しく表示されるか確認
2. **`募集` シートの重複エントリクリーンアップ**: 既存の重複を検出・統合するユーティリティ関数の作成（任意）
3. **残りの `getLastRow()` off-by-one修正**: 補助関数にも展開（任意）
