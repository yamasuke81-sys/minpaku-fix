#!/usr/bin/env node
/**
 * スタッフ操作マニュアル用 スクリーンショット撮影スクリプト
 *
 * 使い方:
 *   node staff-manual-screenshot.js
 *   node staff-manual-screenshot.js --url <URL>
 *   node staff-manual-screenshot.js --headed   (ブラウザ表示デバッグ)
 *
 * 出力先: screenshots/staff-manual/
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'screenshots', 'staff-manual');
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── CLI / deploy-config.json からURL取得 ──
function getUrl() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) return args[i + 1];
  }
  const cfgPath = path.join(__dirname, '..', 'deploy-config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const id = (cfg.ownerDeploymentId || '').trim();
    if (id) return `https://script.google.com/macros/s/${id}/exec`;
  }
  return null;
}

function isHeaded() {
  return process.argv.includes('--headed');
}

// ── GASフレーム取得 ──
function getAppFrame(page) {
  for (const f of page.frames()) {
    const name = f.name();
    if (name === 'userHtmlFrame' || name.includes('sandboxFrame')) return f;
  }
  return page.mainFrame();
}

// ── スクリーンショット保存 ──
async function take(page, id, results) {
  const filePath = path.join(OUT_DIR, `${id}.png`);
  await page.screenshot({ path: filePath });
  results.push({ id, ok: true, file: filePath });
  console.log(`    ✓ ${id}.png`);
}

// ── 要素スクリーンショット ──
async function takeElement(frame, page, selector, id, results) {
  let el = await frame.$(selector);
  if (!el) el = await page.$(selector);
  if (!el) {
    console.log(`    - ${id}: 要素が見つかりません (${selector})`);
    results.push({ id, ok: false, reason: 'not found' });
    return;
  }
  const filePath = path.join(OUT_DIR, `${id}.png`);
  await el.screenshot({ path: filePath });
  results.push({ id, ok: true, file: filePath });
  console.log(`    ✓ ${id}.png`);
}

// ── イベントクリック試行 ──
async function tryClick(frame, selector) {
  try {
    await frame.waitForSelector(selector, { timeout: 5000 });
    await frame.click(selector);
    return true;
  } catch (_) { return false; }
}

// ── モーダル待機 ──
async function waitModal(frame) {
  try {
    await frame.waitForSelector('.modal.show', { timeout: 8000 });
    await sleep(2000); // データ読み込み待ち
  } catch (_) {}
}

// ── モーダル閉じる ──
async function closeModal(frame, page) {
  try {
    await frame.click('.modal.show [data-bs-dismiss="modal"]');
  } catch (_) {
    try { await page.click('.modal.show [data-bs-dismiss="modal"]'); } catch (__) {}
  }
  await sleep(800);
}

// ════════════════════════════════════════════════════════════
//  メイン処理
// ════════════════════════════════════════════════════════════
async function main() {
  const url = getUrl();
  if (!url) {
    console.error('エラー: URLが必要です。');
    console.error('  --url <URL> を指定するか、../deploy-config.json を確認してください。');
    process.exit(1);
  }

  console.log('\n📸 スタッフマニュアル用スクリーンショット撮影\n');
  console.log(`  URL : ${url}`);
  console.log(`  出力: ${OUT_DIR}\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: isHeaded() ? false : 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security',
           '--disable-features=IsolateOrigins,site-per-process'],
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.setUserAgent(UA);

  const staffUrl = url + (url.includes('?') ? '&' : '?') + 'staff=1';
  const results = [];

  // ── ページ読み込み ──
  console.log('  ページ読み込み中...');
  await page.goto(staffUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  // GAS中間ページ処理
  try {
    const advBtn = await page.$('#details-button, [id*="proceed"], a[href*="continue"]');
    if (advBtn) {
      await advBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    }
  } catch (_) {}

  const frame = getAppFrame(page);
  await sleep(4000);

  // ════════════════════════════════════════════════════════
  // 1. スタッフ選択オーバーレイ
  // ════════════════════════════════════════════════════════
  console.log('  [1/8] スタッフ選択オーバーレイ...');
  try {
    await frame.waitForFunction(() => {
      const el = document.getElementById('staffSelectOverlay');
      return el && getComputedStyle(el).display !== 'none';
    }, { timeout: 10000 });
    await sleep(500);
    await take(page, 'staff-select', results);
  } catch (e) {
    console.log('    スキップ: オーバーレイが表示されませんでした');
  }

  // ── スタッフ選択実行 ──
  console.log('  スタッフを選択中...');
  try {
    // ドロップダウンにオプションが読み込まれるまで待機
    await frame.waitForFunction(() => {
      const sel = document.getElementById('staffSelectModalSelect');
      return sel && sel.options.length > 1;
    }, { timeout: 20000 });

    await frame.evaluate(() => {
      const sel = document.getElementById('staffSelectModalSelect');
      sel.selectedIndex = 1;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(500);
    await frame.click('#staffSelectModalConfirm');
    await sleep(3000);
  } catch (e) {
    console.log('    警告: スタッフ選択失敗 - ' + e.message);
  }

  // FullCalendar 待機
  try {
    await frame.waitForSelector('.fc-daygrid-body, .fc-view-harness, #calendar', { timeout: 15000 });
    await sleep(2000);
  } catch (_) {
    console.log('    警告: カレンダーが見つかりません');
  }

  // ════════════════════════════════════════════════════════
  // 2. カレンダー画面
  // ════════════════════════════════════════════════════════
  console.log('  [2/8] カレンダー画面...');
  await take(page, 'calendar', results);

  // ════════════════════════════════════════════════════════
  // 3. 宿泊詳細モーダル
  // ════════════════════════════════════════════════════════
  console.log('  [3/8] 宿泊詳細モーダル...');
  if (await tryClick(frame, '.fc-event-booking')) {
    await waitModal(frame);
    await take(page, 'booking-detail', results);
    await closeModal(frame, page);
  } else {
    console.log('    スキップ: 予約イベントが見つかりません（カレンダーに予約がない月です）');
  }

  // ════════════════════════════════════════════════════════
  // 4. 清掃詳細モーダル（全体）
  // ════════════════════════════════════════════════════════
  console.log('  [4/8] 清掃詳細モーダル...');
  if (await tryClick(frame, '.fc-event-cleaning')) {
    await waitModal(frame);
    // 清掃データ（ランドリー・募集状況）の読み込みを待つ
    await sleep(3000);
    await take(page, 'cleaning-detail', results);

    // ════════════════════════════════════════════════════════
    // 5. 回答ボタン部分（要素スクリーンショット）
    // ════════════════════════════════════════════════════════
    console.log('  [5/8] 回答ボタン...');
    // 回答ボタンはフッター or ボディ内のどちらかにある
    await takeElement(frame, page,
      '#eventModalVolunteerCenter, #eventModalVolunteerBodyArea',
      'response-buttons', results);

    // ════════════════════════════════════════════════════════
    // 6. チェックリストボタン（ヘッダー部分）
    // ════════════════════════════════════════════════════════
    console.log('  [6/8] チェックリストボタン...');
    await takeElement(frame, page,
      '#checklistBtnHeaderArea',
      'checklist-btn', results);

    // ════════════════════════════════════════════════════════
    // 7. クリーニング状況カード
    // ════════════════════════════════════════════════════════
    console.log('  [7/8] クリーニング状況...');
    // モーダル本体を下までスクロール
    await frame.evaluate(() => {
      const body = document.querySelector('#eventModal .modal-body');
      if (body) body.scrollTop = body.scrollHeight;
    });
    await sleep(500);
    await takeElement(frame, page,
      '#laundryCardArea',
      'laundry-card', results);

    // ════════════════════════════════════════════════════════
    // 8. 清掃詳細モーダル（スクロール後）
    // ════════════════════════════════════════════════════════
    console.log('  [8/8] 清掃詳細モーダル（下部）...');
    await take(page, 'cleaning-detail-bottom', results);

    await closeModal(frame, page);
  } else {
    console.log('    スキップ: 清掃イベントが見つかりません（カレンダーに清掃がない月です）');
  }

  await browser.close();

  // ── 結果レポート ──
  const resultPath = path.join(OUT_DIR, 'result.json');
  fs.writeFileSync(resultPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    results,
  }, null, 2));

  const ok = results.filter(r => r.ok).length;
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n── 結果 ──`);
  console.log(`  成功: ${ok}  スキップ: ${ng}  合計: ${results.length}`);
  console.log(`  出力先: ${OUT_DIR}\n`);

  if (ok === 0) {
    console.log('  ⚠ スクリーンショットが1枚も撮れませんでした。');
    console.log('    カレンダーに予約・清掃が表示される月で再実行してください。\n');
  }
}

main().catch(err => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
