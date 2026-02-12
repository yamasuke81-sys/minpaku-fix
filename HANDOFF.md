# minpaku-fix プロジェクト引き継ぎ資料

## 1. プロジェクト概要

民泊（バケーションレンタル）の予約・清掃管理を行うGoogle Apps Script (GAS) Webアプリ。
2つの独立したGASプロジェクトで構成される。

| 項目 | メインアプリ（予約管理） | チェックリストアプリ（清掃） |
|------|--------------------------|------------------------------|
| 用途 | 予約カレンダー表示、清掃募集、iCal同期 | 清掃チェックリスト（スタッフ用） |
| Script ID | `1cFH0kD81gR6DC1RPBFyMJNXLI52nGYSOl6w461bkz_Byx1nE-4C0yD4w` | `18PILN4GA1DyQY9nkf2lV1GVxAXV95LT51vh2erWB1NZ8uNX54kVqlx3w` |
| 主要ファイル | `Code.gs` (5708行), `index.html` (6160行) | `checklist-app/Code.gs` (698行), `checklist-app/checklist.html` (868行) |
| デプロイ | オーナー用 + スタッフ用（2つのデプロイ） | 1つのデプロイ |

## 2. ユーザー環境

- OS: Windows 10/11
- ローカルパス: `C:\Users\yamas\Desktop\For_OpenHands\minpaku-fix`
- デプロイ方法: `deploy-all.bat` をダブルクリック（完全自動）
- **常に日本語で応答すること**

## 3. ファイル構成

```
minpaku-fix/
├── Code.gs                      # メインアプリ GAS コード（5708行）
├── index.html                   # メインアプリ UI（6160行）
├── appsscript.json              # GASマニフェスト（デプロイ時に自動切替）
├── .clasp.json                  # メインアプリのclasp設定
├── .claspignore                 # メインアプリ push 時の除外ルール
├── deploy.js                    # メインアプリ デプロイスクリプト（Node.js）
├── deploy-all.bat               # 全体デプロイのエントリーポイント（Windows）
├── deploy-config.json           # デプロイID保存（git追跡対象外！）
├── deploy-config.sample.json    # deploy-config.json のテンプレート
├── package.json                 # Node.js依存（@google/clasp）
│
├── checklist-app/               # チェックリストアプリ（別GASプロジェクト）
│   ├── Code.gs                  # チェックリストアプリ GAS コード（698行）
│   ├── checklist.html           # チェックリストアプリ UI（868行）
│   ├── .clasp.json              # チェックリストアプリのclasp設定
│   ├── .claspignore             # チェックリストアプリ push 時の除外ルール
│   ├── deploy-checklist.js      # チェックリストアプリ デプロイスクリプト
│   ├── deploy-checklist.bat     # チェックリストアプリ 単体デプロイ
│   └── appsscript.json
│
└── .gitignore                   # deploy-config.json, node_modules/ を除外
```

## 4. デプロイの仕組み

### deploy-all.bat の処理フロー
1. **コード更新**: `git fetch` → `git checkout` → `git reset --hard` でリモートの最新コードを取得
2. **メインアプリ**: `node deploy.js` でpush + deploy（オーナー用 → スタッフ用の2回デプロイ）
3. **チェックリスト**: `node deploy-checklist.js` でpush + deploy

### デプロイID管理（重要）
- `deploy-config.json` にオーナー用・スタッフ用・チェックリスト用のデプロイIDを永続保存
- **このファイルは `.gitignore` でgit追跡から除外済み**（`git reset --hard` で上書きされないため）
- deploy.js / deploy-checklist.js は3段階でデプロイIDを探す:
  1. `deploy-config.json` の保存済みID → 既存デプロイを更新（URL変更なし）
  2. `clasp deployments` の出力から説明文で検索（フォールバック）
  3. 新規作成（最終手段。URLが変わる）

### メインアプリの2つのデプロイ
- **オーナー用**: `executeAs: USER_DEPLOYING` + `access: ANYONE_ANONYMOUS` → オーナーとして実行
- **スタッフ用**: `executeAs: USER_DEPLOYING` + `access: ANYONE` → Google アカウント必要
- deploy.js がappsscript.jsonのwebapp設定を切り替えながら2回デプロイする

### デプロイ後の自動処理
- スタッフ用URLをメインアプリのDocumentPropertiesに自動保存（`?action=setStaffUrl`）
- チェックリストURLをメインアプリのScriptPropertiesに自動保存（`?action=setChecklistAppUrl`）

## 5. Git ブランチ

| ブランチ | 用途 | 状態 |
|---------|------|------|
| `main` | 本番 | 安定版 |
| `claude/fix-sheet-name-variable-tBTum` | 開発中 | **現在のアクティブブランチ** |

### mainブランチからの変更履歴（最新 → 古い順）
```
e011acf 清掃募集レコードを自動作成（半自動化）
e9d09dd デプロイIDを永続保存してURL変更を防止
f5b68fc deploy-checklist.js: HEADデプロイ除外 + curl→Node.js https置換 + OAuth認証ヒント
85462f8 チェックリストURL自動同期: デプロイ後にメインアプリのCHECKLIST_APP_URLを更新
985d45e clasp自動インストール + deploy.js エラーハンドリング改善
fc15dbd deploy-checklist.js: 既存デプロイIDを更新する方式に修正
b7830d2 deploy-all.bat: 強制ブランチ切り替え + deploy.js: clasp push --force
```

## 6. 重要な技術的制約

### GAS グローバルスコープの罠
- GASプロジェクト内の全 `.gs` ファイルは同一グローバルスコープを共有
- `const SHEET_NAME = '...'` を2つのファイルで宣言すると **SyntaxError** でアプリ全体がクラッシュ
- **対策**: `.claspignore` で各プロジェクトに不要なファイルを除外

### チェックリストアプリの変数名ルール
チェックリストアプリ（`checklist-app/Code.gs`）では以下の変数名を**絶対に使わない**:
- `SHEET_NAME` → 代わりに `CL_BOOKING_SHEET` を使用
- `SHEET_OWNER` → 代わりに `CL_OWNER_SHEET` を使用
- `SHEET_STAFF` → 代わりに `CL_STAFF_SHEET` を使用

`checklist-app/deploy-checklist.js` にバリデーションが組み込まれており、上記変数が検出されるとデプロイが中止される。

### GASバージョン上限
- GASプロジェクトのバージョンは**最大200個**
- deploy.jsは現在のバージョン数を監視し、150超で警告を表示
- 古いバージョンの削除はGASエディタのUIからのみ可能（API不可）

### GASデプロイの@HEAD
- `@HEAD` デプロイはread-onlyで更新不可
- deploy-checklist.jsは `@HEAD` を除外してデプロイIDを探す

## 7. メインアプリ（Code.gs）の主要機能

### 予約管理
- `doGet(e)`: Webアプリのエントリーポイント。オーナー/スタッフモード分岐
- `syncFromICal()`: iCalendar URLから予約を自動同期
- `onFormSubmit(e)`: Googleフォームからの予約登録トリガー
- `buildColumnMap(headers)`: スプレッドシートのヘッダーから列位置を動的取得

### 清掃募集（半自動化済み）
- `checkAndCreateRecruitments()`: 未来の全予約に対して募集レコードを自動作成
  - `syncFromICal()` 内で新規予約追加後に自動呼び出し
  - 日付範囲制限は撤廃済み（過去の予約のみスキップ）
- `saveRecruitmentDetail()`: 募集詳細の保存
- スタッフへの通知は手動（メール送信ボタン or テキストコピーボタン）

### URL自動管理
- `?action=setStaffUrl&url=...`: deploy.jsからスタッフ用URLを自動保存
- `?action=setChecklistAppUrl&url=...`: deploy-checklist.jsからチェックリストURLを自動保存

### スプレッドシートのシート構成
```
フォームの回答 1    ... 予約データ本体
設定_オーナー       ... オーナー設定
サブオーナー        ... サブオーナー情報
清掃スタッフ        ... 清掃スタッフ一覧
仕事内容マスタ      ... 仕事種類
スタッフ報酬        ... 報酬計算
特別料金            ... 特別料金設定
募集設定            ... 募集の設定
募集                ... 清掃募集レコード
募集_立候補         ... スタッフの立候補
キャンセル申請      ... キャンセル申請
設定_連携           ... iCal URL等の連携設定
通知履歴            ... 通知ログ
スタッフ共有用      ... スタッフ画面用
ベッド数マスタ      ... ベッド設定
チェックリストマスタ ... チェック項目のマスタデータ
撮影箇所マスタ      ... 写真撮影箇所
チェックリスト記録   ... チェック実績
チェックリスト写真   ... 撮影写真
チェックリストメモ   ... メモ
```

## 8. チェックリストアプリ（checklist-app/）の構成

### Code.gs の主要関数
- `doGet(e)`: Webアプリのエントリーポイント（`?date=YYYY-MM-DD&staff=名前`）
- `getChecklistForDate(checkoutDate)`: 指定日のチェックリストデータを返す
- `getNextBookingDetails(checkoutDate)`: 次回予約の詳細を返す
- `toggleChecklistItem()`: チェック項目のON/OFF
- `toggleSupplyNeeded()`: 要補充フラグのON/OFF
- `uploadChecklistPhoto()`: 写真アップロード
- `addChecklistMemo()`: メモ追加
- `notifyCleaningComplete()`: 清掃完了通知
- `importDefaultChecklist()`: マスタデータの初期投入

### checklist.html のUI構成
- ヘッダー（日付、進捗バー）
- 次回予約情報パネル
- カテゴリ別チェックリスト（折りたたみ式）
- 写真撮影セクション（ビフォー/アフター）
- 要補充リスト
- メモセクション
- ボトムバー（漏れチェック / 清掃完了ボタン）

## 9. 未完了タスク

### 優先度: 高
1. **Notionの清掃チェックリストデータでアプリをアップデート**
   - ユーザーがNotionから詳細なCSVデータを提供済み（約300項目）
   - 現在の `importDefaultChecklist()` は約107項目のみの暫定実装
   - 不足カテゴリ: 2階廊下、階段、1階和室、脱衣・洗面所、1階トイレ前廊下、1階廊下、玄関、最終チェック
   - 既存カテゴリも項目数が不足（キッチン、お風呂、トイレ等）
   - **条件分岐対応が必要**: BBQ利用あり/なし、宿泊人数（1-2名 / 3-8名 / 9-10名）
   - CSVデータはこのファイルと同じリポジトリ内には保存されていないため、ユーザーに再提供を依頼する必要がある

### 優先度: 中
2. **オーナー画面のGoogle Driveエラー確認**
   - deploy-config.json保護の修正はコミット済み・プッシュ済み
   - ユーザーが `deploy-all.bat` を実行後に確認が必要
   - 問題: `git reset --hard` が毎回deploy-config.jsonを上書き → 新デプロイID → URL変更
   - 修正済み: deploy-config.jsonをgit追跡から除外

3. **チェックリスト「マスタデータの読み込みに失敗しました」エラー**
   - CHECKLIST_APP_URL自動同期を実装済み（deploy-checklist.js）
   - 初回デプロイ後にGASエディタで `diagChecklistSetup()` を実行してOAuth認証が必要
   - ScriptProperties に `CHECKLIST_SS_ID`（スプレッドシートID）の設定が必要

### 優先度: 低
4. **deploy-all.bat のdeploy-config.json保護改善**
   - 現在: `.gitignore` + `git rm --cached` でgit追跡から除外
   - 新規クローン時: `deploy-config.sample.json` をコピーしてID設定が必要

## 10. deploy-config.json の現在の値

```json
{
  "ownerDeploymentId": "AKfycbyOhS3uLiC3JJY1fNkSNzmMdVoGcgFr-O6Unvd-aX6fNneMo6yquB8IF69z2zfKwmompg",
  "staffDeploymentId": "AKfycbw14JV3GcHE7eduQiJHmXLDhgynEvAbDDIdob-sVYg1I08VX1ENXG3aqrgmprvhE7ZrDA",
  "checklistDeploymentId": ""
}
```

**注意**: このファイルはgit追跡外。ユーザーのローカルPCにのみ存在する。

## 11. よくある問題と対処法

| 問題 | 原因 | 対処 |
|------|------|------|
| URL が毎回変わる | deploy-config.json がリセットされた | git追跡から除外済み。新規の場合は sample からコピー |
| SHEET_NAME SyntaxError | 2つのGASプロジェクトで同名のconst | .claspignoreで除外。変数名をCL_接頭辞に変更 |
| clasp push JSON5 エラー | npx経由のclasp実行 | node_modules/.bin/clasp を直接実行（deploy.jsで対応済み） |
| マスタデータ読み込み失敗 | ScriptProperties未設定 or OAuth未許可 | diagChecklistSetup() をGASエディタで実行 |
| @HEAD deployment修正不可 | HEADはread-only | getWebAppDeploymentIds() で @HEAD を除外済み |
| オーナー画面が開けない | デプロイIDが変わった | deploy-config.json の ownerDeploymentId を正しいIDに |

## 12. Claude.ai プロジェクト用カスタム指示（推奨）

以下をClaude.aiプロジェクトの「Custom Instructions」に貼り付けてください:

```
# minpaku-fix プロジェクトルール

## 基本ルール
- 常に日本語で応答すること
- deploy-all.bat をダブルクリックするだけで全自動デプロイが完結すること（手動ステップの指示をしない）
- ユーザー環境は Windows 10/11

## GAS開発の注意事項
- チェックリストアプリ (checklist-app/) では SHEET_NAME, SHEET_OWNER, SHEET_STAFF を使わない
  → 代わりに CL_BOOKING_SHEET, CL_OWNER_SHEET, CL_STAFF_SHEET を使用
- GASの全.gsファイルはグローバルスコープを共有するため、同名のconst宣言は禁止
- .claspignore を必ず確認し、不要なファイルがpushされないようにする

## デプロイの注意事項
- deploy-config.json はgit追跡対象外（.gitignore）。このファイルを削除・変更するとURLが変わる
- デプロイIDは永続保存 → URL安定化（3段階フォールバック: 保存ID → 説明文検索 → 新規作成）

## コードスタイル
- Code.gs, index.html は大きなファイル（5700行+, 6100行+）なので、修正時は対象箇所を正確に特定すること
- GASはES6一部対応（const/let可、arrow function可、async/await不可）
```
