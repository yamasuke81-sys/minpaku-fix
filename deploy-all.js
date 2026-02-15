/**
 * 全アプリ一括デプロイ＆ブラウザ自動オープン
 * 使い方: node deploy-all.js
 *
 * 1. メインアプリ: clasp push → clasp deploy（オーナー用・スタッフ用）
 * 2. チェックリストアプリ: clasp push → clasp deploy
 * 3. ブラウザでメインアプリを自動オープン
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

/** clasp deployments からデプロイIDを取得（@HEAD除外） */
function getDeployIds(text) {
  var ids = [];
  text.split('\n').forEach(function(line) {
    if (line.includes('@HEAD')) return;
    var m = line.match(/(AKfycb[A-Za-z0-9_-]{20,})/);
    if (m && ids.indexOf(m[1]) < 0) ids.push(m[1]);
  });
  return ids;
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

/** ブラウザをシークレットウィンドウで開く（Windows: Edge→Chrome→通常 の順で試行） */
function openBrowserIncognito(url) {
  if (process.platform !== 'win32') { openBrowser(url); return; }
  try {
    execSync('start msedge --inprivate "' + url + '"', { shell: true });
    return;
  } catch (e) {}
  try {
    execSync('start chrome --incognito "' + url + '"', { shell: true });
    return;
  } catch (e) {}
  openBrowser(url);
}

/** URLにHTTP GETリクエストを送信（リダイレクト対応） */
function fetchUrlSync(targetUrl) {
  var script = [
    "var https = require('https');",
    "function fetch(u, depth) {",
    "  if (depth > 5) { process.exit(1); return; }",
    "  https.get(u, {headers:{'User-Agent':'deploy'}}, function(r) {",
    "    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {",
    "      fetch(r.headers.location, depth + 1);",
    "    } else {",
    "      var d = '';",
    "      r.on('data', function(c) { d += c; });",
    "      r.on('end', function() { process.stdout.write(d); });",
    "    }",
    "  }).on('error', function() { process.exit(1); });",
    "}",
    "fetch(process.argv[1], 0);"
  ].join('\n');
  var tmpFile = path.join(rootDir, '.tmp_fetch.js');
  try {
    fs.writeFileSync(tmpFile, script);
    var result = run('node "' + tmpFile + '" "' + targetUrl + '"');
    return result.ok ? result.out.trim() : '';
  } catch (e) {
    return '';
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  }
}

function main() {
  console.log('========================================');
  console.log('  全アプリ一括デプロイ');
  console.log('========================================');
  console.log('');

  var urls = [];

  // === メインアプリ ===
  console.log('[1/4] メインアプリ: コードをプッシュ...');
  var mainPush = run(clasp + ' push --force', rootDir);
  if (!mainPush.ok) {
    console.error('  エラー: メインアプリの clasp push に失敗');
    console.error('  ' + mainPush.out.slice(0, 500));
    process.exit(1);
  }
  console.log('  OK');

  console.log('[2/4] メインアプリ: デプロイを更新...');
  var mainDeps = run(clasp + ' deployments', rootDir);
  var mainIds = mainDeps.ok ? getDeployIds(mainDeps.out) : [];
  var today = new Date().toISOString().slice(0, 10);
  if (mainIds.length > 0) {
    mainIds.forEach(function(id, i) {
      var label = i === 0 ? 'オーナー用' : 'スタッフ用';
      var r = run(clasp + ' deploy --deploymentId "' + id + '" --description "' + label + ' ' + today + '"', rootDir);
      if (r.ok) {
        console.log('  ' + label + ': OK');
        var baseUrl = 'https://script.google.com/macros/s/' + id + '/exec';
        urls.push({ label: label, url: label === 'スタッフ用' ? baseUrl + '?staff=1' : baseUrl });
      } else {
        console.log('  ' + label + ': 失敗 - ' + r.out.slice(0, 200));
      }
    });
  } else {
    console.log('  既存デプロイが見つかりません。新規作成...');
    run(clasp + ' deploy --description "メインアプリ ' + today + '"', rootDir);
  }

  // === スタッフ用URLを設定タブに自動反映 ===
  var ownerEntry = urls.filter(function(u) { return u.label === 'オーナー用'; })[0];
  var staffEntry = urls.filter(function(u) { return u.label === 'スタッフ用'; })[0];
  if (ownerEntry && staffEntry) {
    console.log('');
    console.log('  スタッフ用URLを設定タブに自動反映中...');
    var configPath = path.join(rootDir, 'deploy-config.json');
    var urlUpdateSecret = '';
    try {
      var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      urlUpdateSecret = (config.urlUpdateSecret || '').trim();
    } catch (e) {}
    var updateUrl = ownerEntry.url + (ownerEntry.url.indexOf('?') >= 0 ? '&' : '?') +
      'action=setStaffUrl&url=' + encodeURIComponent(staffEntry.url) +
      (urlUpdateSecret ? '&secret=' + encodeURIComponent(urlUpdateSecret) : '');
    var response = fetchUrlSync(updateUrl);
    if (response === 'OK') {
      console.log('  スタッフ用URLを自動反映しました: ' + staffEntry.url);
    } else {
      console.log('  自動反映できませんでした。設定タブで手動入力してください: ' + staffEntry.url);
    }
  }

  // === チェックリストアプリ ===
  console.log('[3/4] チェックリストアプリ: コードをプッシュ...');
  var clPush = run(clasp + ' push --force', checklistDir);
  if (!clPush.ok) {
    console.error('  エラー: チェックリストアプリの clasp push に失敗');
    console.error('  ' + clPush.out.slice(0, 500));
    process.exit(1);
  }
  console.log('  OK');

  console.log('[4/4] チェックリストアプリ: デプロイを更新...');
  var clDeps = run(clasp + ' deployments', checklistDir);
  var clIds = clDeps.ok ? getDeployIds(clDeps.out) : [];
  if (clIds.length > 0) {
    var clId = clIds[0];
    var r = run(clasp + ' deploy --deploymentId "' + clId + '" --description "チェックリスト ' + today + '"', checklistDir);
    if (r.ok) {
      console.log('  チェックリスト: OK');
      urls.push({ label: 'チェックリスト', url: 'https://script.google.com/macros/s/' + clId + '/exec' });
    } else {
      console.log('  失敗 - ' + r.out.slice(0, 200));
    }
  } else {
    console.log('  既存デプロイが見つかりません。新規作成...');
    var clNew = run(clasp + ' deploy --description "チェックリスト ' + today + '"', checklistDir);
    console.log('  ' + (clNew.ok ? 'OK' : '失敗'));
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
