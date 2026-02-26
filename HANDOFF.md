# minpaku-fix プロジェクト引き継ぎ資料

> **最終更新**: 2026-02-26
> **作業ブランチ**: `claude/review-handoff-docs-5WgKR`（最新デプロイ対象）
> **最新コミット**: `7825fe8 docs: CLAUDE.md を引き継ぎ資料テンプレートに準じて全面更新`

---

## 必須デプロイコマンド

ユーザーのWindows PCで下記を実行すること。**変更を反映するには必ずこの手順が必要。**

**方式A: deploy-all.bat をダブルクリック（推奨）**
- 現在のローカルブランチのコードを `git fetch` + `git reset --hard` で最新化してデプロイ
- 初回のみ `git checkout <ブランチ名>` が必要（以降は不要）

**方式B: コマンド1行で実行**（どのブランチにいても、未コミットの変更があっても、これ1つでOK）
```
cd C:\Users\yamas\minpaku-fix && git fetch origin && git checkout -f <現在の作業ブランチ名> && git reset --hard origin/<現在の作業ブランチ名> && node deploy-all.js
```

**現時点のコマンド（これをそのままコピペ！）:**
```
cd C:\Users\yamas\minpaku-fix && git fetch origin && git checkout -f claude/review-handoff-docs-5WgKR && git reset --hard origin/claude/review-handoff-docs-5WgKR && node deploy-all.js
```

---

## 1. プロジェクト概要

民泊（バケーションレンタル）の予約・清掃管理を行うGoogle Apps Script (GAS) Webアプリ。
2つの独立したGASプロジェクトで構成される。

| 項目 | メインアプリ（予約管理） | チェックリストアプリ（清掃） |
|------|--------------------------|------------------------------|
| 用途 | 予約カレンダー表示、清掃募集、iCal同期 | 清掃チェックリスト（スタッフ用） |
| Script ID | `1cFH0kD81gR6DC1RPBFyMJNXLI52nGYSOl6w461bkz_Byx1nE-4C0yD4w` | `18PILN4GA1DyQY9nkf2lV1GVxAXV95LT51vh2erWB1NZ8uNX54kVqlx3w` |
| 主要ファイル | `Code.gs` (~9665行), `index.html` (~8447行) | `checklist-app/Code.gs` (~2947行), `checklist-app/checklist.html` (~5788行) |
| デプロイ | メイン+ゲートウェイの2つ（?staff=1でスタッフ用） | 1つのデプロイ |

## 2. ユーザー環境

- OS: Windows 10/11
- ローカルパス: `C:\Users\yamas\minpaku-fix`
- デプロイ方法: `node deploy-all.js` または `deploy-all.bat` をダブルクリック
- **常に日本語で応答すること**
- **変更をプッシュしたら毎回デプロイ手順を表示すること**
- **必須ルールの詳細は `SESSION_HANDOFF.md` の「必須ルール」セクションを参照すること**（ルール1〜6）

## 3. ファイル構成

```
minpaku-fix/
├── Code.gs                      # メインアプリ GAS コード（~9665行）
├── index.html                   # メインアプリ UI（~8447行）
├── appsscript.json              # GASマニフェスト（デプロイ時に自動切替）
├── .clasp.json                  # メインアプリのclasp設定
├── .claspignore                 # メインアプリ push 時の除外ルール
├── deploy.js                    # メインアプリ デプロイスクリプト（Node.js）
├── deploy-all.js                # 一括デプロイ（メイン+チェックリスト）（~340行）
├── deploy-all.bat               # deploy-all.jsのWindows用ラッパー
├── deploy-config.json           # デプロイID保存（git追跡対象外！）
├── deploy-config.sample.json    # deploy-config.json のテンプレート
├── package.json                 # Node.js依存（@google/clasp）
├── staff-manual.html            # スタッフ操作マニュアル（~884行）
│
├── checklist-app/               # チェックリストアプリ（別GASプロジェクト）
│   ├── Code.gs                  # チェックリストアプリ GAS コード（~2947行）
│   ├── checklist.html           # チェックリストアプリ UI（~5788行）
│   ├── .clasp.json              # チェックリストアプリのclasp設定
│   ├── .claspignore             # チェックリストアプリ push 時の除外ルール
│   ├── deploy-checklist.js      # チェックリストアプリ デプロイスクリプト
│   ├── deploy-checklist.bat     # チェックリストアプリ 単体デプロイ
│   └── appsscript.json
│
├── manual-generator/            # スタッフ操作マニュアル生成ツール
│   ├── generate-manual.js       # メインマニュアル生成
│   ├── generate-staff-manual.js # スタッフマニュアル生成
│   ├── screenshot.js            # スクリーンショット撮影
│   ├── staff-manual-screenshot.js # スタッフ用スクショ撮影
│   ├── screens.json             # スクショ設定
│   └── package.json             # Puppeteer等の依存
│
├── generate-manual.bat          # マニュアル生成batファイル
├── generate-staff-manual.bat    # スタッフマニュアル生成batファイル
│
├── HANDOFF.md                   # ← この引き継ぎ資料
├── SESSION_HANDOFF.md           # セッション間の引き継ぎ情報
└── .gitignore                   # deploy-config.json, node_modules/ を除外
```

## 4. Gitブランチ・コミット履歴

| ブランチ | 用途 | 状態 |
|---------|------|------|
| `main` | 本番 | 安定版 |
| `claude/review-handoff-docs-5WgKR` | **最新デプロイ対象（EbLOg統合済み）** | **デプロイはこのブランチから** |
| `claude/setup-deployment-rules-EbLOg` | 過去の開発 | 5WgKRに統合済み |
| `claude/update-handoff-docs-897D8` | 過去の開発・引き継ぎ | 897D8の変更はEbLOgに含む |
| `claude/create-handoff-docs-tRAuI` | 過去の開発 | マージ不要 |

### 最新コミット履歴（claude/review-handoff-docs-5WgKR ブランチ、直近20件）
```
7825fe8 docs: CLAUDE.md を引き継ぎ資料テンプレートに準じて全面更新
a65cd5c fix: スタッフ回答状況が「未回答」のまま反映されない問題を修正
caa4991 fix: 名簿通知誤検知・スタッフ回答状況ズレ・通知タブ表示不具合を修正
7b3ff9d feat: 請求書要請メール機能を実装（デフォルト送信無し）
f18d0c4 請求書メール送信結果をUI上に表示 + エラー詳細を保持
07a0dc8 iPhone写真撮影ブラックアウト修正: capture="environment"属性を削除
63756c7 Playwright自動テストスクリプト（Python + Excel出力）を追加
47a7053 fix: オーナーURL消え問題 - レースコンディションの根本排除 (v0223g)
37588eb fix: オーナーURL自動上書きバグの修正 (v0223f)
055b743 fix: オーナーURL消え問題の根本修正 - 非同期コールバック競合の解消 (v0223e)
34cb049 fix: 取消申請の ReferenceError + オーナーURL保存の堅牢化 (v0223b)
dd31746 fix: 取消申請がサイレントに失敗する問題を修正 (v0223a)
59ba790 fix: iCal同期のブロック日誤認 + 取消申請フォールバック検索 + オーナーURL永続化 (v0222g)
06ae8ba fix: 通知パネルクラッシュ修正 + メール通知デフォルトON (v0222f)
ae650f0 fix: 取消申請がオーナーに届かない問題を修正
8f0ac36 perf: 2-C モーダル最適化 - キャッシュ活用で軽量API呼び出し
28a38ce fix: オーナーURL欄をブラウザ更新後も永続化（3層キャッシュ）
553ec5d perf: Phase2-B - getInitData()結果を90秒キャッシュ（チャンク分割対応）
ce4faf2 perf: Phase1 - CacheServiceでスタッフリストキャッシュ + CDN事前接続
d883636 feat: URL設定に保存ボタン追加 (v0222a)
```

---

## 5. 全セッションで完了した変更

### メインアプリ (`index.html`, `Code.gs`)

| 項目 | 内容 | 状態 |
|------|------|------|
| スタッフ回答状況「未回答」表示バグ修正 | 4つのバグの連鎖（重複エントリ上書き、重複作成、同日複数予約、off-by-one）をすべて修正 | **完了** |
| 請求書要請メール機能 | デフォルト送信無し。オーナーが任意で送信可能 | **完了** |
| 請求書機能の独立タブ化 | PDF生成・メール送信・履歴管理を独立タブに | **完了** |
| オーナーURL消え問題の根本修正 | 非同期コールバック競合（レースコンディション）を5段階で修正 | **完了** |
| 取消申請サイレント失敗修正 | ReferenceError修正 + オーナーURL保存の堅牢化 | **完了** |
| パフォーマンス最適化 | CacheService(600秒TTL) + getInitData 90秒キャッシュ + モーダル最適化 | **完了** |
| 通知改善 | 期間フィルタ、既読10日自動削除、チェックイン日追加、誤検知修正 | **完了** |
| 閲覧専用URL (`?view=readonly`) | スタッフビューベース + URL一覧サブタブ | **完了** |
| カレンダー今日枠のダークモード対応 | box-shadow方式 | **完了** |
| iOS Safari対応 | confirm()/prompt()をカスタムモーダルに完全置換 | **完了** |
| メール通知ON/OFF個別制御 | 全8通知の個別制御 | **完了** |
| 凡例マーク変更 | 「日付背景-募集中」を「赤丸」の凡例に統合 | **完了** |
| 宿泊人数編集 | オーナー宿泊詳細画面に追加 | **完了** |
| 清掃ステータスマーク修正 | 確定後に即座に緑に変わる（楽観的キャッシュ更新） | **完了** |
| 清掃担当UI改善 | 編集ボタンをラベル直下に配置、バナー形式見出し | **完了** |
| スタッフ名変更時の自動伝播 | 全関連シートの名前を自動更新 | **完了** |
| 名簿リマインド判定修正 | 部分一致・複数列対応・キャンセル除外 | **完了** |

### チェックリストアプリ (`checklist-app/`)

| 項目 | 内容 | 状態 |
|------|------|------|
| iPhone写真撮影ブラックアウト修正 | `capture="environment"` 属性を削除 | **完了** |
| スタッフ選択の複数端末同期 | deviceId別管理、粘着ユニオン問題修正 | **完了** |
| メモ機能全面改修 | 登録ボタン方式＋削除機能＋写真添付 | **完了** |
| 要補充タブ刷新 | 全supplyItem表示+カテゴリタグ+双方向同期 | **完了** |
| 撮影タブ改善 | 折りたたみ+一括アップロード+「未整理」セクション | **完了** |
| 設定タブに編集ロック/アンロック | 誤操作防止 | **完了** |
| カテゴリ移動 | 中カテゴリをルートレベルに昇格可能 | **完了** |
| 自動クリーンアップ | 古い写真・記録・メモの自動削除 | **完了** |
| チェックリスト4階層対応 | CSV全558項目を網羅 | **完了** |
| カテゴリ見出し差別化 | 大=濃紺、中=薄青、小=オレンジ、細=紫 | **完了** |
| 全展開/全折り・編集・削除 | カテゴリ見出しにボタン追加 | **完了** |
| 並び替え機能 | 項目・カテゴリのドラッグ並び替え（長押し600ms） | **完了** |
| UNDO機能 | 並び替え・移動・リネームに1回UNDO | **完了** |
| クリーニング連絡機能 | 出し/受取/施設戻しの3ステップ記録 | **完了** |

### デプロイ・インフラ

| 項目 | 内容 | 状態 |
|------|------|------|
| Playwright自動テストスクリプト | Python + Excel出力の自動テスト基盤 | **完了** |
| deploy-all.js改善 | デプロイID1つ前提にシンプル化 | **完了** |
| deploy-all.bat自動ブランチ検出 | `git branch --show-current` 方式 | **完了** |
| マニュアル生成ツール | Puppeteer＋スクショ自動撮影 | **完了** |
| メール重複送信防止 | LockService/PropertiesServiceで重複防止 | **完了** |
| トリガー管理 | setupReminderTriggers()でUI一括セットアップ | **完了** |
| ゲートウェイデプロイメント | URL永続化のための自動リダイレクト | **完了** |

---

## 6. checklist.html の現在のUI構成（最新）

```
┌─────────────────────────────────────┐
│ ヘッダー（タイトル + 日付）          │  ← sticky top:0
│ ████████░░ プログレスバー           │
├─────────────────────────────────────┤
│ [チェックリスト] [撮影] [要補充]     │  ← sticky top:52px ボタン形式タブ
│ [仕事内容] [設定]                   │
├─────────────────────────────────────┤
│ 担当スタッフ選択（複数端末同期対応） │
│ 「他の端末で〇〇さんが選択済み」     │  ← remoteStaffInfo
│ [全て展開] [全チェック]              │
│                                     │
│ ▼ 大カテゴリ名 (3/5) [全チェック][全展開] ✎✕ │
│ ┌───────────────────────────────┐   │
│ │ インライン撮影箇所:            │   │
│ │ [thumb] 名前  📷前 📷後  ✎ ✕ │   │
│ │ ＋ 撮影項目を追加              │   │
│ └───────────────────────────────┘   │
│ ☑ 項目名（タッチでチェック切替）    │
│ ☐ 項目名                           │
│  ▼ 中カテゴリ名 (2/3)  [↑ルート昇格]│
│   ☑ サブ項目名                      │
│   ＋ 項目を追加                     │
│   ＋ 小カテゴリを追加               │
│ ＋ 項目を追加                       │
│ ＋ 中カテゴリを追加                 │
│                                     │
│ ＋ カテゴリを追加                   │
│                                     │
│ 📝 特記事項・備品不足など           │
│ [メモ入力...] [登録] [📷写真添付]   │  ← 登録ボタン方式
│ 登録済みメモ一覧（削除可能）         │
│                                     │
│ ┌───────────────────────────────┐   │
│ │ 未チェック項目: 5件、未撮影: 2件│   │
│ │ [     清掃完了      ]          │   │
│ └───────────────────────────────┘   │
└─────────────────────────────────────┘
```

---

## 7. 未完了タスク・今後の調査事項

### 要確認（デプロイ後）

1. **スタッフ回答状況表示の確認** — 過去の日付のスタッフ回答状況が正しく表示されるか
2. **`募集` シートの重複エントリクリーンアップ** — 既存の重複を検出・統合するユーティリティ関数の作成（任意）
3. **残りの `getLastRow()` off-by-one修正** — 主要13関数は修正済み、補助関数にも展開（任意）
4. **スタッフ選択の複数端末同期テスト** — 粘着ユニオン問題の解消確認
5. **メール重複送信防止の動作確認** — トリガーセットアップボタンの動作確認

### 既知の課題

6. **`募集` シートの既存重複エントリ** — 新規作成は防止済み。表示上は修正済み（回答データ優先ロジック）。スプシ上のクリーンアップは未実施
7. **オーナーURL消え問題** — v0223c〜g で根本修正済み。再発時は非同期コールバック競合を疑う

### 将来の課題

8. **条件分岐対応**: BBQ利用あり/なし、宿泊人数による表示切替
9. **在庫管理リスト機能**
10. **リネン洗濯フロー管理**

---

## 8. アーキテクチャ詳細

### チェックリストアプリのデータフロー

```
[checklist.html]
    ↓ callGAS('getChecklistForDate', [date, deviceId])
[checklist-app/Code.gs]
    ↓ getChecklistForDate(date, deviceId)
[Google Sheets]
    ├── チェックリストマスタ → items（チェック項目定義）
    ├── 撮影箇所マスタ → spots（撮影箇所 + exampleFileId）
    ├── チェックリスト記録 → checked（日付別チェック状態）
    ├── チェックリスト写真 → photos（日付別撮影写真）
    ├── チェックリストメモ → memos（日付別メモ）
    └── スタッフ選択 → staffSelection（端末別スタッフ選択状態）
```

### スタッフ選択の複数端末同期（重要）
```
データフロー:
1. 端末がページ読込 → getChecklistForDate(date, deviceId) で自分の選択を取得
2. スタッフ選択/解除 → applyStaffSelection() でローカル反映 + GASにsave
3. GAS側 getStaffSelectionDetailed_() で全端末の選択をマージ
4. 60秒ポーリングで他端末の選択も反映（remoteStaffInfo表示）

粘着ユニオン問題の修正:
- 旧: 全端末の選択をunionして返す → 一度選んだスタッフが外せない
- 新: deviceId別に選択状態を管理 → 各端末の解除が正しく反映される
```

### callGAS() の仕組み
```javascript
function callGAS(functionName, args) {
  return new Promise(function(resolve, reject) {
    google.script.run
      .withSuccessHandler(function(jsonStr) {
        resolve(JSON.parse(jsonStr));
      })
      .withFailureHandler(reject)
      [functionName].apply(null, args);
  });
}
```
- GASの `google.script.run` をPromise化
- GAS側は全てJSON文字列を返す

### カテゴリ階層構造
```
大カテゴリ（majorName）     例: "2階寝室"
  └─ 中カテゴリ（subName）  例: "2階寝室：ベッドメイク"
      └─（小カテゴリは中カテゴリのさらにネスト、フルカテゴリ名で管理）

カテゴリ名のフォーマット: "大カテゴリ" または "大カテゴリ：中カテゴリ"
区切り文字: 全角コロン（\uff1a = ：）
```

### 写真保存構造 (Google Drive)
```
写真フォルダ/
  ├── before/    ← ビフォー写真
  ├── after/     ← アフター写真
  ├── example/   ← 見本写真（日付非依存）
  └── memo/      ← メモ添付写真
```
- サムネイルURL: `https://drive.google.com/thumbnail?id={fileId}&sz=w{size}`
- `sz=w56` でインラインサムネイル、`sz=w800` でモーダル表示

### 60秒ポーリングリフレッシュ
- `setInterval` で60秒ごとにデータ再取得
- 折りたたみ状態 (`saveCollapseState/restoreCollapseState`) とタブ状態を保持
- 複数端末の同時利用に対応（スタッフ選択のマージ）

---

## 9. デプロイの仕組み

### deploy-all.js の処理フロー
1. メインアプリ: `node deploy.js` でpush + deploy（1つのデプロイ）
2. チェックリスト: `node deploy-checklist.js` でpush + deploy

### デプロイID管理（重要）
- `deploy-config.json` にデプロイIDを永続保存
- **このファイルは `.gitignore` でgit追跡から除外済み**
- deploy.js / deploy-checklist.js は3段階でデプロイIDを探す:
  1. `deploy-config.json` の保存済みID → 既存デプロイを更新（URL変更なし）
  2. `clasp deployments` の出力から説明文で検索（フォールバック）
  3. 新規作成（最終手段。URLが変わる）

### ゲートウェイデプロイメント（URL永続化・重要）

メインアプリのURLが将来変更されてもブックマークが無効にならないよう、**ゲートウェイデプロイメント**を導入済み。

**仕組み:**
```
ゲートウェイURL（ブックマーク用）
  → doGet() が ScriptApp.getService().getUrl() と APP_BASE_URL を比較
  → 異なる場合 → 最新URLに自動リダイレクト（クエリパラメータ引き継ぎ）
  → 同じ場合 → 通常表示
```

**構成:**
- `deploy-config.json` に `gatewayDeploymentId` として保存
- `deploy-all.js` がデプロイ時にメインと一緒にゲートウェイも更新
- `Code.gs` の `doGet()` 内にリダイレクトロジックあり（`action=setGatewayUrl` でURL保存）
- GAS ScriptProperties キー `GATEWAY_URL` にゲートウェイURL保存

**運用ルール:**
- ユーザーにはゲートウェイURLをブックマークさせる
- メインのデプロイIDが変わっても、ゲートウェイ経由でアクセスすれば自動で最新URLに転送される
- ゲートウェイデプロイメント自体の削除は厳禁（ブックマークが無効になる）
- `deploy-config.json` の `gatewayDeploymentId` を失うとゲートウェイURLが変わるため注意

### メインアプリのスタッフ用アクセス
- オーナー用URLに `?staff=1` を付けるとスタッフ用画面として動作
- deploy-all.js で自動的にスタッフ用URLも生成

---

## 10. 重要な技術的制約

### GAS グローバルスコープの罠
- GASプロジェクト内の全 `.gs` ファイルは同一グローバルスコープを共有
- `const SHEET_NAME = '...'` を2つのファイルで宣言すると **SyntaxError**
- **対策**: `.claspignore` で互いのファイルを除外 + チェックリストは `CL_` 接頭辞で回避

### チェックリストアプリの変数名ルール
- `SHEET_NAME` → `CL_BOOKING_SHEET`
- `SHEET_OWNER` → `CL_OWNER_SHEET`
- `SHEET_STAFF` → `CL_STAFF_SHEET`

### GASバージョン上限
- 最大200個。deploy.jsは150超で警告。古いバージョンはGASエディタUIから手動削除。

### GAS CSSサニタイザー
- GASはHTMLサービスで `body` セレクタを書き換える
- **対策**: `body` の代わりに `#contentArea` セレクタを使用

### FullCalendar の注意点
- イベントソースの差し替え: 全ソース削除 → `addEventSource` → `render` のパターンが必要
- `eventSources` の直接操作は避ける

### スプレッドシートの行番号
- 「募集」シートの `currentRowNum` が予約行番号のマッピングに使われる
- 行の挿入/削除でずれる可能性あり → `getRecruitmentForBooking()` に自己修復メカニズムあり
- 行番号は1ベースで、ヘッダー行を含む

### deploy-all.bat のブランチ取得方式に関する注意（重要）

`deploy-all.bat` はgit pullからデプロイまでをワンクリックで実行するラッパー。
ブランチ取得方式について以下のレビュー結果を踏まえること：

**方式比較:**
| 方式 | メリット | リスク |
|------|---------|--------|
| ハードコード (`set BRANCH=claude/xxx`) | 確実 | 毎回書き換えが必要 |
| 自動検出 (`git for-each-ref --sort=-committerdate`) | 手間なし | 古いブランチにCI/botがpushすると誤検出 |
| `git branch --show-current` | 安全・シンプル | 初回は手動checkoutが必要 |
| `deploy-config.json` にブランチ名保持 | 安全 | 設定ファイル管理が必要 |

**現在の採用方式**: `git branch --show-current`（ローカルの現在ブランチを使用）
- 初回のみ `git checkout <ブランチ名>` が必要
- 以降は `deploy-all.bat` ダブルクリックだけでOK
- 古いブランチを誤って拾うリスクがゼロ

**`deploy-config.json` について:**
- `.gitignore` 対象のためcheckout/resetで上書きされない
- `git clean -f` を使うと消えるので**絶対に使わないこと**
- bat内のバックアップ＆リストア処理は安全側に残している

**bat実行中のcheckoutリスク:**
- Windowsの CMD は bat を行単位で読むため、checkout でファイルが変わっても通常は問題ない
- ただし行位置がずれると後続処理がおかしくなる可能性はある
- ロジックは `deploy-all.js` に集約し、bat は短いラッパーに保つのが安全

### デプロイ時の注意
- `deploy-config.json` は `.gitignore` 対象。紛失するとURLが変わる（ゲートウェイURLも変わる）
- `deploy-config.json` のキー: `ownerDeploymentId`, `staffDeploymentId`, `gatewayDeploymentId`, `checklistDeploymentId`
- `npx clasp` ではなく `node_modules/.bin/clasp` を直接実行（JSON5エラー回避）
- clasp login のセッションは数週間有効。期限切れ時は再ログインが必要

### メール送信の重複防止（重要）
- トリガー実行関数（`checkAndSendReminderEmails`, `checkAndSendReminders`）は `LockService.getScriptLock()` で排他制御
- `ensureSingleTrigger_()` が実行時にトリガー重複を自動クリーンアップ
- `setupReminderTriggers()` でUIから一括セットアップ可能（手動GASエディタ不要）
- `sendImmediateReminderIfNeeded_()`, `notifyCleaningComplete()` はPropertiesServiceで日次重複防止
- UI操作起点のメール（`notifyStaffForRecruitment`, `notifyStaffConfirmation`, `approveCancelRequest`, `rejectCancelRequest`, `cancelBookingFromICal_`）は未対策（低リスク）

### iCal同期
- 正常動作中（トリガーで定期実行）
- 予約重複排除: iCal UID + チェックイン日で判定
- 対応サイト: Airbnb, Booking.com 等（iCalフィードを提供する予約サイト全般）
- 同期設定: 「設定_連携」シートにiCal URLを登録

---

## 11. スプレッドシートのシート構成

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
撮影箇所マスタ      ... 写真撮影箇所（exampleFileIdカラムあり）
チェックリスト記録   ... チェック実績（日付別）
チェックリスト写真   ... 撮影写真（日付別）
チェックリストメモ   ... メモ（日付別）
スタッフ選択        ... 端末別スタッフ選択状態
要補充記録          ... 要補充アイテムの記録
```

---

## 12. よくある問題と対処法

| 問題 | 原因 | 対処 |
|------|------|------|
| URL が毎回変わる | deploy-config.json がリセット | git追跡から除外済み。新規ならsampleコピー |
| SHEET_NAME SyntaxError | 同名const宣言 | .claspignoreで除外＋CL_接頭辞 |
| clasp push JSON5 エラー | npx経由のclasp | node_modules/.bin/clasp直接実行（対応済み） |
| マスタデータ読み込み失敗 | ScriptProperties未設定/OAuth未許可 | GASエディタで `diagChecklistSetup()` 実行 |
| @HEAD deployment修正不可 | HEADはread-only | `@HEAD` 除外済み |
| CSSが適用されない | GAS CSSサニタイザー | bodyセレクタを#contentAreaに変更（対応済み） |
| スタッフ選択が復活する | 粘着ユニオン問題 | deviceId別管理に修正（対応済み） |
| メールが重複送信される | トリガー重複 or 同時実行 | LockService + ensureSingleTrigger_() で対応済み。設定画面の「トリガーをセットアップ」ボタンで整理可能 |
| URLが変わってブックマークが切れた | deploy-config.json紛失 | ゲートウェイURL経由なら自動リダイレクト。ゲートウェイURLをブックマークに推奨 |

---

## 13. ユーザーの要望原文（参考）

以下はユーザーが出した改善要望の原文（完了済みのものも含む）:

### メインアプリ
- 「清掃の凡例の表示を変更。"日付背景-募集中" を "赤丸" の凡例に統合」→ **完了**
- 「2/23の日付の背景が黄色のまま」→ **未調査**（スプレッドシートのデータ問題の可能性）
- 「オーナー宿泊詳細画面に宿泊人数の編集機能を追加」→ **完了**
- 「清掃スタッフ確定後にカレンダーのステータスマークが即座に変わるように」→ **完了（要テスト）**
- 「清掃担当を編集ボタンをラベル直下に配置」→ **完了**
- 「クリーニング状況の見出しをバナー形式に」→ **完了**

### チェックリストアプリ
- 「項目名をタッチしてもチェックが入るように」→ **完了**
- 「タブをボタンっぽい表示にして上部配置」→ **完了**
- 「漏れチェックを清掃完了ボタンに統合」→ **完了**
- 「メモを登録ボタン方式に変更＋削除機能」→ **完了**
- 「メモに写真添付」→ **完了**
- 「見本写真サムネイル表示」→ **完了**
- 「編集・削除ボタンを右端に」→ **完了**
- 「追加ボタンを控えめに」→ **完了**
- 「サブカテゴリ追加ボタン」→ **完了**
- 「見本写真は全日付共通」→ **実装済み、要実環境テスト**
- 「大カテゴリと中カテゴリの見出しを差別化」→ **完了**
- 「各カテゴリに全展開/全折りたたみボタンを追加」→ **完了**
- 「カテゴリ名称変更機能」→ **完了**
- 「カテゴリ削除（中身も削除 or 親に移動）」→ **完了**
- 「要補充タブに表示ボタンと大カテゴリ名を表示」→ **完了**
- 「要補充対象を外したら要補充タブからも消す」→ **完了**
- 「中カテゴリをルートレベルに昇格」→ **完了**
- 「複数端末でスタッフ選択を同期」→ **完了（要テスト）**
- 「古いデータの自動クリーンアップ」→ **完了**
- 「仕事内容タブの折りたたみUI」→ **完了**
- 「写真保管期間設定」→ **完了**

### 運用ルール
- 「変更をプッシュしたら毎回デプロイ手順を表示して」→ **ルール化済み**
- 「チャット移行時に引き継ぎ資料をまとめて」→ **ルール化済み**
