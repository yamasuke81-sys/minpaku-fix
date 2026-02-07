# 次回予約（nextReservation）のバグ検証プロンプト

以下のプロンプトを他のAIに渡してください。`[スプレッドシートURL]` の部分をあなたの実際のスプレッドシートURLに置き換えてください。

---

## プロンプトここから

```
あなたはGoogle Apps Script（GAS）のデバッグ専門家です。
民泊予約・清掃管理Webアプリの「次回予約」表示が正しく動作しない問題を調査してください。

## 環境情報

- Apps Script ID: 1cFH0kD81gR6DC1RPBFyMJNXLI52nGYSOl6w461bkz_Byx1nE-4C0yD4w
- Apps Script エディタ: https://script.google.com/home/projects/1cFH0kD81gR6DC1RPBFyMJNXLI52nGYSOl6w461bkz_Byx1nE-4C0yD4w/edit
- スプレッドシート: [スプレッドシートURL]
- オーナー用URL: https://script.google.com/macros/s/AKfycbyOhS3uLiC3JJY1fNkSNzmMdVoGcgFr-O6Unvd-aX6fNneMo6yquB8IF69z2zfKwmompg/exec
- スタッフ用URL: https://script.google.com/macros/s/AKfycbw14JV3GcHE7eduQiJHmXLDhgynEvAbDDIdob-sVYg1I08VX1ENXG3aqrgmprvhE7ZrDA/exec?staff=1

## 問題の概要

清掃詳細画面（イベントモーダル）で「次回の予約」情報が期待通りに表示されない。
「次回の予約」とは、ある予約のチェックアウト日（＝清掃日）以降にチェックインする最も近い予約のこと。

## シート構成

### 「フォームの回答 1」シート（メインデータ）
- チェックイン / Check-in 列
- チェックアウト / Check-out 列
- 氏名 / Full Name 列
- 清掃担当 列
- 宿泊人数 列
- iCal宿泊人数 列
- バーベキューセットをご利用されますか？ 列
- 国籍 列
- ベッド 列
- iCal同期 列（iCal取り込み行の識別。空でなければiCal由来）
- ※チェックイン降順でソートされている（新しい予約が上）
- ※同一チェックイン日にiCal行とフォーム回答行の重複がありうる

### 「募集」シート
- A列: チェックアウト日
- B列: 予約行番号（フォームの回答 1 の行番号）
- D列: ステータス（募集中/選定済）
- E列: 選定スタッフ

### 「スタッフ共有用」シート
- フォームシートと似た構造だが、スタッフに共有される限定データ
- ベッド数などフォームにない情報がある場合がある

## 関係する関数（Code.gs）

### 1. getNextReservationAfterCheckout_() — コア検索ロジック
```
場所: Code.gs 2567行目付近
役割: 清掃日（チェックアウト日）以降にチェックインする最初の予約を検索
引数: formSheet, colMap, currentCheckoutStr, excludeRowNumber, ss

処理フロー:
1. フォームシートの全行を読み込み
2. 除外行（今回の予約自身）のチェックイン日を取得
3. 同一チェックイン日の重複行もスキップ（iCal+フォーム重複対策）
4. チェックイン日 >= チェックアウト日 の条件で最も近い予約を検索
5. 見つからなければ「スタッフ共有用」シートをフォールバック検索
6. ベッド数が不足なら補完
```

### 2. getBookingDetailsForRecruit() — モーダル表示時に呼ばれる関数
```
場所: Code.gs 2757行目付近
役割: 募集詳細のモーダルを開いたとき、次回予約情報を取得
処理:
1. 募集シートから清掃日を取得（あれば）
2. なければフォームシートのチェックアウト日から取得
3. getNextReservationAfterCheckout_() を呼んで次回予約を返す
```

### 3. getNextReservationsForRows() — ページ読み込み時の一括取得
```
場所: Code.gs 3831行目付近
役割: カレンダー表示時に複数の予約行の次回予約を一括取得しキャッシュ
注意: getNextReservationAfterCheckout_() とは別の独自実装になっている
```

### 4. デバッグ関数
```
debugNextReservation(bookingRowNumber, recruitRowIndex)
  場所: Code.gs 2530行目付近
  役割: チェックイン日の一覧と除外行の情報を返す

getNextReservationDebug(bookingRowNumber)
  場所: Code.gs 2709行目付近
  役割: 候補一覧と実際に選ばれた次回予約を返す
```

## 既知の懸念点

1. **重複行スキップロジック**: iCal行とフォーム回答行が同じチェックイン日で存在する場合、「今回の予約」の重複行だけでなく「次回の予約」の重複行もスキップしてしまう可能性がある

2. **日付文字列の比較**: `checkInStr < currentCheckoutStr` で文字列比較しているが、日付フォーマットが `yyyy-MM-dd` でない場合に不正な結果になりうる

3. **2つの独立した検索実装**: `getNextReservationAfterCheckout_()` と `getNextReservationsForRows()` が別々の実装で、微妙にロジックが異なる可能性がある

4. **フォームシートのソート**: チェックイン降順でソートされているが、検索は線形スキャンなのでソート順は影響しないはず。ただし onEdit トリガーでソートが走るとき行番号がずれる可能性がある

5. **cleaningDate の取得元**: 募集シートのA列（チェックアウト日）とフォームシートのチェックアウト列で値が異なる可能性がある（片方が日付オブジェクト、片方が文字列）

## 検証手順

### ステップ1: 実データの確認
Apps Scriptエディタで以下を実行し、実行ログを確認してください:

```javascript
function testNextReservation() {
  // 対象の予約行番号を入れる（スプレッドシートで確認）
  var targetRow = 5;  // ← 問題がある予約の行番号に変更
  Logger.log('=== debugNextReservation ===');
  Logger.log(debugNextReservation(targetRow));
  Logger.log('=== getNextReservationDebug ===');
  Logger.log(getNextReservationDebug(targetRow));
}
```

### ステップ2: ログから確認すべきこと

1. `cleaningDate`（清掃日）は正しい yyyy-MM-dd 形式か？
2. `excludeCi`（除外するチェックイン日）は正しいか？
3. `checkIns` 配列の中に、期待する「次回予約」のチェックイン日が存在するか？
4. 各行の `parsed` フィールドが `(unparseable)` になっていないか？
5. `nextResFound` が true になるか？
6. `candidates` の中に `pass: true` の行があるか？

### ステップ3: 特に確認すべきエッジケース

- 同一チェックイン日の重複行（iCal行 + フォーム行）が正しくハンドルされているか
- 次回予約が「スタッフ共有用」シートにしかない場合に取得できるか
- 清掃日と次回チェックイン日が同日の場合（`>=` 比較）に取得できるか
- 日付が Date オブジェクトと文字列で混在している場合に正しくパースされるか

### ステップ4: 修正方針の提案

上記の調査結果をもとに、以下の形式で報告してください:

1. **原因**: なぜ次回予約が正しく表示されないのか
2. **該当コード**: 問題のある Code.gs の関数名・行番号
3. **修正案**: 具体的なコード修正の提案
4. **テスト**: 修正後に確認すべきテストケース
```

## プロンプトここまで

---

## 補足: Apps Script エディタでのデバッグ方法

1. スプレッドシートを開く → 拡張機能 → Apps Script
2. Code.gs を開く
3. 上部の関数選択ドロップダウンで `testNextReservation` を選択
4. `targetRow` を問題のある予約の行番号に変更
5. ▶ 実行ボタンをクリック
6. 「実行ログ」をクリックして結果を確認
