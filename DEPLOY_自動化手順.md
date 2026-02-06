# デプロイ自動化の整理

## やりたいこと（自動化の流れ）

1. **Cursor** で Code.gs や index.html を修正して保存する
2. **deploy-minpaku.bat** をダブルクリックしてデプロイする
3. **いつものオーナー用・スタッフ用のURL** を開いてページを更新（F5）する
4. → 変更内容が反映された画面が表示される（URLは変わらない）

この流れが、バッチファイル＋npm run deploy で自動化されています。

---

## いちばん簡単なやり方（バッチファイル）

- **NotifyInbox** フォルダにある **`deploy-minpaku.bat`** をダブルクリックするだけです。
- コマンドプロンプトが開き、自動でデプロイが実行されます。
- Node.js のインストールと、初回の `npx clasp login` が済んでいればそのまま使えます。

**うまく動かないとき**: minpaku-gas-app フォルダの **`setup-check.bat`** を実行すると、Node.js や設定ファイルの有無を確認できます。

---

## 重要なポイント

- **URLは変わりません**  
  `deploy-config.json` に登録したオーナー用・スタッフ用の**デプロイID**を使って既存のデプロイを更新するため、同じURLのままです。

- **実行するコマンドは1つ**  
  `minpaku-gas-app` フォルダで `npm run deploy` を実行するだけで、以下が自動で行われます。

---

## 自動デプロイで行われること

| 順番 | 内容 |
|------|------|
| 1 | ローカルのコード（Code.gs, index.html）を GAS にアップロード |
| 2 | オーナー用デプロイを更新（同じURLのまま） |
| 3 | スタッフ用デプロイを更新（同じURLのまま） |
| 4 | スタッフ用URLをオーナー画面の設定に自動反映（オーナー用デプロイのアクセスが「全員」の場合） |

---

## 初回セットアップ（1回だけ）

Node.js はインストール済みとのことなので、以下を行います。

### 1. clasp で Google にログイン

```powershell
cd c:\Users\yamas\AndroidStudioProjects\NotifyInbox\minpaku-gas-app
npx clasp login
```

- ブラウザが開くので、民泊アプリを管理している Google アカウントでログイン
- 「認証が完了しました」と出たら OK（一度ログインすれば通常は再実行不要）

### 2. 設定ファイルの確認

次のファイルが正しく設定されているか確認します。

| ファイル | 確認内容 |
|----------|----------|
| `.clasp.json` | `scriptId` に Apps Script のスクリプトIDが入っている |
| `deploy-config.json` | `ownerDeploymentId` と `staffDeploymentId` が入っている |

※ 現在の `deploy-config.json` には ID が設定済みです。

---

## コードを更新したときの手順

### 方法A: バッチファイルで実行（いちばん簡単）

1. エクスプローラーで次のどちらかを**ダブルクリック**します。
   - **NotifyInbox フォルダ内**の `deploy-minpaku.bat`
   - **minpaku-gas-app フォルダ内**の `deploy.bat`
2. コマンドプロンプトが開き、自動でデプロイが実行されます。
3. 終了したら「続行するには何かキーを押してください」でウィンドウを閉じてください。

※ Node.js がインストールされ、初回に `npx clasp login` を済ませておく必要があります。

### 方法B: コマンドプロンプトで実行

**minpaku-gas-app フォルダ**で次のコマンドを実行します。

```cmd
cd c:\Users\yamas\AndroidStudioProjects\NotifyInbox\minpaku-gas-app
npm run deploy
```

以上です。コードのアップロードからデプロイ更新まで自動で行われます。

---

## URL について

| デプロイ | URL形式 | 備考 |
|----------|---------|------|
| オーナー用 | `https://script.google.com/macros/s/{ownerDeploymentId}/exec` | deploy-config.json の ID で更新するため変更されない |
| スタッフ用 | `https://script.google.com/macros/s/{staffDeploymentId}/exec?staff=1` | 同上。末尾の `?staff=1` は必須 |

`clasp deploy --deploymentId "xxx"` は**既存デプロイの更新**なので、「新しいデプロイ」を作成しません。そのため、URL は変わりません。

---

## トラブルシューティング

### `npm` が見つからない / `package.json` がない

- カレントディレクトリが `minpaku-gas-app` になっているか確認
- `cd minpaku-gas-app` で移動してから実行

### clasp の認証エラー

- `npx clasp login` を再度実行して再ログイン

### スタッフURLがオーナー画面に自動反映されない

- オーナー用デプロイの「アクセスできるユーザー」が **「全員」** になっているか確認
- 反映されなくてもデプロイ自体は成功しているため、スタッフ用URLを手動でコピーして設定タブに貼り付けてください

### デプロイが「アーカイブ済み」になる

- `npm run deploy:push` でプッシュのみ実行し、デプロイ更新をスキップ
- Apps Script の「デプロイを管理」から、既存デプロイの「編集」→ バージョン「Head」→ デプロイ、で手動更新

---

## コマンド早見表

| コマンド | 説明 |
|----------|------|
| `npm run deploy` | プッシュ ＋ オーナー・スタッフ両方のデプロイ更新（推奨） |
| `npm run deploy:push` | プッシュのみ（デプロイ更新はスキップ） |
| `npm run push` | clasp push のみ |
| `npx clasp login` | clasp で Google にログイン |
| `npx clasp open` | ブラウザで Apps Script を開く |
