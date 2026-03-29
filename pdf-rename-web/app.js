/**
 * PDF リネームツール - GitHub Pages版 メインアプリ
 * Google OAuth + Drive API + Sheets API + Gemini API
 * すべてブラウザ上で動作（サーバー不要）
 */

// ============================================================
// グローバル状態
// ============================================================
let accessToken = '';
let currentData = [];
let taxFolders = [];

// ============================================================
// 初期化
// ============================================================
window.onload = function () {
  // Google Identity Services コールバック
  window.handleCredentialResponse = handleCredentialResponse;
  loadSettingsFromLocalStorage();
  checkExistingToken();
};

function loadSettingsFromLocalStorage() {
  document.getElementById('setting-gemini-key').value =
    localStorage.getItem(CONFIG.LS_KEYS.GEMINI_API_KEY) || '';
  document.getElementById('setting-input-folder').value =
    localStorage.getItem(CONFIG.LS_KEYS.INPUT_FOLDER_ID) || '';
  document.getElementById('setting-output-folder').value =
    localStorage.getItem(CONFIG.LS_KEYS.OUTPUT_FOLDER_ID) || '';
  document.getElementById('setting-spreadsheet-id').value = CONFIG.SPREADSHEET_ID;
}

// ============================================================
// OAuth 認証
// ============================================================
function initGoogleAuth() {
  const client = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: (response) => {
      if (response.access_token) {
        accessToken = response.access_token;
        localStorage.setItem(CONFIG.LS_KEYS.ACCESS_TOKEN, accessToken);
        localStorage.setItem(CONFIG.LS_KEYS.TOKEN_EXPIRY, Date.now() + 3500000);
        onSignedIn();
      }
    },
  });
  client.requestAccessToken();
}

function handleCredentialResponse(response) {
  // ID tokenからアクセストークンを取得する場合のコールバック
  console.log('Credential response received');
}

function checkExistingToken() {
  const token = localStorage.getItem(CONFIG.LS_KEYS.ACCESS_TOKEN);
  const expiry = localStorage.getItem(CONFIG.LS_KEYS.TOKEN_EXPIRY);
  if (token && expiry && Date.now() < parseInt(expiry)) {
    accessToken = token;
    onSignedIn();
  } else {
    showSignInButton();
  }
}

function showSignInButton() {
  document.getElementById('auth-status').innerHTML =
    '<button class="btn btn-primary btn-sm" onclick="initGoogleAuth()"><i class="bi bi-google"></i> Googleでログイン</button>';
}

function onSignedIn() {
  document.getElementById('auth-status').innerHTML =
    '<span class="badge bg-success"><i class="bi bi-check-circle"></i> ログイン済み</span>' +
    ' <button class="btn btn-outline-secondary btn-sm ms-2" onclick="signOut()">ログアウト</button>';
  loadData();
}

function signOut() {
  accessToken = '';
  localStorage.removeItem(CONFIG.LS_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(CONFIG.LS_KEYS.TOKEN_EXPIRY);
  google.accounts.oauth2.revoke(accessToken);
  showSignInButton();
  currentData = [];
  renderTable();
}

// ============================================================
// API ヘルパー
// ============================================================
async function apiFetch(url, options = {}) {
  const headers = {
    'Authorization': 'Bearer ' + accessToken,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const resp = await fetch(url, { ...options, headers });
  if (resp.status === 401) {
    // トークン期限切れ
    showSignInButton();
    throw new Error('認証が期限切れです。再ログインしてください。');
  }
  return resp;
}

function getGeminiApiKey() {
  const key = localStorage.getItem(CONFIG.LS_KEYS.GEMINI_API_KEY);
  if (!key) throw new Error('Gemini APIキーが未設定です。設定画面で入力してください。');
  return key;
}

// ============================================================
// Sheets API
// ============================================================
async function readSheetData(sheetName) {
  const range = encodeURIComponent(sheetName);
  const url = `${CONFIG.SHEETS_API}/${CONFIG.SPREADSHEET_ID}/values/${range}`;
  const resp = await apiFetch(url);
  const data = await resp.json();
  return data.values || [];
}

async function writeSheetRow(sheetName, row, values) {
  const range = encodeURIComponent(`${sheetName}!A${row}`);
  const url = `${CONFIG.SHEETS_API}/${CONFIG.SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
  await apiFetch(url, {
    method: 'PUT',
    body: JSON.stringify({ values: [values] }),
  });
}

async function appendSheetRow(sheetName, values) {
  const range = encodeURIComponent(`${sheetName}!A:A`);
  const url = `${CONFIG.SHEETS_API}/${CONFIG.SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  await apiFetch(url, {
    method: 'POST',
    body: JSON.stringify({ values: [values] }),
  });
}

async function updateSheetCell(sheetName, row, col, value) {
  const colLetter = String.fromCharCode(64 + col);
  const range = encodeURIComponent(`${sheetName}!${colLetter}${row}`);
  const url = `${CONFIG.SHEETS_API}/${CONFIG.SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
  await apiFetch(url, {
    method: 'PUT',
    body: JSON.stringify({ values: [[value]] }),
  });
}

// ============================================================
// Drive API
// ============================================================
async function searchDriveFiles(query, pageSize = 20) {
  const q = encodeURIComponent(query);
  const url = `${CONFIG.DRIVE_API}/files?q=${q}&pageSize=${pageSize}&fields=files(id,name,parents,mimeType)&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=allDrives`;
  const resp = await apiFetch(url);
  const data = await resp.json();
  return data.files || [];
}

async function listFolderContents(folderId) {
  const parentId = folderId || 'root';
  const q = encodeURIComponent(`'${parentId}' in parents and trashed = false`);
  const url = `${CONFIG.DRIVE_API}/files?q=${q}&pageSize=100&fields=files(id,name,mimeType,parents)&orderBy=name&includeItemsFromAllDrives=true&supportsAllDrives=true`;
  const resp = await apiFetch(url);
  const data = await resp.json();
  const files = data.files || [];
  return {
    folders: files.filter(f => f.mimeType === 'application/vnd.google-apps.folder'),
    files: files.filter(f => f.mimeType === 'application/pdf'),
  };
}

async function moveFile(fileId, newFolderId) {
  // 現在の親を取得
  const metaResp = await apiFetch(`${CONFIG.DRIVE_API}/files/${fileId}?fields=parents&supportsAllDrives=true`);
  const meta = await metaResp.json();
  const oldParents = (meta.parents || []).join(',');

  const url = `${CONFIG.DRIVE_API}/files/${fileId}?addParents=${newFolderId}&removeParents=${oldParents}&supportsAllDrives=true`;
  await apiFetch(url, { method: 'PATCH' });
}

async function copyFile(fileId, newName, destFolderId) {
  const url = `${CONFIG.DRIVE_API}/files/${fileId}/copy?supportsAllDrives=true`;
  await apiFetch(url, {
    method: 'POST',
    body: JSON.stringify({ name: newName, parents: [destFolderId] }),
  });
}

async function renameFile(fileId, newName) {
  const url = `${CONFIG.DRIVE_API}/files/${fileId}?supportsAllDrives=true`;
  await apiFetch(url, {
    method: 'PATCH',
    body: JSON.stringify({ name: newName }),
  });
}

async function getFileContent(fileId) {
  const url = `${CONFIG.DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`;
  const resp = await apiFetch(url, { headers: { 'Content-Type': '' } });
  return await resp.blob();
}

async function getOrCreateSubFolder(parentId, folderName) {
  const q = encodeURIComponent(`'${parentId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const url = `${CONFIG.DRIVE_API}/files?q=${q}&fields=files(id)&supportsAllDrives=true`;
  const resp = await apiFetch(url);
  const data = await resp.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  // 作成
  const createUrl = `${CONFIG.DRIVE_API}/files?supportsAllDrives=true`;
  const createResp = await apiFetch(createUrl, {
    method: 'POST',
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  const created = await createResp.json();
  return created.id;
}

// ============================================================
// Gemini API
// ============================================================
async function callGemini(prompt, pdfBase64) {
  const apiKey = getGeminiApiKey();
  const url = `${CONFIG.GEMINI_API}/${CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const parts = [{ text: prompt }];
  if (pdfBase64) {
    parts.push({ inline_data: { mime_type: 'application/pdf', data: pdfBase64 } });
  }

  const maxRetries = 3;
  const baseDelay = 3000;

  for (let i = 0; i < maxRetries; i++) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1 },
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        return data.candidates[0].content.parts[0].text.trim();
      }
      return null;
    }

    if (resp.status === 429 || resp.status === 503) {
      const delay = baseDelay * Math.pow(2, i);
      console.warn(`Gemini API ${resp.status} → ${delay / 1000}秒待機`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    const errText = await resp.text();
    console.error(`Gemini API HTTP${resp.status}: ${errText.substring(0, 200)}`);
    return null;
  }
  return null;
}

// ============================================================
// データ読み込み
// ============================================================
async function loadData() {
  try {
    showLoading(true);
    const rows = await readSheetData(CONFIG.SHEET_NAME);
    if (rows.length < 2) {
      currentData = [];
      renderTable();
      showLoading(false);
      return;
    }

    currentData = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      currentData.push({
        rowNum: i + 1,
        checked: r[CONFIG.COL.CHECK - 1] === 'TRUE',
        scanName: r[CONFIG.COL.SCAN_NAME - 1] || '',
        summary: r[CONFIG.COL.SUMMARY - 1] || '',
        renameTo: r[CONFIG.COL.RENAME_TO - 1] || '',
        refName: r[CONFIG.COL.REF_NAME - 1] || '',
        refFolderId: r[CONFIG.COL.REF_FOLDER_ID - 1] || '',
        destFolder: r[CONFIG.COL.DEST_FOLDER - 1] || '',
        destFolderId: r[CONFIG.COL.DEST_FOLDER_ID - 1] || '',
        destFolder2: r[CONFIG.COL.DEST_FOLDER2 - 1] || '',
        destFolderId2: r[CONFIG.COL.DEST_FOLDER2_ID - 1] || '',
        status: r[CONFIG.COL.STATUS - 1] || '',
        scanFileId: r[CONFIG.COL.SCAN_FILE_ID - 1] || '',
        refFileId: r[CONFIG.COL.REF_FILE_ID - 1] || '',
        feedback: r[CONFIG.COL.FEEDBACK - 1] || '',
        taxShare: parseTaxShare(r[CONFIG.COL.TAX_SHARE - 1]),
        docDate: r[CONFIG.COL.DOC_DATE - 1] || '',
        entityType: r[CONFIG.COL.ENTITY_TYPE - 1] || '',
        timestamp: r[CONFIG.COL.TIMESTAMP - 1] || '',
      });
    }

    renderTable();
    updateCounts();
  } catch (e) {
    showError(e.message);
  } finally {
    showLoading(false);
  }
}

function parseTaxShare(val) {
  if (!val) return [];
  try { return JSON.parse(val); } catch (e) { return []; }
}

// ============================================================
// テーブル描画
// ============================================================
function renderTable() {
  const tbody = document.getElementById('data-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (currentData.length === 0) {
    document.getElementById('empty-msg').style.display = 'block';
    document.getElementById('table-wrapper').style.display = 'none';
    return;
  }

  document.getElementById('empty-msg').style.display = 'none';
  document.getElementById('table-wrapper').style.display = 'block';

  currentData.forEach((row, idx) => {
    const tr = document.createElement('tr');
    const isDone = (row.status || '').includes('完了');
    const isNew = (row.status || '').includes('新規');

    if (isNew) tr.style.background = '#FFFDE7';
    if (isDone) tr.style.opacity = '0.6';
    if (row.checked && !isDone) tr.style.background = '#E3F2FD';

    // チェック
    tr.innerHTML += `<td><input type="checkbox" class="form-check-input" ${row.checked ? 'checked' : ''} ${isDone ? 'disabled' : ''} onchange="App.toggleCheck(${idx}, this.checked)"></td>`;
    // スキャンファイル名
    tr.innerHTML += `<td><small>${esc(row.scanName)}</small>${row.scanFileId ? ` <a href="https://drive.google.com/file/d/${row.scanFileId}/view" target="_blank"><i class="bi bi-box-arrow-up-right text-primary"></i></a>` : ''}</td>`;
    // 内容要約
    tr.innerHTML += `<td class="summary-cell" data-tooltip="${esc(row.summary)}"><span class="summary-text">${esc(row.summary)}</span></td>`;
    // リネーム予定名
    tr.innerHTML += isDone
      ? `<td><small>${esc(row.renameTo)}</small></td>`
      : `<td><input type="text" class="rename-input" value="${esc(row.renameTo)}" onblur="App.updateRename(${idx}, this.value)"></td>`;
    // 参照元
    let refHtml = `<small>${esc(row.refName)}</small>`;
    if (row.refFileId) refHtml += ` <a href="https://drive.google.com/file/d/${row.refFileId}/view" target="_blank"><i class="bi bi-box-arrow-up-right text-primary"></i></a>`;
    if (!isDone) refHtml += ` <button class="btn btn-outline-info btn-sm py-0 px-1" onclick="App.openBrowse(${idx},'ref')"><i class="bi bi-folder2-open"></i></button>`;
    if (!isDone) refHtml += ` <button class="btn btn-outline-secondary btn-sm py-0 px-1" onclick="App.clearRef(${idx})"><i class="bi bi-x-circle"></i></button>`;
    tr.innerHTML += `<td>${refHtml}</td>`;
    // 移動先1
    let d1Html = `<small>${esc(row.destFolder)}</small>`;
    if (!isDone) d1Html += ` <button class="btn btn-outline-info btn-sm py-0 px-1" onclick="App.openBrowse(${idx},'dest')"><i class="bi bi-folder2-open"></i></button>`;
    tr.innerHTML += `<td class="folder-cell">${d1Html}</td>`;
    // 移動先2
    let d2Html = `<small>${esc(row.destFolder2)}</small>`;
    if (!isDone) d2Html += ` <button class="btn btn-outline-info btn-sm py-0 px-1" onclick="App.openBrowse(${idx},'dest2')"><i class="bi bi-folder2-open"></i></button>`;
    if (!isDone && row.destFolderId2) d2Html += ` <button class="btn btn-outline-secondary btn-sm py-0 px-1" onclick="App.clearDest2(${idx})"><i class="bi bi-x-circle"></i></button>`;
    tr.innerHTML += `<td class="folder-cell">${d2Html}</td>`;
    // ステータス
    let badgeClass = 'bg-secondary';
    if (isDone) badgeClass = 'bg-success';
    else if (isNew) badgeClass = 'bg-warning text-dark';
    else if ((row.status || '').includes('エラー')) badgeClass = 'bg-danger';
    else badgeClass = 'bg-info';
    tr.innerHTML += `<td><span class="badge ${badgeClass}">${esc(row.status)}</span></td>`;
    // 補足メモ
    tr.innerHTML += isDone
      ? `<td><small>${esc(row.feedback)}</small></td>`
      : `<td><input type="text" class="rename-input" style="font-size:0.75rem" value="${esc(row.feedback)}" onblur="App.updateFeedback(${idx}, this.value)"></td>`;
    // 操作
    let opsHtml = '';
    if (row.scanFileId) opsHtml += `<a href="https://drive.google.com/file/d/${row.scanFileId}/view" target="_blank" class="btn btn-outline-primary btn-sm py-0 px-1"><i class="bi bi-file-pdf"></i></a>`;
    tr.innerHTML += `<td>${opsHtml}</td>`;
    // 税理士
    tr.innerHTML += `<td><small>${esc(row.taxShare.join(', '))}</small></td>`;

    tbody.appendChild(tr);
  });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function updateCounts() {
  const total = currentData.length;
  let waiting = 0, done = 0, newCount = 0;
  currentData.forEach(r => {
    const s = r.status || '';
    if (s.includes('完了')) done++;
    else if (s.includes('新規')) { waiting++; newCount++; }
    else if (s.includes('待ち')) waiting++;
  });
  const el = document.getElementById('status-counts');
  if (el) el.innerHTML = `全体: <strong>${total}</strong> | 確認待ち: <strong>${waiting}</strong> | 完了: <strong>${done}</strong> | 新規: <strong>${newCount}</strong>`;
}

// ============================================================
// スキャン＆参照元検索
// ============================================================
async function scanAndPrepare() {
  const inputFolderId = localStorage.getItem(CONFIG.LS_KEYS.INPUT_FOLDER_ID);
  if (!inputFolderId) { alert('設定画面で入力フォルダIDを設定してください'); return; }

  showSpinner('スキャン中...', 'PDFを解析しています');
  try {
    // 入力フォルダのPDF一覧を取得
    const q = `'${inputFolderId}' in parents and mimeType = 'application/pdf' and trashed = false`;
    const files = await searchDriveFiles(q, 50);

    if (files.length === 0) {
      alert('入力フォルダにPDFがありません');
      hideSpinner();
      return;
    }

    // 既存のファイルIDを取得（重複防止）
    const existingIds = new Set(currentData.map(r => r.scanFileId));

    // ルール読み込み
    const rulesData = await readSheetData(CONFIG.SPREADSHEET_ID ? 'Sheet1' : 'ルール');
    const rules = (rulesData || []).map(r => `${r[0]}: ${r[1]}`).join('\n') || 'ルールなし';

    let processedCount = 0;
    for (const file of files) {
      if (existingIds.has(file.id)) continue;

      try {
        // PDFの内容を取得
        const blob = await getFileContent(file.id);
        const base64 = await blobToBase64(blob);

        // Gemini APIで解析
        const prompt = `以下のPDFについて作業をしてください。
【作業1: 内容要約】書類の種類、発行元、宛名、対象期間、金額を3〜5行で要約
【作業2: ファイル名生成】以下のルールに従い新しいファイル名を1つ生成:
${rules}
【作業3: 書類日付】YYYY-MM形式で抽出
【作業4: 法人/個人判定】宛名から法人か個人か判定
【出力形式】JSONのみ出力:
{"summary":"要約","renameTo":"ファイル名","docDate":"YYYY-MM","entityType":"法人 or 個人 or 不明"}`;

        const result = await callGemini(prompt, base64);
        let summary = '（解析失敗）', renameTo = '（生成失敗）', docDate = '', entityType = '不明';

        if (result) {
          try {
            const match = result.match(/\{[\s\S]*"summary"[\s\S]*\}/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              summary = parsed.summary || summary;
              renameTo = parsed.renameTo || renameTo;
              docDate = parsed.docDate || '';
              entityType = parsed.entityType || '不明';
            }
          } catch (e) {
            console.warn('JSON解析失敗:', e);
          }
        }

        // スプシに書き込み
        const newRow = [
          'FALSE', file.name, summary, renameTo,
          `https://drive.google.com/file/d/${file.id}/view`,
          '🆕 新規（参照元なし）', '', '',
          '', '', '', '',
          '🆕 新規 - 確認待ち', file.id, '',
          '', '[]', docDate, entityType,
          new Date().toISOString()
        ];
        await appendSheetRow(CONFIG.SHEET_NAME, newRow);
        processedCount++;

        // 15秒待機（レート制限対策）
        await new Promise(r => setTimeout(r, 15000));
      } catch (e) {
        console.error('ファイル処理エラー:', file.name, e);
      }
    }

    hideSpinner();
    alert(`スキャン完了: ${processedCount}件処理`);
    await loadData();
  } catch (e) {
    hideSpinner();
    showError(e.message);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

// ============================================================
// チェック済みを実行
// ============================================================
async function executeApproved() {
  const checkedItems = currentData.filter(r => r.checked && !r.status.includes('完了'));
  if (checkedItems.length === 0) { alert('チェックされたファイルがありません'); return; }
  if (!confirm(`${checkedItems.length}件を実行しますか？`)) return;

  const outputFolderId = localStorage.getItem(CONFIG.LS_KEYS.OUTPUT_FOLDER_ID);
  showSpinner('実行中...', `${checkedItems.length}件を処理しています`);

  let executedCount = 0;
  for (const item of checkedItems) {
    try {
      let cleanName = item.renameTo.replace(/[\\/:*?"<>|]/g, '').trim();
      if (!cleanName.toLowerCase().endsWith('.pdf')) cleanName += '.pdf';

      // リネーム
      await renameFile(item.scanFileId, cleanName);

      // 移動先1
      const destId = item.destFolderId || item.refFolderId || outputFolderId;
      if (destId) await moveFile(item.scanFileId, destId);

      // 移動先2（コピー）
      if (item.destFolderId2) {
        await copyFile(item.scanFileId, cleanName, item.destFolderId2);
      }

      // ステータス更新
      await updateSheetCell(CONFIG.SHEET_NAME, item.rowNum, CONFIG.COL.STATUS, '✅ 完了');
      await updateSheetCell(CONFIG.SHEET_NAME, item.rowNum, CONFIG.COL.TIMESTAMP, new Date().toISOString());
      executedCount++;
    } catch (e) {
      console.error('実行エラー:', item.scanName, e);
      await updateSheetCell(CONFIG.SHEET_NAME, item.rowNum, CONFIG.COL.STATUS, 'エラー: ' + e.message);
    }
  }

  hideSpinner();
  alert(`${executedCount}件完了`);
  await loadData();
}

// ============================================================
// UI操作
// ============================================================
function showSpinner(text, sub) {
  const el = document.getElementById('spinner-overlay');
  if (el) {
    el.style.display = 'flex';
    document.getElementById('spinner-text').textContent = text || '処理中...';
    document.getElementById('spinner-sub').textContent = sub || '';
  }
}

function hideSpinner() {
  const el = document.getElementById('spinner-overlay');
  if (el) el.style.display = 'none';
}

function showLoading(show) {
  const el = document.getElementById('loading-msg');
  if (el) el.style.display = show ? 'block' : 'none';
}

function showError(msg) {
  alert('エラー: ' + msg);
}

// ============================================================
// 設定
// ============================================================
function saveSettings() {
  localStorage.setItem(CONFIG.LS_KEYS.GEMINI_API_KEY, document.getElementById('setting-gemini-key').value);
  localStorage.setItem(CONFIG.LS_KEYS.INPUT_FOLDER_ID, document.getElementById('setting-input-folder').value);
  localStorage.setItem(CONFIG.LS_KEYS.OUTPUT_FOLDER_ID, document.getElementById('setting-output-folder').value);
  alert('設定を保存しました');
  bootstrap.Modal.getInstance(document.getElementById('settingsModal')).hide();
}

// ============================================================
// セル更新
// ============================================================
async function toggleCheck(idx, checked) {
  currentData[idx].checked = checked;
  await updateSheetCell(CONFIG.SHEET_NAME, currentData[idx].rowNum, CONFIG.COL.CHECK, checked ? 'TRUE' : 'FALSE');
  renderTable();
}

async function updateRename(idx, newName) {
  if (newName === currentData[idx].renameTo) return;
  currentData[idx].renameTo = newName;
  await updateSheetCell(CONFIG.SHEET_NAME, currentData[idx].rowNum, CONFIG.COL.RENAME_TO, newName);
}

async function updateFeedback(idx, text) {
  if (text === currentData[idx].feedback) return;
  currentData[idx].feedback = text;
  await updateSheetCell(CONFIG.SHEET_NAME, currentData[idx].rowNum, CONFIG.COL.FEEDBACK, text);
}

async function clearRef(idx) {
  if (!confirm('参照元を「新規（参照元なし）」に変更しますか？')) return;
  const rowNum = currentData[idx].rowNum;
  await updateSheetCell(CONFIG.SHEET_NAME, rowNum, CONFIG.COL.REF_NAME, '🆕 新規（参照元なし）');
  await updateSheetCell(CONFIG.SHEET_NAME, rowNum, CONFIG.COL.REF_LINK, '');
  await updateSheetCell(CONFIG.SHEET_NAME, rowNum, CONFIG.COL.REF_FILE_ID, '');
  await updateSheetCell(CONFIG.SHEET_NAME, rowNum, CONFIG.COL.REF_FOLDER_ID, '');
  await loadData();
}

async function clearDest2(idx) {
  const rowNum = currentData[idx].rowNum;
  await updateSheetCell(CONFIG.SHEET_NAME, rowNum, CONFIG.COL.DEST_FOLDER2, '');
  await updateSheetCell(CONFIG.SHEET_NAME, rowNum, CONFIG.COL.DEST_FOLDER2_ID, '');
  await loadData();
}

// ============================================================
// フォルダブラウズ
// ============================================================
let browseMode = '';
let browseIdx = -1;

function openBrowse(idx, mode) {
  browseIdx = idx;
  browseMode = mode;
  const titles = { ref: '参照元ファイルを選択', dest: '移動先フォルダ1を選択', dest2: '移動先フォルダ2を選択' };
  document.getElementById('folderBrowserModal').querySelector('.modal-title').innerHTML =
    '<i class="bi bi-folder2-open"></i> ' + (titles[mode] || '選択');
  document.getElementById('folder-browser-content').innerHTML = '<p class="text-center text-muted">読み込み中...</p>';
  new bootstrap.Modal(document.getElementById('folderBrowserModal')).show();
  loadBrowseFolder('');
}

async function loadBrowseFolder(folderId) {
  const content = document.getElementById('folder-browser-content');
  content.innerHTML = '<p class="text-center"><span class="spinner-border spinner-border-sm"></span></p>';

  try {
    const data = await listFolderContents(folderId);
    let html = '<div class="list-group">';

    if (browseMode === 'dest' || browseMode === 'dest2') {
      html += `<button class="list-group-item list-group-item-action py-1 list-group-item-success" onclick="App.selectBrowseFolder('${folderId || 'root'}')">
        <i class="bi bi-check-circle me-2"></i><strong>このフォルダを選択</strong></button>`;
    }

    data.folders.forEach(f => {
      html += `<button class="list-group-item list-group-item-action py-1" onclick="App.loadBrowseFolder('${f.id}')">
        <i class="bi bi-folder-fill text-warning me-2"></i>${esc(f.name)}</button>`;
    });

    if (browseMode === 'ref') {
      data.files.forEach(f => {
        html += `<button class="list-group-item list-group-item-action py-1" onclick="App.selectBrowseFile('${f.id}')">
          <i class="bi bi-file-pdf text-danger me-2"></i>${esc(f.name)} <span class="badge bg-primary float-end">選択</span></button>`;
      });
    }

    html += '</div>';
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = `<p class="text-danger">エラー: ${esc(e.message)}</p>`;
  }
}

async function selectBrowseFile(fileId) {
  bootstrap.Modal.getInstance(document.getElementById('folderBrowserModal')).hide();
  const rowNum = currentData[browseIdx].rowNum;
  try {
    const resp = await apiFetch(`${CONFIG.DRIVE_API}/files/${fileId}?fields=id,name,parents&supportsAllDrives=true`);
    const file = await resp.json();
    await updateSheetCell(CONFIG.SHEET_NAME, rowNum, CONFIG.COL.REF_NAME, file.name);
    await updateSheetCell(CONFIG.SHEET_NAME, rowNum, CONFIG.COL.REF_FILE_ID, fileId);
    await updateSheetCell(CONFIG.SHEET_NAME, rowNum, CONFIG.COL.REF_FOLDER_ID, (file.parents || [''])[0]);
    await loadData();
  } catch (e) { showError(e.message); }
}

async function selectBrowseFolder(folderId) {
  bootstrap.Modal.getInstance(document.getElementById('folderBrowserModal')).hide();
  const rowNum = currentData[browseIdx].rowNum;
  const slot = browseMode === 'dest2' ? 2 : 1;
  const colFolder = slot === 2 ? CONFIG.COL.DEST_FOLDER2 : CONFIG.COL.DEST_FOLDER;
  const colFolderId = slot === 2 ? CONFIG.COL.DEST_FOLDER2_ID : CONFIG.COL.DEST_FOLDER_ID;
  try {
    const resp = await apiFetch(`${CONFIG.DRIVE_API}/files/${folderId}?fields=id,name&supportsAllDrives=true`);
    const folder = await resp.json();
    await updateSheetCell(CONFIG.SHEET_NAME, rowNum, colFolder, '📁 ' + folder.name);
    await updateSheetCell(CONFIG.SHEET_NAME, rowNum, colFolderId, folderId);
    await loadData();
  } catch (e) { showError(e.message); }
}

// ============================================================
// フローティングツールチップ
// ============================================================
(function () {
  document.addEventListener('mouseover', function (e) {
    const cell = e.target.closest('.summary-cell');
    const tip = document.getElementById('floatingTooltip');
    if (cell && cell.dataset.tooltip && tip) {
      tip.textContent = cell.dataset.tooltip;
      tip.style.display = 'block';
      const rect = cell.getBoundingClientRect();
      tip.style.left = rect.left + 'px';
      tip.style.top = (rect.bottom + 4) + 'px';
    }
  });
  document.addEventListener('mouseout', function (e) {
    const cell = e.target.closest('.summary-cell');
    const tip = document.getElementById('floatingTooltip');
    if (cell && tip) tip.style.display = 'none';
  });
})();

// ============================================================
// 公開API（HTMLから呼び出し用）
// ============================================================
window.App = {
  scanAndPrepare,
  executeApproved,
  loadData,
  saveSettings,
  toggleCheck,
  updateRename,
  updateFeedback,
  clearRef,
  clearDest2,
  openBrowse,
  loadBrowseFolder,
  selectBrowseFile,
  selectBrowseFolder,
  initGoogleAuth,
  signOut,
};
