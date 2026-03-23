/**
 * アラームアプリ用デプロイスクリプト
 * 使い方: node deploy-alarm.js
 *
 * 1. バリデーション
 * 2. clasp push
 * 3. clasp deploy（既存デプロイを更新 or 新規作成）
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const scriptDir = __dirname;
const parentDir = path.join(scriptDir, '..');

const parentBinDir = path.join(parentDir, 'node_modules', '.bin');
const claspCmd = process.platform === 'win32'
  ? path.join(parentBinDir, 'clasp.cmd')
  : path.join(parentBinDir, 'clasp');
const clasp = fs.existsSync(claspCmd) ? `"${claspCmd}"` : 'npx clasp';

function runCapture(cmd, cwd) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const envPath = parentBinDir + sep + (process.env.PATH || '');
  try {
    const out = execSync(cmd, { encoding: 'utf8', shell: true, cwd: cwd || scriptDir, env: { ...process.env, PATH: envPath } });
    return { success: true, stdout: out || '', stderr: '' };
  } catch (e) {
    const stdout = (e.stdout || '').toString();
    const stderr = (e.stderr || '').toString();
    const combined = stdout + stderr;
    if (/EPERM/.test(combined)) {
      const hasSuccessIndicator =
        /Pushed \d+ file/i.test(combined) ||
        /Created version/i.test(combined) ||
        /AKfycb[A-Za-z0-9_-]{20,}/.test(combined);
      if (hasSuccessIndicator) {
        console.log('  (EPERM警告: .clasprc.json書き込み権限エラー。操作自体は成功)');
        return { success: true, stdout: stdout, stderr: stderr };
      }
    }
    return { success: false, stdout: stdout, stderr: stderr };
  }
}

function getWebAppDeploymentIds(text) {
  const ids = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.includes('@HEAD')) continue;
    const m = line.match(/(AKfycb[A-Za-z0-9_-]{20,})/);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

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
    process.exit(1);
  }
  if (!code.includes('function doGet(')) {
    console.error('   エラー: Code.gs に doGet 関数がありません。');
    process.exit(1);
  }
  console.log('   バリデーション OK');
}

async function main() {
  const claspJsonPath = path.join(scriptDir, '.clasp.json');
  if (!fs.existsSync(claspJsonPath)) {
    console.error('エラー: .clasp.json が見つかりません。');
    process.exit(1);
  }

  const claspConfig = JSON.parse(fs.readFileSync(claspJsonPath, 'utf8'));
  if (!claspConfig.scriptId || claspConfig.scriptId === 'YOUR_ALARM_SCRIPT_ID_HERE') {
    console.error('エラー: .clasp.json の scriptId が未設定です。');
    console.error('   GASプロジェクトを作成し、scriptId を設定してください。');
    process.exit(1);
  }

  console.log('   clasp: ' + clasp);
  const versionCheck = runCapture(`${clasp} --version`);
  if (!versionCheck.success) {
    console.error('エラー: clasp が見つかりません。');
    process.exit(1);
  }
  console.log('   clasp version: ' + versionCheck.stdout.trim());

  validateCode();

  console.log('2. コードをプッシュしています...');
  const pushResult = runCapture(`${clasp} push --force`);
  const pushOutput = pushResult.stdout + pushResult.stderr;
  const pushActuallySucceeded = pushResult.success || /Pushed \d+ file/i.test(pushOutput);
  if (!pushActuallySucceeded) {
    console.error('   clasp push に失敗しました。');
    console.error('   ' + pushOutput.slice(0, 500));
    process.exit(1);
  }
  console.log('   プッシュ完了');

  if (process.argv.includes('--push-only')) {
    console.log('プッシュのみ完了しました。（--push-only）');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log('3. デプロイを更新しています...');

  const configPath = path.join(parentDir, 'deploy-config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
  }
  const savedAlarmId = (config.alarmDeploymentId || '').trim();

  let deployResult;
  let deployUrl = '';
  let deployId = '';
  let wasCreated = false;

  if (savedAlarmId) {
    console.log('   保存済みデプロイIDで更新: ' + savedAlarmId.substring(0, 30) + '...');
    deployResult = runCapture(`${clasp} deploy --deploymentId "${savedAlarmId}" --description "アラーム ${today}"`);
    if (deployResult.success) {
      deployId = savedAlarmId;
      deployUrl = 'https://script.google.com/macros/s/' + deployId + '/exec';
    } else {
      console.log('   保存済みIDでの更新に失敗。既存デプロイを探します...');
    }
  }

  if (!deployId) {
    const deploymentsResult = runCapture(`${clasp} deployments`);
    const existingIds = deploymentsResult.success
      ? getWebAppDeploymentIds(deploymentsResult.stdout + deploymentsResult.stderr)
      : [];

    if (existingIds.length > 0) {
      const foundId = existingIds[0];
      console.log('   既存デプロイを発見。更新: ' + foundId.substring(0, 30) + '...');
      deployResult = runCapture(`${clasp} deploy --deploymentId "${foundId}" --description "アラーム ${today}"`);
      if (deployResult.success) {
        deployId = foundId;
        deployUrl = 'https://script.google.com/macros/s/' + deployId + '/exec';
      }
    }
  }

  if (!deployId) {
    console.log('   既存デプロイが見つかりません。新規作成します...');
    deployResult = runCapture(`${clasp} deploy --description "アラーム ${today}"`);
    if (!deployResult.success) {
      console.error('   clasp deploy に失敗しました。');
      console.error('   ' + (deployResult.stdout + deployResult.stderr).slice(0, 500));
      process.exit(1);
    }
    const text = deployResult.stdout + deployResult.stderr;
    const idMatch = text.match(/(AKfycb[A-Za-z0-9_-]{20,})/);
    if (idMatch) {
      deployId = idMatch[1];
      deployUrl = 'https://script.google.com/macros/s/' + deployId + '/exec';
    }
    wasCreated = true;
  }

  if (deployId && deployId !== savedAlarmId) {
    config.alarmDeploymentId = deployId;
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
      console.log('   deploy-config.json にアラームデプロイIDを保存しました。');
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

  const scriptId = claspConfig.scriptId;
  if (scriptId) {
    console.log('');
    console.log('   初回デプロイの場合:');
    console.log('   1. GASエディタで doGet を実行してOAuth認証を許可');
    console.log('      https://script.google.com/home/projects/' + scriptId + '/edit');
    console.log('   2. スプレッドシートIDをScript Propertiesに設定:');
    console.log('      SPREADSHEET_ID = <宿泊者名簿のスプレッドシートID>');
  }

  console.log('');
  console.log('完了しました。');
}

main().catch(function(e) {
  console.error('エラー: ' + e.message);
  process.exit(1);
});
