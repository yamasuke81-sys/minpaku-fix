#!/usr/bin/env node
/**
 * 民泊管理アプリ スクリーンショット自動撮影スクリプト
 *
 * 使い方:
 *   npm install
 *   npm run screenshot
 *
 * オプション:
 *   --url <URL>       デプロイURL（省略時は deploy-config.json から自動取得）
 *   --only <id,...>   指定した画面IDだけ撮影
 *   --headed          ブラウザを表示して実行（デバッグ用）
 *   --dark            ダークモードで撮影
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ─── 設定読み込み ────────────────────────────────────
const screensConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'screens.json'), 'utf8'));
const screenshotsDir = path.join(__dirname, 'screenshots');

// deploy-config.json からデプロイURL自動取得
function getBaseUrl() {
  const configPath = path.join(__dirname, '..', 'deploy-config.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const id = (config.ownerDeploymentId || '').trim();
  if (!id) return null;
  return `https://script.google.com/macros/s/${id}/exec`;
}

// CLI引数パース
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { url: null, only: null, headed: false, dark: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) { opts.url = args[++i]; }
    else if (args[i] === '--only' && args[i + 1]) { opts.only = args[++i].split(','); }
    else if (args[i] === '--headed') { opts.headed = true; }
    else if (args[i] === '--dark') { opts.dark = true; }
  }
  if (!opts.url) {
    opts.url = getBaseUrl();
  }
  return opts;
}

// ─── メイン処理 ──────────────────────────────────────
async function main() {
  const opts = parseArgs();

  if (!opts.url) {
    console.error('エラー: デプロイURLが見つかりません。');
    console.error('  --url オプションで指定するか、../deploy-config.json を確認してください。');
    process.exit(1);
  }

  console.log(`\n📸 民泊管理アプリ スクリーンショット撮影\n`);
  console.log(`  URL: ${opts.url}`);
  console.log(`  モード: ${opts.dark ? 'ダーク' : 'ライト'}`);
  console.log(`  出力先: ${screenshotsDir}\n`);

  // screenshots ディレクトリ作成
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: opts.headed ? false : 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  const { viewport } = screensConfig;
  const results = [];

  // 撮影対象をフィルタリング
  let screens = screensConfig.screens;
  if (opts.only) {
    screens = screens.filter(s => opts.only.includes(s.id));
  }

  // モード別にグループ化（ページ切り替え回数を最小化）
  const ownerScreens = screens.filter(s => s.mode === 'owner');
  const staffScreens = screens.filter(s => s.mode === 'staff');

  // ─── オーナー画面撮影 ─────────────────────────────
  if (ownerScreens.length > 0) {
    console.log('── オーナー画面 ──');
    const page = await browser.newPage();

    // viewport 設定
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor || 2,
    });

    // ダークモード
    if (opts.dark) {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    }

    // モバイルUA
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );

    // ページ読み込み
    console.log('  ページ読み込み中...');
    await navigateToApp(page, opts.url);

    for (const screen of ownerScreens) {
      try {
        console.log(`  撮影中: ${screen.title} (${screen.id})`);
        await executeActions(page, screen.actions);
        const filePath = path.join(screenshotsDir, `${screen.id}.png`);
        await page.screenshot({ path: filePath, fullPage: false });
        results.push({ id: screen.id, success: true, file: filePath });
        console.log(`    -> OK`);
      } catch (err) {
        console.error(`    -> エラー: ${err.message}`);
        results.push({ id: screen.id, success: false, error: err.message });
      }
    }

    await page.close();
  }

  // ─── スタッフ画面撮影 ─────────────────────────────
  if (staffScreens.length > 0) {
    console.log('\n── スタッフ画面 ──');
    const page = await browser.newPage();

    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor || 2,
    });

    if (opts.dark) {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    }

    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );

    // スタッフURLで読み込み
    const staffUrl = opts.url + (opts.url.includes('?') ? '&' : '?') + 'staff=1';
    console.log('  ページ読み込み中...');
    await navigateToApp(page, staffUrl);

    for (const screen of staffScreens) {
      try {
        console.log(`  撮影中: ${screen.title} (${screen.id})`);
        await executeActions(page, screen.actions);
        const filePath = path.join(screenshotsDir, `${screen.id}.png`);
        await page.screenshot({ path: filePath, fullPage: false });
        results.push({ id: screen.id, success: true, file: filePath });
        console.log(`    -> OK`);
      } catch (err) {
        console.error(`    -> エラー: ${err.message}`);
        results.push({ id: screen.id, success: false, error: err.message });
      }
    }

    await page.close();
  }

  await browser.close();

  // ─── 結果レポート ─────────────────────────────────
  const resultPath = path.join(screenshotsDir, 'result.json');
  fs.writeFileSync(resultPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  console.log(`\n── 結果 ──`);
  const ok = results.filter(r => r.success).length;
  const ng = results.filter(r => !r.success).length;
  console.log(`  成功: ${ok}  失敗: ${ng}  合計: ${results.length}`);
  console.log(`  結果ファイル: ${resultPath}\n`);

  if (ng > 0) {
    console.log('  失敗した画面:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`    - ${r.id}: ${r.error}`);
    });
  }
}

// ─── GASアプリへのナビゲーション ─────────────────────
async function navigateToApp(page, url) {
  // GAS web app は Google のリダイレクトを経由する場合がある
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // Google の中間ページ（「このアプリはGoogleで確認されていません」等）の処理
  try {
    // "続行" / "Advanced" / "Go to ..." ボタンがあればクリック
    const advancedBtn = await page.$('#details-button, [id*="proceed"], a[href*="continue"]');
    if (advancedBtn) {
      await advancedBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    }
  } catch (_) { /* 中間ページがなければスキップ */ }

  // GAS は iframe 内にコンテンツを表示することがある
  // メインフレームに userHtmlFrame があればそちらを使う
  const frames = page.frames();
  let appFrame = page.mainFrame();
  for (const frame of frames) {
    const name = frame.name();
    if (name === 'userHtmlFrame' || name.includes('sandboxFrame')) {
      appFrame = frame;
      break;
    }
  }

  // アプリの読み込み完了を待機（FullCalendar のレンダリング等）
  const waitMs = screensConfig.waitAfterLoad || 4000;
  await sleep(waitMs);

  // FullCalendar が表示されるまで追加待機
  try {
    await appFrame.waitForSelector('.fc-daygrid-body, .fc-view-harness, #calendar', { timeout: 15000 });
    await sleep(1000); // レンダリング完了を少し待つ
  } catch (_) {
    console.log('    (FullCalendar の検出をスキップ)');
  }
}

// ─── アクション実行 ──────────────────────────────────
async function executeActions(page, actions) {
  // GAS iframe 対応: 適切なフレームを取得
  const frames = page.frames();
  let frame = page.mainFrame();
  for (const f of frames) {
    const name = f.name();
    if (name === 'userHtmlFrame' || name.includes('sandboxFrame')) {
      frame = f;
      break;
    }
  }

  for (const action of actions) {
    switch (action.type) {
      case 'wait':
        await sleep(action.ms || 1000);
        break;

      case 'click':
        try {
          await frame.waitForSelector(action.selector, { timeout: 5000 });
          await frame.click(action.selector);
        } catch (err) {
          // フレーム内で見つからなければメインページで試行
          await page.waitForSelector(action.selector, { timeout: 3000 });
          await page.click(action.selector);
        }
        break;

      case 'scroll':
        await frame.evaluate((y) => window.scrollTo(0, y), action.y || 0);
        break;

      case 'scrollToBottom':
        await frame.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        break;

      case 'type':
        await frame.waitForSelector(action.selector, { timeout: 5000 });
        await frame.type(action.selector, action.text);
        break;

      default:
        console.log(`    (不明なアクション: ${action.type})`);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
