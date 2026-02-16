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

// ── GASフレーム取得（再取得可能） ──
function getAppFrame(page) {
  for (const f of page.frames()) {
    const name = f.name();
    if (name === 'userHtmlFrame' || name.includes('sandboxFrame')) return f;
  }
  return page.mainFrame();
}

// ── 条件付き待機（タイムアウトしてもエラーにならない） ──
async function waitFor(frame, fn, timeoutMs = 30000) {
  try {
    await frame.waitForFunction(fn, { timeout: timeoutMs });
    return true;
  } catch (_) { return false; }
}

// ── スクリーンショット保存 ──
async function take(page, id, results) {
  const filePath = path.join(OUT_DIR, `${id}.png`);
  await page.screenshot({ path: filePath });
  results.push({ id, ok: true, file: filePath });
  console.log(`    ✓ ${id}.png`);
}

// ── 要素スクリーンショット（中身があるか確認） ──
async function takeElement(frame, page, selectors, id, results) {
  // 複数セレクタを順番に試す
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  let el = null;

  for (const sel of selectorList) {
    // frame内で検索
    el = await frame.$(sel);
    if (el) {
      // 要素が空でないか確認（表示サイズが1px以上）
      const box = await el.boundingBox();
      if (box && box.width > 1 && box.height > 1) break;
      el = null;
    }
    // page全体で検索
    el = await page.$(sel);
    if (el) {
      const box = await el.boundingBox();
      if (box && box.width > 1 && box.height > 1) break;
      el = null;
    }
  }

  if (!el) {
    console.log(`    - ${id}: 表示可能な要素が見つかりません`);
    results.push({ id, ok: false, reason: 'not found or empty' });
    return;
  }

  const filePath = path.join(OUT_DIR, `${id}.png`);
  await el.screenshot({ path: filePath });
  results.push({ id, ok: true, file: filePath });
  console.log(`    ✓ ${id}.png`);
}

// ── モーダル閉じる ──
async function closeModal(frame, page) {
  // 閉じるボタンをクリック
  try {
    await frame.click('.modal.show [data-bs-dismiss="modal"]');
  } catch (_) {
    try { await page.click('.modal.show [data-bs-dismiss="modal"]'); } catch (__) {}
  }
  // モーダルが閉じるまで待機
  await waitFor(frame, () => !document.querySelector('.modal.show'), 5000);
  await sleep(1000);
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

  // ══════════════════════════════════════════════════════════
  // ページ読み込み
  // ══════════════════════════════════════════════════════════
  console.log('  ページ読み込み中（GASアプリは時間がかかります）...');
  await page.goto(staffUrl, { waitUntil: 'networkidle2', timeout: 90000 });

  // GAS中間ページ（「このアプリはGoogleで確認されていません」等）の処理
  try {
    const advBtn = await page.$('#details-button, [id*="proceed"], a[href*="continue"]');
    if (advBtn) {
      console.log('  GAS中間ページを通過中...');
      await advBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    }
  } catch (_) {}

  let frame = getAppFrame(page);

  // GASアプリのHTMLが読み込まれるまで十分待機
  console.log('  アプリ初期化待機中...');
  await sleep(6000);
  // フレームが変わっている可能性があるので再取得
  frame = getAppFrame(page);

  // ══════════════════════════════════════════════════════════
  // 1. スタッフ選択オーバーレイ
  // ══════════════════════════════════════════════════════════
  console.log('  [1/8] スタッフ選択オーバーレイ...');
  const overlayShown = await waitFor(frame, () => {
    const el = document.getElementById('staffSelectOverlay');
    return el && getComputedStyle(el).display !== 'none';
  }, 20000);

  if (overlayShown) {
    // ドロップダウンにスタッフ名が読み込まれるまで待機
    console.log('    スタッフリスト読み込み待機中...');
    await waitFor(frame, () => {
      const sel = document.getElementById('staffSelectModalSelect');
      return sel && sel.options.length > 1;
    }, 30000);
    await sleep(1000);
    await take(page, 'staff-select', results);
  } else {
    console.log('    スキップ: オーバーレイが表示されませんでした');
  }

  // ── スタッフ選択実行 ──
  console.log('  スタッフを選択中...');
  try {
    await frame.evaluate(() => {
      const sel = document.getElementById('staffSelectModalSelect');
      if (sel && sel.options.length > 1) {
        sel.selectedIndex = 1;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await sleep(800);
    await frame.click('#staffSelectModalConfirm');
  } catch (e) {
    console.log('    警告: スタッフ選択失敗 - ' + e.message);
  }

  // オーバーレイが閉じるまで待機
  console.log('  カレンダー読み込み待機中...');
  await waitFor(frame, () => {
    const el = document.getElementById('staffSelectOverlay');
    return !el || getComputedStyle(el).display === 'none';
  }, 15000);

  // FullCalendar のイベントが描画されるまで待機
  const hasEvents = await waitFor(frame, () => {
    return document.querySelectorAll('.fc-event').length > 0;
  }, 30000);

  if (!hasEvents) {
    console.log('  ⚠ カレンダーにイベントが見つかりません。予約・清掃がある月で再実行してください。');
  }
  // イベント描画後の安定化待ち
  await sleep(2000);

  // ══════════════════════════════════════════════════════════
  // 2. カレンダー画面
  // ══════════════════════════════════════════════════════════
  console.log('  [2/8] カレンダー画面...');
  await take(page, 'calendar', results);

  // ══════════════════════════════════════════════════════════
  // 3. 宿泊詳細モーダル
  // ══════════════════════════════════════════════════════════
  console.log('  [3/8] 宿泊詳細モーダル...');
  const hasBooking = await waitFor(frame, () => {
    return !!document.querySelector('.fc-event-booking');
  }, 5000);

  if (hasBooking) {
    await frame.click('.fc-event-booking');

    // モーダルが表示されるまで待機
    await waitFor(frame, () => !!document.querySelector('.modal.show'), 10000);

    // モーダル内のデータが読み込まれるまで待機
    // （チェックイン日時などの detail-row が表示されるまで）
    console.log('    モーダルデータ読み込み待機中...');
    await waitFor(frame, () => {
      const body = document.querySelector('#eventModalBody');
      return body && body.textContent.trim().length > 50;
    }, 15000);
    await sleep(1500);

    await take(page, 'booking-detail', results);
    await closeModal(frame, page);
  } else {
    console.log('    スキップ: 予約イベントが見つかりません');
  }

  // ══════════════════════════════════════════════════════════
  // 4. 清掃詳細モーダル
  // ══════════════════════════════════════════════════════════
  console.log('  [4/8] 清掃詳細モーダル...');
  const hasCleaning = await waitFor(frame, () => {
    return !!document.querySelector('.fc-event-cleaning');
  }, 5000);

  if (hasCleaning) {
    await frame.click('.fc-event-cleaning');

    // モーダル表示待機
    await waitFor(frame, () => !!document.querySelector('.modal.show'), 10000);

    // ── 清掃モーダルの非同期データ読み込み完了を確実に待機 ──
    // GASサーバーから getCleaningModalData を呼び出し、結果が返るまで
    // 各エリアに spinner + 「読み込み中…」が表示される。
    // 完了すると volBodyLoading 要素がDOMから削除される。
    console.log('    清掃データ読み込み待機中（最大30秒）...');

    // (1) volBodyLoading スピナーが消えるまで待機（最も確実な完了シグナル）
    const spinnerGone = await waitFor(frame, () => {
      return !document.getElementById('volBodyLoading');
    }, 30000);
    if (!spinnerGone) {
      console.log('    ⚠ 回答ボタン読み込みがタイムアウト');
    }

    // (2) 募集ステータスバッジの「読み込み中…」が消えるまで待機
    const statusLoaded = await waitFor(frame, () => {
      const el = document.getElementById('eventModalStaffRecruitStatus');
      return el && !el.textContent.includes('読み込み中');
    }, 15000);
    if (!statusLoaded) {
      console.log('    ⚠ 募集ステータス読み込みがタイムアウト');
    }

    // (3) ランドリーカードのデータ読み込み待機
    const laundryLoaded = await waitFor(frame, () => {
      const el = document.getElementById('laundryCardArea');
      return el && !el.textContent.includes('読み込み中');
    }, 15000);
    if (!laundryLoaded) {
      console.log('    ⚠ ランドリーカード読み込みがタイムアウト');
    }

    // (4) 次回予約情報の読み込み待機
    await waitFor(frame, () => {
      const el = document.getElementById('nextResHeaderStatus');
      return !el || !el.textContent.includes('読み込み中');
    }, 10000);

    // 全データ到着後、描画の安定化を待つ
    await sleep(3000);
    console.log('    データ読み込み完了');

    await take(page, 'cleaning-detail', results);

    // ══════════════════════════════════════════════════════════
    // 5. 回答ボタン部分
    // ══════════════════════════════════════════════════════════
    console.log('  [5/8] 回答ボタン...');
    // 回答ボタン（対応可/条件付/不可）が描画されるまで待機
    await waitFor(frame, () => {
      const area = document.getElementById('eventModalVolunteerBodyArea');
      if (area && area.querySelector('button')) return true;
      const center = document.getElementById('eventModalVolunteerCenter');
      return center && center.querySelector('button');
    }, 10000);
    await sleep(500);
    await takeElement(frame, page, [
      '#eventModalVolunteerBodyArea',
      '#eventModalVolunteerCenter',
    ], 'response-buttons', results);

    // ══════════════════════════════════════════════════════════
    // 6. チェックリストボタン（ヘッダー部分）
    // ══════════════════════════════════════════════════════════
    console.log('  [6/8] チェックリストボタン...');
    // ヘッダー全体を撮影（ボタンが小さいため）
    await takeElement(frame, page, [
      '#checklistBtnHeaderArea',
      '#eventModalHeader',
    ], 'checklist-btn', results);

    // ══════════════════════════════════════════════════════════
    // 7. クリーニング状況カード
    // ══════════════════════════════════════════════════════════
    console.log('  [7/8] クリーニング状況...');
    // モーダルを下までスクロールしてランドリーカードを見える位置にする
    await frame.evaluate(() => {
      const body = document.querySelector('#eventModal .modal-body');
      if (body) body.scrollTop = body.scrollHeight;
    });
    await sleep(800);
    await takeElement(frame, page, [
      '#laundryCardArea',
    ], 'laundry-card', results);

    // ══════════════════════════════════════════════════════════
    // 8. 清掃詳細モーダル（スクロール後）
    // ══════════════════════════════════════════════════════════
    console.log('  [8/8] 清掃詳細モーダル（下部）...');
    await take(page, 'cleaning-detail-bottom', results);

    await closeModal(frame, page);
  } else {
    console.log('    スキップ: 清掃イベントが見つかりません');
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
