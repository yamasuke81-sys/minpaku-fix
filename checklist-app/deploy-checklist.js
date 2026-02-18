/**
 * チェックリストアプリ用デプロイスクリプト
 * 使い方: node deploy-checklist.js
 *
 * 1. Code.gs内のSHEET_NAME重複チェック（バリデーション）
 * 2. clasp push（コードをGASプロジェクトにアップロード）
 * 3. clasp deploy（既存デプロイを新しいバージョンで更新）
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const scriptDir = __dirname;
const parentDir = path.join(scriptDir, '..');

// 親ディレクトリの node_modules/.bin から clasp を直接実行
// npx 経由だと Windows で JSON5 エラーが発生する場合がある
const parentBinDir = path.join(parentDir, 'node_modules', '.bin');
const claspCmd = process.platform === 'win32'
  ? path.join(parentBinDir, 'clasp.cmd')
  : path.join(parentBinDir, 'clasp');
const clasp = fs.existsSync(claspCmd) ? `"${claspCmd}"` : 'npx clasp';

/** コマンドを実行し結果を取得（親の node_modules/.bin を PATH に含む） */
function runCapture(cmd, cwd) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const envPath = parentBinDir + sep + (process.env.PATH || '');
  try {
    const out = execSync(cmd, { encoding: 'utf8', shell: true, cwd: cwd || scriptDir, env: { ...process.env, PATH: envPath } });
    return { success: true, stdout: out || '', stderr: '' };
  } catch (e) {
    return { success: false, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() };
  }
}

/** clasp deployments の出力からウェブアプリ用デプロイIDを取得（AKfycb... 形式、HEAD除外） */
function getWebAppDeploymentIds(text) {
  const ids = [];
  const lines = text.split('\n');
  for (const line of lines) {
    // @HEAD はread-onlyなので除外
    if (line.includes('@HEAD')) continue;
    const m = line.match(/(AKfycb[A-Za-z0-9_-]{20,})/);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** デプロイ前のバリデーション: SHEET_NAME の重複チェック */
function validateCode() {
  console.log('1. コードのバリデーション...');

  const codeGsPath = path.join(scriptDir, 'Code.gs');
  if (!fs.existsSync(codeGsPath)) {
    console.error('   エラー: Code.gs が見つかりません。');
    process.exit(1);
  }

  const code = fs.readFileSync(codeGsPath, 'utf8');

  if (code.match(/\bconst\s+SHEET_NAME\b/)) {
    console.error('   エラー: Code.gs に "const SHEET_NAME" が含まれています！');
    console.error('   チェックリストアプリでは CL_BOOKING_SHEET を使用してください。');
    process.exit(1);
  }

  if (code.match(/\bconst\s+SHEET_OWNER\b/) || code.match(/\bconst\s+SHEET_STAFF\b/)) {
    console.error('   エラー: Code.gs に SHEET_OWNER/SHEET_STAFF が含まれています！');
    console.error('   CL_OWNER_SHEET, CL_STAFF_SHEET を使用してください。');
    process.exit(1);
  }

  if (!code.includes('function doGet(')) {
    console.error('   エラー: Code.gs に doGet 関数がありません。');
    process.exit(1);
  }

  console.log('   バリデーション OK');
}

/** URLを取得（リダイレクト対応、15秒タイムアウト） */
function fetchUrl(url, redirectCount) {
  if (redirectCount === undefined) redirectCount = 0;
  if (redirectCount >= 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise(function(resolve, reject) {
    var lib = url.startsWith('https') ? https : http;
    var req = lib.get(url, { headers: { 'User-Agent': 'deploy-checklist/1.0' }, timeout: 15000 }, function(res) {
      if (res.statusCode >= 301 && res.statusCode <= 303 && res.headers.location) {
        var next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetchUrl(next, redirectCount + 1).then(resolve, reject);
      }
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() { resolve(data); });
    });
    req.on('timeout', function() { req.destroy(); reject(new Error('タイムアウト (15秒)')); });
    req.on('error', reject);
  });
}

async function main() {
  const claspJsonPath = path.join(scriptDir, '.clasp.json');
  if (!fs.existsSync(claspJsonPath)) {
    console.error('エラー: .clasp.json が見つかりません。');
    process.exit(1);
  }

  // clasp 動作確認
  console.log('   clasp: ' + clasp);
  const versionCheck = runCapture(`${clasp} --version`);
  if (!versionCheck.success) {
    console.error('エラー: clasp が見つかりません。npm install @google/clasp を実行してください。');
    process.exit(1);
  }
  console.log('   clasp version: ' + versionCheck.stdout.trim());

  // バリデーション
  validateCode();

  // clasp push（--force で確認プロンプトをスキップ）
  console.log('2. コードをプッシュしています...');
  const pushResult = runCapture(`${clasp} push --force`);
  if (!pushResult.success) {
    const errText = (pushResult.stdout + pushResult.stderr);
    console.error('   clasp push に失敗しました。');
    console.error('   ' + errText.slice(0, 500));
    console.error('');
    if (errText.includes('JSON') || errText.includes('json') || errText.includes('Parse')) {
      console.error('   [ヒント] JSON解析エラーです。以下を試してください:');
      console.error('   1. npx clasp login  （再ログイン）');
      console.error('   2. %USERPROFILE%\\.clasprc.json を削除して再ログイン');
    } else if (errText.includes('401') || errText.includes('auth') || errText.includes('login')) {
      console.error('   [ヒント] 認証エラーです: npx clasp login');
    } else {
      console.error('   ログインが必要な場合: npx clasp login');
    }
    process.exit(1);
  }
  console.log('   プッシュ完了');

  // clasp deploy（既存デプロイを更新 or 新規作成）
  if (process.argv.includes('--push-only')) {
    console.log('');
    console.log('プッシュのみ完了しました。（--push-only）');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log('3. デプロイを更新しています...');

  // deploy-config.json から保存済みのチェックリストデプロイIDを読み込む
  const configPath = path.join(parentDir, 'deploy-config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
  }
  const savedChecklistId = (config.checklistDeploymentId || '').trim();

  let deployResult;
  let deployUrl = '';
  let deployId = '';
  let wasCreated = false;

  // 優先順位1: deploy-config.json に保存済みIDがあれば使う（URLが変わらない）
  if (savedChecklistId) {
    console.log('   保存済みデプロイIDで更新: ' + savedChecklistId.substring(0, 30) + '...');
    deployResult = runCapture(`${clasp} deploy --deploymentId "${savedChecklistId}" --description "チェックリスト ${today}"`);
    if (deployResult.success) {
      deployId = savedChecklistId;
      deployUrl = 'https://script.google.com/macros/s/' + deployId + '/exec';
    } else {
      console.log('   保存済みIDでの更新に失敗。既存デプロイを探します...');
    }
  }

  // 優先順位2: clasp deployments から既存のversionedデプロイを探す
  if (!deployId) {
    const deploymentsResult = runCapture(`${clasp} deployments`);
    const existingIds = deploymentsResult.success
      ? getWebAppDeploymentIds(deploymentsResult.stdout + deploymentsResult.stderr)
      : [];

    if (existingIds.length > 0) {
      const foundId = existingIds[0];
      console.log('   既存デプロイを発見。更新: ' + foundId.substring(0, 30) + '...');
      deployResult = runCapture(`${clasp} deploy --deploymentId "${foundId}" --description "チェックリスト ${today}"`);
      if (deployResult.success) {
        deployId = foundId;
        deployUrl = 'https://script.google.com/macros/s/' + deployId + '/exec';
      }
    }
  }

  // 優先順位3: どうしても見つからない場合のみ新規作成
  if (!deployId) {
    console.log('   既存デプロイが見つかりません。新規作成します...');
    deployResult = runCapture(`${clasp} deploy --description "チェックリスト ${today}"`);
    if (!deployResult.success) {
      console.error('   clasp deploy に失敗しました。');
      console.error('   ' + (deployResult.stdout + deployResult.stderr).slice(0, 500));
      process.exit(1);
    }
    // 新規デプロイのIDを抽出
    const text = deployResult.stdout + deployResult.stderr;
    const idMatch = text.match(/(AKfycb[A-Za-z0-9_-]{20,})/);
    if (idMatch) {
      deployId = idMatch[1];
      deployUrl = 'https://script.google.com/macros/s/' + deployId + '/exec';
    }
    wasCreated = true;
  }

  // デプロイIDを deploy-config.json に永続保存（次回以降URLが変わらない）
  if (deployId && deployId !== savedChecklistId) {
    config.checklistDeploymentId = deployId;
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
      console.log('   deploy-config.json にチェックリストデプロイIDを保存しました。');
    } catch (e) {
      console.log('   deploy-config.json の保存に失敗: ' + e.message);
    }
  }

  console.log('   デプロイ完了');
  if (deployUrl) {
    console.log('   URL: ' + deployUrl);
  }
  if (wasCreated) {
    console.log('   ※ 新規デプロイが作成されました（URLが変更されています）');
  }

  // メインアプリの CHECKLIST_APP_URL を自動更新
  if (deployUrl) {
    const ownerId = (config.ownerDeploymentId || '').trim();
    if (ownerId) {
      const ownerUrl = 'https://script.google.com/macros/s/' + ownerId + '/exec';
      const updateUrl = ownerUrl + '?action=setChecklistAppUrl&url=' + encodeURIComponent(deployUrl);
      console.log('4. メインアプリのチェックリストURLを更新しています...');
      try {
        const res = await fetchUrl(updateUrl);
        const trimmed = (res || '').trim();
        if (trimmed === 'OK') {
          console.log('   CHECKLIST_APP_URL を更新しました。');
        } else {
          console.log('   自動更新できませんでした（応答: ' + trimmed.slice(0, 100) + '）');
          console.log('   メインアプリの Script Properties に手動で設定してください:');
          console.log('   CHECKLIST_APP_URL = ' + deployUrl);
        }
      } catch (fetchErr) {
        console.log('   URL自動更新でエラー: ' + fetchErr.message);
        console.log('   メインアプリの Script Properties に手動で設定してください:');
        console.log('   CHECKLIST_APP_URL = ' + deployUrl);
      }
    }
  }

  // 初回セットアップのヒント
  const claspConfig = JSON.parse(fs.readFileSync(claspJsonPath, 'utf8'));
  const scriptId = claspConfig.scriptId;
  if (scriptId) {
    console.log('   ※ 初回デプロイの場合、GASエディタで diagChecklistSetup() を実行して');
    console.log('     OAuth認証を許可してください:');
    console.log('     https://script.google.com/home/projects/' + scriptId + '/edit');
  }

  console.log('');
  console.log('完了しました。');
}

main().catch(function(e) {
  console.error('エラー: ' + e.message);
  process.exit(1);
});
