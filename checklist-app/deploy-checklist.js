/**
 * チェックリストアプリ用デプロイスクリプト
 * 使い方: node deploy-checklist.js
 *
 * 1. Code.gs内のSHEET_NAME重複チェック（バリデーション）
 * 2. clasp push（コードをGASプロジェクトにアップロード）
 * 3. clasp deploy（新しいバージョンでデプロイを更新）
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const scriptDir = __dirname;
const parentDir = path.join(scriptDir, '..');

// npx が checklist-app ディレクトリから clasp を見つけられない場合があるため、
// 親ディレクトリの node_modules から直接 clasp を呼ぶ
const claspBin = path.join(parentDir, 'node_modules', '.bin', 'clasp');
const clasp = fs.existsSync(claspBin) ? '"' + claspBin + '"' : 'npx clasp';

/** コマンドを実行し結果を取得 */
function runCapture(cmd, cwd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', shell: true, cwd: cwd || scriptDir });
    return { success: true, stdout: out || '', stderr: '' };
  } catch (e) {
    return { success: false, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() };
  }
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

  // SHEET_NAME が宣言されていないことを確認
  const sheetNameMatch = code.match(/\bconst\s+SHEET_NAME\b/);
  if (sheetNameMatch) {
    console.error('   エラー: Code.gs に "const SHEET_NAME" が含まれています！');
    console.error('   予約管理アプリの Code.gs と混同していないか確認してください。');
    console.error('   チェックリストアプリでは CL_BOOKING_SHEET を使用する必要があります。');
    process.exit(1);
  }

  // SHEET_OWNER / SHEET_STAFF が宣言されていないことを確認
  const ownerMatch = code.match(/\bconst\s+SHEET_OWNER\b/);
  const staffMatch = code.match(/\bconst\s+SHEET_STAFF\b/);
  if (ownerMatch || staffMatch) {
    console.error('   エラー: Code.gs に SHEET_OWNER または SHEET_STAFF が含まれています！');
    console.error('   CL_OWNER_SHEET, CL_STAFF_SHEET を使用してください。');
    process.exit(1);
  }

  // doGet 関数が存在することを確認
  if (!code.includes('function doGet(')) {
    console.error('   エラー: Code.gs に doGet 関数がありません。');
    console.error('   ウェブアプリとして機能するには doGet が必要です。');
    process.exit(1);
  }

  console.log('   バリデーション OK');
  return true;
}

function main() {
  // .clasp.json の存在確認
  const claspJsonPath = path.join(scriptDir, '.clasp.json');
  if (!fs.existsSync(claspJsonPath)) {
    console.error('エラー: .clasp.json が見つかりません。');
    console.error('チェックリストアプリのプロジェクトIDを設定してください。');
    process.exit(1);
  }

  // バリデーション
  validateCode();

  // clasp push
  console.log('2. コードをプッシュしています...');
  const pushResult = runCapture(`${clasp} push`);
  if (!pushResult.success) {
    console.error('   clasp push に失敗しました。');
    console.error('   ' + (pushResult.stdout + pushResult.stderr).slice(0, 500));
    console.error('');
    console.error('   ログインが必要な場合: npx clasp login');
    process.exit(1);
  }
  console.log('   プッシュ完了');

  // clasp deploy
  const deployOnly = !process.argv.includes('--push-only');
  if (deployOnly) {
    const today = new Date().toISOString().slice(0, 10);
    console.log('3. デプロイを更新しています...');
    const deployResult = runCapture(`${clasp} deploy --description "チェックリスト ${today}"`);
    if (!deployResult.success) {
      console.error('   clasp deploy に失敗しました。');
      console.error('   ' + (deployResult.stdout + deployResult.stderr).slice(0, 500));
      console.error('');
      console.error('   手動でデプロイする場合:');
      console.error('   Apps Scriptエディタ → デプロイ → デプロイを管理 → 編集 → 新しいバージョン → デプロイ');
      process.exit(1);
    }
    console.log('   デプロイ完了');

    // デプロイIDを表示
    const text = deployResult.stdout + deployResult.stderr;
    const urlMatch = text.match(/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec/);
    if (urlMatch) {
      console.log('   URL: https://script.google.com/macros/s/' + urlMatch[1] + '/exec');
    }
  }

  console.log('');
  console.log('完了しました。');
  console.log('チェックリストURL: https://script.google.com/macros/s/AKfycbyhVlj_IiLIk0tjKUFKjDBA4SNQ4EEVpgj_0WsSBw3JVMtcclOs5XzwHUfy9x9pExK_/exec');
  console.log('');
  console.log('ブラウザで開いて Ctrl+Shift+R でハードリフレッシュしてテストしてください。');
}

main();
