# PDF Rename Tool - GitHub Actions 自動デプロイ設定

## 初回セットアップ（1回だけ）

### 1. clasp のログイン情報を取得

ローカルPCで以下を実行:

```bash
npx @google/clasp login
```

ブラウザでGoogleアカウント認証後、以下のファイルが作成される:
- Windows: `C:\Users\<ユーザー名>\.clasprc.json`
- Mac/Linux: `~/.clasprc.json`

### 2. GitHub Secrets に登録

1. https://github.com/yamasuke81-sys/minpaku-fix/settings/secrets/actions を開く
2. 「New repository secret」をクリック
3. 以下を入力:
   - **Name**: `CLASP_CREDENTIALS`
   - **Value**: `.clasprc.json` の中身を丸ごとコピペ
4. 「Add secret」をクリック

### 3. 完了

これ以降、`pdf-rename-tool/` 内のファイルをpush（またはPRをmerge）すると、自動でGASにデプロイされます。

## 動作の仕組み

```
git push (pdf-rename-tool/ に変更あり)
  ↓
GitHub Actions がトリガー
  ↓
clasp push --force (コードをGASに反映)
  ↓
clasp deploy (Web Appを更新)
```
