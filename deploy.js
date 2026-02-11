/**
 * オーナー用・スタッフ用の両方に自動デプロイするスクリプト
 * 使い方: npm run deploy
 * プッシュのみ: npm run deploy -- --push-only
 * 方針: deploy-config.json のオーナー・スタッフID以外の古いデプロイを削除し、20件上限による自動アーカイブを防止。
 *       オーナー・スタッフの2件は既存IDで「更新」のみ（URL変更なし）。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const configPath = path.join(__dirname, 'deploy-config.json');
const claspJsonPath = path.join(__dirname, '.clasp.json');
const appsscriptPath = path.join(__dirname, 'appsscript.json');
// npx 経由だと Windows で JSON5 エラーが発生する場合があるため、直接実行を優先
const binDir = path.join(__dirname, 'node_modules', '.bin');
const claspBin = process.platform === 'win32'
  ? path.join(binDir, 'clasp.cmd')
  : path.join(binDir, 'clasp');
const clasp = fs.existsSync(claspBin) ? `"${claspBin}"` : 'npx clasp';

// オーナー用・スタッフ用の Webアプリ設定（appsscript.json の webapp セクション）
const OWNER_WEBAPP = { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' };
const STAFF_WEBAPP  = { access: 'ANYONE',           executeAs: 'USER_DEPLOYING' };

/** appsscript.json の webapp 設定を書き換える */
function setWebappConfig(webappConfig) {
  const manifest = JSON.parse(fs.readFileSync(appsscriptPath, 'utf8'));
  manifest.webapp = webappConfig;
  fs.writeFileSync(appsscriptPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function run(cmd, env = {}) {
  const opts = { stdio: 'inherit', shell: true, env: { ...process.env, ...env } };
  execSync(cmd, opts);
}

/** コマンドを実行し標準出力・標準エラーを取得。成功時 success: true */
function runCapture(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', shell: true, env: process.env });
    return { success: true, stdout: out || '', stderr: '' };
  } catch (e) {
    return { success: false, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() };
  }
}

/** clasp deploy の出力からデプロイIDを抽出（URL または "Deployment ID:" 行、"Deployed" 行） */
function parseDeploymentId(stdout, stderr) {
  const text = (stdout + '\n' + stderr);
  // 1. URL形式: script.google.com/macros/s/AKfycb.../exec
  const fromUrl = text.match(/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec/);
  if (fromUrl) return fromUrl[1];
  // 2. "Deployed AKfycb... @120" 形式
  const fromDeployed = text.match(/Deployed\s+([A-Za-z0-9_-]+)(?:\s*@\d+)?/i);
  if (fromDeployed && fromDeployed[1].length >= 20) return fromDeployed[1];
  // 3. "Deployment ID: AKfycb..." 形式
  const fromLine = text.match(/Deployment\s+ID[:\s]+([A-Za-z0-9_-]+)/i);
  if (fromLine) return fromLine[1];
  // 4. 20文字以上のAKfycb...形式のIDを探す（最後のマッチを採用）
  const allIds = text.match(/([A-Za-z0-9_-]{20,})/g);
  if (allIds && allIds.length > 0) {
    // 最後のID（通常は最新のデプロイID）を返す
    return allIds[allIds.length - 1];
  }
  return null;
}

/** clasp deployments の出力から、説明文にキーワードを含むデプロイIDを返す（HEAD除外） */
function findDeploymentByDescription(text, keyword, excludeIds) {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.includes('@HEAD')) continue;
    if (keyword && !line.includes(keyword)) continue;
    const m = line.match(/(AKfycb[A-Za-z0-9_-]{20,})/);
    if (m) {
      const id = m[1].trim();
      if (excludeIds && excludeIds.includes(id)) continue;
      return id;
    }
  }
  return null;
}

/** clasp deployments の出力からデプロイIDのリストを取得（AKfycb... 形式のみ。scriptId は除外） */
function getDeploymentIds(stdout) {
  const ids = [];
  const lines = stdout.split('\n');
  for (const line of lines) {
    // ウェブアプリのデプロイIDは AKfycb で始まる
    const m = line.match(/(AKfycb[A-Za-z0-9_-]{20,})/);
    if (m) {
      const id = m[1].trim();
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** clasp versions の出力からバージョン数を取得 */
function getVersionCount() {
  const result = runCapture(`${clasp} versions`);
  if (!result.success) return -1;
  const text = result.stdout + result.stderr;
  // "~N Versions." のパターンまたは各バージョン行をカウント
  const countMatch = text.match(/~?(\d+)\s+Versions?\./i);
  if (countMatch) return parseInt(countMatch[1], 10);
  // バージョン行を数える（"1 - description" 形式）
  const lines = text.split('\n').filter(l => /^\d+\s+-\s+/.test(l.trim()));
  return lines.length;
}

/** バージョン数を確認し、上限に近い場合は警告してプロジェクト履歴を開く */
function checkVersionLimit(scriptId) {
  const count = getVersionCount();
  if (count < 0) return;
  console.log('   現在のバージョン数: ' + count + ' / 200');
  if (count >= 150) {
    console.log('');
    console.log('   ⚠ バージョン数が上限(200)に近づいています！');
    console.log('   GASエディタの「プロジェクトの履歴」から古いバージョンを一括削除してください。');
    console.log('   ※ バージョン削除はAPIでは不可。GASエディタのUIからのみ可能です。');
    if (scriptId) {
      const historyUrl = 'https://script.google.com/home/projects/' + scriptId + '/edit';
      try {
        if (process.platform === 'win32') {
          execSync('start "" "' + historyUrl + '"', { shell: true });
        } else {
          execSync('open "' + historyUrl + '"', { shell: true });
        }
        console.log('   GASエディタを開きました。左メニュー「プロジェクトの履歴」→「バージョンの一括削除」で削除できます。');
      } catch (e) { /* ignore */ }
    }
  }
}

/** deploy-config にない古いデプロイだけ削除（オーナー・スタッフの2件は必ず保持） */
function cleanupOldDeployments(keepIds) {
  try {
    const result = runCapture(`${clasp} deployments`);
    if (!result.success) {
      console.log('   deployments 取得失敗。スキップします。');
      return 0;
    }
    const allIds = getDeploymentIds(result.stdout + result.stderr);
    const keepSet = new Set(keepIds.map(id => String(id).trim()));
    let deleted = 0;
    for (const id of allIds) {
      if (!keepSet.has(id)) {
        const delResult = runCapture(`${clasp} undeploy "${id}"`);
        if (delResult.success) {
          deleted++;
          console.log('   古いデプロイを削除: ' + id.substring(0, 25) + '...');
        }
      }
    }
    return deleted;
  } catch (e) {
    console.log('   削除処理でエラー: ' + e.message);
    return 0;
  }
}

function fetchUrl(url, redirectCount = 0) {
  const MAX_REDIRECTS = 5;
  if (redirectCount >= MAX_REDIRECTS) return Promise.reject(new Error('Too many redirects'));

  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; clasp-deploy/1.0)' } }, (res) => {
      if (res.statusCode >= 301 && res.statusCode <= 303 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        const nextHost = (new URL(next)).hostname;
        if (nextHost.includes('script.google.com') && !nextHost.includes('accounts.')) {
          return fetchUrl(next, redirectCount + 1).then(resolve, reject);
        }
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/** オーナー用（通常ブラウザ）とスタッフ用（Chromeシークレット）を開く */
function openBrowserUrls(ownerUrl, staffUrl) {
  try {
    if (process.platform === 'win32') {
      // オーナー用: デフォルトブラウザ（通常モード）
      execSync('start "" "' + ownerUrl + '"', { shell: true });
      // スタッフ用: Chrome シークレットモード
      try {
        execSync('start chrome --incognito "' + staffUrl + '"', { shell: true });
      } catch (e) {
        // Chrome が見つからない場合はデフォルトブラウザで開く
        execSync('start "" "' + staffUrl + '"', { shell: true });
        console.log('   ※ Chrome が見つからないためスタッフ用は通常ブラウザで開きました。');
      }
    } else {
      execSync('open "' + ownerUrl + '"', { shell: true });
      execSync('open -a "Google Chrome" --args --incognito "' + staffUrl + '"', { shell: true });
    }
    console.log('オーナー用（通常）・スタッフ用（シークレット）をブラウザで開きました。');
  } catch (e) {
    // ブラウザ起動に失敗してもデプロイは成功しているので無視
  }
}

/** Apps Scriptのエディタをブラウザで開く */
function openDeploymentsPage() {
  try {
    if (!fs.existsSync(claspJsonPath)) {
      console.log('   ※ .clasp.json が見つかりません。Apps Scriptを手動で開いてください。');
      return;
    }
    const claspConfig = JSON.parse(fs.readFileSync(claspJsonPath, 'utf8'));
    const scriptId = claspConfig.scriptId;
    if (!scriptId) {
      console.log('   ※ スクリプトIDが見つかりません。Apps Scriptを手動で開いてください。');
      return;
    }
    // Apps ScriptエディタのURLを開く
    const editorUrl = `https://script.google.com/home/projects/${scriptId}/edit`;
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      execSync('start "" "' + editorUrl + '"', { shell: true });
    } else {
      execSync('open "' + editorUrl + '"', { shell: true });
    }
    console.log('   Apps Scriptエディタをブラウザで開きました。');
    console.log('   上部メニューの「デプロイ」→「デプロイを管理」をクリックしてください。');
  } catch (e) {
    console.log('   Apps Scriptエディタを開く際にエラー:', e.message);
    console.log('   手動でApps Scriptを開いてください: https://script.google.com/');
  }
}

async function main() {
  if (!fs.existsSync(configPath)) {
    console.error('エラー: deploy-config.json がありません。');
    console.error('deploy-config.sample.json をコピーして deploy-config.json を作成し、');
    console.error('ownerDeploymentId と staffDeploymentId を設定してください。');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const ownerId = (config.ownerDeploymentId || '').trim();
  const staffId = (config.staffDeploymentId || '').trim();

  if (!ownerId || ownerId.includes('オーナー')) {
    console.error('エラー: deploy-config.json の ownerDeploymentId を設定してください。');
    process.exit(1);
  }
  if (!staffId || staffId.includes('スタッフ')) {
    console.error('エラー: deploy-config.json の staffDeploymentId を設定してください。');
    process.exit(1);
  }

  const pushOnly = process.argv.includes('--push-only');

  // プッシュ前バリデーション: ChecklistApp.gsが.claspignoreで除外されているか確認
  const claspignorePath = path.join(__dirname, '.claspignore');
  if (fs.existsSync(claspignorePath)) {
    const ignoreContent = fs.readFileSync(claspignorePath, 'utf8');
    if (!ignoreContent.includes('ChecklistApp.gs')) {
      console.error('警告: .claspignore に ChecklistApp.gs が含まれていません。');
      console.error('予約管理アプリに ChecklistApp.gs がプッシュされると SHEET_NAME 重複エラーが発生します。');
      console.error('.claspignore に "ChecklistApp.gs" を追加してください。');
      process.exit(1);
    }
  }

  console.log('1. コードをプッシュしています...');
  const pushResult1 = runCapture(`${clasp} push --force`);
  if (!pushResult1.success) {
    console.error('   clasp push に失敗しました。');
    console.error('   ' + (pushResult1.stdout + pushResult1.stderr).slice(0, 500));
    console.error('');
    console.error('   clasp がインストールされていない場合: npm install @google/clasp --save-dev');
    console.error('   ログインが必要な場合: npx clasp login');
    process.exit(1);
  }
  console.log('   プッシュ完了');

  if (pushOnly) {
    // ここから先は「プッシュのみ」用の軽量オートメーション
    const currentOwnerId = ownerId;
    const currentStaffId = staffId;
    const staffUrl = 'https://script.google.com/macros/s/' + currentStaffId + '/exec?staff=1';
    const ownerUrl = 'https://script.google.com/macros/s/' + currentOwnerId + '/exec';
    const urlUpdateSecret = (config.urlUpdateSecret || '').trim();
    const updateUrl = ownerUrl + '?action=setStaffUrl&url=' + encodeURIComponent(staffUrl) + (urlUpdateSecret ? '&secret=' + encodeURIComponent(urlUpdateSecret) : '');

    console.log('');
    console.log('2. スタッフ用URLをオーナー設定に自動反映しています（push-only モード）...');
    try {
      const res = await fetchUrl(updateUrl);
      const trimmed = (res || '').trim();
      if (trimmed === 'OK') {
        console.log('   スタッフ用URLを設定タブに反映しました。');
      } else {
        console.log('   自動反映に失敗しました。必要であれば手動で設定してください。');
        const preview = trimmed.slice(0, 150);
        if (preview) console.log('   サーバー応答:', preview + (trimmed.length > 150 ? '...' : ''));
        console.log('   スタッフ用URL: ' + staffUrl);
      }
    } catch (e) {
      console.log('   URL反映時にエラー:', e.message);
      console.log('   必要であれば手動で設定してください。スタッフ用URL: ' + staffUrl);
    }

    console.log('');
    console.log('プッシュのみ完了しました。（--push-only）');
    console.log('');
    console.log('【最新のURL】');
    console.log('オーナー用: ' + ownerUrl);
    console.log('スタッフ用: ' + staffUrl);
    console.log('');

    // push-only 時もブラウザを自動で開く（スタッフ用はシークレットモード）
    openBrowserUrls(ownerUrl, staffUrl);

    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let currentOwnerId = ownerId;
  let currentStaffId = staffId;
  let ownerWasCreated = false;
  let staffWasCreated = false;

  // 1.5. オーナー・スタッフ以外の古いデプロイを削除（20件上限による自動アーカイブ防止）
  console.log('1.5. オーナー・スタッフ以外の古いデプロイを削除しています...');
  const keepIds = [ownerId, staffId].filter(Boolean);
  const deletedCount = cleanupOldDeployments(keepIds);
  if (deletedCount > 0) {
    console.log('   ' + deletedCount + ' 件削除しました。');
  } else {
    console.log('   削除対象はありませんでした。');
  }

  // 1.6. バージョン数チェック（200件上限の監視）
  console.log('1.6. バージョン数を確認しています...');
  const claspConfig = JSON.parse(fs.readFileSync(claspJsonPath, 'utf8'));
  checkVersionLimit(claspConfig.scriptId);
  console.log('');

  // 既存デプロイ一覧を取得（オーナー・スタッフ共通で使う）
  const deploymentsInfo = runCapture(`${clasp} deployments`);
  const deploymentsText = deploymentsInfo.success ? (deploymentsInfo.stdout + deploymentsInfo.stderr) : '';

  // 2. オーナー用デプロイ（既存IDで更新。失敗時は既存デプロイを探す→最終手段で新規作成）
  console.log('2. オーナー用デプロイを更新しています...');
  let ownerResult = runCapture(`${clasp} deploy --deploymentId "${ownerId}" --description "オーナー用 ${today}"`);
  if (!ownerResult.success) {
    const ownerErr = (ownerResult.stdout + ownerResult.stderr).toLowerCase();
    if (ownerErr.includes('20 versioned deployments') || ownerErr.includes('versioned deployments')) {
      console.error('   デプロイの上限（20個）に達しています。');
      console.error('   Apps Script「デプロイを管理」で不要なデプロイを手動で削除してから再実行してください。');
      process.exit(1);
    }
    // 既存デプロイから「オーナー用」を探す（URL変更を最小限に）
    const foundOwner = findDeploymentByDescription(deploymentsText, 'オーナー用', [staffId]);
    if (foundOwner) {
      console.log('   既存の「オーナー用」デプロイを発見: ' + foundOwner.substring(0, 30) + '...');
      ownerResult = runCapture(`${clasp} deploy --deploymentId "${foundOwner}" --description "オーナー用 ${today}"`);
      if (ownerResult.success) {
        currentOwnerId = foundOwner;
        config.ownerDeploymentId = foundOwner;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
        console.log('   deploy-config.json を更新しました。');
      }
    }
    if (!ownerResult.success) {
      // 最終手段: 新規作成
      console.log('   既存デプロイが見つかりません。新規作成します...');
      ownerResult = runCapture(`${clasp} deploy --description "オーナー用 ${today}"`);
      if (!ownerResult.success) {
        console.error('   オーナー用デプロイの新規作成にも失敗しました。');
        console.error('   出力: ' + (ownerResult.stdout + ownerResult.stderr).slice(0, 300));
        process.exit(1);
      }
      const newOwnerId = parseDeploymentId(ownerResult.stdout, ownerResult.stderr);
      if (newOwnerId) {
        currentOwnerId = newOwnerId;
        ownerWasCreated = true;
        config.ownerDeploymentId = newOwnerId;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
        console.log('   新しいオーナー用デプロイID: ' + newOwnerId);
        console.log('   deploy-config.json を更新しました。');
      }
    }
  }

  // 3. スタッフ用デプロイ（マニフェストをスタッフ設定に切り替えてからデプロイ）
  console.log('3. スタッフ用デプロイを更新しています...');
  console.log('   マニフェストをスタッフ用設定に切り替えて再プッシュしています...');
  setWebappConfig(STAFF_WEBAPP);
  const pushResult2 = runCapture(`${clasp} push --force`);
  if (!pushResult2.success) {
    console.error('   スタッフ用 clasp push に失敗しました。');
    console.error('   ' + (pushResult2.stdout + pushResult2.stderr).slice(0, 500));
    setWebappConfig(OWNER_WEBAPP); // マニフェストを戻す
    process.exit(1);
  }
  let staffResult = runCapture(`${clasp} deploy --deploymentId "${staffId}" --description "スタッフ用 ${today}"`);
  if (!staffResult.success) {
    const staffErr = (staffResult.stdout + staffResult.stderr).toLowerCase();
    if (staffErr.includes('20 versioned deployments') || staffErr.includes('versioned deployments')) {
      console.error('   デプロイの上限（20個）に達しています。');
      console.error('   Apps Script「デプロイを管理」で不要なデプロイを手動で削除してから再実行してください。');
      process.exit(1);
    }
    // 既存デプロイから「スタッフ用」を探す（URL変更を最小限に）
    const foundStaff = findDeploymentByDescription(deploymentsText, 'スタッフ用', [currentOwnerId]);
    if (foundStaff) {
      console.log('   既存の「スタッフ用」デプロイを発見: ' + foundStaff.substring(0, 30) + '...');
      staffResult = runCapture(`${clasp} deploy --deploymentId "${foundStaff}" --description "スタッフ用 ${today}"`);
      if (staffResult.success) {
        currentStaffId = foundStaff;
        config.staffDeploymentId = foundStaff;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
        console.log('   deploy-config.json を更新しました。');
      }
    }
    if (!staffResult.success) {
      // 最終手段: 新規作成
      console.log('   既存デプロイが見つかりません。新規作成します...');
      staffResult = runCapture(`${clasp} deploy --description "スタッフ用 ${today}"`);
      if (!staffResult.success) {
        console.error('   スタッフ用デプロイの新規作成にも失敗しました。');
        console.error('   出力: ' + (staffResult.stdout + staffResult.stderr).slice(0, 300));
        process.exit(1);
      }
      const newStaffId = parseDeploymentId(staffResult.stdout, staffResult.stderr);
      if (newStaffId) {
        currentStaffId = newStaffId;
        staffWasCreated = true;
        config.staffDeploymentId = newStaffId;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
        console.log('   新しいスタッフ用デプロイID: ' + newStaffId);
        console.log('   deploy-config.json を更新しました。');
      }
    }
  }

  // マニフェストをオーナー用設定に戻す（ローカルファイルのみ。次回デプロイに備える）
  setWebappConfig(OWNER_WEBAPP);
  console.log('   マニフェストをオーナー用設定に戻しました。');

  const staffUrl = 'https://script.google.com/macros/s/' + currentStaffId + '/exec?staff=1';
  const ownerUrl = 'https://script.google.com/macros/s/' + currentOwnerId + '/exec';
  const urlUpdateSecret = (config.urlUpdateSecret || '').trim();
  const updateUrl = ownerUrl + '?action=setStaffUrl&url=' + encodeURIComponent(staffUrl) + (urlUpdateSecret ? '&secret=' + encodeURIComponent(urlUpdateSecret) : '');

  // スタッフ用URLの自動反映
  console.log('4. スタッフ用URLをオーナー画面に自動反映しています...');

  let urlReflected = false;
  try {
    const res = await fetchUrl(updateUrl);
    const trimmed = (res || '').trim();
    if (trimmed === 'OK') {
      console.log('   スタッフ用URLを設定タブに反映しました。');
      urlReflected = true;
    }
  } catch (e) {
    // 失敗しても続行
  }

  if (!urlReflected) {
    console.log('   スタッフ用URLの自動反映はスキップされました（デプロイ自体は成功しています）。');
    console.log('   必要に応じて、オーナー画面の「設定」→「スタッフ用URL」に以下を貼り付けてください:');
    console.log('   ' + staffUrl);
  }

  console.log('');
  console.log('デプロイ完了しました。');
  console.log('');
  
  // 新規デプロイが作成された場合は手動設定が必要な旨を表示
  if (ownerWasCreated || staffWasCreated) {
    console.log('【警告】新規デプロイが作成されました。');
    console.log('GASエディタの「デプロイを管理」で以下を確認してください:');
    console.log('');
    if (ownerWasCreated) {
      console.log('【オーナー用】 説明: オーナー用 ' + today);
      console.log('   - 次のユーザーとして実行: アクセスしているユーザー');
      console.log('   - アクセスできるユーザー: 全員');
    }
    if (staffWasCreated) {
      console.log('【スタッフ用】 説明: スタッフ用 ' + today);
      console.log('   - 次のユーザーとして実行: 自分');
      console.log('   - アクセスできるユーザー: Google アカウントを持つ全員');
    }
    console.log('');
    openDeploymentsPage();
    console.log('');
  }

  console.log('【最新のURL】');
  console.log('オーナー用: ' + ownerUrl);
  console.log('スタッフ用: ' + staffUrl);
  console.log('');

  // カレンダーURLを常に開く（オーナー＝通常ブラウザ、スタッフ＝Chromeシークレット）
  openBrowserUrls(ownerUrl, staffUrl);
}

main();
