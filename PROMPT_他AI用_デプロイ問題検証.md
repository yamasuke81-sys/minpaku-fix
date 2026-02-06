# 他AI向け：Google Apps Script ウェブアプリ デプロイ問題の多角的検証プロンプト

以下の問題について、**今までと違うアプローチで多角的に**検証し、原因仮説と対策案を出してください。必要なら Apps Script / clasp の公式ドキュメント・API リファレンス・GitHub Issue を参照してください。

---

## 1. 問題の要約（ユーザー主張を正確に）

- **ユーザーの主張（繰り返しのため要約）**:
  - 「**ウェブアプリで作っても、アーカイブされてしかもライブラリに変換されている**」
  - 必ず **ウェブアプリ** として作成している（ライブラリは選んでいない）
  - 手動でアーカイブ操作は **絶対にしていない**
  - 現時点で **アクティブ** に入っているデプロイも、すべて「**ライブラリ**」と表示されている

- **事象の流れ**:
  1. GAS の「デプロイを管理」で **ウェブアプリ** として新規デプロイを作成する
  2. しばらくするとそのデプロイが **アーカイブ済み** に移る
  3. アーカイブ済みの項目を開くと、種類が **「ウェブアプリ」ではなく「ライブラリ」** と表示される
  4. **ウェブアプリの URL**（`https://script.google.com/macros/s/AKfycb.../exec`）で開けず、Google Drive の「現在、ファイルを開くことができません」等のエラーになる
  5. GAS 画面に表示される URL が **ライブラリ形式**（`.../macros/library/d/<scriptId>/<version>`）になっている

- **重要な前提**: ユーザーは「ウェブアプリではなくライブラリになっているのでは？」と**何度も指摘しており**、「ウェブアプリで作っているが、結果としてアーカイブされ、かつライブラリに変換（または表示）されている」という理解で一致している。**「もしかしてライブラリでは？」という確認ではなく、その事実を前提に原因と対策を検証してほしい。**

---

## 2. 技術コンテキスト

### 2.1 プロジェクト構成

- **バックエンド**: Google Apps Script（GAS）。スプレッドシートに紐づくスクリプトプロジェクト。
- **ローカル**: Node.js + **clasp**。`clasp push` と `clasp deploy --deploymentId <ID>` を実行するカスタム deploy スクリプト（deploy.js）およびバッチ（deploy-minpaku.bat）を使用。
- **目的**: **オーナー用** と **スタッフ用** の 2 種類のウェブアプリを、**同じ URL（同じデプロイ ID）のまま** 更新し続けたい。

### 2.2 現在の deploy スクリプトの流れ

1. `clasp push` でコードを GAS にアップロード
2. **オーナー・スタッフ以外のデプロイを削除**: `clasp deployments` の出力から `AKfycb...` 形式の ID を抽出し、`deploy-config.json` に記載の 2 件以外を `clasp undeploy <ID>` で削除（20 件上限対策）
3. `clasp deploy --deploymentId "<オーナーID>" --description "オーナー用 ..."` でオーナー用を更新
4. `clasp deploy --deploymentId "<スタッフID>" --description "スタッフ用 ..."` でスタッフ用を更新
5. スタッフ用 URL をオーナー画面に反映するため、オーナー URL に `?action=setStaffUrl&url=...` を付けて GET リクエスト
6. ブラウザでオーナー・スタッフの URL を開く

※ 新規デプロイの作成は **行っていない**（既存の deploymentId で更新のみ）。

### 2.3 重要なファイル

- **deploy-config.json**: `ownerDeploymentId`, `staffDeploymentId`（いずれも `AKfycb...` 形式）
- **appsscript.json**: マニフェスト。**現在** `webapp`: `{ "access": "ANYONE", "executeAs": "USER_ACCESSING" }` を含む（過去に `webapp` がなかった時期あり）
- **.clasp.json**: `scriptId`（`1cFH0kD81gR6DC1RPBFyMJNXLI52nGYSOl6w461bkz_Byx1nE-4C0yD4w` 形式）

### 2.4 URL の種類

- **ウェブアプリ（期待）**: `https://script.google.com/macros/s/<デプロイID>/exec`（デプロイ ID は `AKfycb...`）
- **ライブラリ（問題の表示）**: `https://script.google.com/macros/library/d/<scriptId>/<version>`  
  → ユーザーが「開かない」と言っているのは、この形式の URL や、`/s/ID/exec` を開いてもエラーになる状況。

### 2.5 Apps Script API 上の「種類」の扱い（参考）

- REST API の [Deployment](https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments#Deployment) リソースでは、`entryPoints[]` の各要素に `entryPointType` がある。
- 値: `WEB_APP` / `EXECUTION_API` / `ADD_ON` 等（`ENTRY_POINT_TYPE_UNSPECIFIED` もある）。
- 「ライブラリ」が UI 上で何に対応するかは要確認（例: `EXECUTION_API` が「ライブラリ」表示に対応するか等）。API でデプロイ一覧を取得し、各デプロイの `entryPoints[].entryPointType` を確認すれば、**実体としてウェブアプリかどうか**は判定できる。

---

## 3. 多角的に検証してほしい観点（今までと違うアプローチ）

以下を、**それぞれ独立した角度**として検証し、仮説と検証方法を出してください。

### 角度 A: デプロイ「種類」が決まるタイミングと責任者

- **作成時**: GAS の「新しいデプロイ」で種類「ウェブアプリ」を選んで作成した場合、**API 上は何が記録されるか**（`entryPointType` や manifest の参照先）。
- **更新時**: `clasp deploy --deploymentId` は **既存デプロイのバージョンだけを差し替える**のか、**種類（entryPoint）を上書きしうる**のか。API の [update](https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments/update) の仕様。
- **仮説**: 最初の 1 回が「ライブラリ」として作成されていた場合、その後 clasp で更新しても種類は変わらない、等。

### 角度 B: GAS UI の「種類の選択」と実際の作成結果のずれ

- 「新しいデプロイ」で **歯車から「ウェブアプリ」を選んだ**場合でも、**実際に作成されるデプロイの entryPointType が EXECUTION_API 等になっている**可能性（UI のバグや、別の設定が優先される仕様）。
- **検証案**: 同じプロジェクトで「ウェブアプリ」として 1 件だけ新規作成し、**Apps Script API の deployments.get でそのデプロイの entryPoints を取得**し、`entryPointType` が `WEB_APP` かどうか確認する。

### 角度 C: アーカイブが起きる条件と「種類」表示への影響

- デプロイ数上限（例: 20 件）に達したとき、**GAS が自動でアーカイブする**仕様があるか。公式ドキュメントや Issue。
- アーカイブされたデプロイを UI で開いたとき、**種類が「ライブラリ」と表示される**のが仕様か、表示バグか、あるいは**アーカイブ時に実体がライブラリ相当に変わる**仕様があるか。

### 角度 D: clasp の deploy / undeploy の挙動

- **clasp deploy**（新規作成時・更新時）が、Apps Script API のどのメソッドをどう呼んでいるか。**manifest の `webapp` を参照しているか**、`manifestFileName` を指定しているか。
- **clasp undeploy** を行ったデプロイが、GAS UI 上で「アーカイブ」に移るか、完全削除になるか。また、**別のデプロイの「種類」やアーカイブ状態に影響しうるか**（例: 削除順やバージョン番号の付け方で、残ったデプロイの表示が変わる等）。

### 角度 E: appsscript.json の webapp と「種類」の関係

- マニフェストに **`webapp` が無い**状態で GAS UI から「ウェブアプリ」を選んでデプロイした場合、API 上はどう記録されるか。
- **`webapp` がある**状態で `clasp deploy`（新規）した場合、**必ず WEB_APP として作成されるか**。clasp のソースやドキュメントで、create 時に manifest をどう渡しているか。

### 角度 F: 1 プロジェクトで「オーナー用」「スタッフ用」の 2 デプロイを運用することの影響

- 同じ scriptId に対して **複数のウェブアプリデプロイ**（別 deploymentId）を持つことが、GAS の制限やアーカイブ・表示の挙動に影響するか。
- 「デプロイを 1 つにし、URL クエリ（例: `?staff=1`）で役割を切り替える」運用にした場合、**実行ユーザー（自分 / アクセスしているユーザー）の違い**をどう実現するか（1 デプロイでは「次のユーザーとして実行」は 1 種類しか選べないため）。

---

## 4. 依頼したい検証と出力

1. **原因の多角的な仮説**
   - 上記 角度 A〜F に沿って、**番号付きで**仮説を立て、根拠（ドキュメント・API・Issue）を簡潔に記載してください。
   - 特に「**ウェブアプリで作ったのにアーカイブされ、かつライブラリ表示（または変換）される**」を説明しうる仮説を優先してください。

2. **検証手順の提案**
   - **Apps Script API** で `projects.deployments.list` を実行し、各デプロイの `entryPoints[].entryPointType` を確認する手順（必要なスコープ・サンプルリクエスト含む）。
   - `clasp deployments` の生出力と、API の list 結果を突き合わせて、**どの ID が WEB_APP でどれがそうでないか**を切り分ける手順。
   - 上記で「実体は WEB_APP だが UI がライブラリと表示している」のか「実体が EXECUTION_API 等」なのかを判定する方法。

3. **対策案**
   - **短期**: すぐ試せる設定変更・手順（例: 必ず「ウェブアプリ」で新規作成した直後に API で entryPointType を確認する、appsscript.json の webapp を確認したうえで clasp push してから手動で 1 件だけデプロイする、等）。
   - **中期**: 運用変更（例: clasp では push のみにし、デプロイ・バージョンはすべて GAS 画面で手動、等）。
   - **代替**: 「ウェブアプリがアーカイブされず、ライブラリに変換されず、URL が開く」を実現する、**別のアプローチ**（別ホスティング、1 デプロイ + クエリで役割切り替えの実現方法、等）。

4. **不確実な点**
   - 仕様やドキュメントからは判断できない部分は「要確認」と明記し、必要ならユーザーや Google に確認するための質問文を提示してください。

---

## 5. 参照してほしい情報（可能なら）

- Google Apps Script: [Deployments](https://developers.google.com/apps-script/concepts/deployments), [Manifest - webapp](https://developers.google.com/apps-script/manifest/web-app-api-executable), [clasp](https://developers.google.com/apps-script/guides/clasp)
- Apps Script API: [projects.deployments](https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments)（create / get / list / update のリクエスト・レスポンス）、[Deployment リソースの entryPoints / EntryPointType](https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments#Deployment)
- clasp の GitHub: `deploy` / `undeploy` / deployments 一覧の実装、およびデプロイ作成・更新時に **manifest や種類をどう渡しているか**
- 「clasp deploy web app type」「Apps Script deployment EXECUTION_API vs WEB_APP」「deployment archived automatically」などの Issue や Q&A

---

## 6. 期待する回答形式（目安）

- **原因仮説**: 角度 A〜F に対応する形で、番号付き。根拠を簡潔に。
- **検証手順**: API や clasp の具体的なコマンド・手順をステップで。
- **対策案**: 短期・中期・代替に分け、具体的に。
- **不確実な点**: 「要確認」と、必要なら質問文を記載。

以上を踏まえ、**今までと違う角度から**原因と対策を検証し、詳細に回答してください。
