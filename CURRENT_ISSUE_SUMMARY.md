# SHEET_NAME重複エラー：根本原因と修正手順

## エラー内容
```
SyntaxError: Identifier 'SHEET_NAME' has already been declared (行 1、ファイル『Code』)
```
チェックリストアプリ（プロジェクトID: `18PILN4GA1DyQY9nkf2lV1GVxAXV95LT51vh2erWB1NZ8uNX54kVqlx3w`）のURL:
https://script.google.com/macros/s/AKfycbyhVlj_IiLIk0tjKUFKjDBA4SNQ4EEVpgj_0WsSBw3JVMtcclOs5XzwHUfy9x9pExK_/exec

## 根本原因

**GASのデプロイが古いバージョンのコードを参照している。**

GASのウェブアプリは特定の「バージョン番号」にピン留めされます。エディタでコードを編集・保存しても、デプロイが参照しているバージョンは変わりません。

### 経緯
1. チェックリストアプリのGASプロジェクトに、`Code.gs`（予約管理のコード、`const SHEET_NAME`を含む）と`ChecklistApp.gs`（`const SHEET_NAME`を含む）が両方存在した
2. 同じ`const`が2つのファイルで宣言され、GASは全`.gs`ファイルを同一スコープで実行するためSyntaxError発生
3. gitでは定数名を`CL_BOOKING_SHEET`等に変更済み（コミット `d742fd5`）
4. **しかし、GASプロジェクトへのデプロイ（`clasp push` + バージョン更新）が実行されていない**

## 修正手順

### 手順1: Apps Scriptエディタで確認・修正

1. ブラウザでチェックリストアプリのエディタを開く:
   https://script.google.com/home/projects/18PILN4GA1DyQY9nkf2lV1GVxAXV95LT51vh2erWB1NZ8uNX54kVqlx3w/edit

2. **全ファイル一覧を確認** — 以下のファイルだけが存在すべき:
   - `Code.gs` — チェックリスト機能のコード（`CL_BOOKING_SHEET`を使用、`SHEET_NAME`は不可）
   - `checklist.html` — チェックリストUI
   - `appsscript.json` — マニフェスト

3. **不要なファイルがあれば削除**:
   - `無題.gs`（Untitled.gs）→ 削除
   - 予約管理アプリの`Code.gs`が混入している場合 → 内容をチェックリスト用に置換

4. `Code.gs`を開いて `SHEET_NAME` を検索（Ctrl+F）:
   - 見つかった場合 → `checklist-app/Code.gs`の内容で完全に置換
   - 見つからない場合 → 次の手順へ

### 手順2: デプロイを最新バージョンに更新（これが最も重要）

1. エディタ上部の「デプロイ」→「デプロイを管理」をクリック
2. 既存のデプロイの右側にある「編集」（鉛筆アイコン）をクリック
3. **「バージョン」を「新しいバージョン」に変更**
4. 「デプロイ」をクリック
5. ブラウザでチェックリストURLを開いてテスト（Ctrl+Shift+R でハードリフレッシュ）

### 手順3: claspでデプロイ（代替方法）

Windows環境のコマンドプロンプトで:
```batch
cd /d C:\Users\yamas\AndroidStudioProjects\NotifyInbox\minpaku-gas-app
git pull
cd checklist-app
npx clasp login    （初回のみ）
npx clasp push
npx clasp deploy --description "SHEET_NAME修正"
```

## コードの正しい状態

### checklist-app/Code.gs（チェックリストアプリ用）
- `const SHEET_NAME` → **存在してはいけない**
- 代わりに `const CL_BOOKING_SHEET`, `const CL_OWNER_SHEET`, `const CL_STAFF_SHEET` を使用
- `doGet()` 関数が存在すること

### Code.gs（予約管理アプリ用・ルートディレクトリ）
- `const SHEET_NAME = 'フォームの回答 1';` → これは正常（予約管理アプリで使用）
- ChecklistApp.gsは`.claspignore`で除外済み

## 確認ポイント
- [ ] チェックリストGASプロジェクトに余分なファイルがないか
- [ ] `Code.gs`に`SHEET_NAME`が含まれていないか
- [ ] デプロイが最新バージョンを参照しているか
- [ ] ブラウザでエラーなく開けるか
