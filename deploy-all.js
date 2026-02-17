/**
 * 全アプリ一括デプロイ＆ブラウザ自動オープン
 * 使い方: node deploy-all.js
 *
 * 1. メインアプリ: clasp push → clasp deploy
 * 2. チェックリストアプリ: clasp push → clasp deploy
 * 3. ブラウザでメインアプリを自動オープン（オーナー用=通常、スタッフ用=シークレット）
 *
 * ※ スタッフ用URLはオーナー用URLに ?staff=1 を付けたもの（デプロイIDは1つ）
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const checklistDir = path.join(rootDir, 'checklist-app');

// clasp コマンドのパスを解決
const binDir = path.join(rootDir, 'node_modules', '.bin');
const claspCmd = process.platform === 'win32'
  ? path.join(binDir, 'clasp.cmd')
  : path.join(binDir, 'clasp');
const clasp = fs.existsSync(claspCmd) ? '"' + claspCmd + '"' : 'npx clasp';

function run(cmd, cwd) {
  var sep = process.platform === 'win32' ? ';' : ':';
  var envPath = binDir + sep + (process.env.PATH || '');
  try {
    var out = execSync(cmd, { encoding: 'utf8', shell: true, cwd: cwd, env: Object.assign({}, process.env, { PATH: envPath }) });
    return { ok: true, out: out || '' };
  } catch (e) {
    return { ok: false, out: (e.stdout || '').toString() + (e.stderr || '').toString() };
  }
}

/** clasp deployments からデプロイIDを1つ取得（@HEAD除外） */
function getDeployId(text) {
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].includes('@HEAD')) continue;
    var m = lines[i].match(/(AKfycb[A-Za-z0-9_-]{20,})/);
    if (m) return m[1];
  }
  return null;
}

/** ブラウザを通常ウィンドウで開く */
function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      execSync('start "" "' + url + '"', { shell: true });
    } else if (process.platform === 'darwin') {
      execSync('open "' + url + '"');
    } else {
      execSync('xdg-open "' + url + '"');
    }
  } catch (e) {
    console.log('  ブラウザを開けませんでした: ' + url);
  }
}

/** ブラウザをシークレットウィンドウで開く（Windows: Brave→Edge→Chrome→通常 の順で試行） */
function openBrowserIncognito(url) {
  if (process.platform !== 'win32') { openBrowser(url); return; }
  // startコマンドは非同期で起動するため、存在しないコマンドでもエラーをスローしない
  // そのため、ブラウザの実行ファイルが実際に存在するかチェックしてから起動する
  var localAppData = process.env.LOCALAPPDATA || '';
  var programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  var programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  var browsers = [
    { name: 'Brave', flag: '--incognito', paths: [
      localAppData + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      programFiles + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
    ]},
    { name: 'Edge', flag: '--inprivate', paths: [
      programFilesX86 + '\\Microsoft\\Edge\\Application\\msedge.exe',
      programFiles + '\\Microsoft\\Edge\\Application\\msedge.exe'
    ]},
    { name: 'Chrome', flag: '--incognito', paths: [
      localAppData + '\\Google\\Chrome\\Application\\chrome.exe',
      programFiles + '\\Google\\Chrome\\Application\\chrome.exe',
      programFilesX86 + '\\Google\\Chrome\\Application\\chrome.exe'
    ]}
  ];
  for (var i = 0; i < browsers.length; i++) {
    var b = browsers[i];
    for (var j = 0; j < b.paths.length; j++) {
      if (fs.existsSync(b.paths[j])) {
        try {
          execSync('start "" "' + b.paths[j] + '" ' + b.flag + ' "' + url + '"', { shell: true });
          return;
        } catch (e) {}
      }
    }
  }
  // どのブラウザも見つからなかった場合、通常ウィンドウで開く
  openBrowser(url);
}

function main() {
  console.log('========================================');
  console.log('  全アプリ一括デプロイ');
  console.log('========================================');
  console.log('');

  var urls = [];

  // === メインアプリ ===
  console.log('[1/5] メインアプリ: コードをプッシュ...');
  var mainPush = run(clasp + ' push --force', rootDir);
  if (!mainPush.ok) {
    console.error('  エラー: メインアプリの clasp push に失敗');
    console.error('  ' + mainPush.out.slice(0, 500));
    process.exit(1);
  }
  console.log('  OK');

  console.log('[2/5] メインアプリ: デプロイを更新...');
  var mainDeps = run(clasp + ' deployments', rootDir);
  var mainId = mainDeps.ok ? getDeployId(mainDeps.out) : null;
  var today = new Date().toISOString().slice(0, 10);
  if (mainId) {
    var r = run(clasp + ' deploy --deploymentId "' + mainId + '" --description "メインアプリ ' + today + '"', rootDir);
    console.log('  デプロイ: ' + (r.ok ? 'OK' : '失敗 - ' + r.out.slice(0, 200)));
    var baseUrl = 'https://script.google.com/macros/s/' + mainId + '/exec';
    urls.push({ label: 'オーナー用', url: baseUrl });
    urls.push({ label: 'スタッフ用', url: baseUrl + '?staff=1' });
  } else {
    console.log('  既存デプロイが見つかりません。新規作成...');
    run(clasp + ' deploy --description "メインアプリ ' + today + '"', rootDir);
  }

  // === オーナーURL・スタッフ用URLをGASに保存 ===
  if (mainId) {
    var baseUrl = 'https://script.google.com/macros/s/' + mainId + '/exec';
    var staffUrl = baseUrl + '?staff=1';
    console.log('  URLをGASに保存中...');
    try {
      // ベースURL保存
      execSync('curl -sL "' + baseUrl + '?action=setBaseUrl&url=' + encodeURIComponent(baseUrl) + '"', { encoding: 'utf8', timeout: 15000 });
      // スタッフURL保存
      execSync('curl -sL "' + baseUrl + '?action=setStaffUrl&url=' + encodeURIComponent(staffUrl) + '"', { encoding: 'utf8', timeout: 15000 });
      console.log('  OK - オーナー: ' + baseUrl);
      console.log('  OK - スタッフ: ' + staffUrl);
    } catch (e) {
      console.log('  URL保存リクエスト失敗（次回デプロイで自動リトライされます）: ' + e.message);
    }
  }

  // === チェックリストアプリ ===
  console.log('[3/5] チェックリストアプリ: コードをプッシュ...');
  var clPush = run(clasp + ' push --force', checklistDir);
  if (!clPush.ok) {
    console.error('  エラー: チェックリストアプリの clasp push に失敗');
    console.error('  ' + clPush.out.slice(0, 500));
    process.exit(1);
  }
  console.log('  OK');
  console.log('  push出力: ' + clPush.out.trim().split('\n').slice(0, 5).join(' / '));

  console.log('[4/5] チェックリストアプリ: 新バージョンを作成...');
  var clVer = run(clasp + ' version "チェックリスト ' + today + '"', checklistDir);
  if (!clVer.ok) {
    console.error('  エラー: バージョン作成に失敗');
    console.error('  ' + clVer.out.slice(0, 500));
    process.exit(1);
  }
  // バージョン番号を抽出（出力例: "Created version 15."）
  var verMatch = clVer.out.match(/(\d+)/);
  var versionNum = verMatch ? verMatch[1] : null;
  console.log('  OK - バージョン ' + (versionNum || '(番号取得失敗)'));

  console.log('[5/5] チェックリストアプリ: デプロイを更新...');
  var clDeps = run(clasp + ' deployments', checklistDir);
  console.log('  デプロイ一覧: ' + (clDeps.out || '').trim().split('\n').filter(function(l) { return l.trim(); }).join(' / '));
  var clId = clDeps.ok ? getDeployId(clDeps.out) : null;
  if (clId) {
    var deployCmd = clasp + ' deploy --deploymentId "' + clId + '"';
    if (versionNum) deployCmd += ' -V ' + versionNum;
    deployCmd += ' --description "チェックリスト ' + today + '"';
    var r = run(deployCmd, checklistDir);
    if (r.ok) {
      console.log('  チェックリスト: OK (デプロイID=' + clId + ', バージョン=' + (versionNum || 'auto') + ')');
      urls.push({ label: 'チェックリスト', url: 'https://script.google.com/macros/s/' + clId + '/exec' });
    } else {
      console.log('  失敗 - ' + r.out.slice(0, 200));
    }
  } else {
    console.log('  既存デプロイが見つかりません。新規作成...');
    var clNew = run(clasp + ' deploy --description "チェックリスト ' + today + '"', checklistDir);
    console.log('  ' + (clNew.ok ? 'OK' : '失敗'));
    if (clNew.ok) console.log('  出力: ' + clNew.out.trim());
  }

  console.log('');
  console.log('========================================');
  console.log('  デプロイ完了 - ブラウザを開いています...');
  console.log('========================================');
  console.log('');

  // URLを表示
  urls.forEach(function(u) {
    console.log('  ' + u.label + ': ' + u.url);
  });
  console.log('');

  // ブラウザで2つ開く: オーナー(通常)、スタッフ(シークレット)
  urls.forEach(function(u) {
    if (u.label === 'チェックリスト') return; // チェックリストは開かない
    if (u.label === 'スタッフ用') {
      console.log('  シークレットウィンドウで開く: ' + u.label);
      openBrowserIncognito(u.url);
    } else {
      console.log('  通常ウィンドウで開く: ' + u.label);
      openBrowser(u.url);
    }
  });
}

main();
