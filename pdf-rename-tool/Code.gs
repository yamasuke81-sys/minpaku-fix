/**
 * PDF自動リネーム＆参照元比較ツール
 *
 * ワークフロー:
 *   1. scanAndPrepare() — 入力フォルダのPDFを解析→Drive内で類似PDF検索→比較シートに書き出し
 *   2. ユーザーがスプシで参照元とリネーム予定ファイルを比較確認→チェックボックスON
 *   3. executeApproved() — チェック済みファイルをリネーム＆参照元と同じフォルダへ移動
 */

// ============================================================
// 設定エリア
// ============================================================
// APIキーはスクリプトプロパティから取得（コードに直書きしない）
// 初回セットアップ: GASエディタで setupApiKey() を実行
function getApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('APIキーが未設定です。GASエディタで setupApiKey() を実行してください。');
  return key;
}

const SS_URL = 'https://docs.google.com/spreadsheets/d/17oV_2vPj33aZf7fl8A-NDgS0l4aYvsRrSJBw2JliAy0/edit?usp=drive_link';
const INPUT_FOLDER_URL = 'https://drive.google.com/drive/folders/1qHOwdBCPydL4wnZhPOfhIJAsjnyZOtRX?usp=drive_link';
const OUTPUT_FOLDER_URL = 'https://drive.google.com/drive/folders/1N0SMy_uAV2sIX1roMbJqoy2kQz79Vco3?usp=drive_link';

/**
 * 初回セットアップ: GASエディタでこの関数を1回だけ実行してAPIキーを保存
 */
function setupApiKey() {
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'YOUR_API_KEY_HERE');
  console.log('APIキーを保存しました。');
}

/**
 * WebアプリからAPIキーを設定
 */
function setApiKey(key) {
  if (!key || key.length < 10) return 'APIキーが無効です';
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  return '✅ APIキーを保存しました';
}

// ============================================================
// 設定管理
// ============================================================
/**
 * 設定を取得
 */
function getSettings() {
  var props = PropertiesService.getScriptProperties();
  return {
    taxAccountantFolderId: props.getProperty('TAX_ACCOUNTANT_FOLDER_ID') || '',
    taxAccountantFolderName: props.getProperty('TAX_ACCOUNTANT_FOLDER_NAME') || '（未設定）'
  };
}

/**
 * 設定を保存
 */
function saveSettings(settings) {
  var props = PropertiesService.getScriptProperties();

  if (settings.taxAccountantFolderUrl) {
    var folderId = extractIdFromUrl(settings.taxAccountantFolderUrl);
    try {
      var folder = DriveApp.getFolderById(folderId);
      props.setProperty('TAX_ACCOUNTANT_FOLDER_ID', folderId);
      props.setProperty('TAX_ACCOUNTANT_FOLDER_NAME', folder.getName());
      return '✅ 税理士共有フォルダを設定: ' + folder.getName();
    } catch (e) {
      return '❌ フォルダにアクセスできません: ' + e.message;
    }
  }
  return '設定なし';
}

// ============================================================
// 税理士共有
// ============================================================
/**
 * ファイルを税理士共有フォルダにコピー
 */
function shareWithTaxAccountant(scanFileId, renameTo) {
  var folderId = PropertiesService.getScriptProperties().getProperty('TAX_ACCOUNTANT_FOLDER_ID');
  if (!folderId) return '❌ 税理士共有フォルダが未設定です。設定画面で指定してください。';

  try {
    var file = DriveApp.getFileById(scanFileId);
    var folder = DriveApp.getFolderById(folderId);
    var fileName = renameTo || file.getName();
    if (!fileName.toLowerCase().endsWith('.pdf')) fileName += '.pdf';
    var copy = file.makeCopy(fileName, folder);

    // 学習データに蓄積
    saveShareLearning_(scanFileId, fileName, folderId);

    return '✅ 「' + fileName + '」を税理士共有フォルダにコピーしました';
  } catch (e) {
    return '❌ コピー失敗: ' + e.message;
  }
}

/**
 * 税理士共有の学習データを蓄積
 */
function saveShareLearning_(fileId, fileName, folderId) {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheetName = '税理士共有履歴';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, 4).setValues([['ファイル名', 'ファイルID', 'フォルダID', '共有日時']]);
    var h = sheet.getRange(1, 1, 1, 4);
    h.setBackground('#6A1B9A'); h.setFontColor('#fff'); h.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 4).setValues([[fileName, fileId, folderId, new Date()]]);
}

// ============================================================
// 参照元ファイルの変更（ファイル検索＋選択）
// ============================================================
/**
 * ファイル名でDrive内を検索
 */
function searchFilesInDrive(query) {
  if (!query || query.length < 2) return [];

  var results = [];
  try {
    var searchQuery = 'title contains "' + query.replace(/"/g, '\\"') + '" and mimeType = "application/pdf" and trashed = false';
    var files = DriveApp.searchFiles(searchQuery);
    var count = 0;
    while (files.hasNext() && count < 15) {
      var f = files.next();
      var folderId = '';
      var folderName = '';
      var parents = f.getParents();
      if (parents.hasNext()) {
        var p = parents.next();
        folderId = p.getId();
        folderName = p.getName();
      }
      results.push({
        fileId: f.getId(),
        fileName: f.getName(),
        folderId: folderId,
        folderName: folderName
      });
      count++;
    }
  } catch (e) {
    console.error('ファイル検索エラー: ' + e.message);
  }
  return results;
}

/**
 * 参照元ファイルを変更（行を更新＋学習データ蓄積）
 */
function updateReferenceFile(rowNum, newRefFileId) {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheet = ss.getSheetByName(COMPARE_SHEET_NAME);
  if (!sheet) return '❌ シートなし';

  try {
    var file = DriveApp.getFileById(newRefFileId);
    var folderId = '';
    var folderPath = '';
    var parents = file.getParents();
    if (parents.hasNext()) {
      var p = parents.next();
      folderId = p.getId();
      folderPath = getFolderPath_(folderId);
    }

    // 変更前の情報を取得（学習用）
    var oldRow = sheet.getRange(rowNum, 1, 1, TOTAL_COLS).getValues()[0];
    var oldRefName = oldRow[COL.REF_NAME - 1];
    var oldRefFileId = oldRow[COL.REF_FILE_ID - 1];
    var summary = oldRow[COL.SUMMARY - 1];
    var scanName = oldRow[COL.SCAN_NAME - 1];

    // シートを更新
    var refUrl = 'https://drive.google.com/file/d/' + newRefFileId + '/view';
    sheet.getRange(rowNum, COL.REF_NAME).setValue(file.getName());
    sheet.getRange(rowNum, COL.REF_LINK).setFormula('=HYPERLINK("' + refUrl + '","開く")');
    sheet.getRange(rowNum, COL.REF_FILE_ID).setValue(newRefFileId);
    sheet.getRange(rowNum, COL.REF_FOLDER_ID).setValue(folderId);
    sheet.getRange(rowNum, COL.DEST_FOLDER).setValue(folderPath ? '📁 ' + folderPath : '');
    sheet.getRange(rowNum, COL.DEST_FOLDER_ID).setValue(folderId);

    // 学習データに蓄積（フィードバック履歴に保存）
    if (oldRefFileId !== newRefFileId) {
      saveFeedbackHistory_(ss, {
        scanName: scanName,
        summary: summary,
        renameTo: oldRow[COL.RENAME_TO - 1],
        wrongRefName: oldRefName,
        wrongRefFileId: oldRefFileId,
        feedback: '参照元を「' + file.getName() + '」(フォルダ: ' + folderPath + ')に変更',
        timestamp: new Date()
      });
    }

    return '✅ 参照元を「' + file.getName() + '」に変更しました';
  } catch (e) {
    return '❌ 変更失敗: ' + e.message;
  }
}

// 比較シート名
const COMPARE_SHEET_NAME = '参照元比較';
const FEEDBACK_SHEET_NAME = 'フィードバック履歴';

// 比較シートのカラム定義（1始まり）
const COL = {
  CHECK:          1,  // A: チェックボックス
  SCAN_NAME:      2,  // B: スキャンファイル名
  SUMMARY:        3,  // C: 内容要約
  RENAME_TO:      4,  // D: リネーム予定名
  SCAN_LINK:      5,  // E: スキャンファイルへのリンク
  REF_NAME:       6,  // F: 参照元ファイル名
  REF_LINK:       7,  // G: 参照元ファイルへのリンク
  REF_FOLDER_ID:  8,  // H: 参照元フォルダID（移動先）
  DEST_FOLDER:    9,  // I: 移動先フォルダ候補（名前＋パス）
  DEST_FOLDER_ID:10,  // J: 移動先フォルダID
  STATUS:        11,  // K: ステータス
  SCAN_FILE_ID:  12,  // L: スキャンファイルID
  REF_FILE_ID:   13,  // M: 参照元ファイルID
  FEEDBACK:      15,  // O: 補足メモ（ユーザーフィードバック）
  TIMESTAMP:     16,  // P: 処理日時
};
const TOTAL_COLS = 16;

// ============================================================
// メニュー
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🤖 PDF自動処理')
    .addItem('📋 スキャン＆参照元検索', 'scanAndPrepare')
    .addItem('✅ チェック済みを実行（リネーム＆移動）', 'executeApproved')
    .addSeparator()
    .addItem('▶️ 従来のリネーム（即時実行）', 'autoRenamePDFs')
    .addToUi();
}

// ============================================================
// doGet — WebアプリUI表示
// ============================================================
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('PDF自動リネームツール')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// WebアプリAPI関数（google.script.run から呼ばれる）
// ============================================================

/**
 * 比較シートのデータを取得してWebアプリに返す
 */
function getCompareData() {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheet = ss.getSheetByName(COMPARE_SHEET_NAME);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, TOTAL_COLS).getValues();
  var result = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    result.push({
      rowNum: i + 2, // シート上の行番号
      checked: row[COL.CHECK - 1] === true,
      scanName: row[COL.SCAN_NAME - 1] || '',
      summary: row[COL.SUMMARY - 1] || '',
      renameTo: row[COL.RENAME_TO - 1] || '',
      refName: row[COL.REF_NAME - 1] || '',
      refFolderId: row[COL.REF_FOLDER_ID - 1] || '',
      destFolder: row[COL.DEST_FOLDER - 1] || '',
      destFolderId: row[COL.DEST_FOLDER_ID - 1] || '',
      status: row[COL.STATUS - 1] || '',
      scanFileId: row[COL.SCAN_FILE_ID - 1] || '',
      refFileId: row[COL.REF_FILE_ID - 1] || '',
      feedback: row[COL.FEEDBACK - 1] || '',
      timestamp: row[COL.TIMESTAMP - 1] ? Utilities.formatDate(new Date(row[COL.TIMESTAMP - 1]), 'Asia/Tokyo', 'MM/dd HH:mm') : ''
    });
  }
  return result;
}

/**
 * チェック状態を更新
 */
function updateCheckStatus(rowNum, checked) {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheet = ss.getSheetByName(COMPARE_SHEET_NAME);
  if (!sheet) return;
  sheet.getRange(rowNum, COL.CHECK).setValue(checked);
}

/**
 * チェック状態を一括更新
 */
function updateCheckStatusBatch(updates) {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheet = ss.getSheetByName(COMPARE_SHEET_NAME);
  if (!sheet) return;
  for (var i = 0; i < updates.length; i++) {
    sheet.getRange(updates[i].rowNum, COL.CHECK).setValue(updates[i].checked);
  }
}

/**
 * リネーム予定名を更新＋手動変更を学習データに蓄積
 */
function updateRenameTo(rowNum, newName) {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheet = ss.getSheetByName(COMPARE_SHEET_NAME);
  if (!sheet) return;

  // 変更前の名前（AI生成名）を取得
  var oldName = sheet.getRange(rowNum, COL.RENAME_TO).getValue();

  // 新しい名前を保存
  sheet.getRange(rowNum, COL.RENAME_TO).setValue(newName);

  // AI生成名と異なる場合、リネーム学習データに蓄積
  if (oldName && newName && oldName !== newName) {
    var row = sheet.getRange(rowNum, 1, 1, TOTAL_COLS).getValues()[0];
    var summary = row[COL.SUMMARY - 1] || '';
    var scanName = row[COL.SCAN_NAME - 1] || '';

    saveRenameLearning_(ss, {
      scanName: scanName,
      summary: summary,
      aiGeneratedName: oldName,
      userCorrectedName: newName,
      timestamp: new Date()
    });
  }
}

/**
 * リネーム学習データをシートに蓄積
 */
function saveRenameLearning_(ss, data) {
  var sheetName = 'リネーム学習';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    var headers = [
      'スキャンファイル名', '内容要約', 'AI生成名', 'ユーザー修正名', '登録日時'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#1565C0');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 300);
    sheet.setColumnWidth(3, 250);
    sheet.setColumnWidth(4, 250);
    sheet.setColumnWidth(5, 150);
  }

  var newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1, 1, 5).setValues([[
    data.scanName, data.summary, data.aiGeneratedName,
    data.userCorrectedName, data.timestamp
  ]]);
}

/**
 * 補足メモを保存（参照元が違う場合のフィードバック）
 */
function saveFeedback(rowNum, feedbackText) {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheet = ss.getSheetByName(COMPARE_SHEET_NAME);
  if (!sheet) return 'シートなし';

  // 比較シートの補足メモ列に保存
  sheet.getRange(rowNum, COL.FEEDBACK).setValue(feedbackText);

  // フィードバック履歴シートにも蓄積（学習用）
  var row = sheet.getRange(rowNum, 1, 1, TOTAL_COLS).getValues()[0];
  var scanName = row[COL.SCAN_NAME - 1];
  var summary = row[COL.SUMMARY - 1];
  var renameTo = row[COL.RENAME_TO - 1];
  var refName = row[COL.REF_NAME - 1];
  var refFileId = row[COL.REF_FILE_ID - 1];

  saveFeedbackHistory_(ss, {
    scanName: scanName,
    summary: summary,
    renameTo: renameTo,
    wrongRefName: refName,
    wrongRefFileId: refFileId,
    feedback: feedbackText,
    timestamp: new Date()
  });

  return '✅ 補足メモを保存しました';
}

/**
 * フィードバック履歴シートに蓄積
 */
function saveFeedbackHistory_(ss, data) {
  var sheet = ss.getSheetByName(FEEDBACK_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(FEEDBACK_SHEET_NAME);
    var headers = [
      'スキャンファイル名', '内容要約', 'リネーム予定名',
      '誤った参照元ファイル名', '誤った参照元ID',
      '補足メモ（正しい情報）', '登録日時'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#e65100');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 300);
    sheet.setColumnWidth(3, 200);
    sheet.setColumnWidth(4, 200);
    sheet.setColumnWidth(5, 100);
    sheet.setColumnWidth(6, 400);
    sheet.setColumnWidth(7, 150);
  }

  var newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1, 1, 7).setValues([[
    data.scanName, data.summary, data.renameTo,
    data.wrongRefName, data.wrongRefFileId,
    data.feedback, data.timestamp
  ]]);
}

/**
 * フィードバック履歴を取得（類似検索で活用するため）
 */
function getFeedbackHistory_() {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheet = ss.getSheetByName(FEEDBACK_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return '';

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  var feedbackLines = data.map(function(row) {
    return '・「' + row[0] + '」(内容: ' + String(row[1]).substring(0, 50) + ') → 誤参照:「' + row[3] + '」→ 補足:「' + row[5] + '」';
  });

  // 最新20件のみ返す（プロンプトが長くなりすぎないように）
  return feedbackLines.slice(-20).join('\n');
}

/**
 * リネーム学習データを取得（ファイル名生成で活用するため）
 */
function getRenameLearningHistory_() {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheet = ss.getSheetByName('リネーム学習');
  if (!sheet || sheet.getLastRow() < 2) return '';

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  var lines = data.map(function(row) {
    return '・内容:「' + String(row[1]).substring(0, 50) + '」→ AI提案:「' + row[2] + '」→ 正しい名前:「' + row[3] + '」';
  });

  return lines.slice(-20).join('\n');
}

/**
 * 失敗データをクリアして再スキャン可能にする
 * 「解析失敗」「生成失敗」のある行を削除
 */
function clearFailedEntries() {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheet = ss.getSheetByName(COMPARE_SHEET_NAME);
  if (!sheet) return '「参照元比較」シートがありません';

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return '削除対象なし';

  var data = sheet.getRange(2, 1, lastRow - 1, TOTAL_COLS).getValues();
  var deletedCount = 0;

  // 下から削除（行番号がずれないように）
  for (var i = data.length - 1; i >= 0; i--) {
    var summary = String(data[i][COL.SUMMARY - 1]);
    var renameTo = String(data[i][COL.RENAME_TO - 1]);
    var status = String(data[i][COL.STATUS - 1]);
    if (summary.indexOf('解析失敗') !== -1 || renameTo.indexOf('生成失敗') !== -1 || status.indexOf('エラー') !== -1) {
      sheet.deleteRow(i + 2);
      deletedCount++;
    }
  }

  return deletedCount + '件の失敗データを削除しました。再スキャンできます。';
}

/**
 * チェック済みの行を比較シートから削除して再スキャン対象にする
 */
function requeueCheckedEntries() {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheet = ss.getSheetByName(COMPARE_SHEET_NAME);
  if (!sheet) return '「参照元比較」シートがありません';

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return '対象なし';

  var data = sheet.getRange(2, 1, lastRow - 1, TOTAL_COLS).getValues();
  var deletedCount = 0;

  for (var i = data.length - 1; i >= 0; i--) {
    var isChecked = data[i][COL.CHECK - 1];
    var status = String(data[i][COL.STATUS - 1]);
    // チェック済み ＆ まだ完了していない行のみ削除
    if (isChecked === true && status.indexOf('完了') === -1) {
      sheet.deleteRow(i + 2);
      deletedCount++;
    }
  }

  return deletedCount + '件を削除しました。再スキャンで再処理されます。';
}

/**
 * スキャン＆参照元検索（Web版 — 処理件数を返す）
 */
function scanAndPrepareWeb() {
  scanAndPrepare();
  // 処理件数を返す（最後のログから取得は難しいので、比較シートの行数を返す）
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var sheet = ss.getSheetByName(COMPARE_SHEET_NAME);
  return sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
}

/**
 * 実行（Web版 — 結果メッセージを返す）
 */
function executeApprovedWeb() {
  return executeApproved();
}

/**
 * スプレッドシートURLを返す
 */
function getSpreadsheetUrl() {
  return SS_URL;
}

/**
 * Gemini API接続診断（Webアプリから呼べる）
 */
function runDiagnostics() {
  var results = [];

  // 1. APIキー確認
  try {
    var apiKey = getApiKey_();
    results.push('【APIキー】 ✅ ' + apiKey.substring(0, 10) + '...');
  } catch (e) {
    results.push('【APIキー】 ❌ ' + e.message);
    return results.join('\n');
  }

  // 2. モデル取得テスト
  try {
    var model = getLatestAvailableModel();
    results.push('【モデル】 ✅ ' + model);
  } catch (e) {
    results.push('【モデル】 ❌ ' + e.message);
  }

  // 3. Gemini APIテスト（テキストのみ）
  try {
    var model = getLatestAvailableModel();
    var url = 'https://generativelanguage.googleapis.com/v1beta/' + model + ':generateContent?key=' + getApiKey_();
    var payload = { contents: [{ parts: [{ text: 'こんにちは。「テスト成功」とだけ返してください。' }] }] };
    var resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    results.push('【テキストAPI】 HTTP ' + resp.getResponseCode());
    if (resp.getResponseCode() !== 200) {
      results.push('  → レスポンス: ' + resp.getContentText().substring(0, 300));
    } else {
      var r = JSON.parse(resp.getContentText());
      results.push('  → 応答: ' + (r.candidates ? r.candidates[0].content.parts[0].text : '(candidates なし)'));
    }
  } catch (e) {
    results.push('【テキストAPI】 ❌ ' + e.message);
  }

  // 4. 入力フォルダ確認
  try {
    var folder = DriveApp.getFolderById(extractIdFromUrl(INPUT_FOLDER_URL));
    var files = folder.getFilesByType(MimeType.PDF);
    var count = 0;
    var sampleSize = 0;
    while (files.hasNext()) {
      var f = files.next();
      if (count === 0) sampleSize = f.getSize();
      count++;
    }
    results.push('【入力フォルダ】 ✅ PDF ' + count + '件');
    if (sampleSize > 0) results.push('  → 1件目のサイズ: ' + Math.round(sampleSize / 1024) + 'KB');
  } catch (e) {
    results.push('【入力フォルダ】 ❌ ' + e.message);
  }

  // 5. PDF付きAPIテスト（1件目のPDFで試行）
  try {
    var folder = DriveApp.getFolderById(extractIdFromUrl(INPUT_FOLDER_URL));
    var files = folder.getFilesByType(MimeType.PDF);
    if (files.hasNext()) {
      var testFile = files.next();
      var blob = testFile.getBlob();
      var bytes = blob.getBytes();
      results.push('【PDFテスト】 ファイル: ' + testFile.getName() + ' (' + Math.round(bytes.length / 1024) + 'KB)');

      var model = getLatestAvailableModel();
      var url = 'https://generativelanguage.googleapis.com/v1beta/' + model + ':generateContent?key=' + getApiKey_();
      var payload = {
        contents: [{ parts: [
          { text: 'このPDFの内容を一言で教えてください。' },
          { inline_data: { mime_type: 'application/pdf', data: Utilities.base64Encode(bytes) } }
        ] }],
        generationConfig: { temperature: 0.1 }
      };
      var resp = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify(payload), muteHttpExceptions: true
      });
      results.push('  → HTTP ' + resp.getResponseCode());
      if (resp.getResponseCode() !== 200) {
        results.push('  → エラー: ' + resp.getContentText().substring(0, 500));
      } else {
        var r = JSON.parse(resp.getContentText());
        results.push('  → ✅ 応答: ' + (r.candidates ? r.candidates[0].content.parts[0].text.substring(0, 100) : '(candidates なし)'));
      }
    }
  } catch (e) {
    results.push('【PDFテスト】 ❌ ' + e.message);
  }

  return results.join('\n');
}

// ============================================================
// 1. スキャン＆参照元検索
// ============================================================
function scanAndPrepare() {
  var startTime = Date.now();
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var compareSheet = getOrCreateCompareSheet_(ss);
  var rulesSheet = ss.getSheets()[0];
  var rules = loadRules_(rulesSheet);

  var inputFolder = DriveApp.getFolderById(extractIdFromUrl(INPUT_FOLDER_URL));
  var files = inputFolder.getFilesByType(MimeType.PDF);

  if (!files.hasNext()) {
    console.log('入力フォルダにPDFファイルがありません。');
    return;
  }

  // 既に比較シートに載っているファイルIDを取得（重複防止）
  var existingIds = getExistingFileIds_(compareSheet);
  var activeModel = getLatestAvailableModel();
  var processedCount = 0;

  // 過去のフィードバック履歴を取得（全ステップで活用）
  var feedbackHistory = getFeedbackHistory_();
  var renameLearning = getRenameLearningHistory_();

  while (files.hasNext()) {
    // 4.5分で安全停止
    if (Date.now() - startTime > 4 * 60 * 1000) break;

    var file = files.next();
    var fileId = file.getId();

    // 既に比較シートにある場合はスキップ
    if (existingIds[fileId]) continue;

    try {
      var blob = file.getBlob();
      var fileSizeKB = Math.round(blob.getBytes().length / 1024);

      var summary, renameTo;

      // 20MB超のPDFはGemini APIに送れない
      if (fileSizeKB > 20000) {
        summary = '（ファイルサイズ超過: ' + fileSizeKB + 'KB — Gemini上限20MB）';
        renameTo = '（生成失敗: サイズ超過）';
      } else {
        // PDFの内容要約＋リネーム名を1回のAPI呼び出しで取得（学習データ込み）
        var analyzed = analyzeAndRename_(blob, rules, activeModel, feedbackHistory, renameLearning);
        summary = analyzed.summary;
        renameTo = analyzed.renameTo;
      }

      if (renameTo === 'ERROR') renameTo = '（生成失敗）';

      // Drive内で類似PDFを検索
      var refResult = findSimilarFile_(summary, activeModel, feedbackHistory, rules);

      // 比較シートに行を追加
      var newRow = compareSheet.getLastRow() + 1;
      var driveFileUrl = 'https://drive.google.com/file/d/' + fileId + '/view';
      var refUrl = refResult.fileId ? 'https://drive.google.com/file/d/' + refResult.fileId + '/view' : '';

      compareSheet.getRange(newRow, COL.CHECK).insertCheckboxes();
      compareSheet.getRange(newRow, COL.SCAN_NAME).setValue(file.getName());
      compareSheet.getRange(newRow, COL.SUMMARY).setValue(summary);
      var cleanRenameTo = renameTo.replace(/[\\/:*?"<>|]/g, '').trim();
      compareSheet.getRange(newRow, COL.RENAME_TO).setValue(cleanRenameTo);
      compareSheet.getRange(newRow, COL.SCAN_LINK).setFormula('=HYPERLINK("' + driveFileUrl + '","開く")');

      var isNewFile = !refResult.fileId;

      if (isNewFile) {
        // 参照元なし → 新規ファイル扱い
        compareSheet.getRange(newRow, COL.REF_NAME).setValue('🆕 新規（参照元なし）→ ' + cleanRenameTo);
        compareSheet.getRange(newRow, COL.REF_LINK).setValue('―');
        compareSheet.getRange(newRow, COL.REF_FOLDER_ID).setValue('');

        // PDFの内容からDrive内の適切な保存先フォルダを提案
        var folderSuggestion = suggestDestinationFolder_(summary, cleanRenameTo, activeModel, feedbackHistory, rules);
        if (folderSuggestion.folderId) {
          compareSheet.getRange(newRow, COL.DEST_FOLDER).setValue('📁 ' + folderSuggestion.folderPath);
          compareSheet.getRange(newRow, COL.DEST_FOLDER_ID).setValue(folderSuggestion.folderId);
        } else {
          compareSheet.getRange(newRow, COL.DEST_FOLDER).setValue('（候補なし → outputフォルダへ）');
          compareSheet.getRange(newRow, COL.DEST_FOLDER_ID).setValue('');
        }

        compareSheet.getRange(newRow, COL.STATUS).setValue('🆕 新規 - 確認待ち');
        compareSheet.getRange(newRow, 1, 1, TOTAL_COLS).setBackground('#FFF9C4');
      } else {
        // 参照元あり → 参照元フォルダを移動先に自動セット
        compareSheet.getRange(newRow, COL.REF_NAME).setValue(refResult.fileName);
        compareSheet.getRange(newRow, COL.REF_LINK).setFormula('=HYPERLINK("' + refUrl + '","開く")');
        compareSheet.getRange(newRow, COL.REF_FOLDER_ID).setValue(refResult.folderId || '');
        // 参照元フォルダをそのまま移動先候補にコピー
        var refFolderName = refResult.folderId ? getFolderPath_(refResult.folderId) : '';
        compareSheet.getRange(newRow, COL.DEST_FOLDER).setValue(refFolderName ? '📁 ' + refFolderName : '');
        compareSheet.getRange(newRow, COL.DEST_FOLDER_ID).setValue(refResult.folderId || '');
        compareSheet.getRange(newRow, COL.STATUS).setValue('確認待ち');
      }
      compareSheet.getRange(newRow, COL.SCAN_FILE_ID).setValue(fileId);
      compareSheet.getRange(newRow, COL.REF_FILE_ID).setValue(refResult.fileId || '');
      compareSheet.getRange(newRow, COL.TIMESTAMP).setValue(new Date());

      processedCount++;
    } catch (e) {
      console.error('ファイル処理エラー [' + file.getName() + ']: ' + e.message);
      // エラーでも行を追加して記録
      var errRow = compareSheet.getLastRow() + 1;
      compareSheet.getRange(errRow, COL.SCAN_NAME).setValue(file.getName());
      compareSheet.getRange(errRow, COL.STATUS).setValue('エラー: ' + e.message);
      compareSheet.getRange(errRow, COL.SCAN_FILE_ID).setValue(file.getId());
      compareSheet.getRange(errRow, COL.TIMESTAMP).setValue(new Date());
    }

    Utilities.sleep(5000); // API負荷軽減（1ファイルあたり複数回API呼び出しのため長めに待機）
  }

  console.log('scanAndPrepare完了: ' + processedCount + '件処理');
}

// ============================================================
// 2. チェック済みファイルを実行（リネーム＆移動）
// ============================================================
function executeApproved() {
  var ss = SpreadsheetApp.openByUrl(SS_URL);
  var compareSheet = ss.getSheetByName(COMPARE_SHEET_NAME);
  if (!compareSheet) {
    return '「参照元比較」シートが見つかりません。先に「スキャン＆参照元検索」を実行してください。';
  }

  var lastRow = compareSheet.getLastRow();
  if (lastRow < 2) {
    return '処理対象のデータがありません。';
  }

  var data = compareSheet.getRange(2, 1, lastRow - 1, TOTAL_COLS).getValues();
  var outputFolder = DriveApp.getFolderById(extractIdFromUrl(OUTPUT_FOLDER_URL));
  var executedCount = 0;
  var errorCount = 0;

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var isChecked = row[COL.CHECK - 1];
    var status = row[COL.STATUS - 1];

    // チェック済み & まだ実行されていない行のみ処理
    if (isChecked !== true || String(status).indexOf('完了') !== -1) continue;

    var fileId = row[COL.SCAN_FILE_ID - 1];
    var renameTo = row[COL.RENAME_TO - 1];
    var refFolderId = row[COL.REF_FOLDER_ID - 1];
    var destFolderId = row[COL.DEST_FOLDER_ID - 1];

    if (!fileId || !renameTo) continue;

    // 移動先の優先順位: DEST_FOLDER_ID（ユーザーが確認済み）> REF_FOLDER_ID > outputフォルダ
    var moveFolderId = destFolderId || refFolderId || '';

    try {
      var file = DriveApp.getFileById(fileId);

      // リネーム（.pdf拡張子を確保）
      var cleanName = renameTo.replace(/[\\/:*?"<>|]/g, '').trim();
      if (!cleanName.toLowerCase().endsWith('.pdf')) {
        cleanName += '.pdf';
      }
      file.setName(cleanName);

      // 移動先フォルダへ移動
      var movedTo = '';
      if (moveFolderId) {
        try {
          var destFolder = DriveApp.getFolderById(moveFolderId);
          file.moveTo(destFolder);
          movedTo = destFolder.getName();
        } catch (moveErr) {
          console.error('指定フォルダへの移動失敗、outputフォルダへ移動: ' + moveErr.message);
          file.moveTo(outputFolder);
          movedTo = 'output（フォールバック）';
        }
      } else {
        file.moveTo(outputFolder);
        movedTo = 'output';
      }

      // ステータス更新
      var sheetRow = i + 2; // ヘッダー分+1
      var doneLabel = '✅ 完了（→ ' + movedTo + '）';
      compareSheet.getRange(sheetRow, COL.STATUS).setValue(doneLabel);
      compareSheet.getRange(sheetRow, COL.TIMESTAMP).setValue(new Date());
      executedCount++;

    } catch (e) {
      console.error('実行エラー [行' + (i + 2) + ']: ' + e.message);
      compareSheet.getRange(i + 2, COL.STATUS).setValue('エラー: ' + e.message);
      errorCount++;
    }
  }

  var msg = '実行完了: ' + executedCount + '件リネーム＆移動';
  if (errorCount > 0) msg += '（エラー: ' + errorCount + '件）';
  console.log(msg);
  return msg;
}

// ============================================================
// PDF内容解析（Gemini）
// ============================================================
function analyzePdfContent_(pdfBlob, modelName) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + getApiKey_();

  var payload = {
    contents: [{
      parts: [
        { text: '以下のPDFの内容を簡潔に要約してください。以下の情報を抽出してください：\n' +
                '・書類の種類（請求書、明細、通知書など）\n' +
                '・発行元（会社名・団体名）\n' +
                '・対象物件や契約名があれば\n' +
                '・対象期間（年月）\n' +
                '・金額があれば\n' +
                '3〜5行で簡潔にまとめてください。' },
        { inline_data: { mime_type: 'application/pdf', data: Utilities.base64Encode(pdfBlob.getBytes()) } }
      ]
    }],
    generationConfig: { temperature: 0.1 }
  };

  var result = callGeminiWithRetry_(url, payload, 'analyzePdf');
  if (result && result.__error) return '（解析失敗: ' + result.__error + '）';
  return result || '（解析失敗）';
}

// ============================================================
// PDF解析＋リネーム名を1回のAPI呼び出しで同時取得（API節約）
// ============================================================
function analyzeAndRename_(pdfBlob, rules, modelName, feedbackHistory, renameLearning) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + getApiKey_();

  var promptText = '以下のPDFについて2つの作業をしてください。\n\n' +
    '【作業1: 内容要約】\n' +
    '以下の情報を抽出して3〜5行で要約:\n' +
    '・書類の種類（請求書、明細、通知書など）\n' +
    '・発行元（会社名・団体名）\n' +
    '・対象物件や契約名\n' +
    '・対象期間（年月）\n' +
    '・金額\n\n' +
    '【作業2: ファイル名生成】\n' +
    '以下のルールに従い、新しいファイル名を1つ生成:\n' + rules + '\n\n';

  if (renameLearning) {
    promptText += '【過去のリネーム修正履歴（ユーザーが望む命名パターンを学習してください）】\n' +
      'AIが提案した名前をユーザーがどう修正したかの履歴です。この傾向に合わせてファイル名を生成してください:\n' +
      renameLearning + '\n\n';
  }

  if (feedbackHistory) {
    promptText += '【過去の補足情報（分類の参考にしてください）】\n' + feedbackHistory + '\n\n';
  }

  promptText += '【出力形式】必ず以下のJSON形式で出力（他の文字は不要）:\n' +
    '{"summary":"要約テキスト","renameTo":"新しいファイル名"}';

  var payload = {
    contents: [{
      parts: [
        { text: promptText },
        { inline_data: { mime_type: 'application/pdf', data: Utilities.base64Encode(pdfBlob.getBytes()) } }
      ]
    }],
    generationConfig: { temperature: 0.1 }
  };

  var result = callGeminiWithRetry_(url, payload, 'analyzeAndRename');

  // エラーオブジェクトが返ってきた場合
  if (result && result.__error) {
    return { summary: '（API失敗: ' + result.__error + '）', renameTo: 'ERROR', error: result.__error };
  }

  if (result && typeof result === 'string') {
    try {
      var jsonMatch = result.match(/\{[\s\S]*"summary"[\s\S]*"renameTo"[\s\S]*\}/);
      if (jsonMatch) {
        var parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || '（解析失敗）',
          renameTo: parsed.renameTo || 'ERROR'
        };
      }
    } catch (e) {
      console.warn('JSON解析失敗、フォールバック: ' + e.message);
    }
  }

  // 統合APIが失敗した場合は個別に呼び出す（フォールバック）
  console.log('統合API失敗、個別呼び出しにフォールバック');
  var summary = analyzePdfContent_(pdfBlob, modelName);
  var renameTo = askGemini(pdfBlob, rules, modelName);
  return { summary: summary, renameTo: renameTo };
}

// ============================================================
// 共通Gemini API呼び出し（指数バックオフ付きリトライ）
// ============================================================
function callGeminiWithRetry_(url, payload, context) {
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var maxRetries = 3;
  var baseDelay = 3000;
  var lastError = '';

  for (var i = 0; i < maxRetries; i++) {
    try {
      var response = UrlFetchApp.fetch(url, options);
      var code = response.getResponseCode();

      if (code === 200) {
        var result = JSON.parse(response.getContentText());
        if (result.candidates && result.candidates[0] && result.candidates[0].content) {
          return result.candidates[0].content.parts[0].text.trim();
        }
        var reason = 'unknown';
        if (result.candidates && result.candidates[0] && result.candidates[0].finishReason) {
          reason = result.candidates[0].finishReason;
        }
        if (result.promptFeedback && result.promptFeedback.blockReason) {
          reason = 'BLOCKED: ' + result.promptFeedback.blockReason;
        }
        lastError = 'candidates無し(' + reason + ')';
        console.warn('[' + context + '] ' + lastError);
        // SAFETY等でブロックされた場合はリトライしても無駄
        break;
      }

      if (code === 429 || code === 503) {
        var delay = baseDelay * Math.pow(2, i);
        lastError = 'HTTP' + code + '(レート制限)';
        console.warn('[' + context + '] ' + lastError + ' → ' + (delay/1000) + '秒待機');
        Utilities.sleep(delay);
        continue;
      }

      var errBody = response.getContentText().substring(0, 200);
      lastError = 'HTTP' + code;
      console.error('[' + context + '] ' + lastError + ': ' + errBody);
      break; // 400系エラーはリトライしても無駄

    } catch (e) {
      lastError = e.message.substring(0, 100);
      console.error('[' + context + '] 例外: ' + lastError);
      Utilities.sleep(baseDelay * Math.pow(2, i));
    }
  }

  console.error('[' + context + '] 失敗: ' + lastError);
  return { __error: lastError };
}

// ============================================================
// Drive内で類似ファイルを検索
// ============================================================
function findSimilarFile_(summary, modelName, feedbackHistory, rules) {
  var emptyResult = { fileId: '', fileName: '', folderId: '' };

  // Geminiに検索キーワードを生成させる（学習データ＋ルール込み）
  var keywords = extractSearchKeywords_(summary, modelName, feedbackHistory, rules);
  if (!keywords) return emptyResult;

  // キーワードでDriveを検索（PDFのみ、inputフォルダ以外）
  var inputFolderId = extractIdFromUrl(INPUT_FOLDER_URL);
  var candidates = searchDriveForPdf_(keywords, inputFolderId);

  if (candidates.length === 0) return emptyResult;

  if (candidates.length === 1) {
    return candidates[0];
  }

  // フィードバック履歴＋ルールを含めて最適候補を選定
  return selectBestMatch_(summary, candidates, modelName, feedbackHistory, rules);
}

/**
 * 要約から検索用キーワードを抽出（Gemini）
 */
function extractSearchKeywords_(summary, modelName, feedbackHistory, rules) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + getApiKey_();

  var promptText = '以下のPDF内容の要約から、Googleドライブで類似ファイルを検索するためのキーワードを生成してください。\n' +
    '会社名・物件名・書類種別など、ファイル名に含まれそうな重要キーワードを2〜4個、スペース区切りで出力してください。\n' +
    'キーワードのみ出力し、説明は不要です。\n\n' +
    '【要約】\n' + summary;

  if (rules) {
    promptText += '\n\n【変名ルール（ファイル命名の前提条件）】\n' + rules;
  }

  if (feedbackHistory) {
    promptText += '\n\n【過去の補足情報（正しい分類の参考にしてください）】\n' + feedbackHistory;
  }

  var payload = {
    contents: [{
      parts: [{ text: promptText }]
    }],
    generationConfig: { temperature: 0.1 }
  };

  var r = callGeminiWithRetry_(url, payload, 'extractKeywords');
  return (r && typeof r === 'string') ? r : '';
}

/**
 * Driveからキーワードで検索
 */
function searchDriveForPdf_(keywords, excludeFolderId) {
  var results = [];
  var keywordList = keywords.split(/[\s,　]+/).filter(function(k) { return k.length > 0; });

  // 各キーワードでAND検索クエリを構築
  // Drive検索: タイトルにキーワードを含むPDF
  var queryParts = keywordList.map(function(kw) {
    return 'title contains "' + kw.replace(/"/g, '\\"') + '"';
  });

  // まずAND検索、結果がなければ個別キーワードで検索
  var queries = [];
  if (queryParts.length > 1) {
    queries.push(queryParts.join(' and ') + ' and mimeType = "application/pdf" and trashed = false');
  }
  // 個別キーワードでも検索（フォールバック用）
  keywordList.forEach(function(kw) {
    queries.push('title contains "' + kw.replace(/"/g, '\\"') + '" and mimeType = "application/pdf" and trashed = false');
  });

  var seenIds = {};
  for (var q = 0; q < queries.length; q++) {
    if (results.length >= 10) break; // 最大10件

    try {
      var searchResults = DriveApp.searchFiles(queries[q]);
      while (searchResults.hasNext() && results.length < 10) {
        var f = searchResults.next();
        var fId = f.getId();

        // 入力フォルダ内のファイルは除外、重複も除外
        if (seenIds[fId]) continue;
        seenIds[fId] = true;

        // 入力フォルダ内かチェック
        var parents = f.getParents();
        var isInInputFolder = false;
        while (parents.hasNext()) {
          if (parents.next().getId() === excludeFolderId) {
            isInInputFolder = true;
            break;
          }
        }
        if (isInInputFolder) continue;

        // 親フォルダIDを取得
        var folderId = '';
        var parentFolders = f.getParents();
        if (parentFolders.hasNext()) {
          folderId = parentFolders.next().getId();
        }

        results.push({
          fileId: fId,
          fileName: f.getName(),
          folderId: folderId
        });
      }
    } catch (e) {
      console.error('Drive検索エラー: ' + e.message);
    }
  }

  return results;
}

/**
 * 候補から最適な参照元を選定（Gemini）
 */
function selectBestMatch_(summary, candidates, modelName, feedbackHistory, rules) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + getApiKey_();

  var candidateList = candidates.map(function(c, i) {
    return (i + 1) + '. ' + c.fileName;
  }).join('\n');

  var promptText = '以下のPDFの内容要約に最も類似したファイルを、候補リストから1つ選んでください。\n' +
    '同じ会社・同じ書類種別・同じ物件のファイルを優先してください（対象月が違うのは問題ありません）。\n' +
    '番号のみ（例: 1）を出力してください。適切な候補がない場合は 0 と出力してください。\n\n' +
    '【PDF内容要約】\n' + summary + '\n\n' +
    '【候補リスト】\n' + candidateList;

  if (rules) {
    promptText += '\n\n【変名ルール（ファイル命名の前提条件）】\n' + rules;
  }

  if (feedbackHistory) {
    promptText += '\n\n【過去の誤り（参考にして同じ間違いを避けてください）】\n' + feedbackHistory;
  }

  var payload = {
    contents: [{
      parts: [{ text: promptText }]
    }],
    generationConfig: { temperature: 0.1 }
  };

  var answer = callGeminiWithRetry_(url, payload, 'selectBestMatch');
  if (answer && typeof answer === 'string') {
    var idx = parseInt(answer, 10);
    if (idx > 0 && idx <= candidates.length) return candidates[idx - 1];
  }
  return candidates[0];
}

// ============================================================
// 比較シートの初期化
// ============================================================
function getOrCreateCompareSheet_(ss) {
  var sheet = ss.getSheetByName(COMPARE_SHEET_NAME);
  if (sheet) return sheet;

  // 新規作成
  sheet = ss.insertSheet(COMPARE_SHEET_NAME);

  // ヘッダー設定
  var headers = [
    'チェック', 'スキャンファイル名', '内容要約', 'リネーム予定名',
    'スキャンファイル', '参照元ファイル名', '参照元ファイル',
    '参照元フォルダID', '移動先フォルダ候補', '移動先フォルダID',
    'ステータス', 'スキャンファイルID', '参照元ファイルID',
    '補足メモ', '処理日時'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // ヘッダーの書式設定
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#1a73e8');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);

  // 列幅の調整
  sheet.setColumnWidth(COL.CHECK, 60);
  sheet.setColumnWidth(COL.SCAN_NAME, 200);
  sheet.setColumnWidth(COL.SUMMARY, 350);
  sheet.setColumnWidth(COL.RENAME_TO, 250);
  sheet.setColumnWidth(COL.SCAN_LINK, 60);
  sheet.setColumnWidth(COL.REF_NAME, 250);
  sheet.setColumnWidth(COL.REF_LINK, 60);
  sheet.setColumnWidth(COL.REF_FOLDER_ID, 100);
  sheet.setColumnWidth(COL.DEST_FOLDER, 300);
  sheet.setColumnWidth(COL.DEST_FOLDER_ID, 100);
  sheet.setColumnWidth(COL.STATUS, 180);
  sheet.setColumnWidth(COL.SCAN_FILE_ID, 100);
  sheet.setColumnWidth(COL.REF_FILE_ID, 100);
  sheet.setColumnWidth(COL.FEEDBACK, 300);         // 補足メモ
  sheet.setColumnWidth(COL.TIMESTAMP, 150);

  // 内部ID列を非表示（ユーザーには不要）
  sheet.hideColumns(COL.REF_FOLDER_ID);
  sheet.hideColumns(COL.DEST_FOLDER_ID);
  sheet.hideColumns(COL.SCAN_FILE_ID);
  sheet.hideColumns(COL.REF_FILE_ID);

  return sheet;
}

/**
 * 比較シートに既に登録されているファイルIDを取得
 */
function getExistingFileIds_(sheet) {
  var ids = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return ids;

  var fileIds = sheet.getRange(2, COL.SCAN_FILE_ID, lastRow - 1, 1).getValues();
  for (var i = 0; i < fileIds.length; i++) {
    if (fileIds[i][0]) ids[fileIds[i][0]] = true;
  }
  return ids;
}

// ============================================================
// ルール読み込み
// ============================================================
function loadRules_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return 'ルールがありません。';
  return sheet.getRange(1, 1, lastRow, 2).getValues()
    .map(function(row) { return row[0] + ': ' + row[1]; }).join('\n');
}

// ============================================================
// 移動先フォルダの提案（新規ファイル用）
// ============================================================

/**
 * PDFの内容要約とリネーム予定名から、Drive内の適切な保存先フォルダを提案
 */
function suggestDestinationFolder_(summary, renameTo, modelName, feedbackHistory, rules) {
  var emptyResult = { folderId: '', folderPath: '' };

  // Geminiにフォルダ検索用キーワードを生成させる（学習データ＋ルール込み）
  var keywords = extractFolderKeywords_(summary, renameTo, modelName, feedbackHistory, rules);
  if (!keywords) return emptyResult;

  // キーワードでDrive内のフォルダを検索
  var candidateFolders = searchDriveForFolders_(keywords);
  if (candidateFolders.length === 0) return emptyResult;

  if (candidateFolders.length === 1) {
    return candidateFolders[0];
  }

  // 複数候補 → 学習データ＋ルール込みで最適なフォルダを選定
  return selectBestFolder_(summary, renameTo, candidateFolders, modelName, feedbackHistory, rules);
}

/**
 * フォルダ検索用キーワードを生成
 */
function extractFolderKeywords_(summary, renameTo, modelName, feedbackHistory, rules) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + getApiKey_();

  var promptText = '以下のPDFの情報から、Googleドライブ内で保存先フォルダを探すためのキーワードを生成してください。\n' +
    '物件名、会社名、カテゴリ（水道、電気、ガス、保険、税金など）を考慮してください。\n' +
    'フォルダ名に含まれそうなキーワードを2〜3個、スペース区切りで出力してください。\n' +
    'キーワードのみ出力し、説明は不要です。\n\n' +
    '【内容要約】\n' + summary + '\n\n' +
    '【リネーム予定名】\n' + renameTo;

  if (rules) {
    promptText += '\n\n【変名ルール（前提条件）】\n' + rules;
  }

  if (feedbackHistory) {
    promptText += '\n\n【過去の補足情報（正しいフォルダ分類の参考にしてください）】\n' + feedbackHistory;
  }

  var payload = {
    contents: [{
      parts: [{ text: promptText }]
    }],
    generationConfig: { temperature: 0.1 }
  };

  var r = callGeminiWithRetry_(url, payload, 'extractFolderKeywords');
  return (r && typeof r === 'string') ? r : '';
}

/**
 * Drive内でフォルダを検索
 */
function searchDriveForFolders_(keywords) {
  var results = [];
  var keywordList = keywords.split(/[\s,　]+/).filter(function(k) { return k.length > 0; });

  // 各キーワードで個別にフォルダ検索
  var seenIds = {};

  // まずAND検索
  if (keywordList.length > 1) {
    var andParts = keywordList.map(function(kw) {
      return 'title contains "' + kw.replace(/"/g, '\\"') + '"';
    });
    var andQuery = andParts.join(' and ') + ' and mimeType = "application/vnd.google-apps.folder" and trashed = false';
    collectFolderResults_(andQuery, seenIds, results, 5);
  }

  // 個別キーワードでフォールバック
  for (var i = 0; i < keywordList.length && results.length < 8; i++) {
    var query = 'title contains "' + keywordList[i].replace(/"/g, '\\"') + '" and mimeType = "application/vnd.google-apps.folder" and trashed = false';
    collectFolderResults_(query, seenIds, results, 8);
  }

  return results;
}

/**
 * フォルダ検索結果を収集
 */
function collectFolderResults_(query, seenIds, results, maxCount) {
  try {
    var searchResults = DriveApp.searchFolders(query);
    while (searchResults.hasNext() && results.length < maxCount) {
      var folder = searchResults.next();
      var fId = folder.getId();
      if (seenIds[fId]) continue;
      seenIds[fId] = true;

      var path = getFolderPath_(fId);
      results.push({
        folderId: fId,
        folderPath: path
      });
    }
  } catch (e) {
    console.error('フォルダ検索エラー: ' + e.message);
  }
}

/**
 * フォルダIDからパスを構築（マイドライブからの相対パス）
 */
function getFolderPath_(folderId) {
  try {
    var folder = DriveApp.getFolderById(folderId);
    var parts = [folder.getName()];
    var parent = folder.getParents();

    // 最大5階層まで遡る
    var depth = 0;
    while (parent.hasNext() && depth < 5) {
      var p = parent.next();
      var pName = p.getName();
      if (pName === 'マイドライブ' || pName === 'My Drive') break;
      parts.unshift(pName);
      parent = p.getParents();
      depth++;
    }

    return parts.join(' / ');
  } catch (e) {
    return '（パス取得失敗）';
  }
}

/**
 * 候補から最適なフォルダを選定（Gemini）
 */
function selectBestFolder_(summary, renameTo, candidates, modelName, feedbackHistory, rules) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + getApiKey_();

  var candidateList = candidates.map(function(c, i) {
    return (i + 1) + '. ' + c.folderPath;
  }).join('\n');

  var promptText = '以下のPDFの保存先として最も適切なフォルダを候補から1つ選んでください。\n' +
    '書類の種類（水道、電気、ガス、保険、税金など）と物件名・会社名が一致するフォルダを優先してください。\n' +
    '番号のみ（例: 1）を出力してください。適切な候補がない場合は 0 と出力してください。\n\n' +
    '【PDF内容】\n' + summary + '\n\n' +
    '【リネーム予定名】\n' + renameTo + '\n\n' +
    '【フォルダ候補】\n' + candidateList;

  if (rules) {
    promptText += '\n\n【変名ルール（前提条件）】\n' + rules;
  }

  if (feedbackHistory) {
    promptText += '\n\n【過去の補足情報（フォルダ選択の参考にしてください）】\n' + feedbackHistory;
  }

  var payload = {
    contents: [{
      parts: [{ text: promptText }]
    }],
    generationConfig: { temperature: 0.1 }
  };

  var answer = callGeminiWithRetry_(url, payload, 'selectBestFolder');
  if (answer && typeof answer === 'string') {
    var idx = parseInt(answer, 10);
    if (idx > 0 && idx <= candidates.length) return candidates[idx - 1];
  }
  return candidates[0];
}

// ============================================================
// 既存の即時リネーム処理（後方互換）
// ============================================================
function autoRenamePDFs() {
  var startTime = Date.now();
  try {
    var inputFolder = DriveApp.getFolderById(extractIdFromUrl(INPUT_FOLDER_URL));
    var outputFolder = DriveApp.getFolderById(extractIdFromUrl(OUTPUT_FOLDER_URL));
    var ss = SpreadsheetApp.openByUrl(SS_URL);
    var sheet = ss.getSheets()[0];
    var rules = loadRules_(sheet);

    var files = inputFolder.getFilesByType(MimeType.PDF);
    if (!files.hasNext()) return;

    var activeModel = getLatestAvailableModel();
    while (files.hasNext()) {
      if (Date.now() - startTime > 4 * 60 * 1000) break;
      var file = files.next();
      var blob = file.getBlob();

      var newName = askGemini(blob, rules, activeModel);
      if (newName && newName !== 'ERROR') {
        var cleanName = newName.replace(/[\\/:*?"<>|]/g, '').trim();
        file.setName(cleanName + '.pdf');
        file.moveTo(outputFolder);
      }

      Utilities.sleep(3000);
    }
  } catch (e) {
    console.error('実行エラー: ' + e.message);
  }
}

// ============================================================
// 共通ユーティリティ
// ============================================================
function extractIdFromUrl(url) {
  if (!url || !url.includes('/')) return url;
  var match = url.match(/[-\w]{25,}/);
  return match ? match[0] : url;
}

function getLatestAvailableModel() {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + getApiKey_();
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      var data = JSON.parse(response.getContentText());
      var validModels = data.models.filter(function(m) {
        return m.supportedGenerationMethods &&
               m.supportedGenerationMethods.includes('generateContent') &&
               m.name.includes('flash');
      });
      if (validModels.length > 0) {
        validModels.sort(function(a, b) { return b.name.localeCompare(a.name); });
        return validModels[0].name;
      }
    }
  } catch (e) {}
  return 'models/gemini-2.5-flash';
}

function askGemini(pdfBlob, rules, modelName) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + getApiKey_();

  var payload = {
    contents: [{
      parts: [
        { text: '以下のルールを守り、このPDFの新しいファイル名を1つだけ出力してください。挨拶は不要です。\n\n【ルール】\n' + rules },
        { inline_data: { mime_type: 'application/pdf', data: Utilities.base64Encode(pdfBlob.getBytes()) } }
      ]
    }],
    generationConfig: { temperature: 0.1 }
  };

  var result = callGeminiWithRetry_(url, payload, 'askGemini');
  if (result && result.__error) return 'ERROR';
  return (typeof result === 'string') ? result : 'ERROR';
}
