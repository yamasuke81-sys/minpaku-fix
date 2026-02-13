# minpaku-fix プロジェクト引き継ぎ資料

> **最終更新**: 2026-02-13
> **作業ブランチ**: `claude/create-handoff-docs-tRAuI`
> **最新コミット**: `d0a1a50 チェックリスト：全展開/全折り・カテゴリ名編集・カテゴリ削除機能を追加`

---

## 必須デプロイコマンド

ユーザーのWindows PCで下記を実行すること。**変更を反映するには必ずこの手順が必要。**

```
cd C:\Users\yamas\minpaku-fix && git pull origin claude/create-handoff-docs-tRAuI && node deploy-all.js
```

---

## 1. プロジェクト概要

民泊（バケーションレンタル）の予約・清掃管理を行うGoogle Apps Script (GAS) Webアプリ。
2つの独立したGASプロジェクトで構成される。

| 項目 | メインアプリ（予約管理） | チェックリストアプリ（清掃） |
|------|--------------------------|------------------------------|
| 用途 | 予約カレンダー表示、清掃募集、iCal同期 | 清掃チェックリスト（スタッフ用） |
| Script ID | `1cFH0kD81gR6DC1RPBFyMJNXLI52nGYSOl6w461bkz_Byx1nE-4C0yD4w` | `18PILN4GA1DyQY9nkf2lV1GVxAXV95LT51vh2erWB1NZ8uNX54kVqlx3w` |
| 主要ファイル | `Code.gs` (6609行), `index.html` (6150行) | `checklist-app/Code.gs` (1604行), `checklist-app/checklist.html` (2423行) |
| デプロイ | オーナー用 + スタッフ用（2つのデプロイ） | 1つのデプロイ |

## 2. ユーザー環境

- OS: Windows 10/11
- ローカルパス: `C:\Users\yamas\minpaku-fix`
- デプロイ方法: `node deploy-all.js` または `deploy-all.bat` をダブルクリック
- **常に日本語で応答すること**
- **変更をプッシュしたら毎回デプロイ手順を表示すること**

## 3. ファイル構成

```
minpaku-fix/
├── Code.gs                      # メインアプリ GAS コード（6164行）
├── index.html                   # メインアプリ UI（6004行）
├── appsscript.json              # GASマニフェスト（デプロイ時に自動切替）
├── .clasp.json                  # メインアプリのclasp設定
├── .claspignore                 # メインアプリ push 時の除外ルール
├── deploy.js                    # メインアプリ デプロイスクリプト（Node.js）
├── deploy-all.js                # 一括デプロイ（メイン+チェックリスト）
├── deploy-all.bat               # deploy-all.jsのWindows用ラッパー
├── deploy-config.json           # デプロイID保存（git追跡対象外！）
├── deploy-config.sample.json    # deploy-config.json のテンプレート
├── package.json                 # Node.js依存（@google/clasp）
│
├── checklist-app/               # チェックリストアプリ（別GASプロジェクト）
│   ├── Code.gs                  # チェックリストアプリ GAS コード（698行）
│   ├── checklist.html           # チェックリストアプリ UI（2239行）
│   ├── .clasp.json              # チェックリストアプリのclasp設定
│   ├── .claspignore             # チェックリストアプリ push 時の除外ルール
│   ├── deploy-checklist.js      # チェックリストアプリ デプロイスクリプト
│   ├── deploy-checklist.bat     # チェックリストアプリ 単体デプロイ
│   └── appsscript.json
│
├── HANDOFF.md                   # ← この引き継ぎ資料
└── .gitignore                   # deploy-config.json, node_modules/ を除外
```

## 4. Gitブランチ・コミット履歴

| ブランチ | 用途 | 状態 |
|---------|------|------|
| `main` | 本番 | 安定版 |
| `claude/create-handoff-docs-tRAuI` | 現在の開発 | **現在のアクティブブランチ** |
| `claude/minpaku-fix-ui-updates-af95w` | 旧UI改修 | 過去のブランチ |
| `claude/fix-sheet-name-variable-tBTum` | 旧開発 | 過去のブランチ |

### 最新コミット履歴
```
d0a1a50 チェックリスト：全展開/全折り・カテゴリ名編集・カテゴリ削除機能を追加
9f30e11 清掃ステータスマーク：applyConfirmOptimisticを根本的に改良
9acf17d 清掃ステータスマーク：confirmRecruitment成功時に楽観的キャッシュ更新を追加
a5530c3 fix: 小・細カテゴリの視認性改善 + 展開時の見切れ修正
5ad84f8 fix: 中カテゴリの視認性を改善 - 青背景+白文字に変更
f70e821 fix: 清掃スタッフ確定後にカレンダーのステータスマークが赤のまま残るバグを修正
2bb73e4 feat: オーナー宿泊詳細画面に宿泊人数の編集機能を追加
c13137f 大カテゴリと中カテゴリの見出しデザインを差別化
0db3da6 feat: チェックリスト4階層対応 + CSV全558項目を網羅
04a0617 feat: チェックリストUI改善 - サムネ3倍化・ボタン右寄せ・項目削除・状態維持
966085e feat: チェックアプリUI全面改修 - タブ移動・漏れチェック統合・サムネイル等
```

---

## 5. 全セッションで完了した変更

### メインアプリ (`index.html`, `Code.gs`)

| 項目 | 内容 | 状態 |
|------|------|------|
| 凡例マーク変更 | 「日付背景-募集中」を「赤丸」の凡例に統合。マークを黄色四角の中に赤丸に変更 | **完了** |
| 宿泊人数編集 | オーナー宿泊詳細画面に宿泊人数の編集機能を追加 | **完了** |
| 清掃ステータスマーク修正 | スタッフ確定後にカレンダーのステータスドットが即座に緑に変わるよう修正。`applyConfirmOptimistic()` による楽観的キャッシュ更新 | **完了（要テスト）** |

### チェックリストアプリ (`checklist-app/checklist.html`, `checklist-app/Code.gs`)

| 項目 | 内容 | 状態 |
|------|------|------|
| カテゴリ見出し差別化 | 大カテゴリ=濃紺帯、中カテゴリ=薄青、小=オレンジ、細=紫 | **完了** |
| 大カテゴリ未完了時 | 赤背景(`#c0392b`)で表示 | **完了** |
| 全展開/全折りたたみ | 子カテゴリがあるカテゴリ見出しに「全展開/全折り」ボタンを追加 | **完了** |
| カテゴリ名称変更 | ✎ ボタンでカテゴリ名を変更可能。GAS側 `renameCategoryInMaster()` | **完了** |
| カテゴリ削除 | ✕ ボタンでカテゴリ削除。中身も削除 or 親カテゴリに移動の選択可。GAS側 `deleteCategoryFromMaster()` | **完了** |

### チェックリストアプリ (`checklist-app/checklist.html`)

| 項目 | 変更内容 | 状態 |
|------|----------|------|
| **タブナビ移動** | 画面下部固定 → ヘッダー+プログレスバー直下にボタン形式配置（sticky対応、`top:52px`） | **完了** |
| **漏れチェック統合** | 「漏れチェック」ボタン削除。「清掃完了」ボタン押下時に自動で漏れチェック実行。未チェック項目・未撮影箇所を赤くハイライト+件数表示。未完了でも確認後に送信可能 | **完了** |
| **メモ自動保存** | 「送信」ボタン削除。入力後1.5秒デバウンスで自動保存。Enter即時保存も対応 | **完了** |
| **項目名タッチ** | チェックボックスだけでなく項目名テキストをタッチしてもチェック切替（イベント委譲） | **完了** |
| **見本写真サムネイル** | テキスト「見本」ボタン → 28x28px圧縮サムネイル画像に変更。タップでモーダル表示（変更・削除オプション付き） | **完了** |
| **撮影箇所レイアウト** | `[見本thumb] 名前 📷前/📷後 ✏️✕` の順に整列 | **完了** |
| **編集・削除ボタン** | `margin-left:auto` で右端に配置（誤タップ防止） | **完了** |
| **カテゴリ階層ボタン** | 大カテゴリ内に「中カテゴリを追加」、中カテゴリ内に「小カテゴリを追加」ボタン追加 | **完了** |
| **追加ボタンデザイン** | 「撮影項目を追加」「項目を追加」「カテゴリを追加」を控えめデザインに（左寄せ・薄い点線ボーダー） | **完了** |

---

## 6. checklist.html の現在のUI構成（最新）

```
┌─────────────────────────────────────┐
│ ヘッダー（タイトル + 日付）          │  ← sticky top:0
│ ████████░░ プログレスバー           │
├─────────────────────────────────────┤
│ [チェックリスト] [撮影] [要補充]     │  ← sticky top:52px ボタン形式タブ
├─────────────────────────────────────┤
│ 担当スタッフ選択                     │
│ [全て展開] [全チェック]              │
│                                     │
│ ▼ 大カテゴリ名 (3/5) [全チェック][全展開] ✎✕ │ ← 折りたたみ式
│ ┌───────────────────────────────┐   │
│ │ インライン撮影箇所:            │   │
│ │ [thumb] 名前  📷前 📷後  ✎ ✕ │   │  ← 見本サムネイル + 右端にedit/del
│ │ ＋ 撮影項目を追加              │   │  ← 控えめデザイン
│ └───────────────────────────────┘   │
│ ☑ 項目名（タッチでチェック切替）    │
│ ☐ 項目名                           │
│  ▼ 中カテゴリ名 (2/3)              │  ← サブセクション
│   ☑ サブ項目名                      │
│   ＋ 項目を追加                     │  ← 控えめ
│   ＋ 小カテゴリを追加               │  ← 階層追加ボタン
│ ＋ 項目を追加                       │
│ ＋ 中カテゴリを追加                 │  ← 階層追加ボタン
│                                     │
│ ＋ カテゴリを追加                   │
│                                     │
│ 📝 特記事項・備品不足など           │
│ [メモ入力...（自動保存）]            │  ← 送信ボタンなし
│                                     │
│ ┌───────────────────────────────┐   │
│ │ 未チェック項目: 5件、未撮影: 2件│   │  ← 漏れ時のみ赤文字で表示
│ │ [     清掃完了      ]          │   │  ← 漏れチェック統合
│ └───────────────────────────────┘   │
└─────────────────────────────────────┘
```

### 主要CSS変更ポイント

| セレクター | 変更 |
|-----------|------|
| `body` | `padding-bottom: 60px` → `16px`（タブが上部に移動） |
| `.tab-nav` | `position:sticky; top:52px; z-index:99;` 追加 |
| `.tab-nav-btn` | ボタン風デザイン（rounded, border, active時は#2c3e50背景） |
| `.complete-area` | 新CSS。旧`.bottom-bar`を置換 |
| `.complete-msg` | 漏れチェック時のエラーメッセージ表示用 |
| `.item-name` | `cursor:pointer; user-select:none;` 追加 |
| `.memo-input` | full width、旧`.memo-input-group`ラッパー削除 |
| `.section-add-btn`, `.category-add-btn` | `inline-block; border:1px dashed #ccc; color:#aaa;` 控えめ化 |
| `.inline-photo-add-btn` | 同上、控えめ化 |
| `.inline-example-thumb` | `width:28px; height:28px; border-radius:4px; object-fit:cover;` |
| `.inline-spot-actions` | `margin-left:auto;` で右端寄せ |

### 主要JavaScript変更ポイント

| 関数/機能 | 変更 |
|-----------|------|
| `window.onload` | `btnCheckMissing` リスナー削除、`memoBtn` リスナー削除 |
| 新: 項目名タッチ | `checklistContainer` にイベント委譲で `.item-name` クリック時にチェック切替 |
| 新: メモ自動保存 | `memoInput` の `input` イベントで1.5秒デバウンス、`keydown` Enter で即時保存 |
| `completeChecklist()` | 漏れチェック統合。未チェック項目＋未撮影箇所を検出→ `highlightMissing()` →赤ハイライト＋件数表示→確認ダイアログ |
| `toggleMissingCheck()` | **削除**（もう使わない） |
| `missingCheckActive` | **削除**（各所の `if (missingCheckActive)` も削除） |
| `updateProgress()` | `btnComplete.disabled` の設定を削除（常にクリック可能） |
| `renderChecklist()` | 見本写真を`<img class="inline-example-thumb">`で表示。レイアウト順序変更。階層ボタン追加 |
| `renderPhotoSection()` | 撮影タブ内でも見本サムネイル表示+edit/deleteを右端配置 |
| 新: `addSubCategoryPrompt()` | 親カテゴリを受け取り、`親：子` 形式で新サブカテゴリ追加 |
| `addCategoryPrompt()` | プロンプト文言から「サブカテゴリの場合は…」の説明を削除（専用ボタンがあるため） |
| 新: `toggleCategorySections()` | 子カテゴリの全展開/全折りたたみをトグル |
| 新: `renameCategoryPrompt()` | プロンプトでカテゴリ名を変更、GAS `renameCategoryInMaster()` を呼び出し |
| 新: `deleteCategoryPrompt()` | カテゴリ削除（中身も削除 or 親に移動を選択）、GAS `deleteCategoryFromMaster()` を呼び出し |
| 新: `reloadChecklist()` | データ再取得＋再描画のヘルパー |

---

## 7. 未完了タスク・今後の調査事項

### 要テスト（デプロイ後）

1. **清掃ステータスマーク修正の確認**
   - スタッフ確定後にカレンダーのステータスドットが即座に赤→緑に変わるか
   - 特に「スタッフ一覧にない名前を手入力で指定」した場合のフロー
   - `applyConfirmOptimistic()` で楽観的キャッシュ更新を実装済み（4回の修正を経た最終版）
   - **根本原因**: 清掃イベント初回表示時にauto-createされた募集エントリが `window._recruitFullMap` に未反映だった。`bookingRowNumber` でフォールバック作成する処理を追加

2. **チェックリスト新機能の動作確認**
   - 全展開/全折りたたみボタンの動作
   - カテゴリ名変更（✎ボタン）の動作
   - カテゴリ削除（✕ボタン）の動作：中身削除 or 親に移動

### 調査が必要

3. **2026/2/23 日付背景の黄色問題**
   - メインアプリで2/23のセルが黄色背景のまま残る
   - 「西山PCテスト」スタッフの▲回答が削除後も残存
   - **推定原因**: スプレッドシートの募集・立候補データにゴミが残っている可能性

### 見本写真の日付非依存化（要確認）

4. **見本写真は全日付で共通であるべき**
   - `spot.exampleFileId` はマスタデータに保存されており、既に日付非依存のはず
   - ただしユーザーの実環境でテストして確認が必要

### 将来の課題

5. **条件分岐対応**: BBQ利用あり/なし、宿泊人数による表示切替
6. **在庫管理リスト機能**
7. **リネン洗濯フロー管理**

---

## 8. アーキテクチャ詳細

### チェックリストアプリのデータフロー

```
[checklist.html]
    ↓ callGAS('getChecklistForDate', [date])
[checklist-app/Code.gs]
    ↓ getChecklistForDate()
[Google Sheets]
    ├── チェックリストマスタ → items（チェック項目定義）
    ├── 撮影箇所マスタ → spots（撮影箇所 + exampleFileId）
    ├── チェックリスト記録 → checked（日付別チェック状態）
    ├── チェックリスト写真 → photos（日付別撮影写真）
    └── チェックリストメモ → memos（日付別メモ）
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
  └── example/   ← 見本写真（日付非依存）
```
- サムネイルURL: `https://drive.google.com/thumbnail?id={fileId}&sz=w{size}`
- `sz=w56` でインラインサムネイル、`sz=w800` でモーダル表示

### 60秒ポーリングリフレッシュ
- `setInterval` で60秒ごとにデータ再取得
- 折りたたみ状態 (`saveCollapseState/restoreCollapseState`) とタブ状態を保持
- 2人同時利用に対応

---

## 9. デプロイの仕組み

### deploy-all.js の処理フロー
1. メインアプリ: `node deploy.js` でpush + deploy（オーナー用 → スタッフ用の2回デプロイ）
2. チェックリスト: `node deploy-checklist.js` でpush + deploy

### デプロイID管理（重要）
- `deploy-config.json` にオーナー用・スタッフ用・チェックリスト用のデプロイIDを永続保存
- **このファイルは `.gitignore` でgit追跡から除外済み**
- deploy.js / deploy-checklist.js は3段階でデプロイIDを探す:
  1. `deploy-config.json` の保存済みID → 既存デプロイを更新（URL変更なし）
  2. `clasp deployments` の出力から説明文で検索（フォールバック）
  3. 新規作成（最終手段。URLが変わる）

### メインアプリの2つのデプロイ
- **オーナー用**: `executeAs: USER_DEPLOYING` + `access: ANYONE_ANONYMOUS`
- **スタッフ用**: `executeAs: USER_DEPLOYING` + `access: ANYONE`

---

## 10. 重要な技術的制約

### GAS グローバルスコープの罠
- GASプロジェクト内の全 `.gs` ファイルは同一グローバルスコープを共有
- `const SHEET_NAME = '...'` を2つのファイルで宣言すると **SyntaxError**
- **対策**: `.claspignore` で除外 + チェックリストは `CL_` 接頭辞

### チェックリストアプリの変数名ルール
- `SHEET_NAME` → `CL_BOOKING_SHEET`
- `SHEET_OWNER` → `CL_OWNER_SHEET`
- `SHEET_STAFF` → `CL_STAFF_SHEET`

### GASバージョン上限
- 最大200個。deploy.jsは150超で警告。古いバージョンはGASエディタUIから手動削除。

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

---

## 13. ユーザーの要望原文（参考）

以下はユーザーが出した改善要望の原文（完了済みのものも含む）:

### メインアプリ
- 「清掃の凡例の表示を変更。"日付背景-募集中" を "赤丸" の凡例に統合」→ **完了**
- 「2/23の日付の背景が黄色のまま」→ **未調査**（スプレッドシートのデータ問題の可能性）
- 「オーナー宿泊詳細画面に宿泊人数の編集機能を追加」→ **完了**
- 「清掃スタッフ確定後にカレンダーのステータスマークが即座に変わるように」→ **完了（要テスト）**

### チェックリストアプリ
- 「項目名をタッチしてもチェックが入るように」→ **完了**
- 「タブをボタンっぽい表示にして上部配置」→ **完了**
- 「漏れチェックを清掃完了ボタンに統合」→ **完了**
- 「メモ自動保存」→ **完了**
- 「見本写真サムネイル表示」→ **完了**
- 「編集・削除ボタンを右端に」→ **完了**
- 「追加ボタンを控えめに」→ **完了**
- 「サブカテゴリ追加ボタン」→ **完了**
- 「見本写真は全日付共通」→ **実装済み、要実環境テスト**
- 「大カテゴリと中カテゴリの見出しを差別化」→ **完了**
- 「各カテゴリに全展開/全折りたたみボタンを追加」→ **完了**
- 「カテゴリ名称変更機能」→ **完了**
- 「カテゴリ削除（中身も削除 or 親に移動）」→ **完了**

### 運用ルール
- 「変更をプッシュしたら毎回デプロイ手順を表示して」→ **ルール化済み**
- 「チャット移行時に引き継ぎ資料をまとめて」→ **ルール化済み**
