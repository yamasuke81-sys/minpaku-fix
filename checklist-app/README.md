# 清掃チェックリストアプリ - 自動デプロイ

## 📁 このディレクトリについて

このディレクトリは**チェックリストアプリ専用**です。予約管理アプリとは完全に分離されています。

## 🚀 使い方

### デプロイ（Windows）

```batch
deploy-checklist.bat
```

これだけで：
1. 最新のコードをApps Scriptにプッシュ
2. 自動的にデプロイ完了

### デプロイ後

ブラウザでチェックリストアプリを開き、**Ctrl+Shift+R**（ハードリフレッシュ）してください。

### チェックリストアプリURL

```
https://script.google.com/macros/s/AKfycbyhVlj_IiLIk0tjKUFKjDBA4SNQ4EEVpgj_0WsSBw3JVMtcclOs5XzwHUfy9x9pExK_/exec
```

## 📝 ファイル構成

- **Code.gs**: メインコード（チェックリスト機能）
- **checklist.html**: UI
- **appsscript.json**: プロジェクト設定
- **.clasp.json**: デプロイ設定（プロジェクトID: 18PILN4GA1DyQY9nkf2lV1GVxAXV95LT51vh2erWB1NZ8uNX54kVqlx3w）

## 🔧 コード編集後の手順

1. Code.gsまたはchecklist.htmlを編集
2. `deploy-checklist.bat`を実行
3. ブラウザでCtrl+Shift+R

**これだけです！**

## 🎯 予約管理アプリとの違い

| 項目 | 予約管理アプリ | チェックリストアプリ |
|------|--------------|------------------|
| ディレクトリ | `/minpaku-fix/` | `/minpaku-fix/checklist-app/` |
| メインコード | Code.gs | Code.gs（元ChecklistApp.gs） |
| デプロイバッチ | deploy-y5SdA.bat | deploy-checklist.bat |
| プロジェクトID | 1cFH0k... | 18PILN... |

## ⚠️ 重要

- 定数名の衝突を防ぐため、このディレクトリは完全に分離されています
- Code.gsには`CL_BOOKING_SHEET`等の定数を使用（`SHEET_NAME`は使用しない）
- 予約管理アプリのCode.gsとは完全に別のファイルです
