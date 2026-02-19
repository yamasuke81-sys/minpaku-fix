/**
 * 全アプリ一括デプロイ＆ブラウザ自動オープン
 * 使い方: node deploy-all.js
 *
 * 1. メインアプリ: clasp push → clasp deploy
 * 2. チェックリストアプリ: deploy-checklist.js を呼び出し（push → deploy）
 * 3. ブラウザでメインアプリを自動オープン（オーナー用=通常、スタッフ用=シークレット）
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

function run(cmd, cwd, timeoutMs) {
  var sep = process.platform === 'win32' ? ';' : ':';
  var envPath = binDir + sep + (process.env.PATH || '');
  var opts = { encoding: 'utf8', shell: true, cwd: cwd, env: Object.assign({}, process.env, { PATH: envPath }) };
  if (timeoutMs) opts.timeout = timeoutMs;
  try {
    var out = execSync(cmd, opts);
    return { ok: true, out: out || '' };
  } catch (e) {
    var msg = (e.stdout || '').toString() + (e.stderr || '').toString();
    if (e.killed) msg += '\n(タイムアウトで強制終了)';
    return { ok: false, out: msg };
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
  console.log('[1/3] メインアプリ: コードをプッシュ...');
  var mainPush = run(clasp + ' push --force', rootDir);
  if (!mainPush.ok) {
    console.error('  エラー: メインアプリの clasp push に失敗');
    console.error('  ' + mainPush.out.slice(0, 500));
    process.exit(1);
  }
  console.log('  OK');

  console.log('[2/3] メインアプリ: デプロイを更新...');
  var today = new Date().toISOString().slice(0, 10);

  // deploy-config.json から保存済みIDを読み込む（URL固定のため最優先）
  var configPath = path.join(rootDir, 'deploy-config.json');
  var config = {};
  if (fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
  }
  var savedMainId = (config.ownerDeploymentId || '').trim();

  var mainId = null;

  // 優先順位1: deploy-config.json の保存済みID
  if (savedMainId) {
    console.log('  保存済みデプロイIDで更新: ' + savedMainId.substring(0, 30) + '...');
    var r = run(clasp + ' deploy --deploymentId "' + savedMainId + '" --description "メインアプリ ' + today + '"', rootDir);
    if (r.ok) {
      mainId = savedMainId;
    } else {
      console.log('  保存済みIDでの更新に失敗。既存デプロイを探します...');
    }
  }

  // 優先順位2: clasp deployments から探す
  if (!mainId) {
    var mainDeps = run(clasp + ' deployments', rootDir);
    var foundId = mainDeps.ok ? getDeployId(mainDeps.out) : null;
    if (foundId) {
      console.log('  既存デプロイを発見。更新: ' + foundId.substring(0, 30) + '...');
      var r = run(clasp + ' deploy --deploymentId "' + foundId + '" --description "メインアプリ ' + today + '"', rootDir);
      if (r.ok) {
        mainId = foundId;
      }
    }
  }

  // 優先順位3: 新規作成（最終手段）
  if (!mainId) {
    console.log('  既存デプロイが見つかりません。新規作成...');
    var r = run(clasp + ' deploy --description "メインアプリ ' + today + '"', rootDir);
    if (r.ok) {
      var m = r.out.match(/(AKfycb[A-Za-z0-9_-]{20,})/);
      if (m) mainId = m[1];
    }
  }

  if (mainId) {
    console.log('  デプロイ: OK');
    var baseUrl = 'https://script.google.com/macros/s/' + mainId + '/exec';
    urls.push({ label: 'オーナー用', url: baseUrl });
    urls.push({ label: 'スタッフ用', url: baseUrl + '?staff=1' });

    // deploy-config.json にIDを保存（次回以降URLが変わらない）
    if (mainId !== savedMainId) {
      config.ownerDeploymentId = mainId;
      config.staffDeploymentId = mainId;
      try { fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8'); } catch (e) {}
    }
  } else {
    console.error('  デプロイに失敗しました。');
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

  // === チェックリストアプリ（deploy-checklist.js に委譲） ===
  console.log('[3/3] チェックリストアプリ: deploy-checklist.js を実行...');
  console.log('');
  var clDeployScript = path.join(checklistDir, 'deploy-checklist.js');
  if (fs.existsSync(clDeployScript)) {
    try {
      // stdio: 'inherit' で子プロセスの出力をリアルタイム表示
      var sep = process.platform === 'win32' ? ';' : ':';
      var envPath = binDir + sep + (process.env.PATH || '');
      execSync('node "' + clDeployScript + '"', {
        shell: true,
        cwd: checklistDir,
        stdio: 'inherit',
        timeout: 120000,
        env: Object.assign({}, process.env, { PATH: envPath })
      });
      console.log('');
      console.log('  チェックリストアプリ: デプロイ完了');
      // deploy-config.json からチェックリストURLを取得
      try {
        var configPath = path.join(rootDir, 'deploy-config.json');
        if (fs.existsSync(configPath)) {
          var cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (cfg.checklistDeploymentId) {
            urls.push({ label: 'チェックリスト', url: 'https://script.google.com/macros/s/' + cfg.checklistDeploymentId + '/exec' });
          }
        }
      } catch (cfgErr) {}
    } catch (clErr) {
      console.log('');
      if (clErr.killed) {
        console.error('  チェックリストアプリ: タイムアウト（120秒）で強制終了');
        console.error('  デプロイ自体は成功している可能性があります。');
      } else {
        console.error('  チェックリストアプリのデプロイに失敗');
      }
    }
  } else {
    console.error('  エラー: ' + clDeployScript + ' が見つかりません');
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
