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
const API_KEY = 'AIzaSyBFUXa18JSJEOkG6ePpSwjgbKO5Fag9s9M';
const SS_URL = 'https://docs.google.com/spreadsheets/d/17oV_2vPj33aZf7fl8A-NDgS0l4aYvsRrSJBw2JliAy0/edit?usp=drive_link';
const INPUT_FOLDER_URL = 'https://drive.google.com/drive/folders/1qHOwdBCPydL4wnZhPOfhIJAsjnyZOtRX?usp=drive_link';
const OUTPUT_FOLDER_URL = 'https://drive.google.com/drive/folders/1N0SMy_uAV2sIX1roMbJqoy2kQz79Vco3?usp=drive_link';

// 比較シート名
const COMPARE_SHEET_NAME = '参照元比較';

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
  STATUS:         9,  // I: ステータス
  SCAN_FILE_ID:  10,  // J: スキャンファイルID
  REF_FILE_ID:   11,  // K: 参照元ファイルID
  TIMESTAMP:     12,  // L: 処理日時
};
const TOTAL_COLS = 12;

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
// doGet — URLアクセス時
// ============================================================
function doGet(e) {
  var mode = e && e.parameter && e.parameter.mode ? e.parameter.mode : 'scan';

  if (mode === 'execute') {
    executeApproved();
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:sans-serif;text-align:center;margin-top:50px;background:#f0f4f8;">' +
      '<h2 style="color:#34a853;">✅ チェック済みファイルのリネーム＆移動が完了しました</h2>' +
      '<p>このタブは閉じて大丈夫です。</p></body></html>'
    );
  }

  // デフォルト: スキャン＆比較準備
  scanAndPrepare();
  return HtmlService.createHtmlOutput(
    '<html><body style="font-family:sans-serif;text-align:center;margin-top:50px;background:#f0f4f8;">' +
    '<h2 style="color:#1a73e8;">📋 スキャン＆参照元検索が完了しました</h2>' +
    '<p>スプレッドシートの「参照元比較」シートを確認してください。</p>' +
    '<p><a href="' + SS_URL + '" target="_blank">スプレッドシートを開く</a></p>' +
    '</body></html>'
  );
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
    SpreadsheetApp.getUi().alert('入力フォルダにPDFファイルがありません。');
    return;
  }

  // 既に比較シートに載っているファイルIDを取得（重複防止）
  var existingIds = getExistingFileIds_(compareSheet);
  var activeModel = getLatestAvailableModel();
  var processedCount = 0;

  while (files.hasNext()) {
    // 4.5分で安全停止
    if (Date.now() - startTime > 4.5 * 60 * 1000) break;

    var file = files.next();
    var fileId = file.getId();

    // 既に比較シートにある場合はスキップ
    if (existingIds[fileId]) continue;

    try {
      var blob = file.getBlob();

      // PDFの内容を要約
      var summary = analyzePdfContent_(blob, activeModel);

      // リネーム予定名を生成
      var renameTo = askGemini(blob, rules, activeModel);
      if (renameTo === 'ERROR') renameTo = '（生成失敗）';

      // Drive内で類似PDFを検索
      var refResult = findSimilarFile_(summary, activeModel);

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
        // 参照元ファイル名欄にリネーム候補を表示（新規であることを明示）
        compareSheet.getRange(newRow, COL.REF_NAME).setValue('🆕 新規（参照元なし）→ ' + cleanRenameTo);
        compareSheet.getRange(newRow, COL.REF_LINK).setValue('―');
        compareSheet.getRange(newRow, COL.REF_FOLDER_ID).setValue('');
        compareSheet.getRange(newRow, COL.STATUS).setValue('🆕 新規 - 確認待ち');
        // 行の背景色を変えて新規ファイルを視覚的に区別
        compareSheet.getRange(newRow, 1, 1, TOTAL_COLS).setBackground('#FFF9C4'); // 薄い黄色
      } else {
        // 参照元あり
        compareSheet.getRange(newRow, COL.REF_NAME).setValue(refResult.fileName);
        compareSheet.getRange(newRow, COL.REF_LINK).setFormula('=HYPERLINK("' + refUrl + '","開く")');
        compareSheet.getRange(newRow, COL.REF_FOLDER_ID).setValue(refResult.folderId || '');
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

    Utilities.sleep(3000); // API負荷軽減
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
    SpreadsheetApp.getUi().alert('「参照元比較」シートが見つかりません。先に「スキャン＆参照元検索」を実行してください。');
    return;
  }

  var lastRow = compareSheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('処理対象のデータがありません。');
    return;
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
    if (isChecked !== true || status === '完了' || status === '実行済み') continue;

    var fileId = row[COL.SCAN_FILE_ID - 1];
    var renameTo = row[COL.RENAME_TO - 1];
    var refFolderId = row[COL.REF_FOLDER_ID - 1];

    if (!fileId || !renameTo) continue;

    try {
      var file = DriveApp.getFileById(fileId);

      // リネーム（.pdf拡張子を確保）
      var cleanName = renameTo.replace(/[\\/:*?"<>|]/g, '').trim();
      if (!cleanName.toLowerCase().endsWith('.pdf')) {
        cleanName += '.pdf';
      }
      file.setName(cleanName);

      // 移動先: 参照元ファイルと同じフォルダ。なければデフォルトのoutputフォルダ
      if (refFolderId) {
        try {
          var destFolder = DriveApp.getFolderById(refFolderId);
          file.moveTo(destFolder);
        } catch (moveErr) {
          console.error('参照元フォルダへの移動失敗、outputフォルダへ移動: ' + moveErr.message);
          file.moveTo(outputFolder);
        }
      } else {
        file.moveTo(outputFolder);
      }

      // ステータス更新
      var sheetRow = i + 2; // ヘッダー分+1
      var doneLabel = refFolderId ? '✅ 完了（参照元フォルダへ移動）' : '✅ 完了（新規 → outputフォルダへ移動）';
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

  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    // doGetから呼ばれた場合UIがないので無視
  }
}

// ============================================================
// PDF内容解析（Gemini）
// ============================================================
function analyzePdfContent_(pdfBlob, modelName) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + API_KEY;

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

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  for (var i = 0; i < 3; i++) {
    try {
      var response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() === 200) {
        var result = JSON.parse(response.getContentText());
        if (result.candidates && result.candidates[0].content) {
          return result.candidates[0].content.parts[0].text.trim();
        }
      }
      Utilities.sleep(3000);
    } catch (e) {
      Utilities.sleep(3000);
    }
  }
  return '（解析失敗）';
}

// ============================================================
// Drive内で類似ファイルを検索
// ============================================================
function findSimilarFile_(summary, modelName) {
  var emptyResult = { fileId: '', fileName: '', folderId: '' };

  // Geminiに検索キーワードを生成させる
  var keywords = extractSearchKeywords_(summary, modelName);
  if (!keywords) return emptyResult;

  // キーワードでDriveを検索（PDFのみ、inputフォルダ以外）
  var inputFolderId = extractIdFromUrl(INPUT_FOLDER_URL);
  var candidates = searchDriveForPdf_(keywords, inputFolderId);

  if (candidates.length === 0) return emptyResult;

  // 最も類似度が高いファイルを選定（Geminiに判定させる）
  if (candidates.length === 1) {
    return candidates[0];
  }

  return selectBestMatch_(summary, candidates, modelName);
}

/**
 * 要約から検索用キーワードを抽出（Gemini）
 */
function extractSearchKeywords_(summary, modelName) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + API_KEY;

  var payload = {
    contents: [{
      parts: [{
        text: '以下のPDF内容の要約から、Googleドライブで類似ファイルを検索するためのキーワードを生成してください。\n' +
              '会社名・物件名・書類種別など、ファイル名に含まれそうな重要キーワードを2〜4個、スペース区切りで出力してください。\n' +
              'キーワードのみ出力し、説明は不要です。\n\n' +
              '【要約】\n' + summary
      }]
    }],
    generationConfig: { temperature: 0.1 }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      var result = JSON.parse(response.getContentText());
      if (result.candidates && result.candidates[0].content) {
        return result.candidates[0].content.parts[0].text.trim();
      }
    }
  } catch (e) {
    console.error('キーワード抽出エラー: ' + e.message);
  }
  return '';
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
function selectBestMatch_(summary, candidates, modelName) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + API_KEY;

  var candidateList = candidates.map(function(c, i) {
    return (i + 1) + '. ' + c.fileName;
  }).join('\n');

  var payload = {
    contents: [{
      parts: [{
        text: '以下のPDFの内容要約に最も類似したファイルを、候補リストから1つ選んでください。\n' +
              '同じ会社・同じ書類種別・同じ物件のファイルを優先してください（対象月が違うのは問題ありません）。\n' +
              '番号のみ（例: 1）を出力してください。適切な候補がない場合は 0 と出力してください。\n\n' +
              '【PDF内容要約】\n' + summary + '\n\n' +
              '【候補リスト】\n' + candidateList
      }]
    }],
    generationConfig: { temperature: 0.1 }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      var result = JSON.parse(response.getContentText());
      if (result.candidates && result.candidates[0].content) {
        var answer = result.candidates[0].content.parts[0].text.trim();
        var idx = parseInt(answer, 10);
        if (idx > 0 && idx <= candidates.length) {
          return candidates[idx - 1];
        }
      }
    }
  } catch (e) {
    console.error('最適候補選定エラー: ' + e.message);
  }

  // 判定できなかった場合は最初の候補を返す
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
    '参照元フォルダID', 'ステータス', 'スキャンファイルID',
    '参照元ファイルID', '処理日時'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // ヘッダーの書式設定
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#1a73e8');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);

  // 列幅の調整
  sheet.setColumnWidth(COL.CHECK, 60);           // チェック
  sheet.setColumnWidth(COL.SCAN_NAME, 200);       // スキャンファイル名
  sheet.setColumnWidth(COL.SUMMARY, 350);         // 内容要約
  sheet.setColumnWidth(COL.RENAME_TO, 250);       // リネーム予定名
  sheet.setColumnWidth(COL.SCAN_LINK, 60);        // スキャンファイルリンク
  sheet.setColumnWidth(COL.REF_NAME, 250);        // 参照元ファイル名
  sheet.setColumnWidth(COL.REF_LINK, 60);         // 参照元ファイルリンク
  sheet.setColumnWidth(COL.REF_FOLDER_ID, 100);   // 参照元フォルダID
  sheet.setColumnWidth(COL.STATUS, 120);          // ステータス
  sheet.setColumnWidth(COL.SCAN_FILE_ID, 100);    // スキャンファイルID（非表示推奨）
  sheet.setColumnWidth(COL.REF_FILE_ID, 100);     // 参照元ファイルID（非表示推奨）
  sheet.setColumnWidth(COL.TIMESTAMP, 150);       // 処理日時

  // ID列を非表示（ユーザーには不要）
  sheet.hideColumns(COL.REF_FOLDER_ID);
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
      if (Date.now() - startTime > 4.5 * 60 * 1000) break;
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
  var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + API_KEY;
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
  var url = 'https://generativelanguage.googleapis.com/v1beta/' + modelName + ':generateContent?key=' + API_KEY;

  var payload = {
    contents: [{
      parts: [
        { text: '以下のルールを守り、このPDFの新しいファイル名を1つだけ出力してください。挨拶は不要です。\n\n【ルール】\n' + rules },
        { inline_data: { mime_type: 'application/pdf', data: Utilities.base64Encode(pdfBlob.getBytes()) } }
      ]
    }],
    generationConfig: { temperature: 0.1 }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  for (var i = 0; i < 3; i++) {
    try {
      var response = UrlFetchApp.fetch(url, options);
      var responseCode = response.getResponseCode();
      if (responseCode === 200) {
        var result = JSON.parse(response.getContentText());
        if (result.candidates) return result.candidates[0].content.parts[0].text.trim();
      } else if (responseCode === 503 || responseCode === 429) {
        Utilities.sleep(5000);
      } else {
        return 'ERROR';
      }
    } catch (e) {
      Utilities.sleep(5000);
    }
  }
  return 'ERROR';
}
