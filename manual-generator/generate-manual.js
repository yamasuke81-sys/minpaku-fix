#!/usr/bin/env node
/**
 * スクリーンショットからHTMLマニュアルを自動生成
 *
 * 使い方:
 *   npm run generate
 *
 * screenshot.js で撮影した画像を screenshots/ から読み込み、
 * screens.json の定義に基づいて1ファイルのHTMLマニュアルを生成します。
 * 画像は Base64 埋め込みなので、HTMLファイル単体で完結します。
 */

const path = require('path');
const fs = require('fs');

const screensConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'screens.json'), 'utf8'));
const screenshotsDir = path.join(__dirname, 'screenshots');
const outputPath = path.join(__dirname, 'manual.html');

function toBase64(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml() {
  const screens = screensConfig.screens;
  const ownerScreens = screens.filter(s => s.mode === 'owner');
  const staffScreens = screens.filter(s => s.mode === 'staff');
  const now = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  // 結果ファイルの読み込み（成功/失敗の判定用）
  const resultPath = path.join(screenshotsDir, 'result.json');
  let resultMap = {};
  if (fs.existsSync(resultPath)) {
    const data = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    for (const r of data.results) {
      resultMap[r.id] = r;
    }
  }

  let tocOwner = '';
  let tocStaff = '';
  let contentOwner = '';
  let contentStaff = '';
  let sectionNum = 0;

  // ── オーナー画面セクション ──
  for (const screen of ownerScreens) {
    sectionNum++;
    const imgPath = path.join(screenshotsDir, `${screen.id}.png`);
    const base64 = toBase64(imgPath);
    const hasImage = base64 !== null;
    const result = resultMap[screen.id];

    tocOwner += `<li><a href="#${screen.id}">${sectionNum}. ${escapeHtml(screen.title)}</a></li>\n`;

    contentOwner += `
    <section class="screen-section" id="${screen.id}">
      <h3>${sectionNum}. ${escapeHtml(screen.title)}</h3>
      <p class="description">${escapeHtml(screen.description)}</p>
      <div class="screenshot-wrapper">
        ${hasImage
          ? `<img src="${base64}" alt="${escapeHtml(screen.title)}" loading="lazy">`
          : `<div class="no-image">スクリーンショット未撮影${result && !result.success ? `<br><small>エラー: ${escapeHtml(result.error)}</small>` : ''}</div>`
        }
      </div>
    </section>`;
  }

  // ── スタッフ画面セクション ──
  for (const screen of staffScreens) {
    sectionNum++;
    const imgPath = path.join(screenshotsDir, `${screen.id}.png`);
    const base64 = toBase64(imgPath);
    const hasImage = base64 !== null;
    const result = resultMap[screen.id];

    tocStaff += `<li><a href="#${screen.id}">${sectionNum}. ${escapeHtml(screen.title)}</a></li>\n`;

    contentStaff += `
    <section class="screen-section" id="${screen.id}">
      <h3>${sectionNum}. ${escapeHtml(screen.title)}</h3>
      <p class="description">${escapeHtml(screen.description)}</p>
      <div class="screenshot-wrapper">
        ${hasImage
          ? `<img src="${base64}" alt="${escapeHtml(screen.title)}" loading="lazy">`
          : `<div class="no-image">スクリーンショット未撮影${result && !result.success ? `<br><small>エラー: ${escapeHtml(result.error)}</small>` : ''}</div>`
        }
      </div>
    </section>`;
  }

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>民泊予約・清掃管理アプリ 操作マニュアル</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
      line-height: 1.7;
      color: #333;
      background: #f8f9fa;
      padding: 0;
    }
    .header {
      background: linear-gradient(135deg, #0d6efd, #198754);
      color: #fff;
      padding: 2rem 1.5rem;
      text-align: center;
    }
    .header h1 { font-size: 1.6rem; margin-bottom: 0.3rem; }
    .header .subtitle { font-size: 0.9rem; opacity: 0.9; }
    .header .date { font-size: 0.8rem; opacity: 0.7; margin-top: 0.5rem; }
    .container { max-width: 480px; margin: 0 auto; padding: 1rem; }
    .toc {
      background: #fff;
      border-radius: 12px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .toc h2 { font-size: 1rem; color: #0d6efd; margin-bottom: 0.8rem; border-bottom: 2px solid #0d6efd; padding-bottom: 0.3rem; }
    .toc h4 { font-size: 0.85rem; color: #495057; margin: 0.8rem 0 0.3rem; }
    .toc ul { list-style: none; padding-left: 0; }
    .toc li { padding: 0.2rem 0; }
    .toc a { color: #0d6efd; text-decoration: none; font-size: 0.85rem; }
    .toc a:hover { text-decoration: underline; }
    .mode-label {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: bold;
      color: #fff;
      padding: 0.2rem 0.6rem;
      border-radius: 20px;
      margin: 1.5rem 0 0.5rem;
    }
    .mode-owner { background: #0d6efd; }
    .mode-staff { background: #198754; }
    .screen-section {
      background: #fff;
      border-radius: 12px;
      padding: 1.2rem;
      margin-bottom: 1.2rem;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .screen-section h3 {
      font-size: 1rem;
      color: #212529;
      margin-bottom: 0.5rem;
      padding-bottom: 0.3rem;
      border-bottom: 1px solid #e9ecef;
    }
    .description {
      font-size: 0.85rem;
      color: #6c757d;
      margin-bottom: 0.8rem;
    }
    .screenshot-wrapper {
      text-align: center;
    }
    .screenshot-wrapper img {
      max-width: 100%;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .no-image {
      background: #f1f3f5;
      color: #adb5bd;
      padding: 3rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      border: 2px dashed #dee2e6;
    }
    .footer {
      text-align: center;
      padding: 2rem 1rem;
      font-size: 0.75rem;
      color: #adb5bd;
    }
    @media print {
      .screen-section { break-inside: avoid; }
      .header { background: #333 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>民泊予約・清掃管理アプリ</h1>
    <div class="subtitle">操作マニュアル</div>
    <div class="date">作成日: ${now}</div>
  </div>
  <div class="container">
    <div class="toc">
      <h2>目次</h2>
      <h4><span class="mode-label mode-owner">オーナー画面</span></h4>
      <ul>${tocOwner}</ul>
      <h4><span class="mode-label mode-staff">スタッフ画面</span></h4>
      <ul>${tocStaff}</ul>
    </div>

    <span class="mode-label mode-owner">オーナー画面</span>
    ${contentOwner}

    <span class="mode-label mode-staff">スタッフ画面</span>
    ${contentStaff}
  </div>
  <div class="footer">
    自動生成マニュアル | ${now}
  </div>
</body>
</html>`;
}

// ─── メイン ──────────────────────────────────────────
function main() {
  console.log('\n📄 HTMLマニュアル生成\n');

  const html = buildHtml();
  fs.writeFileSync(outputPath, html, 'utf8');

  const sizeKB = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
  const imageCount = (html.match(/data:image\/png;base64/g) || []).length;

  console.log(`  出力: ${outputPath}`);
  console.log(`  サイズ: ${sizeKB} KB`);
  console.log(`  埋め込み画像数: ${imageCount}`);
  console.log(`  画面数: ${screensConfig.screens.length}\n`);

  // 画像なしの場合は注意表示
  if (imageCount === 0) {
    console.log('  ⚠  画像が見つかりません。先に npm run screenshot を実行してください。');
    console.log('     画像なしでもHTMLの枠組みは生成されています。\n');
  }
}

main();
