# セッション記憶（2026-04-01 更新）

## 前回セッションの成果
- Firebase プロジェクト構築完了（minpaku-v2, Blaze, asia-northeast1）
- 自動デプロイ完了（GitHub Actions → Firebase Hosting）
- GitHub API直接push確立（`mcp__github__push_files`）→ ユーザーのgitコマンド不要
- スタッフ管理画面動作確認（14名表示）
- 全データ移行完了（民泊メイン24シート + PDFリネーム8シート → Firestore）
- Firestore REST APIでの自動デバッグ確立

## 現在の課題
1. migrated_* コレクションのデータが正式コレクションに未変換（staffのみ手動変換済み）
2. 募集管理・通知・請求書の170+機能が未実装

## 次にやること
1. 募集管理UI（最優先★★★）— スタッフ募集・立候補・選定・確定の全フロー
2. 通知/LINE連携（★★★）
3. 請求書/報酬（★★★）

## 開発ルール
- コード変更 → `mcp__github__push_files` でGitHub APIに直接push
- GitHub Actions が自動デプロイ（約40秒）
- Firestore REST APIでデータ検証（画面不要）
- ユーザーはブラウザで最終確認するだけ

## 既存GASコード
- `Code.js`（13,102行、280+関数）がbusiness-os/mainブランチに存在
- 募集管理34機能、通知43機能、請求書30機能を含む
- 参照して新アプリに移植する

## 重要な設定値
- Firebase プロジェクトID: `minpaku-v2`
- Hosting URL: `https://minpaku-v2.web.app`
- APIキー: `AIzaSyAtQQwLOK9iL1W7hypXHIf0D_xTaxiYRqs`
- GitHub: `yamasuke81-sys/minpaku-fix` / `business-os/main`
- スプシID（民泊メイン）: `1Kk8VZrMQoJwmNk4OZKVQ9riufiCEcVPi_xmYHHnHgCs`
