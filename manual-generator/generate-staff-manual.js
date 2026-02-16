#!/usr/bin/env node
/**
 * スタッフ操作マニュアル HTML 生成スクリプト
 *
 * screenshots/staff-manual/ にある PNG を base64 埋め込みで
 * 単体 HTML ファイル（staff-manual.html）を生成します。
 *
 * 使い方:
 *   node generate-staff-manual.js
 */
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'staff-manual');
const OUTPUT_PATH = path.join(__dirname, '..', 'staff-manual.html');

// ── スクリーンショットを base64 Data URI に変換 ──
function loadImage(id) {
  const filePath = path.join(SCREENSHOTS_DIR, `${id}.png`);
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// ── 画像タグ生成（存在しなければプレースホルダ） ──
function img(id, alt) {
  const src = loadImage(id);
  if (src) {
    return `<div class="screenshot"><img src="${src}" alt="${alt}" loading="lazy"></div>`;
  }
  return `<div class="screenshot placeholder"><p>⚠ スクリーンショット未撮影: ${alt}</p><p class="hint">npm run staff-screenshot を実行してください</p></div>`;
}

// ════════════════════════════════════════════════════════════
//  HTML テンプレート
// ════════════════════════════════════════════════════════════
function buildHtml() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>民泊管理システム スタッフ操作マニュアル</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans',
                 'Noto Sans JP', sans-serif;
    background: #f5f5f5; color: #222; font-size: 15px; line-height: 1.75;
  }
  /* ── Cover ── */
  .cover {
    background: linear-gradient(135deg, #1a2d4a 0%, #0d6efd 100%);
    color: #fff; text-align: center; padding: 52px 20px 48px;
  }
  .cover h1 { font-size: 1.6rem; font-weight: 800; margin-bottom: 4px; }
  .cover .sub { opacity: .85; font-size: .95rem; }
  /* ── TOC ── */
  .toc { max-width: 640px; margin: 28px auto 36px; padding: 0 16px; }
  .toc h2 { font-size: 1.1rem; border-bottom: 2px solid #0d6efd; padding-bottom: 6px; margin-bottom: 12px; }
  .toc ol { list-style: none; padding: 0; counter-reset: t; }
  .toc li { counter-increment: t; margin-bottom: 6px; }
  .toc a {
    display: flex; align-items: center; gap: 10px;
    text-decoration: none; color: #333; padding: 7px 12px; border-radius: 8px;
    font-size: .93rem; transition: background .15s;
  }
  .toc a:hover { background: #dbeafe; color: #0d6efd; }
  .toc a::before {
    content: counter(t);
    width: 26px; height: 26px; border-radius: 50%;
    background: #0d6efd; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: .78rem; flex-shrink: 0;
  }
  /* ── Section ── */
  .sec { max-width: 640px; margin: 0 auto 48px; padding: 0 16px; }
  .sec-head {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 14px; padding-bottom: 8px;
    border-bottom: 3px solid #0d6efd;
  }
  .sec-num {
    width: 38px; height: 38px; border-radius: 50%;
    background: #0d6efd; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 1.05rem; flex-shrink: 0;
  }
  .sec-head h2 { font-size: 1.15rem; font-weight: 700; }
  .sec > p, .sec > div.note { margin-bottom: 12px; }
  /* ── Steps ── */
  .steps { list-style: none; padding: 0; position: relative; }
  .steps::before {
    content: ''; position: absolute; left: 14px; top: 0; bottom: 0;
    width: 2px; background: #ddd;
  }
  .stp { position: relative; padding-left: 42px; margin-bottom: 18px; }
  .stp:last-child { margin-bottom: 0; }
  .stp-n {
    position: absolute; left: 5px; top: 2px;
    width: 20px; height: 20px; border-radius: 50%;
    background: #0d6efd; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: .65rem; z-index: 1;
  }
  .stp b { display: block; font-size: .95rem; margin-bottom: 2px; }
  .stp .desc { color: #555; font-size: .88rem; }
  /* ── Screenshot ── */
  .screenshot {
    max-width: 390px; margin: 16px auto;
    border-radius: 16px; overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,.12);
    background: #000;
  }
  .screenshot img { width: 100%; height: auto; display: block; }
  .screenshot.placeholder {
    background: #e9ecef; padding: 32px 16px; text-align: center;
    color: #6c757d; border-radius: 12px; box-shadow: none;
  }
  .screenshot.placeholder .hint { font-size: .8rem; margin-top: 4px; }
  .screenshot.element-shot {
    max-width: 360px; border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,.08);
    background: #fff;
  }
  /* ── Callout ── */
  .call {
    padding: 11px 14px; border-radius: 8px; margin: 12px 0;
    font-size: .87rem; display: flex; gap: 8px; align-items: flex-start;
  }
  .call i { flex-shrink: 0; margin-top: 2px; }
  .call-info { background: #dbeafe; color: #1e40af; border-left: 4px solid #0d6efd; }
  .call-tip  { background: #dcfce7; color: #15803d; border-left: 4px solid #198754; }
  .call-warn { background: #fef3c7; color: #92400e; border-left: 4px solid #ffc107; }
  /* ── Table ── */
  .tbl { width: 100%; border-collapse: collapse; font-size: .88rem; margin: 10px 0; }
  .tbl th, .tbl td { padding: 7px 10px; border: 1px solid #dee2e6; text-align: left; }
  .tbl thead { background: #f1f3f5; }
  /* ── Footer ── */
  .footer {
    text-align: center; padding: 28px 16px; color: #999; font-size: .82rem;
    border-top: 1px solid #ddd; margin-top: 40px;
  }
  @media print {
    body { background: #fff; }
    .screenshot { box-shadow: none; border: 1px solid #ccc; }
    .sec { break-inside: avoid; }
  }
</style>
</head>
<body>

<div class="cover">
  <h1>民泊管理システム<br>スタッフ操作マニュアル</h1>
  <p class="sub">清掃スタッフ向け 基本操作ガイド</p>
</div>

<nav class="toc">
  <h2>もくじ</h2>
  <ol>
    <li><a href="#s1">スタッフ名の選択（初回ログイン）</a></li>
    <li><a href="#s2">宿泊詳細の開き方</a></li>
    <li><a href="#s3">清掃詳細の開き方</a></li>
    <li><a href="#s4">清掃の回答方法（対応可 / 条件付 / 不可）</a></li>
    <li><a href="#s5">チェックリストの開き方</a></li>
    <li><a href="#s6">コインランドリーの報告方法</a></li>
  </ol>
</nav>

<!-- ===== 1. スタッフ名の選択 ===== -->
<div class="sec" id="s1">
  <div class="sec-head">
    <div class="sec-num">1</div>
    <h2>スタッフ名の選択（初回ログイン）</h2>
  </div>
  <p>スタッフ用URLを開くと、暗い背景の上に名前選択のダイアログが自動で表示されます。</p>

  ${img('staff-select', 'スタッフ選択オーバーレイ')}

  <ol class="steps">
    <li class="stp"><span class="stp-n">1</span>
      <b>共有されたスタッフ用URLを開く</b>
      <span class="desc">ブラウザで開くと画面が暗くなり、名前選択のダイアログが表示されます。</span>
    </li>
    <li class="stp"><span class="stp-n">2</span>
      <b>「-- 選択 --」をタップし、自分の名前を選ぶ</b>
      <span class="desc">ドロップダウンに登録されているスタッフ名が一覧表示されます。</span>
    </li>
    <li class="stp"><span class="stp-n">3</span>
      <b>「決定」ボタンをタップ</b>
      <span class="desc">ダイアログが閉じ、画面上部に自分の名前が表示されたらログイン完了です。</span>
    </li>
  </ol>

  <div class="call call-info"><i>ℹ</i>
    <div>ブラウザを閉じると選択がリセットされます。再度開いたときはもう一度名前を選択してください。</div>
  </div>
</div>

<!-- ===== 2. 宿泊詳細の開き方 ===== -->
<div class="sec" id="s2">
  <div class="sec-head">
    <div class="sec-num">2</div>
    <h2>宿泊詳細の開き方</h2>
  </div>
  <p>カレンダー上の<b>青い予約バー</b>をタップすると、宿泊の詳細情報が表示されます。</p>

  ${img('calendar', 'カレンダー画面')}

  <ol class="steps">
    <li class="stp"><span class="stp-n">1</span>
      <b>カレンダーで薄い青色の予約バーを探す</b>
      <span class="desc">「予約: ○○様」のようにゲスト名が表示されています。</span>
    </li>
    <li class="stp"><span class="stp-n">2</span>
      <b>予約バーをタップ</b>
      <span class="desc">宿泊詳細のモーダル画面が開きます。</span>
    </li>
  </ol>

  ${img('booking-detail', '宿泊詳細モーダル')}

  <p>チェックイン日時、人数、予約サイト、交通手段、BBQ有無などが確認できます。</p>

  <div class="call call-tip"><i>💡</i>
    <div>スタッフ画面では、ゲストの連絡先やパスポートなど個人情報は表示されません。</div>
  </div>
</div>

<!-- ===== 3. 清掃詳細の開き方 ===== -->
<div class="sec" id="s3">
  <div class="sec-head">
    <div class="sec-num">3</div>
    <h2>清掃詳細の開き方</h2>
  </div>
  <p>カレンダー上の<b>黄色い清掃バー</b>をタップすると、清掃の詳細情報が表示されます。</p>

  <div class="call call-info"><i>ℹ</i>
    <div>募集中の清掃がある日はカレンダーの<b>背景が黄色</b>にハイライトされます。</div>
  </div>

  <ol class="steps">
    <li class="stp"><span class="stp-n">1</span>
      <b>カレンダーで黄色い「清掃」バーをタップ</b>
      <span class="desc">チェックアウト日に配置されています。</span>
    </li>
    <li class="stp"><span class="stp-n">2</span>
      <b>清掃詳細モーダルが開く</b>
      <span class="desc">次の予約情報、募集状況、担当スタッフ、クリーニング状況などが確認できます。</span>
    </li>
  </ol>

  ${img('cleaning-detail', '清掃詳細モーダル（上部）')}
  ${img('cleaning-detail-bottom', '清掃詳細モーダル（下部）')}
</div>

<!-- ===== 4. 清掃の回答方法 ===== -->
<div class="sec" id="s4">
  <div class="sec-head">
    <div class="sec-num">4</div>
    <h2>清掃の回答方法（対応可 / 条件付 / 不可）</h2>
  </div>
  <p>清掃募集に対して、対応できるかどうかを3つのボタンから回答します。</p>

  ${img('response-buttons', '回答ボタン')}

  <ol class="steps">
    <li class="stp"><span class="stp-n">1</span>
      <b>清掃詳細画面を開く</b>
      <span class="desc">カレンダーの黄色い清掃バーをタップします（<a href="#s3">セクション3</a>参照）。</span>
    </li>
    <li class="stp"><span class="stp-n">2</span>
      <b>3つの回答ボタンから選ぶ</b>
      <span class="desc">画面に表示される3つのボタンのいずれかをタップします。</span>
    </li>
    <li class="stp"><span class="stp-n">3</span>
      <b>（条件付の場合）備考を入力</b>
      <span class="desc">「△ 条件付」を選んだ場合は、備考欄に条件を入力してください。例：「14時以降なら対応可能」</span>
    </li>
    <li class="stp"><span class="stp-n">4</span>
      <b>回答完了</b>
      <span class="desc">ボタンをタップすると即座に回答が送信されます。</span>
    </li>
  </ol>

  <table class="tbl">
    <thead><tr><th style="width:100px">ボタン</th><th>意味</th></tr></thead>
    <tbody>
      <tr><td><b style="color:#198754">● 対応可</b></td><td>問題なく対応できます</td></tr>
      <tr><td><b style="color:#d97706">▲ 条件付</b></td><td>条件次第で対応可能（備考に条件を記入）</td></tr>
      <tr><td><b style="color:#dc3545">✖ 不可</b></td><td>対応できません</td></tr>
    </tbody>
  </table>

  <div class="call call-warn"><i>⚠</i>
    <div>回答を変更したい場合は<b>「回答削除」</b>ボタンで取り消してから、改めて回答してください。</div>
  </div>
</div>

<!-- ===== 5. チェックリストの開き方 ===== -->
<div class="sec" id="s5">
  <div class="sec-head">
    <div class="sec-num">5</div>
    <h2>チェックリストの開き方</h2>
  </div>
  <p>清掃詳細モーダルのヘッダーにある黄色い「清掃チェックリスト」ボタンから開きます。</p>

  ${img('checklist-btn', 'チェックリストボタン')}

  <ol class="steps">
    <li class="stp"><span class="stp-n">1</span>
      <b>清掃詳細画面を開く</b>
      <span class="desc">カレンダーの黄色い清掃バーをタップ（<a href="#s3">セクション3</a>参照）。</span>
    </li>
    <li class="stp"><span class="stp-n">2</span>
      <b>ヘッダーの黄色い「清掃チェックリスト」ボタンをタップ</b>
      <span class="desc">モーダル上部のヘッダー内にある黄色いボタンです。</span>
    </li>
    <li class="stp"><span class="stp-n">3</span>
      <b>新しいタブでチェックリストアプリが開く</b>
      <span class="desc">清掃日とスタッフ名が自動でセットされています。</span>
    </li>
    <li class="stp"><span class="stp-n">4</span>
      <b>チェック項目を確認しながら清掃する</b>
      <span class="desc">完了した項目にチェックを付けていきます。</span>
    </li>
  </ol>

  <div class="call call-tip"><i>💡</i>
    <div>チェックリストは別タブで開くため、元の清掃詳細画面はそのまま残ります。行き来しながら作業できます。</div>
  </div>
</div>

<!-- ===== 6. コインランドリーの報告方法 ===== -->
<div class="sec" id="s6">
  <div class="sec-head">
    <div class="sec-num">6</div>
    <h2>コインランドリーの報告方法</h2>
  </div>
  <p>清掃で出たリネン類のクリーニング状況を、3つのステップで報告します。清掃詳細画面の「クリーニング状況」カードから操作します。</p>

  ${img('laundry-card', 'クリーニング状況カード')}

  <ol class="steps">
    <li class="stp"><span class="stp-n">1</span>
      <b>清掃詳細画面を開く</b>
      <span class="desc">カレンダーの黄色い清掃バーをタップ（<a href="#s3">セクション3</a>参照）。</span>
    </li>
    <li class="stp"><span class="stp-n">2</span>
      <b>「クリーニングに出した」ボタンをタップ</b>
      <span class="desc">コインランドリーにリネンを持ち込んだら押します。確認メッセージで「OK」を選ぶと、名前と日時が記録されます。</span>
    </li>
    <li class="stp"><span class="stp-n">3</span>
      <b>「受け取った」ボタンをタップ</b>
      <span class="desc">コインランドリーからリネンを受け取ったら押します。ステップ1が完了していないと押せません。</span>
    </li>
    <li class="stp"><span class="stp-n">4</span>
      <b>「施設に戻した」ボタンをタップ</b>
      <span class="desc">リネンを施設にセットし直したら押します。3つすべてに緑のチェックマークが付いたら完了です。</span>
    </li>
  </ol>

  <div class="call call-warn"><i>⚠</i>
    <div>間違ってボタンを押した場合は、各ステップ右端の<b>「取消」</b>ボタンで取り消せます。</div>
  </div>

  <div class="call call-info"><i>ℹ</i>
    <div>各ステップは<b>順番に</b>進める必要があります。前のステップが完了していないと次のボタンは表示されません。</div>
  </div>
</div>

<div class="footer">
  <p>民泊管理システム スタッフ操作マニュアル</p>
  <p style="margin-top:4px">不明点がある場合はオーナーにお問い合わせください</p>
</div>

</body>
</html>`;
}

// ════════════════════════════════════════════════════════════
//  メイン
// ════════════════════════════════════════════════════════════
function main() {
  // スクリーンショットディレクトリの存在確認
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    console.log('⚠ スクリーンショットが見つかりません。');
    console.log('  先に npm run staff-screenshot を実行してください。');
    console.log('  （スクショなしでもプレースホルダー付きHTMLを生成します）\n');
  }

  const html = buildHtml();
  fs.writeFileSync(OUTPUT_PATH, html, 'utf8');

  console.log(`✓ スタッフ操作マニュアルを生成しました: ${OUTPUT_PATH}`);

  // 埋め込み画像の統計
  const ids = [
    'staff-select', 'calendar', 'booking-detail',
    'cleaning-detail', 'cleaning-detail-bottom',
    'response-buttons', 'checklist-btn', 'laundry-card'
  ];
  const found = ids.filter(id => loadImage(id));
  console.log(`  画像: ${found.length}/${ids.length} 枚埋め込み済み`);
  if (found.length < ids.length) {
    const missing = ids.filter(id => !loadImage(id));
    console.log(`  未撮影: ${missing.join(', ')}`);
  }
  console.log();
}

main();
