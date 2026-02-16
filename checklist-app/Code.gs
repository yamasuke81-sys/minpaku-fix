/**
 * 清掃チェックリストWebアプリ（スタッフ専用）
 * 軽量・スマホ最適化版
 */

// 日付を yyyy-MM-dd 文字列に正規化するヘルパー
function normDateStr_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  var s = String(v || '').trim();
  // 既に yyyy-MM-dd ならそのまま
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Date パース可能なら変換
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return s;
}

// チェックリスト機能用シート名
const SHEET_CL_MASTER = 'チェックリストマスタ';
const SHEET_CL_PHOTO_SPOTS = '撮影箇所マスタ';
const SHEET_CL_RECORDS = 'チェックリスト記録';
const SHEET_CL_PHOTOS = 'チェックリスト写真';
const SHEET_CL_MEMOS = 'チェックリストメモ';
const SHEET_CL_SUPPLIES = '要補充記録';
const SHEET_CL_CATEGORY_ORDER = 'カテゴリ順序';

// 予約管理スプレッドシートのシート名（チェックリストアプリ用）
const CL_BOOKING_SHEET = 'フォームの回答 1';
const CL_OWNER_SHEET = '設定_オーナー';
const CL_STAFF_SHEET = '清掃スタッフ';

/**
 * 診断用: Script Properties とスプレッドシートの状態を確認
 * GASエディタで実行 → 実行ログで結果を確認
 */
function diagChecklistSetup() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('CHECKLIST_SS_ID');
  Logger.log('CHECKLIST_SS_ID = ' + (ssId || '(未設定)'));

  if (!ssId) {
    Logger.log('ERROR: CHECKLIST_SS_ID が設定されていません。Script Properties に設定してください。');
    return;
  }

  try {
    var ss = SpreadsheetApp.openById(ssId);
    Logger.log('スプレッドシート名: ' + ss.getName());
    var sheets = ss.getSheets();
    Logger.log('シート数: ' + sheets.length);
    sheets.forEach(function(s) {
      Logger.log('  - ' + s.getName() + ' (行数: ' + s.getLastRow() + ')');
    });

    // マスタシートの確認
    var masterSheet = ss.getSheetByName('チェックリストマスタ');
    if (masterSheet) {
      Logger.log('OK: チェックリストマスタ が存在 (行数: ' + masterSheet.getLastRow() + ')');
      if (masterSheet.getLastRow() >= 1) {
        Logger.log('  ヘッダー: ' + masterSheet.getRange(1, 1, 1, 6).getValues()[0].join(', '));
      }
    } else {
      Logger.log('ERROR: チェックリストマスタ シートが存在しません');
    }

    var spotSheet = ss.getSheetByName('撮影箇所マスタ');
    if (spotSheet) {
      Logger.log('OK: 撮影箇所マスタ が存在 (行数: ' + spotSheet.getLastRow() + ')');
      if (spotSheet.getLastRow() >= 1) {
        Logger.log('  ヘッダー: ' + spotSheet.getRange(1, 1, 1, 7).getValues()[0].join(', '));
      }
    } else {
      Logger.log('ERROR: 撮影箇所マスタ シートが存在しません');
    }
  } catch (e) {
    Logger.log('ERROR: スプレッドシートを開けません: ' + e.toString());
  }
}

/**
 * Webアプリのエントリーポイント
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('checklist');
  template.checkoutDate = e.parameter.date || '';
  template.staffName = e.parameter.staff || '';
  return template.evaluate()
    .setTitle('清掃チェックリスト')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

/**
 * HTML内のファイルをインクルード
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 予約管理スプレッドシートを取得
 */
function getBookingSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('BOOKING_SS_ID');
  if (ssId) {
    try { return SpreadsheetApp.openById(ssId); } catch (e) {}
  }
  // フォールバック: 現在のスプレッドシート
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * チェックリスト管理スプレッドシートを取得または作成
 * Script Properties の CHECKLIST_SS_ID にスプレッドシートIDを設定してください
 */
function getOrCreateChecklistSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('CHECKLIST_SS_ID');
  if (ssId) {
    try { return SpreadsheetApp.openById(ssId); } catch (e) {
      // 旧スプレッドシートが開けない場合、新規作成せずにエラーを投げる
      // （データ消失を防ぐため）
      throw new Error('チェックリストスプレッドシート(ID=' + ssId + ')を開けません。Googleドライブで確認してください: ' + e.toString());
    }
  }
  // IDが未設定の場合のみ新規作成
  Logger.log('CHECKLIST_SS_ID が Script Properties に設定されていません。新規作成します。');
  var newSs = SpreadsheetApp.create('清掃チェックリスト管理');
  props.setProperty('CHECKLIST_SS_ID', newSs.getId());
  // 初期シート作成
  var s1 = newSs.getActiveSheet();
  s1.setName(SHEET_CL_MASTER);
  s1.getRange(1, 1, 1, 7).setValues([['ID', 'カテゴリ', '項目名', '表示順', '有効', '要補充対象', '見本写真ID']]);
  var s2 = newSs.insertSheet(SHEET_CL_PHOTO_SPOTS);
  s2.getRange(1, 1, 1, 7).setValues([['ID', '箇所名', '撮影タイミング', '撮影例ファイルID', '表示順', '有効', 'カテゴリ']]);
  var s3 = newSs.insertSheet(SHEET_CL_RECORDS);
  s3.getRange(1, 1, 1, 5).setValues([['チェックアウト日', '項目ID', 'チェック済', 'チェック者', 'タイムスタンプ']]);
  var s4 = newSs.insertSheet(SHEET_CL_PHOTOS);
  s4.getRange(1, 1, 1, 6).setValues([['チェックアウト日', '撮影箇所ID', 'ファイルID', 'アップロード者', 'タイムスタンプ', '撮影タイミング']]);
  var s5 = newSs.insertSheet(SHEET_CL_MEMOS);
  s5.getRange(1, 1, 1, 4).setValues([['チェックアウト日', 'メモ内容', '記入者', 'タイムスタンプ']]);
  var s6 = newSs.insertSheet(SHEET_CL_SUPPLIES);
  s6.getRange(1, 1, 1, 5).setValues([['チェックアウト日', '項目ID', '項目名', '記入者', 'タイムスタンプ']]);
  return newSs;
}

/**
 * チェックリストスプレッドシートの診断情報を取得
 */
function getChecklistDiagnostics() {
  try {
    var props = PropertiesService.getScriptProperties();
    var ssId = props.getProperty('CHECKLIST_SS_ID');
    if (!ssId) return JSON.stringify({ success: true, ssId: null, message: 'CHECKLIST_SS_IDが未設定' });

    var ss;
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) {
      return JSON.stringify({ success: true, ssId: ssId, message: 'スプレッドシートを開けません: ' + e.toString(), canOpen: false });
    }

    var sheets = ss.getSheets();
    var sheetInfo = sheets.map(function(s) {
      return { name: s.getName(), rows: s.getLastRow(), maxRows: s.getMaxRows(), maxCols: s.getMaxColumns() };
    });

    // マスタの先頭数行をプレビュー
    var masterSheet = ss.getSheetByName(SHEET_CL_MASTER);
    var masterPreview = [];
    if (masterSheet && masterSheet.getLastRow() >= 2) {
      var previewRows = masterSheet.getRange(1, 1, Math.min(masterSheet.getLastRow(), 5), Math.min(masterSheet.getLastColumn(), 6)).getValues();
      masterPreview = previewRows.map(function(row) { return row.map(function(c) { return String(c); }); });
    }

    return JSON.stringify({
      success: true,
      ssId: ssId,
      ssName: ss.getName(),
      ssUrl: ss.getUrl(),
      canOpen: true,
      sheets: sheetInfo,
      masterPreview: masterPreview
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Googleドライブから「清掃チェックリスト管理」スプレッドシートを全て検索し、
 * データが入っている元のスプレッドシートを見つける
 */
function findOriginalChecklistSpreadsheet() {
  try {
    var props = PropertiesService.getScriptProperties();
    var currentId = props.getProperty('CHECKLIST_SS_ID') || '';

    var files = DriveApp.getFilesByName('清掃チェックリスト管理');
    var results = [];
    while (files.hasNext()) {
      var file = files.next();
      var fileId = file.getId();
      try {
        var ss = SpreadsheetApp.openById(fileId);
        var masterSheet = ss.getSheetByName(SHEET_CL_MASTER);
        var masterRows = masterSheet ? masterSheet.getLastRow() : 0;
        var preview = [];
        if (masterSheet && masterRows >= 2) {
          var previewData = masterSheet.getRange(2, 1, Math.min(masterRows - 1, 3), Math.min(masterSheet.getLastColumn(), 4)).getValues();
          preview = previewData.map(function(row) { return row.map(function(c) { return String(c); }); });
        }
        results.push({
          id: fileId,
          name: ss.getName(),
          url: ss.getUrl(),
          isCurrent: fileId === currentId,
          masterRows: masterRows,
          created: file.getDateCreated().toISOString(),
          updated: file.getLastUpdated().toISOString(),
          preview: preview
        });
      } catch (e) {
        results.push({ id: fileId, name: file.getName(), error: e.toString() });
      }
    }

    // データ行数が多い順にソート
    results.sort(function(a, b) { return (b.masterRows || 0) - (a.masterRows || 0); });

    return JSON.stringify({ success: true, currentId: currentId, found: results });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * CHECKLIST_SS_IDを指定のIDに変更する（元のスプレッドシートに戻す）
 */
function restoreChecklistSpreadsheetId(newId) {
  try {
    if (!newId) return JSON.stringify({ success: false, error: 'IDが指定されていません' });
    // 指定IDのスプレッドシートが開けるか確認
    var ss = SpreadsheetApp.openById(newId);
    var masterSheet = ss.getSheetByName(SHEET_CL_MASTER);
    if (!masterSheet) return JSON.stringify({ success: false, error: 'チェックリストマスタシートが見つかりません' });
    var rows = masterSheet.getLastRow();
    if (rows < 2) return JSON.stringify({ success: false, error: 'このスプレッドシートにもデータがありません（' + rows + '行）' });

    var props = PropertiesService.getScriptProperties();
    var oldId = props.getProperty('CHECKLIST_SS_ID');
    props.setProperty('CHECKLIST_SS_ID', newId);

    return JSON.stringify({
      success: true,
      oldId: oldId,
      newId: newId,
      masterRows: rows,
      message: 'チェックリストスプレッドシートを復旧しました（データ' + (rows - 1) + '件）'
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function clSheet_(name) {
  var ss = getOrCreateChecklistSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_CL_MASTER) sheet.getRange(1, 1, 1, 7).setValues([['ID', 'カテゴリ', '項目名', '表示順', '有効', '要補充対象', '見本写真ID']]);
    else if (name === SHEET_CL_PHOTO_SPOTS) sheet.getRange(1, 1, 1, 7).setValues([['ID', '箇所名', '撮影タイミング', '撮影例ファイルID', '表示順', '有効', 'カテゴリ']]);
    else if (name === SHEET_CL_RECORDS) sheet.getRange(1, 1, 1, 5).setValues([['チェックアウト日', '項目ID', 'チェック済', 'チェック者', 'タイムスタンプ']]);
    else if (name === SHEET_CL_PHOTOS) sheet.getRange(1, 1, 1, 6).setValues([['チェックアウト日', '撮影箇所ID', 'ファイルID', 'アップロード者', 'タイムスタンプ', '撮影タイミング']]);
    else if (name === SHEET_CL_MEMOS) sheet.getRange(1, 1, 1, 4).setValues([['チェックアウト日', 'メモ内容', '記入者', 'タイムスタンプ']]);
    else if (name === SHEET_CL_SUPPLIES) sheet.getRange(1, 1, 1, 5).setValues([['チェックアウト日', '項目ID', '項目名', '記入者', 'タイムスタンプ']]);
    else if (name === SHEET_CL_CATEGORY_ORDER) sheet.getRange(1, 1, 1, 2).setValues([['カテゴリパス', '表示順']]);
  }
  return sheet;
}

/**
 * 清掃スタッフ一覧を取得
 */
function getCleaningStaffList() {
  try {
    var bookingSs = getBookingSpreadsheet_();
    var staffSheet = bookingSs.getSheetByName(CL_STAFF_SHEET);
    if (!staffSheet || staffSheet.getLastRow() < 2) {
      return JSON.stringify({ success: true, list: [] });
    }
    var data = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 2).getValues();
    var list = [];
    data.forEach(function(row) {
      var name = String(row[0] || '').trim();
      if (name) list.push(name);
    });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), list: [] });
  }
}

/**
 * 次回予約詳細を取得（チェックアウト日をキーにする）
 */
function getNextBookingDetails(checkoutDate) {
  try {
    var bookingSs = getBookingSpreadsheet_();
    var formSheet = bookingSs.getSheetByName(CL_BOOKING_SHEET);
    if (!formSheet || formSheet.getLastRow() < 2) {
      return JSON.stringify({ success: false, error: '予約データがありません' });
    }

    // ヘッダーを取得
    var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    var colMap = {};
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || '').trim();
      if (h === 'チェックイン') colMap.checkIn = i;
      else if (h === 'チェックアウト') colMap.checkOut = i;
      else if (h === '宿泊者名') colMap.guestName = i;
      else if (h === '人数') colMap.guestCount = i;
      else if (h === '予約サイト') colMap.bookingSite = i;
      else if (h === 'BBQ利用') colMap.bbq = i;
      else if (h === 'リネン') colMap.linen = i;
      else if (h === 'ベッド') colMap.bed = i;
    }

    if (colMap.checkOut === undefined) {
      return JSON.stringify({ success: false, error: 'チェックアウト列が見つかりません' });
    }

    // チェックアウト日で該当予約を検索
    var data = formSheet.getRange(2, 1, formSheet.getLastRow() - 1, formSheet.getLastColumn()).getValues();
    var targetCheckoutDate = String(checkoutDate || '').trim();

    for (var i = 0; i < data.length; i++) {
      var coVal = data[i][colMap.checkOut];
      var coKey = '';
      if (coVal instanceof Date) {
        coKey = Utilities.formatDate(coVal, 'Asia/Tokyo', 'yyyy-MM-dd');
      } else {
        coKey = String(coVal || '').trim();
      }

      if (coKey === targetCheckoutDate) {
        // 該当予約を見つけた
        var booking = {
          checkIn: colMap.checkIn !== undefined ? formatDateValue_(data[i][colMap.checkIn]) : '',
          checkOut: targetCheckoutDate,
          guestName: colMap.guestName !== undefined ? String(data[i][colMap.guestName] || '') : '',
          guestCount: colMap.guestCount !== undefined ? String(data[i][colMap.guestCount] || '') : '',
          bookingSite: colMap.bookingSite !== undefined ? String(data[i][colMap.bookingSite] || '') : '',
          bbq: colMap.bbq !== undefined ? String(data[i][colMap.bbq] || '') : '',
          linen: colMap.linen !== undefined ? String(data[i][colMap.linen] || '') : '',
          bed: colMap.bed !== undefined ? String(data[i][colMap.bed] || '') : ''
        };
        return JSON.stringify({ success: true, booking: booking });
      }
    }

    return JSON.stringify({ success: false, error: '該当する予約が見つかりません' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function formatDateValue_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val).trim();
}

/**
 * チェックリストマスタを取得
 */
function getChecklistMaster() {
  try {
    var sheet = clSheet_(SHEET_CL_MASTER);
    if (sheet.getLastRow() < 2) return JSON.stringify({ success: true, items: [] });
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
    var items = rows.map(function(row, i) {
      return {
        rowIndex: i + 2,
        id: String(row[0] || ''),
        category: String(row[1] || ''),
        name: String(row[2] || ''),
        sortOrder: parseInt(row[3], 10) || 0,
        active: String(row[4] || 'Y').trim().toUpperCase(),
        supplyItem: String(row[5] || 'N') === 'Y',
        exampleFileId: String(row[6] || '')
      };
    }).filter(function(item) { return item.id && item.name && item.active !== 'N'; });
    items.sort(function(a, b) { return a.sortOrder - b.sortOrder; });
    return JSON.stringify({ success: true, items: items, totalRows: rows.length });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 撮影箇所マスタを取得
 */
function getPhotoSpotMaster() {
  try {
    var sheet = clSheet_(SHEET_CL_PHOTO_SPOTS);
    if (sheet.getLastRow() < 2) return JSON.stringify({ success: true, spots: [] });
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
    var spots = rows.map(function(row, i) {
      return {
        rowIndex: i + 2,
        id: String(row[0] || ''),
        name: String(row[1] || ''),
        timing: String(row[2] || ''),
        exampleFileId: String(row[3] || ''),
        sortOrder: parseInt(row[4], 10) || 0,
        active: String(row[5] || 'Y'),
        category: String(row[6] || '')
      };
    }).filter(function(spot) { return spot.id && spot.name && spot.active === 'Y'; });
    spots.sort(function(a, b) { return a.sortOrder - b.sortOrder; });
    return JSON.stringify({ success: true, spots: spots });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 日次チェックリストデータを取得
 */
function getChecklistForDate(checkoutDate) {
  try {
    var masterRes = JSON.parse(getChecklistMaster());
    var spotRes = JSON.parse(getPhotoSpotMaster());
    var catOrderRes = JSON.parse(getCategoryOrder());
    if (!masterRes.success || !spotRes.success) {
      var detail = '';
      if (!masterRes.success) detail += 'チェックリストマスタ: ' + (masterRes.error || '不明');
      if (!spotRes.success) detail += (detail ? ' / ' : '') + '撮影箇所マスタ: ' + (spotRes.error || '不明');
      return JSON.stringify({ success: false, error: 'マスタデータの読み込みに失敗しました: ' + detail });
    }

    var recordSheet = clSheet_(SHEET_CL_RECORDS);
    var photoSheet = clSheet_(SHEET_CL_PHOTOS);
    var memoSheet = clSheet_(SHEET_CL_MEMOS);
    var supplySheet = clSheet_(SHEET_CL_SUPPLIES);

    // 日付を正規化して比較
    var targetDate = normDateStr_(checkoutDate);

    // チェック記録を取得
    var checkedItems = {};
    if (recordSheet.getLastRow() >= 2) {
      var records = recordSheet.getRange(2, 1, recordSheet.getLastRow() - 1, 5).getValues();
      records.forEach(function(row) {
        if (normDateStr_(row[0]) === targetDate && row[2]) {
          checkedItems[String(row[1])] = { checked: true, by: String(row[3] || ''), at: String(row[4] || '') };
        }
      });
    }

    // 写真記録を取得
    var photos = {};
    if (photoSheet.getLastRow() >= 2) {
      var photoRecords = photoSheet.getRange(2, 1, photoSheet.getLastRow() - 1, 6).getValues();
      photoRecords.forEach(function(row) {
        if (normDateStr_(row[0]) === targetDate) {
          var spotId = String(row[1]);
          var timing = String(row[5] || '');
          if (!photos[spotId]) photos[spotId] = { before: [], after: [] };
          var photoData = { fileId: String(row[2]), by: String(row[3] || ''), at: String(row[4] || '') };
          if (timing === 'ビフォー') photos[spotId].before.push(photoData);
          else if (timing === 'アフター') photos[spotId].after.push(photoData);
        }
      });
    }

    // 要補充記録を取得
    var supplyNeeded = {};
    if (supplySheet.getLastRow() >= 2) {
      var supplyRecords = supplySheet.getRange(2, 1, supplySheet.getLastRow() - 1, 5).getValues();
      supplyRecords.forEach(function(row) {
        if (normDateStr_(row[0]) === targetDate) {
          supplyNeeded[String(row[1])] = { name: String(row[2]), by: String(row[3] || ''), at: String(row[4] || '') };
        }
      });
    }

    // メモを取得
    var memos = [];
    if (memoSheet.getLastRow() >= 2) {
      var memoRecords = memoSheet.getRange(2, 1, memoSheet.getLastRow() - 1, 4).getValues();
      memoRecords.forEach(function(row) {
        if (normDateStr_(row[0]) === targetDate) {
          memos.push({ text: String(row[1] || ''), by: String(row[2] || ''), at: String(row[3] || '') });
        }
      });
    }

    var checkedCount = Object.keys(checkedItems).length;
    var totalItems = masterRes.items.length;

    return JSON.stringify({
      success: true,
      items: masterRes.items,
      spots: spotRes.spots,
      checked: checkedItems,
      photos: photos,
      supplyNeeded: supplyNeeded,
      memos: memos,
      checkedCount: checkedCount,
      totalItems: totalItems,
      categoryOrder: catOrderRes.success ? catOrderRes.orders : []
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * チェック項目のトグル
 */
function toggleChecklistItem(checkoutDate, itemId, checked, staffName) {
  try {
    var sheet = clSheet_(SHEET_CL_RECORDS);
    var targetDate = normDateStr_(checkoutDate);
    var lastRow = sheet.getLastRow();
    var found = false;

    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      for (var i = 0; i < data.length; i++) {
        if (normDateStr_(data[i][0]) === targetDate && String(data[i][1]) === String(itemId)) {
          if (checked) {
            sheet.getRange(i + 2, 3).setValue('Y');
            sheet.getRange(i + 2, 4).setValue(staffName || '');
            sheet.getRange(i + 2, 5).setValue(new Date());
          } else {
            sheet.deleteRow(i + 2);
          }
          found = true;
          break;
        }
      }
    }

    if (!found && checked) {
      var nextRow = sheet.getLastRow() + 1;
      sheet.getRange(nextRow, 1, 1, 5).setValues([[checkoutDate, itemId, 'Y', staffName || '', new Date()]]);
    }

    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 要補充のトグル
 */
function toggleSupplyNeeded(checkoutDate, itemId, itemName, needed, staffName) {
  try {
    var sheet = clSheet_(SHEET_CL_SUPPLIES);
    var targetDate = normDateStr_(checkoutDate);
    var lastRow = sheet.getLastRow();
    var found = false;

    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      for (var i = 0; i < data.length; i++) {
        if (normDateStr_(data[i][0]) === targetDate && String(data[i][1]) === String(itemId)) {
          if (!needed) {
            sheet.deleteRow(i + 2);
          }
          found = true;
          break;
        }
      }
    }

    if (!found && needed) {
      var nextRow = sheet.getLastRow() + 1;
      sheet.getRange(nextRow, 1, 1, 5).setValues([[checkoutDate, itemId, itemName, staffName || '', new Date()]]);
    }

    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 写真をアップロード
 */
function uploadChecklistPhoto(checkoutDate, spotId, timing, base64Data, staffName) {
  try {
    var parentFolder = getOrCreateChecklistPhotoFolder_();
    // タイミングごとのフォルダに保存
    var subFolderName = (timing === 'ビフォー') ? 'ビフォー' : 'アフター';
    // 個別フォルダ設定があればそちらを使用
    var props = PropertiesService.getScriptProperties();
    var folderIdKey = (timing === 'ビフォー') ? 'CL_PHOTO_FOLDER_BEFORE' : 'CL_PHOTO_FOLDER_AFTER';
    var specificFolderId = props.getProperty(folderIdKey);
    var folder;
    if (specificFolderId) {
      try { folder = DriveApp.getFolderById(specificFolderId); } catch (e) { folder = null; }
    }
    if (!folder) folder = getOrCreateSubFolder_(parentFolder, subFolderName);
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', 'photo_' + new Date().getTime() + '.jpg');
    var file = folder.createFile(blob);
    file.setName(checkoutDate + '_' + spotId + '_' + timing + '_' + new Date().getTime() + '.jpg');
    // ファイルを閲覧可能に設定
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

    var sheet = clSheet_(SHEET_CL_PHOTOS);
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, 6).setValues([[checkoutDate, spotId, file.getId(), staffName || '', new Date(), timing]]);

    return JSON.stringify({ success: true, fileId: file.getId() });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function getOrCreateChecklistPhotoFolder_() {
  var props = PropertiesService.getScriptProperties();
  // メインアプリの設定タブで設定されたフォルダIDを優先
  var folderId = props.getProperty('CHECKLIST_PHOTO_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  var folder = DriveApp.createFolder('清掃チェックリスト写真');
  props.setProperty('CHECKLIST_PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * 親フォルダ内にサブフォルダを取得または作成
 */
function getOrCreateSubFolder_(parentFolder, subFolderName) {
  var folders = parentFolder.getFoldersByName(subFolderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(subFolderName);
}

/**
 * 写真保存フォルダIDを設定
 */
function setChecklistPhotoFolderId(folderId) {
  try {
    var id = String(folderId || '').trim();
    if (!id) return JSON.stringify({ success: false, error: 'フォルダIDが空です。' });
    try { DriveApp.getFolderById(id); } catch (e) {
      return JSON.stringify({ success: false, error: 'フォルダにアクセスできません。' });
    }
    PropertiesService.getScriptProperties().setProperty('CHECKLIST_PHOTO_FOLDER_ID', id);
    return JSON.stringify({ success: true });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
}

/**
 * 撮影フォルダを個別に設定（ビフォー/アフター/見本）
 */
function setPhotoSubFolderId(type, folderId) {
  try {
    var id = String(folderId || '').trim();
    var keyMap = { 'before': 'CL_PHOTO_FOLDER_BEFORE', 'after': 'CL_PHOTO_FOLDER_AFTER', 'example': 'CL_PHOTO_FOLDER_EXAMPLE' };
    var key = keyMap[type];
    if (!key) return JSON.stringify({ success: false, error: '無効なタイプです' });
    if (!id) {
      // 空なら設定を削除（デフォルトフォルダを使う）
      PropertiesService.getScriptProperties().deleteProperty(key);
      return JSON.stringify({ success: true });
    }
    try { DriveApp.getFolderById(id); } catch (e) {
      return JSON.stringify({ success: false, error: 'フォルダにアクセスできません。URLまたはIDを確認してください。' });
    }
    PropertiesService.getScriptProperties().setProperty(key, id);
    return JSON.stringify({ success: true });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
}

/**
 * 撮影フォルダ設定を取得
 */
function getPhotoFolderSettings() {
  try {
    var props = PropertiesService.getScriptProperties();
    var parentId = props.getProperty('CHECKLIST_PHOTO_FOLDER_ID') || '';
    var beforeId = props.getProperty('CL_PHOTO_FOLDER_BEFORE') || '';
    var afterId = props.getProperty('CL_PHOTO_FOLDER_AFTER') || '';
    var exampleId = props.getProperty('CL_PHOTO_FOLDER_EXAMPLE') || '';
    return JSON.stringify({ success: true, parentId: parentId, beforeId: beforeId, afterId: afterId, exampleId: exampleId });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
}

/**
 * メモを追加
 */
function addChecklistMemo(checkoutDate, text, staffName) {
  try {
    var sheet = clSheet_(SHEET_CL_MEMOS);
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, 4).setValues([[checkoutDate, text, staffName || '', new Date()]]);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 清掃完了通知をオーナーに送信
 */
function notifyCleaningComplete(checkoutDate, staffName) {
  try {
    var bookingSs = getBookingSpreadsheet_();
    var ownerSheet = bookingSs.getSheetByName(CL_OWNER_SHEET);
    if (!ownerSheet || ownerSheet.getLastRow() < 2) {
      return JSON.stringify({ success: false, error: 'オーナー情報が見つかりません' });
    }
    var ownerEmail = String(ownerSheet.getRange(2, 1).getValue() || '').trim();
    if (!ownerEmail) {
      return JSON.stringify({ success: false, error: 'オーナーメールアドレスが設定されていません' });
    }

    // 要補充リストを取得
    var supplyList = [];
    var supplySheet = clSheet_(SHEET_CL_SUPPLIES);
    if (supplySheet.getLastRow() >= 2) {
      var supplyData = supplySheet.getRange(2, 1, supplySheet.getLastRow() - 1, 5).getValues();
      var targetDate = normDateStr_(checkoutDate);
      supplyData.forEach(function(row) {
        if (normDateStr_(row[0]) === targetDate) {
          supplyList.push(String(row[2]));
        }
      });
    }

    var subject = '【民泊】清掃完了報告 - ' + checkoutDate;
    var body = '清掃が完了しました。\n\n';
    body += 'チェックアウト日: ' + checkoutDate + '\n';
    body += '清掃担当: ' + (staffName || '不明') + '\n';
    body += '完了時刻: ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') + '\n\n';

    if (supplyList.length > 0) {
      body += '【要補充項目】\n';
      supplyList.forEach(function(item) {
        body += '- ' + item + '\n';
      });
      body += '\n';
    }

    body += '詳細はチェックリストをご確認ください。';

    GmailApp.sendEmail(ownerEmail, subject, body);

    // メインアプリの通知にも追加
    try {
      var notifSheet = bookingSs.getSheetByName('通知履歴');
      if (notifSheet) {
        var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
        var notifMsg = '清掃完了: ' + checkoutDate + ' 担当: ' + (staffName || '不明');
        if (supplyList.length > 0) notifMsg += ' / 要補充: ' + supplyList.join(', ');
        var notifData = JSON.stringify({ type: 'cleaningComplete', checkoutDate: checkoutDate, staff: staffName });
        var nRow = notifSheet.getLastRow() + 1;
        var nCols = Math.max(notifSheet.getLastColumn(), 5);
        if (nCols < 5) nCols = 5;
        notifSheet.getRange(nRow, 1, 1, 5).setValues([[now, '清掃完了', notifMsg, '', notifData]]);
      }
    } catch (ne) { /* 通知追加失敗は無視 */ }

    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * デフォルトチェックリスト項目を一括登録
 * ユーザー提供のNotionチェックリストを基に作成
 */
function importDefaultChecklist() {
  try {
    var sheet = clSheet_(SHEET_CL_MASTER);
    var spotSheet = clSheet_(SHEET_CL_PHOTO_SPOTS);

    // 既存のデータをクリア（ヘッダーは残す）
    if (sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
    if (spotSheet.getLastRow() > 1) {
      spotSheet.deleteRows(2, spotSheet.getLastRow() - 1);
    }

    // チェックリスト項目データ（4階層対応: 大：中：小：細 を ： で区切り）
    var items = [
      ['item_1', '駐車場', 'ゴミ拾い（ゴミボックス内のゴミ袋使用）', 1, 'Y', 'N'],
      ['item_2', '駐車場', 'ゴミボックスがいっぱい→西山に連絡', 2, 'Y', 'N'],
      ['item_3', '駐車場', '雑草チェック', 3, 'Y', 'N'],
      ['item_4', '駐車場', '補充）ビニール袋（都度）', 4, 'Y', 'Y'],
      ['item_5', '駐車場', '（除草剤散布）毎回は不要', 5, 'Y', 'N'],
      ['item_6', '駐車場', '（草抜き）毎回は不要', 6, 'Y', 'N'],
      ['item_7', 'テラス', '安全チェーン 設置位置のズレ、外れたりしていないか', 7, 'Y', 'N'],
      ['item_8', 'テラス', '忘れ物チェック', 8, 'Y', 'N'],
      ['item_9', 'テラス', '落ち葉や虫の死骸の清掃', 9, 'Y', 'N'],
      ['item_10', 'テラス', '床面に残飯あったら流し台へ', 10, 'Y', 'N'],
      ['item_11', 'テラス', 'トング、包丁、ハサミ、お皿などの洗浄', 11, 'Y', 'N'],
      ['item_12', 'テラス：ガスコンロ', '網の洗浄', 12, 'Y', 'N'],
      ['item_13', 'テラス：ガスコンロ', '受皿の洗浄', 13, 'Y', 'N'],
      ['item_14', 'テラス：ガスコンロ', 'コンロ本体の洗浄', 14, 'Y', 'N'],
      ['item_15', 'テラス：ガスコンロ', 'フタの裏', 15, 'Y', 'N'],
      ['item_16', 'テラス：ガスコンロ', '受皿を乗せるところ', 16, 'Y', 'N'],
      ['item_17', 'テラス：ガスコンロ', '本体の両サイドに格納してあるテーブル', 17, 'Y', 'N'],
      ['item_18', 'テラス：灰皿', 'ゴミを、流し台の水切りネットへ捨てる', 18, 'Y', 'N'],
      ['item_19', 'テラス：灰皿', '本体、ふたの洗浄', 19, 'Y', 'N'],
      ['item_20', 'テラス：灰皿', '階段下に設置（水は不要）', 20, 'Y', 'N'],
      ['item_21', 'テラス：流し台', '残飯の回収（水切りネットごとを捨てる）', 21, 'Y', 'N'],
      ['item_22', 'テラス：流し台', '三角コーナーの洗浄', 22, 'Y', 'N'],
      ['item_23', 'テラス：流し台', '生ゴミかごの洗浄', 23, 'Y', 'N'],
      ['item_24', 'テラス：流し台', '天板の洗浄', 24, 'Y', 'N'],
      ['item_25', 'テラス：流し台', 'シンク内の洗浄', 25, 'Y', 'N'],
      ['item_26', 'テラス：流し台', '下の棚部分 洗浄', 26, 'Y', 'N'],
      ['item_27', 'テラス：交換', '水切りネット', 27, 'Y', 'Y'],
      ['item_28', 'テラス：交換', 'スポンジ（汚れている場合）2枚', 28, 'Y', 'Y'],
      ['item_29', 'テラス：テーブル、イス', '油汚れの除去（洗剤スポンジ）', 29, 'Y', 'N'],
      ['item_30', 'テラス：テーブル、イス', 'ホースで高圧洗浄', 30, 'Y', 'N'],
      ['item_31', 'テラス：テーブル、イス', '折りたたみイス、簡易テーブル、タープテントの片付け（テラスのBOXへ）', 31, 'Y', 'N'],
      ['item_32', 'テラス：補充', '食器洗剤【毎回】', 32, 'Y', 'Y'],
      ['item_33', 'テラス：補充', 'パイプユニッシュ（都度）', 33, 'Y', 'Y'],
      ['item_34', 'テラス：次の予約がBBQ利用あり', 'コンロの受皿に水を入れる（MAX目盛りの8割）', 34, 'Y', 'N'],
      ['item_35', 'テラス：次の予約がBBQ利用あり', 'コンロの網をセット', 35, 'Y', 'N'],
      ['item_36', 'テラス：次の予約がBBQ利用あり', 'ガスボンベをセット（1階備品庫、解錠番号007）', 36, 'Y', 'N'],
      ['item_37', 'テラス：次の予約がBBQ利用あり', '電池をセット（1階備品庫、解錠番号007）', 37, 'Y', 'N'],
      ['item_38', 'テラス：次の予約がBBQ利用あり', '着火テスト（右も左も）↓着火しない原因↓', 38, 'Y', 'N'],
      ['item_39', 'テラス：次の予約がBBQ利用あり', 'コンロに自転車カバーをかけて、足部分をしばる', 39, 'Y', 'N'],
      ['item_40', 'テラス：次の予約がBBQ利用あり', 'BBQセットをキッチンガス台の上に置く（保管場所：1階備品庫、解錠番号007）', 40, 'Y', 'N'],
      ['item_41', 'テラス：次の予約がBBQ利用あり：↓セット内容↓', 'トング（大）', 41, 'Y', 'N'],
      ['item_42', 'テラス：次の予約がBBQ利用あり：↓セット内容↓', 'ハサミ（白）', 42, 'Y', 'N'],
      ['item_43', 'テラス：次の予約がBBQ利用あり：↓セット内容↓', '包丁（カバー付）', 43, 'Y', 'N'],
      ['item_44', 'テラス：次の予約がBBQ利用あり：↓セット内容↓', 'まな板（木製）', 44, 'Y', 'N'],
      ['item_45', 'テラス：次の予約がBBQ利用あり：↓セット内容↓', '予備ボンベx2（振って残量チェック）', 45, 'Y', 'N'],
      ['item_46', 'テラス：次の予約がBBQ利用あり：↓セット内容↓', 'ゴミ袋（大きい30L）3枚程度', 46, 'Y', 'N'],
      ['item_47', 'テラス：次の予約がBBQ利用あり：↓セット内容↓', 'ゴミ袋（小さいやつ）箱ごと', 47, 'Y', 'N'],
      ['item_48', 'テラス：次の予約がBBQ利用あり：↓セット内容↓', 'コールマンのランタン', 48, 'Y', 'N'],
      ['item_49', 'テラス：次の予約がBBQ利用あり：↓セット内容↓', 'でか照明（コンセント式）', 49, 'Y', 'N'],
      ['item_50', 'テラス：次の予約がBBQ利用あり：↓セット内容↓', 'ガスコンロ説明書', 50, 'Y', 'N'],
      ['item_51', 'テラス：次の予約がBBQ利用あり：↓セット内容↓', '注意事項カード（日本語、英語）', 51, 'Y', 'N'],
      ['item_52', 'テラス：次の予約がBBQ利用あり', '空のボンベに穴あけ（穴あけ器具はボンベの収納ボックス内）', 52, 'Y', 'N'],
      ['item_53', 'テラス：次の予約がBBQ利用あり', '空のボンベを駐車場のゴミ置場に捨てる', 53, 'Y', 'N'],
      ['item_54', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓', 'コンロにつけているガスの残量チェック', 54, 'Y', 'N'],
      ['item_55', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓', 'コンロからガスボンベ連結器具を外す', 55, 'Y', 'N'],
      ['item_56', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓', '電池を外す', 56, 'Y', 'N'],
      ['item_57', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓', '受け皿をセット（水入れない！）', 57, 'Y', 'N'],
      ['item_58', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓', '網をセット', 58, 'Y', 'N'],
      ['item_59', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓', 'コンロに自転車カバーをかけて、足部分をしばる', 59, 'Y', 'N'],
      ['item_60', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓', 'BBQセットの回収', 60, 'Y', 'N'],
      ['item_61', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', 'トング（大）', 61, 'Y', 'N'],
      ['item_62', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', 'ハサミ（白）', 62, 'Y', 'N'],
      ['item_63', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', '包丁（カバー付）', 63, 'Y', 'N'],
      ['item_64', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', 'まな板（木製）', 64, 'Y', 'N'],
      ['item_65', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', '予備ボンベx2（振って残量チェック）', 65, 'Y', 'N'],
      ['item_66', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', 'ゴミ袋（大きい30）3枚程度', 66, 'Y', 'N'],
      ['item_67', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', 'ゴミ袋（小さいやつ）箱ごと', 67, 'Y', 'N'],
      ['item_68', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', 'コールマンのランタン', 68, 'Y', 'N'],
      ['item_69', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', '照明器具（コンセント式）', 69, 'Y', 'N'],
      ['item_70', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', 'ガスコンロ説明書', 70, 'Y', 'N'],
      ['item_71', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', '注意事項カード（日本語、英語）', 71, 'Y', 'N'],
      ['item_72', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', '＋ガスボンベ連結器具', 72, 'Y', 'N'],
      ['item_73', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', '＋使用中ボンベx2（振って残量チェック）', 73, 'Y', 'N'],
      ['item_74', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', '＋電池', 74, 'Y', 'N'],
      ['item_75', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', 'BBQセットを1階備品庫におさめる（解錠番号007）', 75, 'Y', 'N'],
      ['item_76', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', '空のボンベに穴あけ（穴あけ器具はボンベの収納ボックス内）', 76, 'Y', 'N'],
      ['item_77', 'テラス：次の予約がBBQなし：Ｂ、今回はBBQ利用があった ↓↓↓↓↓：↓セット内容↓', '空のボンベを駐車場のゴミ置場に捨てる', 77, 'Y', 'N'],
      ['item_78', '2階ベランダ（テラス側）', '鳥の糞除去（濡らしたティッシュなどで拭き掃除）', 78, 'Y', 'N'],
      ['item_79', '2階ベランダ（テラス側）', '虫の死骸除去', 79, 'Y', 'N'],
      ['item_80', '2階ベランダ（テラス側）', 'クモの巣（クモがいたら殺す。くも用スプレーの使用も可）', 80, 'Y', 'N'],
      ['item_81', '2階ベランダ（テラス側）', 'ゴミ拾い', 81, 'Y', 'N'],
      ['item_82', '2階ベランダ（テラス側）', '屋外スリッパの整頓（スリッパ大2個）', 82, 'Y', 'N'],
      ['item_83', '2階ベランダ（テラス側）', 'テーブルとイスの整頓', 83, 'Y', 'N'],
      ['item_84', '2階ベランダ（テラス側）', 'ほうきの整頓', 84, 'Y', 'N'],
      ['item_85', '敷地内（テラスとベランダ以外）', '敷地内のゴミ掃除', 85, 'Y', 'N'],
      ['item_86', '敷地内（テラスとベランダ以外）', '落ち葉や虫の死骸の清掃', 86, 'Y', 'N'],
      ['item_87', '敷地内（テラスとベランダ以外）', '雑草チェック', 87, 'Y', 'N'],
      ['item_88', '敷地内（テラスとベランダ以外）', '（除草剤散布）毎回は不要', 88, 'Y', 'N'],
      ['item_89', '敷地内（テラスとベランダ以外）', '（草抜き）毎回は不要', 89, 'Y', 'N'],
      ['item_90', '最初に室内全体のチェック：【Wi-Fiご利用いただけます】', '全部屋　写真か動画を撮影（損害あり → 西山へ）', 90, 'Y', 'N'],
      ['item_91', '最初に室内全体のチェック：【Wi-Fiご利用いただけます】', '写真はLINEグループのアルバムへ', 91, 'Y', 'N'],
      ['item_92', '最初に室内全体のチェック：【Wi-Fiご利用いただけます】', 'タバコのにおいチェック（あり → 西山へ）', 92, 'Y', 'N'],
      ['item_93', '最初に室内全体のチェック：換気（ドアを開ける', '和室押入', 93, 'Y', 'N'],
      ['item_94', '最初に室内全体のチェック：換気（ドアを開ける', '1階備品庫（番号007）', 94, 'Y', 'N'],
      ['item_95', '最初に室内全体のチェック：換気（ドアを開ける', 'キッチン換気扇　常時ON', 95, 'Y', 'N'],
      ['item_96', '最初に室内全体のチェック：換気（ドアを開ける', '脱衣所収納', 96, 'Y', 'N'],
      ['item_97', '最初に室内全体のチェック：換気（ドアを開ける', 'お風呂換気扇　常時ON', 97, 'Y', 'N'],
      ['item_98', '最初に室内全体のチェック：換気（ドアを開ける', 'タオル集め（トイレx2、キッチンx1、洗面所x1、脱衣所人数分）', 98, 'Y', 'N'],
      ['item_99', '最初に室内全体のチェック：換気（ドアを開ける', 'シーツ集め（2階和室マットも見ること）', 99, 'Y', 'N'],
      ['item_100', '2階ベランダ（和室側）', '障子破れていない？（補修キット用意する予定）', 100, 'Y', 'N'],
      ['item_101', '2階ベランダ（和室側）', '鳥の糞除去（濡らしたティッシュなどで拭き掃除）', 101, 'Y', 'N'],
      ['item_102', '2階ベランダ（和室側）', '虫の死骸除去', 102, 'Y', 'N'],
      ['item_103', '2階ベランダ（和室側）', 'クモの巣（クモがいたら殺す。くも用スプレーの使用も可）', 103, 'Y', 'N'],
      ['item_104', '2階ベランダ（和室側）', 'ゴミ拾い', 104, 'Y', 'N'],
      ['item_105', '2階ベランダ（和室側）', 'スリッパなしが正解', 105, 'Y', 'N'],
      ['item_106', '2階ベランダ（和室側）', 'テーブルとイスなしが正解', 106, 'Y', 'N'],
      ['item_107', '2階ベランダ（和室側）', '窓を施錠', 107, 'Y', 'N'],
      ['item_108', '2階ベランダ（和室側）', '障子を閉める', 108, 'Y', 'N'],
      ['item_109', '2階リビング', '冷蔵庫の中チェック（空にする）', 109, 'Y', 'N'],
      ['item_110', '2階リビング：補充（都度）', 'ティッシュ', 110, 'Y', 'Y'],
      ['item_111', '2階リビング：補充（都度）', '殺虫スプレー', 111, 'Y', 'Y'],
      ['item_112', '2階リビング：補充（都度）', 'コロコロ', 112, 'Y', 'Y'],
      ['item_113', '2階リビング：補充（都度）', 'マモルーム（ゴキブリ忌避）', 113, 'Y', 'Y'],
      ['item_114', '2階リビング：補充（都度）', 'ダニスプレー', 114, 'Y', 'Y'],
      ['item_115', '2階リビング：補充（都度）', 'ゴミの回収', 115, 'Y', 'Y'],
      ['item_116', '2階リビング：補充（都度）', 'ゴミ箱の中に予備のゴミ袋あるか？5枚程度（30L）', 116, 'Y', 'Y'],
      ['item_117', '2階リビング：補充（都度）', 'ゴミ箱にゴミ袋（30L）を装着', 117, 'Y', 'Y'],
      ['item_118', '2階リビング：補充（都度）', 'おもちゃ片付け（除菌シート、ほこり取り）', 118, 'Y', 'Y'],
      ['item_119', '2階リビング：補充（都度）', 'エアコンリモコン（黒）電池ある？', 119, 'Y', 'Y'],
      ['item_120', '2階リビング：補充（都度）', 'カウンター照明リモコン電池ある？', 120, 'Y', 'Y'],
      ['item_121', '2階リビング：ほこり取り', 'エアコン', 121, 'Y', 'N'],
      ['item_122', '2階リビング：ほこり取り', '煙感知器', 122, 'Y', 'N'],
      ['item_123', '2階リビング：ほこり取り', '分電盤', 123, 'Y', 'N'],
      ['item_124', '2階リビング：ほこり取り', 'カウンター照明', 124, 'Y', 'N'],
      ['item_125', '2階リビング：ほこり取り', 'カウンターイスの足', 125, 'Y', 'N'],
      ['item_126', '2階リビング：ほこり取り', '換気扇', 126, 'Y', 'N'],
      ['item_127', '2階リビング：ほこり取り', '窓の木額縁、3か所', 127, 'Y', 'N'],
      ['item_128', '2階リビング：ほこり取り', '窓サッシ3か所　虫除去', 128, 'Y', 'N'],
      ['item_129', '2階リビング：マド拭き掃除（窓用シート）', 'テラス側マド　※必須', 129, 'Y', 'N'],
      ['item_130', '2階リビング：マド拭き掃除（窓用シート）', 'カウンター側マド（指紋、クモの巣、フン）', 130, 'Y', 'N'],
      ['item_131', '2階リビング：マド拭き掃除（窓用シート）', '和室側マド（指紋、クモの巣、フン）', 131, 'Y', 'N'],
      ['item_132', '2階リビング：拭き掃除（除菌シート）', 'カウンター', 132, 'Y', 'N'],
      ['item_133', '2階リビング：拭き掃除（除菌シート）', 'テーブル', 133, 'Y', 'N'],
      ['item_134', '2階リビング：拭き掃除（除菌シート）', 'エアコンリモコン', 134, 'Y', 'N'],
      ['item_135', '2階リビング：拭き掃除（除菌シート）', 'カウンター照明リモコン', 135, 'Y', 'N'],
      ['item_136', '2階リビング：A、グレーのカバーのとき（掛ふとんと枕なし）：グレーカバー', 'コロコロかける', 136, 'Y', 'N'],
      ['item_137', '2階リビング：A、グレーのカバーのとき（掛ふとんと枕なし）：グレーカバー', 'カバー汚れがひどいときは洗濯', 137, 'Y', 'N'],
      ['item_138', '2階リビング：A、グレーのカバーのとき（掛ふとんと枕なし）：グレーカバー', '代わりは1階和室引き出し一番下に、色違いがある。', 138, 'Y', 'N'],
      ['item_139', '2階リビング：A、グレーのカバーのとき（掛ふとんと枕なし）：防水シーツ（グレーのカバーの下に敷いている）', '汚れているときは手洗いして乾かす', 139, 'Y', 'N'],
      ['item_140', '2階リビング：A、グレーのカバーのとき（掛ふとんと枕なし）：防水シーツ（グレーのカバーの下に敷いている）', '（洗濯機だと機械が壊れます）', 140, 'Y', 'N'],
      ['item_141', '2階リビング：A、グレーのカバーのとき（掛ふとんと枕なし）：防水シーツ（グレーのカバーの下に敷いている）', '洗濯後、1階和室押入引き出し最下段へ収納', 141, 'Y', 'N'],
      ['item_142', '2階リビング：A、グレーのカバーのとき（掛ふとんと枕なし）：防水シーツ（グレーのカバーの下に敷いている）', '交換品も同じ場所にある', 142, 'Y', 'N'],
      ['item_143', '2階リビング：B、ベージュのシーツのとき', 'ベージュシーツを取り外して洗濯', 143, 'Y', 'N'],
      ['item_144', '2階リビング：B、ベージュのシーツのとき：グレーのカバーはそのまま装着', 'コロコロかける', 144, 'Y', 'N'],
      ['item_145', '2階リビング：B、ベージュのシーツのとき：グレーのカバーはそのまま装着', 'カバー汚れがひどいときは洗濯', 145, 'Y', 'N'],
      ['item_146', '2階リビング：B、ベージュのシーツのとき：グレーのカバーはそのまま装着', '代わりは1階和室引き出し一番下に、色違いがある。', 146, 'Y', 'N'],
      ['item_147', '2階リビング：B、ベージュのシーツのとき：防水シーツ（グレーのカバーの下に敷いている）', '汚れているときは手洗いして乾かす', 147, 'Y', 'N'],
      ['item_148', '2階リビング：B、ベージュのシーツのとき：防水シーツ（グレーのカバーの下に敷いている）', '（洗濯機だと機械が壊れます）', 148, 'Y', 'N'],
      ['item_149', '2階リビング：B、ベージュのシーツのとき：防水シーツ（グレーのカバーの下に敷いている）', '洗濯後、1階和室押入引き出し最下段へ収納', 149, 'Y', 'N'],
      ['item_150', '2階リビング：B、ベージュのシーツのとき：防水シーツ（グレーのカバーの下に敷いている）', '交換品も同じ場所にある', 150, 'Y', 'N'],
      ['item_151', '2階リビング：B、ベージュのシーツのとき：防水シーツ（グレーのカバーの下に敷いている）', '掛け布団x1、枕x2を1階和室の押入へ', 151, 'Y', 'N'],
      ['item_152', '2階リビング：B、ベージュのシーツのとき', '次の宿泊者人数を確認（乳幼児を除く）', 152, 'Y', 'N'],
      ['item_153', '2階リビング：次回3～8人（乳幼児を除く）', 'グレーのカバーのまま', 153, 'Y', 'N'],
      ['item_154', '2階リビング：次回1、2、9、10（乳幼児を除く）：ベッド化する。1階の押入から以下のものを持ってくる', 'セミダブル敷きシーツ　1枚', 154, 'Y', 'N'],
      ['item_155', '2階リビング：次回1、2、9、10（乳幼児を除く）：ベッド化する。1階の押入から以下のものを持ってくる', 'セミダブル掛け布団カバー　1枚', 155, 'Y', 'N'],
      ['item_156', '2階リビング：次回1、2、9、10（乳幼児を除く）：ベッド化する。1階の押入から以下のものを持ってくる', 'セミダブル掛け布団　1枚', 156, 'Y', 'N'],
      ['item_157', '2階リビング：次回1、2、9、10（乳幼児を除く）：ベッド化する。1階の押入から以下のものを持ってくる', '枕カバー　2枚', 157, 'Y', 'N'],
      ['item_158', '2階リビング：次回1、2、9、10（乳幼児を除く）：ベッド化する。1階の押入から以下のものを持ってくる', '枕　2個', 158, 'Y', 'N'],
      ['item_159', '2階リビング：次回1、2、9、10（乳幼児を除く）', 'シーツに髪の毛ついてない？', 159, 'Y', 'N'],
      ['item_160', '2階リビング：コロコロ', '和室　青でかクッション', 160, 'Y', 'N'],
      ['item_161', '2階リビング：コロコロ', '和室　クッション4個', 161, 'Y', 'N'],
      ['item_162', '2階リビング：コロコロ', '洋室　ソファ', 162, 'Y', 'N'],
      ['item_163', '2階リビング：コロコロ', '洋室　カウンターイス', 163, 'Y', 'N'],
      ['item_164', '2階リビング：コロコロ', '畳にクイックルワイパー', 164, 'Y', 'N'],
      ['item_165', '2階リビング：コロコロ', '掃除機かけ', 165, 'Y', 'N'],
      ['item_166', '2階リビング：和室の整頓', 'マットレスのシーツ整える（皴なく）', 166, 'Y', 'N'],
      ['item_167', '2階リビング：和室の整頓', 'クッション4個の位置調整（マットレスの上に）', 167, 'Y', 'N'],
      ['item_168', '2階リビング：和室の整頓', '青でかクッションを和室の角に設置', 168, 'Y', 'N'],
      ['item_169', '2階リビング：和室の整頓', '青でかクッションの形を整える（皴なく）', 169, 'Y', 'N'],
      ['item_170', '2階リビング：洋室の整頓', 'ソファの位置調整', 170, 'Y', 'N'],
      ['item_171', '2階リビング：洋室の整頓', 'ソファの背もたれ位置調整', 171, 'Y', 'N'],
      ['item_172', '2階リビング：洋室の整頓', 'テーブルの位置調整', 172, 'Y', 'N'],
      ['item_173', '2階リビング：洋室の整頓', 'カウンターイスの整頓', 173, 'Y', 'N'],
      ['item_174', '2階リビング：洋室の整頓', '冷蔵庫上の整頓（掃除道具、虫対策品）', 174, 'Y', 'N'],
      ['item_175', '2階リビング：洋室の整頓', 'おもちゃの整頓（カウンター右端）', 175, 'Y', 'N'],
      ['item_176', '2階リビング：洋室の整頓', 'リモコン2個の整頓（カウンター上、電源タップの横）', 176, 'Y', 'N'],
      ['item_177', '2階リビング：写真', '窓閉めた？3か所', 177, 'Y', 'N'],
      ['item_178', '2階リビング：写真', '【最終】髪の毛など落ちていない？', 178, 'Y', 'N'],
      ['item_179', '2階リビング：写真', '消灯', 179, 'Y', 'N'],
      ['item_180', '2階リビング：写真', 'ドアは閉めておく（虫侵入対策）', 180, 'Y', 'N'],
      ['item_181', '2階トイレ', '窓サッシの虫除去', 181, 'Y', 'N'],
      ['item_182', '2階トイレ：拭き取りシート（使い捨て手袋あります）', '【シートは便器に流さない！詰まる】', 182, 'Y', 'N'],
      ['item_183', '2階トイレ：拭き取りシート（使い捨て手袋あります）', '窓　木製額縁', 183, 'Y', 'N'],
      ['item_184', '2階トイレ：拭き取りシート（使い捨て手袋あります）', '床　全面', 184, 'Y', 'N'],
      ['item_185', '2階トイレ：拭き取りシート（使い捨て手袋あります）', '便器　手洗部分（ほこり溜まる', 185, 'Y', 'N'],
      ['item_186', '2階トイレ：拭き取りシート（使い捨て手袋あります）', '便座まわり（裏もしっかり', 186, 'Y', 'N'],
      ['item_187', '2階トイレ：拭き取りシート（使い捨て手袋あります）', 'ノズル（ボタン操作で出てきます', 187, 'Y', 'N'],
      ['item_188', '2階トイレ：拭き取りシート（使い捨て手袋あります）', '便器ブラシ掃除（黒ずみなど）', 188, 'Y', 'N'],
      ['item_189', '2階トイレ：拭き取りシート（使い捨て手袋あります）', 'ゴミ袋(黒)の回収', 189, 'Y', 'N'],
      ['item_190', '2階トイレ：拭き取りシート（使い捨て手袋あります）', 'ゴミ袋(黒)の装着(便器の裏にストックある', 190, 'Y', 'N'],
      ['item_191', '2階トイレ：補充', '【毎回】ハンドソープ', 191, 'Y', 'Y'],
      ['item_192', '2階トイレ：補充', 'ゴミ袋（黒）', 192, 'Y', 'Y'],
      ['item_193', '2階トイレ：補充', 'トイレットペーパー', 193, 'Y', 'Y'],
      ['item_194', '2階トイレ：補充', '拭き取りシート', 194, 'Y', 'Y'],
      ['item_195', '2階トイレ：補充', '便器掃除ブラシの先端', 195, 'Y', 'Y'],
      ['item_196', '2階トイレ：補充', '消臭スプレー（振って確認）', 196, 'Y', 'Y'],
      ['item_197', '2階トイレ：補充', 'トイレットペーパー三角折り', 197, 'Y', 'Y'],
      ['item_198', '2階トイレ：補充', 'フェイスタオルセット', 198, 'Y', 'Y'],
      ['item_199', '2階トイレ：補充', '窓閉めた？', 199, 'Y', 'Y'],
      ['item_200', '2階トイレ：補充', '【髪の毛など落ちていない？】', 200, 'Y', 'Y'],
      ['item_201', '2階トイレ：補充', 'スリッパ整頓', 201, 'Y', 'Y'],
      ['item_202', '2階トイレ：補充', '消灯', 202, 'Y', 'Y'],
      ['item_203', '2階トイレ：補充', 'ドア開けておく（換気、明り取り）', 203, 'Y', 'Y'],
      ['item_204', '1階トイレ', '窓サッシの虫除去', 204, 'Y', 'N'],
      ['item_205', '1階トイレ：拭き取りシート（使い捨て手袋あります）', '【シートは便器に流さない！詰まる】', 205, 'Y', 'N'],
      ['item_206', '1階トイレ：拭き取りシート（使い捨て手袋あります）', '窓　木製額縁', 206, 'Y', 'N'],
      ['item_207', '1階トイレ：拭き取りシート（使い捨て手袋あります）', '棚板', 207, 'Y', 'N'],
      ['item_208', '1階トイレ：拭き取りシート（使い捨て手袋あります）', '床　全面', 208, 'Y', 'N'],
      ['item_209', '1階トイレ：拭き取りシート（使い捨て手袋あります）', '便器　手洗部分ほこり溜まる', 209, 'Y', 'N'],
      ['item_210', '1階トイレ：拭き取りシート（使い捨て手袋あります）', '便座まわり（裏もしっかり', 210, 'Y', 'N'],
      ['item_211', '1階トイレ：拭き取りシート（使い捨て手袋あります）', 'ノズル（ボタン操作で出てきます', 211, 'Y', 'N'],
      ['item_212', '1階トイレ：拭き取りシート（使い捨て手袋あります）', '便器ブラシ掃除（黒ずみなど）', 212, 'Y', 'N'],
      ['item_213', '1階トイレ：拭き取りシート（使い捨て手袋あります）', 'ゴミ袋(黒)の回収', 213, 'Y', 'N'],
      ['item_214', '1階トイレ：拭き取りシート（使い捨て手袋あります）', 'ゴミ袋(黒)の装着(便器の裏にストックある', 214, 'Y', 'N'],
      ['item_215', '1階トイレ：補充', '【毎回】ハンドソープ', 215, 'Y', 'Y'],
      ['item_216', '1階トイレ：補充', 'ゴミ袋（黒）', 216, 'Y', 'Y'],
      ['item_217', '1階トイレ：補充', 'トイレットペーパー', 217, 'Y', 'Y'],
      ['item_218', '1階トイレ：補充', '拭き取りシート', 218, 'Y', 'Y'],
      ['item_219', '1階トイレ：補充', '便器掃除ブラシの先端', 219, 'Y', 'Y'],
      ['item_220', '1階トイレ：補充', '消臭スプレー（振って確認）', 220, 'Y', 'Y'],
      ['item_221', '1階トイレ：補充', 'トイレットペーパー三角折り', 221, 'Y', 'Y'],
      ['item_222', '1階トイレ：補充', 'フェイスタオルセット', 222, 'Y', 'Y'],
      ['item_223', '1階トイレ：補充', '窓閉めた？', 223, 'Y', 'Y'],
      ['item_224', '1階トイレ：補充', '【髪の毛など落ちていない？】', 224, 'Y', 'Y'],
      ['item_225', '1階トイレ：補充', 'スリッパ整頓', 225, 'Y', 'Y'],
      ['item_226', '1階トイレ：補充', '消灯', 226, 'Y', 'Y'],
      ['item_227', '1階トイレ：補充', 'ドア開けておく（換気、明り取り）', 227, 'Y', 'Y'],
      ['item_228', '2階廊下：ほこり取り', '照明器具', 228, 'Y', 'N'],
      ['item_229', '2階廊下：ほこり取り', '消火器', 229, 'Y', 'N'],
      ['item_230', '2階廊下：ほこり取り', '掃除機かけ', 230, 'Y', 'N'],
      ['item_231', '2階廊下：ほこり取り', 'ほうきちりとり整頓', 231, 'Y', 'N'],
      ['item_232', '2階廊下：ほこり取り', '消火器　位置調整', 232, 'Y', 'N'],
      ['item_233', '2階廊下：ほこり取り', 'ベビーゲートは開けたままにする', 233, 'Y', 'N'],
      ['item_234', '2階廊下：ほこり取り', '備品庫（2階和室）のカギを締める（番号007）', 234, 'Y', 'N'],
      ['item_235', '2階廊下：ほこり取り', '髪の毛、小石など落ちていない？', 235, 'Y', 'N'],
      ['item_236', '階段：（綿壁触れないよう注意）', '手すり拭き掃除（除菌シート）', 236, 'Y', 'N'],
      ['item_237', '階段：（綿壁触れないよう注意）', 'ほうき　または　掃除機（2階の掃除機のほうが取り回しがラク', 237, 'Y', 'N'],
      ['item_238', '階段：（綿壁触れないよう注意）', '階段のヘリも掃除機かけ', 238, 'Y', 'N'],
      ['item_239', '階段：（綿壁触れないよう注意）', '小石や砂が落ちていない？', 239, 'Y', 'N'],
      ['item_240', '1階和室', '押入の扉すべて開けて換気', 240, 'Y', 'N'],
      ['item_241', '1階和室', '洗ってきたシーツの収納', 241, 'Y', 'N'],
      ['item_242', '1階和室：リモコン3種類あるか？電池は？', '和室1', 242, 'Y', 'N'],
      ['item_243', '1階和室：リモコン3種類あるか？電池は？', '和室2', 243, 'Y', 'N'],
      ['item_244', '1階和室：リモコン3種類あるか？電池は？', 'ハンガー数量チェック（大10、中10、ズボン6）', 244, 'Y', 'N'],
      ['item_245', '1階和室：補充（都度）', 'マモルーム（ゴキブリ忌避）', 245, 'Y', 'Y'],
      ['item_246', '1階和室：補充（都度）', 'ファブリーズ', 246, 'Y', 'Y'],
      ['item_247', '1階和室：窓サッシの虫の死骸除去', '和室1', 247, 'Y', 'N'],
      ['item_248', '1階和室：窓サッシの虫の死骸除去', '和室2', 248, 'Y', 'N'],
      ['item_249', '1階和室：窓サッシの虫の死骸除去', 'マド拭き掃除（窓用シート）玄関棚の中', 249, 'Y', 'N'],
      ['item_250', '1階和室：窓サッシの虫の死骸除去', '入って左側の窓ガラス（指紋、クモの巣、フン）', 250, 'Y', 'N'],
      ['item_251', '1階和室：窓サッシの虫の死骸除去', 'テラス側の窓ガラス（指紋、クモの巣、フン）', 251, 'Y', 'N'],
      ['item_252', '1階和室：ほこり取り', 'エアコン上', 252, 'Y', 'N'],
      ['item_253', '1階和室：ほこり取り', '長押（なげし）', 253, 'Y', 'N'],
      ['item_254', '1階和室：ほこり取り', '欄間（らんま）', 254, 'Y', 'N'],
      ['item_255', '1階和室：ほこり取り', '照明', 255, 'Y', 'N'],
      ['item_256', '1階和室：ほこり取り', 'タンスの上', 256, 'Y', 'N'],
      ['item_257', '1階和室：ほこり取り', '床の間の棚', 257, 'Y', 'N'],
      ['item_258', '1階和室：ほこり取り', '床の間のほこり溜まる部分', 258, 'Y', 'N'],
      ['item_259', '1階和室：ほこり取り', 'コート掛け', 259, 'Y', 'N'],
      ['item_260', '1階和室：ほこり取り', 'すりガラスの格子', 260, 'Y', 'N'],
      ['item_261', '1階和室：ほこり取り', '扉の装飾の段差部分', 261, 'Y', 'N'],
      ['item_262', '1階和室：ほこり取り', '掃除機かけ（ざざっと）', 262, 'Y', 'N'],
      ['item_263', '1階和室：ほこり取り', 'シーツはがし（防水シートははがさない）', 263, 'Y', 'N'],
      ['item_264', '1階和室：ほこり取り', 'マットレス、枕、掛け布団 → 奥側のベッドの上に避難', 264, 'Y', 'N'],
      ['item_265', '1階和室：1、2名宿泊時：【2階リビングで寝るのでこの部屋の寝具は準備の必要なし】', '防水シートはつけたまま', 265, 'Y', 'N'],
      ['item_266', '1階和室：1、2名宿泊時：【2階リビングで寝るのでこの部屋の寝具は準備の必要なし】', 'シングルマットレスは押入に収納', 266, 'Y', 'N'],
      ['item_267', '1階和室：1、2名宿泊時：【2階リビングで寝るのでこの部屋の寝具は準備の必要なし】', 'セミダブルマットレスはベッドの上に乗せたまま', 267, 'Y', 'N'],
      ['item_268', '1階和室：1、2名宿泊時：【2階リビングで寝るのでこの部屋の寝具は準備の必要なし】', '枕、掛け布団は畳んでセミダブルベッドの上に置く', 268, 'Y', 'N'],
      ['item_269', '1階和室：3～10名宿泊時：セミダブルベッドのセット', 'セミダブルベッドのセッティング（2台とも）', 269, 'Y', 'N'],
      ['item_270', '1階和室：3～10名宿泊時：セミダブルベッドのセット', '枕はベッド1台につき2個（計4個）', 270, 'Y', 'N'],
      ['item_271', '1階和室：3～10名宿泊時：シングルマットレスも用意する場合', 'セミダブル掛け布団は3回折ってベッド上の枕側に置く', 271, 'Y', 'N'],
      ['item_272', '1階和室：3～10名宿泊時：シングルマットレスも用意する場合', '枕2個は畳んだセミダブル掛布団の上に置く', 272, 'Y', 'N'],
      ['item_273', '1階和室：3～10名宿泊時：（玄関側のベッドの上にシングルの掛け布団と枕を置くための措置です）', 'シワやたるみはない？', 273, 'Y', 'N'],
      ['item_274', '1階和室：3～10名宿泊時：（玄関側のベッドの上にシングルの掛け布団と枕を置くための措置です）', 'シーツに髪の毛ついていない？', 274, 'Y', 'N'],
      ['item_275', '1階和室：3～10名宿泊時：シングルマットレスのセット', 'シングルマットレス何人分必要か確認', 275, 'Y', 'N'],
      ['item_276', '1階和室：3～10名宿泊時：シングルマットレスのセット', '不要な枕 → カバーかけず、シーツ引出しのある押入か、その左の押入へ', 276, 'Y', 'N'],
      ['item_277', '1階和室：3～10名宿泊時：シングルマットレスのセット', '不要な掛け布団 → カバーかけず、シーツ引出しのある押入、その左の押入へ', 277, 'Y', 'N'],
      ['item_278', '1階和室：3～10名宿泊時：シングルマットレスのセット', '不要なシングルマットレス → 防水シーツつけたままタンス左の押入へ', 278, 'Y', 'N'],
      ['item_279', '1階和室：3～10名宿泊時：シングルマットレスのセット', 'シングルマットレスのセッティング（必要人数分）', 279, 'Y', 'N'],
      ['item_280', '1階和室：3～10名宿泊時：シングルマットレスのセット', 'シーツしたシングルマットレス → タンス左の押入とクローゼットへ2個ずつ入れる', 280, 'Y', 'N'],
      ['item_281', '1階和室：3～10名宿泊時：シングルマットレスのセット', 'シングル掛け布団は三回折って、玄関側ベッド上の足側（タンス側）に置く', 281, 'Y', 'N'],
      ['item_282', '1階和室：3～10名宿泊時：シングルマットレスのセット', '枕は掛け布団の上に置く', 282, 'Y', 'N'],
      ['item_283', '1階和室：3～10名宿泊時：シングルマットレスのセット', 'シワやたるみはない？', 283, 'Y', 'N'],
      ['item_284', '1階和室：3～10名宿泊時：シングルマットレスのセット', 'シーツに髪の毛ついていない？', 284, 'Y', 'N'],
      ['item_285', '1階和室：3～10名宿泊時', '掃除機かけ', 285, 'Y', 'N'],
      ['item_286', '1階和室：3～10名宿泊時：写真', '押入', 286, 'Y', 'N'],
      ['item_287', '1階和室：3～10名宿泊時：写真', '床の間（板の裏も）', 287, 'Y', 'N'],
      ['item_288', '1階和室：3～10名宿泊時：写真', 'タンス両脇', 288, 'Y', 'N'],
      ['item_289', '1階和室：3～10名宿泊時：写真', 'ベッド下', 289, 'Y', 'N'],
      ['item_290', '1階和室：3～10名宿泊時：写真', '床すべて', 290, 'Y', 'N'],
      ['item_291', '1階和室：3～10名宿泊時', 'ベッド位置調整', 291, 'Y', 'N'],
      ['item_292', '1階和室：3～10名宿泊時', 'コート掛け設置場所（テラス側マド前）', 292, 'Y', 'N'],
      ['item_293', '1階和室：3～10名宿泊時', '押入を閉じる（シングルマットレスが入っているところは除く）', 293, 'Y', 'N'],
      ['item_294', '1階和室：3～10名宿泊時', '窓閉めた？', 294, 'Y', 'N'],
      ['item_295', '1階和室：3～10名宿泊時', 'ベッド側のマドの障子閉めた？', 295, 'Y', 'N'],
      ['item_296', '1階和室：3～10名宿泊時', '髪の毛落ちていない？', 296, 'Y', 'N'],
      ['item_297', '1階和室：3～10名宿泊時', 'エアコンOFF（2台）', 297, 'Y', 'N'],
      ['item_298', '1階和室：3～10名宿泊時', '消灯', 298, 'Y', 'N'],
      ['item_299', 'お風呂', '【お風呂掃除用のクツが風呂入口左の窓付近に隠してあります】', 299, 'Y', 'N'],
      ['item_300', 'お風呂：補充', '【毎回】シャンプー', 300, 'Y', 'Y'],
      ['item_301', 'お風呂：補充', '【毎回】コンディショナー', 301, 'Y', 'Y'],
      ['item_302', 'お風呂：補充', '【毎回】ボディソープ', 302, 'Y', 'Y'],
      ['item_303', 'お風呂：補充', '洗顔フォーム（少ないときは新しいものも置いておく）', 303, 'Y', 'Y'],
      ['item_304', 'お風呂：補充', 'クレンジングオイル（少ないときは新しいものも置いておく）', 304, 'Y', 'Y'],
      ['item_305', 'お風呂：補充', 'マジックリン', 305, 'Y', 'Y'],
      ['item_306', 'お風呂：補充', 'マジックリンを床、壁、洗面器、イスに吹きかける', 306, 'Y', 'Y'],
      ['item_307', 'お風呂：補充', 'お湯でマジックリンを流す', 307, 'Y', 'Y'],
      ['item_308', 'お風呂：補充', '【日曜日のみ】カビキラーを床、壁、洗面器、イスに吹きかける', 308, 'Y', 'Y'],
      ['item_309', 'お風呂：補充', '【日曜日のみ】カビキラーを水で流す', 309, 'Y', 'Y'],
      ['item_310', 'お風呂：補充', '排水口の髪の毛を回収', 310, 'Y', 'Y'],
      ['item_311', 'お風呂：補充', '鏡はワイパーで水を切る（使用済みのタオルでも可）', 311, 'Y', 'Y'],
      ['item_312', 'お風呂：補充', '窓は閉める（小虫が入るので）', 312, 'Y', 'Y'],
      ['item_313', 'お風呂：補充', 'シャンプー等の位置調整', 313, 'Y', 'Y'],
      ['item_314', 'お風呂：補充', '洗面器、イスの整頓', 314, 'Y', 'Y'],
      ['item_315', 'お風呂：補充', 'シャワーの位置調整（上のホルダーにかける）', 315, 'Y', 'Y'],
      ['item_316', 'お風呂：補充', '換気扇は常にON', 316, 'Y', 'Y'],
      ['item_317', 'お風呂：補充', '消灯', 317, 'Y', 'Y'],
      ['item_318', 'お風呂：補充', '風呂掃除用のクツを元の場所へ', 318, 'Y', 'Y'],
      ['item_319', '脱衣・洗面所', '洗ってきたタオルの収納', 319, 'Y', 'N'],
      ['item_320', '脱衣・洗面所', '古いものは上の段の手前に移動', 320, 'Y', 'N'],
      ['item_321', '脱衣・洗面所：ほこり取り', '照明', 321, 'Y', 'N'],
      ['item_322', '脱衣・洗面所：ほこり取り', 'タオル棚', 322, 'Y', 'N'],
      ['item_323', '脱衣・洗面所：ほこり取り', 'ブレーカー', 323, 'Y', 'N'],
      ['item_324', '脱衣・洗面所：ほこり取り', '洗面台の棚、電球など', 324, 'Y', 'N'],
      ['item_325', '脱衣・洗面所：ほこり取り', '洗濯機の上', 325, 'Y', 'N'],
      ['item_326', '脱衣・洗面所：ほこり取り', '除湿器の上', 326, 'Y', 'N'],
      ['item_327', '脱衣・洗面所：ほこり取り', 'カラフルコップの洗浄（キッチンで）', 327, 'Y', 'N'],
      ['item_328', '脱衣・洗面所：洗面台', '洗面台ボウルにキッチン泡ハイター（洗面台の下の収納にある）', 328, 'Y', 'N'],
      ['item_329', '脱衣・洗面所：洗面台', '洗面台ボウルをすすぐ', 329, 'Y', 'N'],
      ['item_330', '脱衣・洗面所：洗面台', '洗面台のボウル周りを使用済みタオルで拭き取る', 330, 'Y', 'N'],
      ['item_331', '脱衣・洗面所：拭き掃除（除菌シート）', '衣装ケース天板', 331, 'Y', 'N'],
      ['item_332', '脱衣・洗面所：拭き掃除（除菌シート）', 'テーブル', 332, 'Y', 'N'],
      ['item_333', '脱衣・洗面所：拭き掃除（除菌シート）', 'イス', 333, 'Y', 'N'],
      ['item_334', '脱衣・洗面所：拭き掃除（除菌シート）', '洗濯機 フタあけ', 334, 'Y', 'N'],
      ['item_335', '脱衣・洗面所：拭き掃除（除菌シート）', '洗濯機 フィルター掃除', 335, 'Y', 'N'],
      ['item_336', '脱衣・洗面所：人数分用意', 'T字カミソリ（化粧机上のコップ', 336, 'Y', 'Y'],
      ['item_337', '脱衣・洗面所：人数分用意', '歯ブラシ（化粧机上のコップ', 337, 'Y', 'Y'],
      ['item_338', '脱衣・洗面所：人数分用意', 'カラフルコップ、色はバラけさせる（化粧机の上', 338, 'Y', 'Y'],
      ['item_339', '脱衣・洗面所：人数分用意', 'フェスタオル（洗濯機上の棚', 339, 'Y', 'Y'],
      ['item_340', '脱衣・洗面所：人数分用意', 'バスタオル（洗濯機上の棚', 340, 'Y', 'Y'],
      ['item_341', '脱衣・洗面所：1枚用意', 'フェイスタオル（洗面台横のタオル掛け', 341, 'Y', 'Y'],
      ['item_342', '脱衣・洗面所：1枚用意', '足タオル（洗濯機の口にかける', 342, 'Y', 'Y'],
      ['item_343', '脱衣・洗面所：その他（重複するけど念のため）', 'キッチン フェイスタオル', 343, 'Y', 'N'],
      ['item_344', '脱衣・洗面所：その他（重複するけど念のため）', 'キッチン 食器拭きタオル', 344, 'Y', 'N'],
      ['item_345', '脱衣・洗面所：その他（重複するけど念のため）', '1階トイレ フェイスタオル', 345, 'Y', 'N'],
      ['item_346', '脱衣・洗面所：その他（重複するけど念のため）', '2階トイレ フェイスタオル', 346, 'Y', 'N'],
      ['item_347', '脱衣・洗面所：補充', '【毎回】ハンドソープ', 347, 'Y', 'Y'],
      ['item_348', '脱衣・洗面所：補充', '【毎回】化粧水', 348, 'Y', 'Y'],
      ['item_349', '脱衣・洗面所：補充', '【毎回】乳液', 349, 'Y', 'Y'],
      ['item_350', '脱衣・洗面所：補充', '日焼け止め', 350, 'Y', 'Y'],
      ['item_351', '脱衣・洗面所：補充', '洗たく洗剤', 351, 'Y', 'Y'],
      ['item_352', '脱衣・洗面所：補充', 'ワイドハイター（漂白剤）', 352, 'Y', 'Y'],
      ['item_353', '脱衣・洗面所：補充', '歯ブラシ', 353, 'Y', 'Y'],
      ['item_354', '脱衣・洗面所：補充', 'T字カミソリ', 354, 'Y', 'Y'],
      ['item_355', '脱衣・洗面所：【在庫管理リストもゆくゆく用意します】', '床面クイックルワイパー（キッチンTV裏', 355, 'Y', 'N'],
      ['item_356', '脱衣・洗面所：【在庫管理リストもゆくゆく用意します】', 'クイックルワイパーシート交換（脱衣所ボックス内', 356, 'Y', 'N'],
      ['item_357', '脱衣・洗面所：掃除機かけ', '洗濯パンの中', 357, 'Y', 'N'],
      ['item_358', '脱衣・洗面所：掃除機かけ', '衣装ケースの上', 358, 'Y', 'N'],
      ['item_359', '脱衣・洗面所：掃除機かけ', '床面', 359, 'Y', 'N'],
      ['item_360', '脱衣・洗面所：掃除機かけ', '物干し道具の整頓', 360, 'Y', 'N'],
      ['item_361', '脱衣・洗面所：掃除機かけ', '洗濯かごのセット', 361, 'Y', 'N'],
      ['item_362', '脱衣・洗面所：掃除機かけ', '化粧机の上、アメニティの整頓', 362, 'Y', 'N'],
      ['item_363', '脱衣・洗面所：掃除機かけ', 'イスの整頓', 363, 'Y', 'N'],
      ['item_364', '脱衣・洗面所：掃除機かけ', 'ドライヤーの整頓', 364, 'Y', 'N'],
      ['item_365', '脱衣・洗面所：掃除機かけ', 'タオルの整頓', 365, 'Y', 'N'],
      ['item_366', '脱衣・洗面所：掃除機かけ', '収納のドア閉める', 366, 'Y', 'N'],
      ['item_367', '脱衣・洗面所：掃除機かけ', '髪の毛など落ちていない？', 367, 'Y', 'N'],
      ['item_368', '脱衣・洗面所：掃除機かけ', '消灯', 368, 'Y', 'N'],
      ['item_369', 'キッチン', 'ロールスクリーン上げる', 369, 'Y', 'N'],
      ['item_370', 'キッチン', 'イス7個あるか', 370, 'Y', 'N'],
      ['item_371', 'キッチン', 'テーブル2個あるか', 371, 'Y', 'N'],
      ['item_372', 'キッチン', '窓サッシの虫の死骸除去', 372, 'Y', 'N'],
      ['item_373', 'キッチン：ほこり取り', 'エアコンのついているカーテンボックス', 373, 'Y', 'N'],
      ['item_374', 'キッチン：ほこり取り', '冷蔵庫上', 374, 'Y', 'N'],
      ['item_375', 'キッチン：ほこり取り', '冷蔵庫の左右すきま', 375, 'Y', 'N'],
      ['item_376', 'キッチン：ほこり取り', '照明', 376, 'Y', 'N'],
      ['item_377', 'キッチン：ほこり取り', 'TV裏', 377, 'Y', 'N'],
      ['item_378', 'キッチン：ほこり取り', 'TV下', 378, 'Y', 'N'],
      ['item_379', 'キッチン：ほこり取り', 'ゴミ箱の上', 379, 'Y', 'N'],
      ['item_380', 'キッチン：ほこり取り', 'SoftbankAirの上（白い四角いの）', 380, 'Y', 'N'],
      ['item_381', 'キッチン：ほこり取り', '窓サッシ', 381, 'Y', 'N'],
      ['item_382', 'キッチン：ほこり取り', 'SoftbankAirの上（白い四角いの）', 382, 'Y', 'N'],
      ['item_383', 'キッチン：ほこり取り', '電子レンジ上', 383, 'Y', 'N'],
      ['item_384', 'キッチン：ほこり取り', '電子レンジ　後ろ、下', 384, 'Y', 'N'],
      ['item_385', 'キッチン：ほこり取り', 'キッチンの中（食器入れの上とか炊飯器、IH周りとか）', 385, 'Y', 'N'],
      ['item_386', 'キッチン：冷蔵庫の中をチェック', '外に出てる調味料は冷蔵庫へ', 386, 'Y', 'N'],
      ['item_387', 'キッチン：冷蔵庫の中をチェック', '調味料以外は廃棄（持ち帰りOK）', 387, 'Y', 'N'],
      ['item_388', 'キッチン：冷蔵庫の中をチェック', '最下段に生ゴミあれば廃棄（宿泊者に入れるようお願いしている）', 388, 'Y', 'N'],
      ['item_389', 'キッチン：空き缶、ビン、ペットボトル', 'ゴミ箱から取り出す', 389, 'Y', 'N'],
      ['item_390', 'キッチン：空き缶、ビン、ペットボトル', 'すすぐ', 390, 'Y', 'N'],
      ['item_391', 'キッチン：空き缶、ビン、ペットボトル', '空き缶：簡単にでもつぶす', 391, 'Y', 'N'],
      ['item_392', 'キッチン：空き缶、ビン、ペットボトル', 'ペットボトル：ラベル、キャップ捨てる', 392, 'Y', 'N'],
      ['item_393', 'キッチン：空き缶、ビン、ペットボトル', '分別してゴミ袋にまとめる', 393, 'Y', 'N'],
      ['item_394', 'キッチン：空き缶、ビン、ペットボトル', 'とりあえず玄関外に出す', 394, 'Y', 'N'],
      ['item_395', 'キッチン：空き缶、ビン、ペットボトル', 'しまってある食器、フライパンなどの状態チェック（必要に応じて洗浄）', 395, 'Y', 'N'],
      ['item_396', 'キッチン：空き缶、ビン、ペットボトル', '食器洗い', 396, 'Y', 'N'],
      ['item_397', 'キッチン：空き缶、ビン、ペットボトル', '洗面所カラフルコップの洗浄', 397, 'Y', 'N'],
      ['item_398', 'キッチン：空き缶、ビン、ペットボトル', '食器拭いて片づけ', 398, 'Y', 'N'],
      ['item_399', 'キッチン：空き缶、ビン、ペットボトル', '（食器拭きは新しいものを使用。洗濯する。洗濯方法は考えます）', 399, 'Y', 'N'],
      ['item_400', 'キッチン：ケトル', '中の水捨て', 400, 'Y', 'N'],
      ['item_401', 'キッチン：ケトル', '中が濡れている場合はフタを外し、逆さにして水切りカゴに置く', 401, 'Y', 'N'],
      ['item_402', 'キッチン：ケトル', '（水切りカゴに置いたままでよい）', 402, 'Y', 'N'],
      ['item_403', 'キッチン：ケトル', '濡れていなければ定位置へ（ガス台の下）', 403, 'Y', 'N'],
      ['item_404', 'キッチン：炊飯器', '使用されているか確認', 404, 'Y', 'N'],
      ['item_405', 'キッチン：炊飯器', '汚れたままの場合は洗浄', 405, 'Y', 'N'],
      ['item_406', 'キッチン：炊飯器', '食器拭きで拭く', 406, 'Y', 'N'],
      ['item_407', 'キッチン：炊飯器', '定位置へ（シンクの右下）', 407, 'Y', 'N'],
      ['item_408', 'キッチン：炊飯器', '流し台の水切りネット交換（燃えるゴミへ）', 408, 'Y', 'N'],
      ['item_409', 'キッチン：炊飯器', 'スポンジ交換（必要に応じて）', 409, 'Y', 'N'],
      ['item_410', 'キッチン：呉市はビニール系も燃やせるゴミです', '生ゴミ（冷蔵庫最下段）回収', 410, 'Y', 'N'],
      ['item_411', 'キッチン：呉市はビニール系も燃やせるゴミです', '生ゴミ（排水口）回収', 411, 'Y', 'N'],
      ['item_412', 'キッチン：呉市はビニール系も燃やせるゴミです', '燃えるゴミだけでゴミ袋まとめる', 412, 'Y', 'N'],
      ['item_413', 'キッチン：呉市はビニール系も燃やせるゴミです', '掃除しているとゴミが出てくるので、口は縛らず室内に置いておく', 413, 'Y', 'N'],
      ['item_414', 'キッチン：呉市はビニール系も燃やせるゴミです', 'ゴミ箱の中に予備のゴミ袋あるか？5枚程度（45L）', 414, 'Y', 'N'],
      ['item_415', 'キッチン：呉市はビニール系も燃やせるゴミです', 'ゴミ箱にゴミ袋（45L）を装着', 415, 'Y', 'N'],
      ['item_416', 'キッチン：呉市はビニール系も燃やせるゴミです', 'マド拭き掃除（窓用シート）玄関棚の中', 416, 'Y', 'N'],
      ['item_417', 'キッチン：呉市はビニール系も燃やせるゴミです', '糞、指紋、クモの巣が目立つ場合', 417, 'Y', 'N'],
      ['item_418', 'キッチン：拭き掃除（除菌シート）', '冷蔵庫の中（ほこりやソースなど）', 418, 'Y', 'N'],
      ['item_419', 'キッチン：拭き掃除（除菌シート）', 'キッチンペーパーケース', 419, 'Y', 'N'],
      ['item_420', 'キッチン：拭き掃除（除菌シート）', '電子レンジの中', 420, 'Y', 'N'],
      ['item_421', 'キッチン：拭き掃除（除菌シート）', '食器水切りのトレー', 421, 'Y', 'N'],
      ['item_422', 'キッチン：拭き掃除（除菌シート）', 'キッチンの上', 422, 'Y', 'N'],
      ['item_423', 'キッチン：拭き掃除（除菌シート）', 'ガス台の周辺（タイルや置台、コンセント）', 423, 'Y', 'N'],
      ['item_424', 'キッチン：拭き掃除（除菌シート）', 'お盆', 424, 'Y', 'N'],
      ['item_425', 'キッチン：拭き掃除（除菌シート）', 'IHコンロ（よくギトギトになっている）', 425, 'Y', 'N'],
      ['item_426', 'キッチン：拭き掃除（除菌シート）', '定位置へ（ガス台の下）', 426, 'Y', 'N'],
      ['item_427', 'キッチン：拭き掃除（除菌シート）', 'テーブルの上', 427, 'Y', 'N'],
      ['item_428', 'キッチン：拭き掃除（除菌シート）', 'イスのひじ掛け', 428, 'Y', 'N'],
      ['item_429', 'キッチン：拭き掃除（除菌シート）', '床の飲み物こぼし跡など（よくテカってます', 429, 'Y', 'N'],
      ['item_430', 'キッチン：拭き掃除（除菌シート）', 'コロコロ　イス7個', 430, 'Y', 'N'],
      ['item_431', 'キッチン：拭き掃除（除菌シート）', 'イスをテーブルの上にあげる', 431, 'Y', 'N'],
      ['item_432', 'キッチン：補充', '【毎回】洗剤', 432, 'Y', 'Y'],
      ['item_433', 'キッチン：補充', '【毎回】ハンドソープ', 433, 'Y', 'Y'],
      ['item_434', 'キッチン：補充', '【毎回】水切りネット', 434, 'Y', 'Y'],
      ['item_435', 'キッチン：補充', 'ティッシュ', 435, 'Y', 'Y'],
      ['item_436', 'キッチン：補充', 'キッチンペーパー', 436, 'Y', 'Y'],
      ['item_437', 'キッチン：補充', 'ラップ', 437, 'Y', 'Y'],
      ['item_438', 'キッチン：補充', 'アルミホイル', 438, 'Y', 'Y'],
      ['item_439', 'キッチン：補充', '箱入りの小さいビニール袋', 439, 'Y', 'Y'],
      ['item_440', 'キッチン：補充', 'コロコロ', 440, 'Y', 'Y'],
      ['item_441', 'キッチン：補充', 'クイックルワイパーシート', 441, 'Y', 'Y'],
      ['item_442', 'キッチン：補充', 'クイックルハンディもふもふ', 442, 'Y', 'Y'],
      ['item_443', 'キッチン：補充', 'マモルーム（ゴキブリ忌避）', 443, 'Y', 'Y'],
      ['item_444', 'キッチン：補充', 'ラーメン（5食）階段下ケース内にある', 444, 'Y', 'Y'],
      ['item_445', 'キッチン：補充', '調味料（冷蔵庫内）', 445, 'Y', 'Y'],
      ['item_446', 'キッチン：補充', '照明リモコンあるか？電池は？', 446, 'Y', 'Y'],
      ['item_447', 'キッチン：補充', 'エアコンリモコンあるか？電池は？', 447, 'Y', 'Y'],
      ['item_448', 'キッチン：TV', '指紋よごれ、TV裏の布で拭く', 448, 'Y', 'N'],
      ['item_449', 'キッチン：TV', 'リモコンあるか？電池は？', 449, 'Y', 'N'],
      ['item_450', 'キッチン：TV', '履歴消去（電源ONしたときの画面の左上が（t）であれば不要。人名などの場合は宿泊客のアカウントの可能性があるためログアウト処理）', 450, 'Y', 'N'],
      ['item_451', 'キッチン：TV', '音量を20に', 451, 'Y', 'N'],
      ['item_452', 'キッチン：TV', '電源OFF', 452, 'Y', 'N'],
      ['item_453', 'キッチン：TV', 'リモコンの整理', 453, 'Y', 'N'],
      ['item_454', 'キッチン：TV', '照明（部屋出入口のわき）', 454, 'Y', 'N'],
      ['item_455', 'キッチン：TV', 'エアコン、TV（TV下のティッシュケース）', 455, 'Y', 'N'],
      ['item_456', 'キッチン：TV', '電源タップを定位置へ（TV下）', 456, 'Y', 'N'],
      ['item_457', 'キッチン：TV', '炊飯器、IHコンロ、ケトルの整頓', 457, 'Y', 'N'],
      ['item_458', 'キッチン：TV', '鍋敷きを定位置へ（冷蔵庫側面に貼付け）', 458, 'Y', 'N'],
      ['item_459', 'キッチン：TV', '食器の整頓', 459, 'Y', 'N'],
      ['item_460', 'キッチン：TV', '洗った食器が乾燥棚に残されていないか？（まな板は水切り棚）', 460, 'Y', 'N'],
      ['item_461', 'キッチン：TV', '床面クイックルワイパー', 461, 'Y', 'N'],
      ['item_462', 'キッチン：TV', 'ワイパーのシート交換', 462, 'Y', 'N'],
      ['item_463', 'キッチン：TV', '掃除機かけ', 463, 'Y', 'N'],
      ['item_464', 'キッチン：TV', '【床面テカってない？】', 464, 'Y', 'N'],
      ['item_465', 'キッチン：TV', '【髪の毛おちていない？】', 465, 'Y', 'N'],
      ['item_466', 'キッチン：TV', 'イスとテーブルの整頓', 466, 'Y', 'N'],
      ['item_467', 'キッチン：TV', 'テーブルの上にラミネートの注意書き2枚置く（騒音、ゴミ捨て）', 467, 'Y', 'N'],
      ['item_468', 'キッチン：TV', 'のれんが汚れていれば洗濯', 468, 'Y', 'N'],
      ['item_469', 'キッチン：TV', '換気扇は常時ON', 469, 'Y', 'N'],
      ['item_470', 'キッチン：TV', '窓閉めた？', 470, 'Y', 'N'],
      ['item_471', 'キッチン：TV', 'TV OFF？', 471, 'Y', 'N'],
      ['item_472', 'キッチン：TV', 'エアコンOFF？', 472, 'Y', 'N'],
      ['item_473', 'キッチン：TV', '【髪の毛など落ちていない？】', 473, 'Y', 'N'],
      ['item_474', 'キッチン：TV', '消灯', 474, 'Y', 'N'],
      ['item_475', '1階トイレ前廊下：ほこり取り', '照明', 475, 'Y', 'N'],
      ['item_476', '1階トイレ前廊下：ほこり取り', 'トイレドアの窓回り', 476, 'Y', 'N'],
      ['item_477', '1階トイレ前廊下：掃除機かけ', '両サイドの木見切りの上', 477, 'Y', 'N'],
      ['item_478', '1階トイレ前廊下：掃除機かけ', '床面', 478, 'Y', 'N'],
      ['item_479', '1階トイレ前廊下：掃除機かけ', '砂など落ちていない？', 479, 'Y', 'N'],
      ['item_480', '1階トイレ前廊下：掃除機かけ', '消灯', 480, 'Y', 'N'],
      ['item_481', '1階廊下：（綿壁触れないよう注意）', '備品庫のドア開けて換気（番号007）', 481, 'Y', 'N'],
      ['item_482', '1階廊下：（綿壁触れないよう注意）', 'BBQセット、必要な場合は備品庫からとりだす', 482, 'Y', 'N'],
      ['item_483', '1階廊下：ほこり取り', '備品庫ドアの格子', 483, 'Y', 'N'],
      ['item_484', '1階廊下：ほこり取り', '照明', 484, 'Y', 'N'],
      ['item_485', '1階廊下：ほこり取り', '消火器', 485, 'Y', 'N'],
      ['item_486', '1階廊下：ほこり取り', '階段下の棚', 486, 'Y', 'N'],
      ['item_487', '1階廊下：ほこり取り', 'コロコロ（室内スリッパの裏（8セット）', 487, 'Y', 'N'],
      ['item_488', '1階廊下：ほこり取り', '室内スリッパの整頓', 488, 'Y', 'N'],
      ['item_489', '1階廊下：補充', 'トイレットペーパー', 489, 'Y', 'Y'],
      ['item_490', '1階廊下：補充', 'ラーメン', 490, 'Y', 'Y'],
      ['item_491', '1階廊下：補充', 'ガスボンベ', 491, 'Y', 'Y'],
      ['item_492', '1階廊下：掃除機かけ', 'スリッパかけ、消火器の下', 492, 'Y', 'N'],
      ['item_493', '1階廊下：掃除機かけ', '階段下の衣装ケースの上', 493, 'Y', 'N'],
      ['item_494', '1階廊下：掃除機かけ', '階段下の衣装ケースの下', 494, 'Y', 'N'],
      ['item_495', '1階廊下：掃除機かけ', '備品庫の中。軽くでよい', 495, 'Y', 'N'],
      ['item_496', '1階廊下：掃除機かけ', '床面', 496, 'Y', 'N'],
      ['item_497', '1階廊下：掃除機かけ', '砂など落ちていない？', 497, 'Y', 'N'],
      ['item_498', '1階廊下：掃除機かけ', '髪の毛など落ちていない？', 498, 'Y', 'N'],
      ['item_499', '1階廊下：掃除機かけ', '備品庫のドアを施錠（番号007）', 499, 'Y', 'N'],
      ['item_500', '1階廊下：掃除機かけ', '消灯', 500, 'Y', 'N'],
      ['item_501', '玄関', '玄関　鏡前のほうき・チリトリの有無チェック', 501, 'Y', 'N'],
      ['item_502', '玄関：補充', '殺虫スプレー（くも）振って確認', 502, 'Y', 'Y'],
      ['item_503', '玄関：補充', '殺虫スプレー（ムカデ）振って確認', 503, 'Y', 'Y'],
      ['item_504', '玄関：補充', '殺虫スプレー（ハチ）振って確認', 504, 'Y', 'Y'],
      ['item_505', '玄関：補充', 'スーツケースのキャスターのカバー', 505, 'Y', 'Y'],
      ['item_506', '玄関：補充', 'チラシなど（随時追加予定）', 506, 'Y', 'Y'],
      ['item_507', '玄関：チェック', 'マド拭きシートの有無（靴箱内）', 507, 'Y', 'N'],
      ['item_508', '玄関：チェック', '救急箱（靴箱内）', 508, 'Y', 'N'],
      ['item_509', '玄関：チェック', '充電ケーブルの有無（靴箱内）', 509, 'Y', 'N'],
      ['item_510', '玄関：チェック', '文房具（靴箱内）', 510, 'Y', 'N'],
      ['item_511', '玄関：ほこり取り', '照明', 511, 'Y', 'N'],
      ['item_512', '玄関：ほこり取り', '玄関ドアの上のほうなど', 512, 'Y', 'N'],
      ['item_513', '玄関：ほこり取り', '和室の引き戸の上', 513, 'Y', 'N'],
      ['item_514', '玄関：ほこり取り', '靴箱みたいな棚の全体', 514, 'Y', 'N'],
      ['item_515', '玄関：ほこり取り', '拭き掃除（カガミ', 515, 'Y', 'N'],
      ['item_516', '玄関：ほこり取り', 'はき掃除', 516, 'Y', 'N'],
      ['item_517', '玄関：ほこり取り', '土間', 517, 'Y', 'N'],
      ['item_518', '玄関：ほこり取り', '玄関ドアの下のミゾ', 518, 'Y', 'N'],
      ['item_519', '玄関：ほこり取り', '掃除機かけ', 519, 'Y', 'N'],
      ['item_520', '玄関：ほこり取り', '玄関マットをはたく（外で）', 520, 'Y', 'N'],
      ['item_521', '玄関：ほこり取り', '玄関外の靴箱の上の掃除', 521, 'Y', 'N'],
      ['item_522', '玄関：ほこり取り', '屋外スリッパの整頓（大1、小2）', 522, 'Y', 'N'],
      ['item_523', '玄関：ほこり取り', 'ほうき、ちりとりの整頓', 523, 'Y', 'N'],
      ['item_524', '玄関：ほこり取り', '砂、小石など落ちていないか？', 524, 'Y', 'N'],
      ['item_525', '最終チェック：宿泊人数分用意するもの：フェイスタオル', '2階トイレ　1枚', 525, 'Y', 'Y'],
      ['item_526', '最終チェック：宿泊人数分用意するもの：フェイスタオル', '1階トイレ　1枚', 526, 'Y', 'Y'],
      ['item_527', '最終チェック：宿泊人数分用意するもの：フェイスタオル', 'キッチン　1枚', 527, 'Y', 'Y'],
      ['item_528', '最終チェック：宿泊人数分用意するもの：フェイスタオル', '洗面台　1枚', 528, 'Y', 'Y'],
      ['item_529', '最終チェック：宿泊人数分用意するもの：フェイスタオル', '洗濯機の棚上　人数分', 529, 'Y', 'Y'],
      ['item_530', '最終チェック：宿泊人数分用意するもの：フェイスタオル', 'バスタオル　洗濯機の棚上　人数分', 530, 'Y', 'Y'],
      ['item_531', '最終チェック：宿泊人数分用意するもの：フェイスタオル', '足タオル　洗濯機にかけておく　1枚', 531, 'Y', 'Y'],
      ['item_532', '最終チェック：宿泊人数分用意するもの：フェイスタオル', '食器ふきタオル　キッチン水切り棚にひっかける　1枚', 532, 'Y', 'Y'],
      ['item_533', '最終チェック：宿泊人数分用意するもの：フェイスタオル', '1、2名　→　2階マットのみベッド化して使用', 533, 'Y', 'Y'],
      ['item_534', '最終チェック：宿泊人数分用意するもの：フェイスタオル', '3～8名　→　1階和室　シングルの数量あってる？', 534, 'Y', 'Y'],
      ['item_535', '最終チェック：宿泊人数分用意するもの：フェイスタオル', '9～10名　→　1階和室の数量と2階のマットもベッド化してる？', 535, 'Y', 'Y'],
      ['item_536', '最終チェック：戸締り確認', 'お風呂　換気扇は常時ON', 536, 'Y', 'N'],
      ['item_537', '最終チェック：戸締り確認', 'キッチン　換気扇は常時ON', 537, 'Y', 'N'],
      ['item_538', '最終チェック：戸締り確認', 'エアコンOFF　2階リビング', 538, 'Y', 'N'],
      ['item_539', '最終チェック：戸締り確認', 'エアコンOFF　和室1', 539, 'Y', 'N'],
      ['item_540', '最終チェック：戸締り確認', 'エアコンOFF　和室2', 540, 'Y', 'N'],
      ['item_541', '最終チェック：戸締り確認', 'エアコンOFF　キッチン', 541, 'Y', 'N'],
      ['item_542', '最終チェック：戸締り確認', '和室押入　閉じた？', 542, 'Y', 'N'],
      ['item_543', '最終チェック：戸締り確認', '脱衣所の収納扉　閉めた？', 543, 'Y', 'N'],
      ['item_544', '最終チェック：戸締り確認', '1階備品庫　施錠した？', 544, 'Y', 'N'],
      ['item_545', '最終チェック：戸締り確認', '2階備品庫　施錠した？', 545, 'Y', 'N'],
      ['item_546', '最終チェック：戸締り確認', '照明OFF　全部屋', 546, 'Y', 'N'],
      ['item_547', '最終チェック：戸締り確認', 'マド施錠　全部屋', 547, 'Y', 'N'],
      ['item_548', '最終チェック：戸締り確認', '忘れ物ない？', 548, 'Y', 'N'],
      ['item_549', '最終チェック：持って出るもの', '使用済みリネン（シーツ、タオル）', 549, 'Y', 'N'],
      ['item_550', '最終チェック：持って出るもの', 'ゴミ', 550, 'Y', 'N'],
      ['item_551', '最終チェック：持って出るもの', '個人の荷物', 551, 'Y', 'N'],
      ['item_552', '最終チェック：持って出るもの', 'ホテルのカギ', 552, 'Y', 'N'],
      ['item_553', '最終チェック：最後の最後', 'テラスでやり残した作業はない？', 553, 'Y', 'N'],
      ['item_554', '最終チェック：最後の最後', 'チェック漏れないかリスト再確認', 554, 'Y', 'N'],
      ['item_555', '最終チェック：最後の最後', '玄関ドア施錠', 555, 'Y', 'N'],
      ['item_556', '最終チェック：最後の最後', 'カギをキーボックスへ入れる', 556, 'Y', 'N'],
      ['item_557', '最終チェック：最後の最後', 'ゴミ捨て（未舗装駐車場のゴミボックスへ）', 557, 'Y', 'N'],
      ['item_558', '最終チェック：最後の最後', 'いっぱいになりそうなときは西山へ連絡', 558, 'Y', 'N'],
    ];

    // チェックリスト項目を一括書き込み
    if (items.length > 0) {
      sheet.getRange(2, 1, items.length, 6).setValues(items);
    }

    // 撮影箇所データ
    var spots = [
      ['spot_1', '駐車場', 'ビフォー/アフター', '', 1, 'Y', '駐車場'],
      ['spot_2', 'テラス全景', 'ビフォー/アフター', '', 2, 'Y', 'テラス'],
      ['spot_3', 'テラス：ガスコンロ', 'ビフォー/アフター', '', 3, 'Y', 'テラス'],
      ['spot_4', 'テラス：流し台', 'ビフォー/アフター', '', 4, 'Y', 'テラス'],
      ['spot_5', '2階ベランダ（テラス側）', 'ビフォー/アフター', '', 5, 'Y', '2階ベランダ（テラス側）'],
      ['spot_6', '2階ベランダ（和室側）', 'ビフォー/アフター', '', 6, 'Y', '2階ベランダ（和室側）'],
      ['spot_7', '敷地内', 'ビフォー/アフター', '', 7, 'Y', '敷地内（テラスとベランダ以外）'],
      ['spot_8', '2階リビング：和室', 'アフター', '', 8, 'Y', '2階リビング'],
      ['spot_9', '2階リビング：洋室', 'アフター', '', 9, 'Y', '2階リビング'],
      ['spot_10', '2階トイレ', 'アフター', '', 10, 'Y', '2階トイレ'],
      ['spot_11', '1階トイレ', 'アフター', '', 11, 'Y', '1階トイレ'],
      ['spot_12', '2階廊下', 'アフター', '', 12, 'Y', '2階廊下'],
      ['spot_13', '階段', 'アフター', '', 13, 'Y', '階段'],
      ['spot_14', '1階和室', 'アフター', '', 14, 'Y', '1階和室'],
      ['spot_15', 'お風呂', 'アフター', '', 15, 'Y', 'お風呂'],
      ['spot_16', '脱衣・洗面所', 'アフター', '', 16, 'Y', '脱衣・洗面所'],
      ['spot_17', 'キッチン', 'アフター', '', 17, 'Y', 'キッチン'],
      ['spot_18', '1階トイレ前廊下', 'アフター', '', 18, 'Y', '1階トイレ前廊下'],
      ['spot_19', '1階廊下', 'アフター', '', 19, 'Y', '1階廊下'],
      ['spot_20', '玄関', 'アフター', '', 20, 'Y', '玄関'],
    ];

    // 撮影箇所を一括書き込み
    if (spots.length > 0) {
      spotSheet.getRange(2, 1, spots.length, 7).setValues(spots);
    }

    return JSON.stringify({ success: true, itemCount: items.length, spotCount: spots.length });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * チェックリスト項目のテキストを更新
 */
function updateChecklistItemText(itemId, newText) {
  try {
    if (!itemId || !newText) return JSON.stringify({ success: false, error: '項目IDまたはテキストが空です' });
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '項目が見つかりません' });
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(itemId)) {
        sheet.getRange(i + 2, 3).setValue(newText);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: '項目が見つかりません' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * チェックリスト項目の要補充対象フラグを更新
 */
function updateChecklistItemSupply(itemId, isSupply) {
  try {
    if (!itemId) return JSON.stringify({ success: false, error: '項目IDが空です' });
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '項目が見つかりません' });
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(itemId)) {
        sheet.getRange(i + 2, 6).setValue(isSupply ? 'Y' : 'N');
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: '項目が見つかりません' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * チェックリスト項目をマスタから削除
 */
function deleteChecklistItemFromMaster(itemId) {
  try {
    if (!itemId) return JSON.stringify({ success: false, error: '項目IDが空です' });
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '項目が見つかりません' });
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(itemId)) {
        sheet.deleteRow(i + 2);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: '項目が見つかりません' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * チェックリストに新しい項目を追加
 */
function addChecklistItemToMaster(category, name, isSupplyItem) {
  try {
    if (!category || !name) return JSON.stringify({ success: false, error: 'カテゴリまたは項目名が空です' });
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    // 最大IDを取得して新IDを生成
    var maxId = 0;
    if (lastRow >= 2) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      ids.forEach(function(row) {
        var m = String(row[0]).match(/item_(\d+)/);
        if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
      });
    }
    var newId = 'item_' + (maxId + 1);
    // 同じカテゴリの最大sortOrderを取得
    var maxSort = 0;
    if (lastRow >= 2) {
      var rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
      rows.forEach(function(row) {
        if (String(row[1]) === category) {
          maxSort = Math.max(maxSort, parseInt(row[3], 10) || 0);
        }
      });
    }
    if (maxSort === 0 && lastRow >= 2) {
      var allSorts = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
      allSorts.forEach(function(row) { maxSort = Math.max(maxSort, parseInt(row[0], 10) || 0); });
    }
    var nextRow = lastRow + 1;
    sheet.getRange(nextRow, 1, 1, 6).setValues([[newId, category, name, maxSort + 1, 'Y', isSupplyItem ? 'Y' : 'N']]);
    return JSON.stringify({ success: true, itemId: newId });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * チェックリスト項目の並び順を更新
 * @param {Array} itemOrders - [{id: 'item_1', sortOrder: 1}, ...]
 */
function reorderChecklistItems(itemOrders) {
  try {
    if (!itemOrders || !itemOrders.length) return JSON.stringify({ success: true });
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true });
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var sortCol = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
    var orderMap = {};
    itemOrders.forEach(function(o) { orderMap[o.id] = o.sortOrder; });
    for (var i = 0; i < ids.length; i++) {
      var id = String(ids[i][0]);
      if (orderMap[id] !== undefined) {
        sortCol[i][0] = orderMap[id];
      }
    }
    sheet.getRange(2, 4, lastRow - 1, 1).setValues(sortCol);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * カテゴリ順序を取得
 */
function getCategoryOrder() {
  try {
    var sheet = clSheet_(SHEET_CL_CATEGORY_ORDER);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true, orders: [] });
    var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    var orders = [];
    for (var i = 0; i < rows.length; i++) {
      var path = String(rows[i][0] || '');
      var sortOrder = parseInt(rows[i][1], 10) || 0;
      if (path) orders.push({ path: path, sortOrder: sortOrder });
    }
    return JSON.stringify({ success: true, orders: orders });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * カテゴリ順序を保存
 * @param {Array} categoryOrders - [{path: 'カテゴリパス', sortOrder: 1}, ...]
 */
function reorderCategories(categoryOrders) {
  try {
    if (!categoryOrders || !categoryOrders.length) return JSON.stringify({ success: true });
    var sheet = clSheet_(SHEET_CL_CATEGORY_ORDER);
    var lastRow = sheet.getLastRow();

    // 既存データを読み込みマップ化
    var existingMap = {};
    if (lastRow >= 2) {
      var existing = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (var i = 0; i < existing.length; i++) {
        existingMap[String(existing[i][0])] = i + 2; // row number
      }
    }

    // 更新または追加
    var toAppend = [];
    categoryOrders.forEach(function(o) {
      var rowNum = existingMap[o.path];
      if (rowNum) {
        sheet.getRange(rowNum, 2).setValue(o.sortOrder);
      } else {
        toAppend.push([o.path, o.sortOrder]);
      }
    });
    if (toAppend.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, toAppend.length, 2).setValues(toAppend);
    }

    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * カテゴリ名を変更（マスターシートの全該当項目のカテゴリ列を更新）
 */
function renameCategoryInMaster(oldFullPath, newName) {
  try {
    if (!oldFullPath || !newName) return JSON.stringify({ success: false, error: 'パラメータが不足しています' });
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '項目がありません' });
    var categories = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    var parts = oldFullPath.split('：');
    var oldName = parts[parts.length - 1];
    parts[parts.length - 1] = newName;
    var newFullPath = parts.join('：');
    var updated = 0;
    for (var i = 0; i < categories.length; i++) {
      var cat = String(categories[i][0]);
      if (cat === oldFullPath || cat.indexOf(oldFullPath + '：') === 0) {
        var newCat = newFullPath + cat.substring(oldFullPath.length);
        sheet.getRange(i + 2, 2).setValue(newCat);
        updated++;
      }
    }
    // カテゴリ順序シートのパスも更新（リネーム後もソート位置を維持）
    var orderSheet = clSheet_(SHEET_CL_CATEGORY_ORDER);
    var orderLastRow = orderSheet.getLastRow();
    if (orderLastRow >= 2) {
      var orderPaths = orderSheet.getRange(2, 1, orderLastRow - 1, 1).getValues();
      var orderUpdated = 0;
      for (var j = 0; j < orderPaths.length; j++) {
        var p = String(orderPaths[j][0]);
        if (p === oldFullPath) {
          orderPaths[j][0] = newFullPath;
          orderUpdated++;
        } else if (p.indexOf(oldFullPath + '：') === 0) {
          orderPaths[j][0] = newFullPath + p.substring(oldFullPath.length);
          orderUpdated++;
        }
      }
      if (orderUpdated > 0) {
        orderSheet.getRange(2, 1, orderLastRow - 1, 1).setValues(orderPaths);
      }
    }
    return JSON.stringify({ success: true, updated: updated });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * カテゴリを削除
 * deleteContents=true: カテゴリ内の全項目も削除
 * deleteContents=false: 項目は親カテゴリに移動
 */
function deleteCategoryFromMaster(fullPath, deleteContents) {
  try {
    if (!fullPath) return JSON.stringify({ success: false, error: 'カテゴリパスが空です' });
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '項目がありません' });
    var categories = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    var parts = fullPath.split('：');
    var parentPath = parts.slice(0, -1).join('：');
    if (deleteContents) {
      // 中身も含めて削除（下の行から削除して行番号ずれを防ぐ）
      var rowsToDelete = [];
      for (var i = 0; i < categories.length; i++) {
        var cat = String(categories[i][0]);
        if (cat === fullPath || cat.indexOf(fullPath + '：') === 0) {
          rowsToDelete.push(i + 2);
        }
      }
      for (var j = rowsToDelete.length - 1; j >= 0; j--) {
        sheet.deleteRow(rowsToDelete[j]);
      }
      return JSON.stringify({ success: true, deleted: rowsToDelete.length });
    } else {
      // 中身は親カテゴリに移動
      var updated = 0;
      for (var i = 0; i < categories.length; i++) {
        var cat = String(categories[i][0]);
        if (cat === fullPath) {
          sheet.getRange(i + 2, 2).setValue(parentPath || cat);
          updated++;
        } else if (cat.indexOf(fullPath + '：') === 0) {
          var remainder = cat.substring(fullPath.length + 1);
          var newCat = parentPath ? (parentPath + '：' + remainder) : remainder;
          sheet.getRange(i + 2, 2).setValue(newCat);
          updated++;
        }
      }
      return JSON.stringify({ success: true, updated: updated });
    }
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 撮影箇所を追加
 */
function addPhotoSpotToMaster(spotName, timing, category) {
  try {
    if (!spotName) return JSON.stringify({ success: false, error: '箇所名が空です' });
    var sheet = clSheet_(SHEET_CL_PHOTO_SPOTS);
    var lastRow = sheet.getLastRow();
    var maxId = 0;
    var maxSort = 0;
    if (lastRow >= 2) {
      var rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      rows.forEach(function(row) {
        var m = String(row[0]).match(/spot_(\d+)/);
        if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
        maxSort = Math.max(maxSort, parseInt(row[4], 10) || 0);
      });
    }
    var newId = 'spot_' + (maxId + 1);
    var nextRow = lastRow + 1;
    sheet.getRange(nextRow, 1, 1, 7).setValues([[newId, spotName, timing || 'ビフォー/アフター', '', maxSort + 1, 'Y', category || '']]);
    return JSON.stringify({ success: true, spotId: newId });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 撮影箇所の名称を変更
 */
function updatePhotoSpotName(spotId, newName) {
  try {
    if (!spotId || !newName) return JSON.stringify({ success: false, error: 'IDまたは名称が空です' });
    var sheet = clSheet_(SHEET_CL_PHOTO_SPOTS);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '箇所が見つかりません' });
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(spotId)) {
        sheet.getRange(i + 2, 2).setValue(newName);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: '箇所が見つかりません' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 撮影箇所を削除（論理削除: 有効フラグをNに）
 */
function deletePhotoSpot(spotId) {
  try {
    if (!spotId) return JSON.stringify({ success: false, error: 'IDが空です' });
    var sheet = clSheet_(SHEET_CL_PHOTO_SPOTS);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '箇所が見つかりません' });
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(spotId)) {
        sheet.getRange(i + 2, 6).setValue('N');
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: '箇所が見つかりません' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 見本写真をアップロード
 */
function uploadExamplePhoto(spotId, base64Data) {
  try {
    if (!spotId || !base64Data) return JSON.stringify({ success: false, error: 'データが不足しています' });
    // 見本用フォルダ: 個別設定があればそちらを使用
    var props = PropertiesService.getScriptProperties();
    var specificFolderId = props.getProperty('CL_PHOTO_FOLDER_EXAMPLE');
    var exampleFolder;
    if (specificFolderId) {
      try { exampleFolder = DriveApp.getFolderById(specificFolderId); } catch (e) { exampleFolder = null; }
    }
    if (!exampleFolder) {
      var folder = getOrCreateChecklistPhotoFolder_();
      exampleFolder = getOrCreateSubFolder_(folder, '見本');
    }
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', 'example_' + spotId + '_' + new Date().getTime() + '.jpg');
    var file = exampleFolder.createFile(blob);
    // ファイルを閲覧可能に設定
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    // 撮影箇所マスタの撮影例ファイルIDを更新
    var sheet = clSheet_(SHEET_CL_PHOTO_SPOTS);
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(spotId)) {
          sheet.getRange(i + 2, 4).setValue(file.getId());
          break;
        }
      }
    }
    return JSON.stringify({ success: true, fileId: file.getId() });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 見本写真を削除
 */
function deleteExamplePhoto(spotId) {
  try {
    if (!spotId) return JSON.stringify({ success: false, error: 'IDが空です' });
    var sheet = clSheet_(SHEET_CL_PHOTO_SPOTS);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '箇所が見つかりません' });
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(spotId)) {
        var oldFileId = String(sheet.getRange(i + 2, 4).getValue() || '').trim();
        sheet.getRange(i + 2, 4).setValue('');
        // Driveからも削除
        if (oldFileId) {
          try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (e) {}
        }
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: '箇所が見つかりません' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 撮影写真を削除
 */
function deleteChecklistPhoto(checkoutDate, spotId, fileId) {
  try {
    if (!fileId) return JSON.stringify({ success: false, error: 'ファイルIDが空です' });
    var sheet = clSheet_(SHEET_CL_PHOTOS);
    var targetDate = normDateStr_(checkoutDate);
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (var i = data.length - 1; i >= 0; i--) {
        if (normDateStr_(data[i][0]) === targetDate && String(data[i][1]) === String(spotId) && String(data[i][2]) === String(fileId)) {
          sheet.deleteRow(i + 2);
          break;
        }
      }
    }
    // Driveからも削除
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * チェックリスト項目の見本写真をアップロード
 */
function uploadChecklistItemPhoto(itemId, base64Data) {
  try {
    if (!itemId || !base64Data) return JSON.stringify({ success: false, error: 'データが不足しています' });
    var props = PropertiesService.getScriptProperties();
    var specificFolderId = props.getProperty('CL_PHOTO_FOLDER_EXAMPLE');
    var exampleFolder;
    if (specificFolderId) {
      try { exampleFolder = DriveApp.getFolderById(specificFolderId); } catch (e) { exampleFolder = null; }
    }
    if (!exampleFolder) {
      var folder = getOrCreateChecklistPhotoFolder_();
      exampleFolder = getOrCreateSubFolder_(folder, '見本');
    }
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', 'item_example_' + itemId + '_' + new Date().getTime() + '.jpg');
    var file = exampleFolder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    // マスタシートの見本写真ID（列7）を更新
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(itemId)) {
          // 既存の写真があれば削除
          var oldFileId = String(sheet.getRange(i + 2, 7).getValue() || '').trim();
          if (oldFileId) {
            try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (e) {}
          }
          sheet.getRange(i + 2, 7).setValue(file.getId());
          break;
        }
      }
    }
    return JSON.stringify({ success: true, fileId: file.getId() });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * チェックリスト項目の見本写真を削除
 */
function deleteChecklistItemPhoto(itemId) {
  try {
    if (!itemId) return JSON.stringify({ success: false, error: 'IDが空です' });
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '項目が見つかりません' });
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(itemId)) {
        var oldFileId = String(sheet.getRange(i + 2, 7).getValue() || '').trim();
        sheet.getRange(i + 2, 7).setValue('');
        if (oldFileId) {
          try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (e) {}
        }
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: '項目が見つかりません' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * カテゴリを別の親カテゴリ内に移動（下層の全項目も一緒に移動）
 * @param {string} oldCategoryPath - 移動するカテゴリのフルパス（例: "テラス"）
 * @param {string} newParentPath - 移動先の親カテゴリパス（例: "駐車場"）。空文字ならトップレベルに移動
 */
function moveCategoryToParent(oldCategoryPath, newParentPath) {
  try {
    if (!oldCategoryPath) return JSON.stringify({ success: false, error: 'カテゴリパスが空です' });
    var parts = oldCategoryPath.split('：');
    var categoryName = parts[parts.length - 1];
    var newCategoryPath = newParentPath ? (newParentPath + '：' + categoryName) : categoryName;
    if (oldCategoryPath === newCategoryPath) return JSON.stringify({ success: true });
    // マスタシートの全項目のカテゴリを更新
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '項目がありません' });
    var categories = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    var updated = 0;
    for (var i = 0; i < categories.length; i++) {
      var cat = String(categories[i][0]);
      if (cat === oldCategoryPath) {
        categories[i][0] = newCategoryPath;
        updated++;
      } else if (cat.indexOf(oldCategoryPath + '：') === 0) {
        categories[i][0] = newCategoryPath + cat.substring(oldCategoryPath.length);
        updated++;
      }
    }
    if (updated > 0) {
      sheet.getRange(2, 2, lastRow - 1, 1).setValues(categories);
    }
    // カテゴリ順序シートも更新
    var orderSheet = clSheet_(SHEET_CL_CATEGORY_ORDER);
    var orderLastRow = orderSheet.getLastRow();
    if (orderLastRow >= 2) {
      var orderPaths = orderSheet.getRange(2, 1, orderLastRow - 1, 1).getValues();
      var orderUpdated = 0;
      for (var j = 0; j < orderPaths.length; j++) {
        var p = String(orderPaths[j][0]);
        if (p === oldCategoryPath) {
          orderPaths[j][0] = newCategoryPath;
          orderUpdated++;
        } else if (p.indexOf(oldCategoryPath + '：') === 0) {
          orderPaths[j][0] = newCategoryPath + p.substring(oldCategoryPath.length);
          orderUpdated++;
        }
      }
      if (orderUpdated > 0) {
        orderSheet.getRange(2, 1, orderLastRow - 1, 1).setValues(orderPaths);
      }
    }
    return JSON.stringify({ success: true, updated: updated });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * チェックリスト項目を別カテゴリに移動（カテゴリ変更＋並び順更新）
 * @param {string} itemId - 移動する項目のID
 * @param {string} newCategory - 移動先カテゴリパス
 * @param {Array} itemOrders - 移動先カテゴリ内の全項目の並び順 [{id, sortOrder}, ...]
 */
function moveItemToCategory(itemId, newCategory, itemOrders) {
  try {
    if (!itemId || newCategory === undefined) return JSON.stringify({ success: false, error: 'パラメータが不足しています' });
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '項目が見つかりません' });
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var found = false;
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(itemId)) {
        sheet.getRange(i + 2, 2).setValue(newCategory);
        found = true;
        break;
      }
    }
    if (!found) return JSON.stringify({ success: false, error: '項目が見つかりません' });
    // 並び順も更新
    if (itemOrders && itemOrders.length > 0) {
      var sortCol = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
      var orderMap = {};
      itemOrders.forEach(function(o) { orderMap[o.id] = o.sortOrder; });
      for (var j = 0; j < ids.length; j++) {
        var id = String(ids[j][0]);
        if (orderMap[id] !== undefined) {
          sortCol[j][0] = orderMap[id];
        }
      }
      sheet.getRange(2, 4, lastRow - 1, 1).setValues(sortCol);
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}
