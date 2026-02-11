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

/** clasp deployments の出力からウェブアプリ用デプロイIDを取得（AKfycb... 形式） */
function getWebAppDeploymentIds(text) {
  const ids = [];
  const lines = text.split('\n');
  for (const line of lines) {
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

function main() {
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

  // 既存デプロイを取得
  const deploymentsResult = runCapture(`${clasp} deployments`);
  const existingIds = deploymentsResult.success
    ? getWebAppDeploymentIds(deploymentsResult.stdout + deploymentsResult.stderr)
    : [];

  let deployResult;
  let deployUrl = '';

  if (existingIds.length > 0) {
    // 既存デプロイを更新（URLが変わらない）
    const deployId = existingIds[0];
    console.log('   既存デプロイを更新: ' + deployId.substring(0, 30) + '...');
    deployResult = runCapture(`${clasp} deploy --deploymentId "${deployId}" --description "チェックリスト ${today}"`);
    if (deployResult.success) {
      deployUrl = 'https://script.google.com/macros/s/' + deployId + '/exec';
    } else {
      // 更新失敗時は新規作成にフォールバック
      console.log('   既存デプロイの更新に失敗。新規作成します...');
      deployResult = runCapture(`${clasp} deploy --description "チェックリスト ${today}"`);
    }
  } else {
    // 既存デプロイがない場合、新規作成
    console.log('   既存デプロイが見つかりません。新規作成します...');
    deployResult = runCapture(`${clasp} deploy --description "チェックリスト ${today}"`);
  }

  if (!deployResult.success) {
    console.error('   clasp deploy に失敗しました。');
    console.error('   ' + (deployResult.stdout + deployResult.stderr).slice(0, 500));
    process.exit(1);
  }

  // デプロイURLを抽出
  if (!deployUrl) {
    const text = deployResult.stdout + deployResult.stderr;
    const urlMatch = text.match(/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec/);
    if (urlMatch) {
      deployUrl = 'https://script.google.com/macros/s/' + urlMatch[1] + '/exec';
    }
    const idMatch = text.match(/(AKfycb[A-Za-z0-9_-]{20,})/);
    if (idMatch) {
      deployUrl = 'https://script.google.com/macros/s/' + idMatch[1] + '/exec';
    }
  }

  console.log('   デプロイ完了');
  if (deployUrl) {
    console.log('   URL: ' + deployUrl);
  }

  console.log('');
  console.log('完了しました。');
}

main();
