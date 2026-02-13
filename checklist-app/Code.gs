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
      Logger.log('CHECKLIST_SS_ID=' + ssId + ' でスプレッドシートを開けません: ' + e.toString());
    }
  } else {
    Logger.log('CHECKLIST_SS_ID が Script Properties に設定されていません。新規作成します。');
  }
  var newSs = SpreadsheetApp.create('清掃チェックリスト管理');
  props.setProperty('CHECKLIST_SS_ID', newSs.getId());
  // 初期シート作成
  var s1 = newSs.getActiveSheet();
  s1.setName(SHEET_CL_MASTER);
  s1.getRange(1, 1, 1, 6).setValues([['ID', 'カテゴリ', '項目名', '表示順', '有効', '要補充対象']]);
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

function clSheet_(name) {
  var ss = getOrCreateChecklistSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_CL_MASTER) sheet.getRange(1, 1, 1, 6).setValues([['ID', 'カテゴリ', '項目名', '表示順', '有効', '要補充対象']]);
    else if (name === SHEET_CL_PHOTO_SPOTS) sheet.getRange(1, 1, 1, 7).setValues([['ID', '箇所名', '撮影タイミング', '撮影例ファイルID', '表示順', '有効', 'カテゴリ']]);
    else if (name === SHEET_CL_RECORDS) sheet.getRange(1, 1, 1, 5).setValues([['チェックアウト日', '項目ID', 'チェック済', 'チェック者', 'タイムスタンプ']]);
    else if (name === SHEET_CL_PHOTOS) sheet.getRange(1, 1, 1, 6).setValues([['チェックアウト日', '撮影箇所ID', 'ファイルID', 'アップロード者', 'タイムスタンプ', '撮影タイミング']]);
    else if (name === SHEET_CL_MEMOS) sheet.getRange(1, 1, 1, 4).setValues([['チェックアウト日', 'メモ内容', '記入者', 'タイムスタンプ']]);
    else if (name === SHEET_CL_SUPPLIES) sheet.getRange(1, 1, 1, 5).setValues([['チェックアウト日', '項目ID', '項目名', '記入者', 'タイムスタンプ']]);
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
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
    var items = rows.map(function(row, i) {
      return {
        rowIndex: i + 2,
        id: String(row[0] || ''),
        category: String(row[1] || ''),
        name: String(row[2] || ''),
        sortOrder: parseInt(row[3], 10) || 0,
        active: String(row[4] || 'Y'),
        supplyItem: String(row[5] || 'N') === 'Y'
      };
    }).filter(function(item) { return item.id && item.name && item.active === 'Y'; });
    items.sort(function(a, b) { return a.sortOrder - b.sortOrder; });
    return JSON.stringify({ success: true, items: items });
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
      totalItems: totalItems
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
    var folder = getOrCreateChecklistPhotoFolder_();
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', 'photo_' + new Date().getTime() + '.jpg');
    var file = folder.createFile(blob);
    file.setName(checkoutDate + '_' + spotId + '_' + timing + '_' + new Date().getTime() + '.jpg');

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
 * 写真保存フォルダIDを設定（メインアプリの設定タブから呼び出し可能）
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

    var itemId = 1;
    var spotId = 1;
    var sortOrder = 1;

    // チェックリスト項目データ（部屋ベース三階層）
    // 大カテゴリ = 部屋/エリア、中カテゴリ = 作業区分（：で区切り）、項目名 = 個別チェック項目
    var items = [
      // ===== 屋外 =====
      ['item_' + itemId++, '屋外：駐車場', 'ゴミ拾い（ゴミボックス内のゴミ袋使用）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '屋外：駐車場', 'ゴミボックスがいっぱい→西山に連絡', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '屋外：駐車場', '雑草チェック', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '屋外：駐車場', '補充：ビニール袋（都度）', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, '屋外：駐車場', '除草剤散布（毎回は不要）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '屋外：駐車場', '草抜き（毎回は不要）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '屋外：敷地内', '敷地内のゴミ掃除', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '屋外：敷地内', '落ち葉や虫の死骸の清掃', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '屋外：敷地内', '雑草チェック', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '屋外：敷地内', '除草剤散布（毎回は不要）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '屋外：敷地内', '草抜き（毎回は不要）', sortOrder++, 'Y', 'N'],

      // ===== テラス =====
      ['item_' + itemId++, 'テラス', '安全チェーン 設置位置のズレ、外れたりしていないか', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス', '忘れ物チェック', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス', '落ち葉や虫の死骸の清掃', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス', '床面に残飯あったら流し台へ', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス', 'トング、包丁、ハサミ、お皿などの洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス', 'テーブル、イス油汚れの除去（洗剤スポンジ）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス', 'ホースで高圧洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス', '折りたたみイス、簡易テーブル、タープテントの片付け（テラスのBOXへ）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス', '次の予約がBBQ利用あり', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス', '次の予約がBBQなし', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：ガスコンロ', '本体、ふたの洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：ガスコンロ', '階段下に設置（水は不要）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：ガスコンロ', '網の洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：ガスコンロ', '受皿の洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：ガスコンロ', 'コンロ本体の洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：ガスコンロ', 'フタの裏', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：ガスコンロ', '受皿を乗せるところ', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：ガスコンロ', '本体の両サイドに格納してあるテーブル灰皿ゴミを、流し台の水切りネットへ捨てる', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：流し台', '流し台残飯の回収（水切りネットごとを捨てる）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：流し台', '三角コーナーの洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：流し台', '生ゴミかごの洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：流し台', '天板の洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：流し台', 'シンク内の洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：流し台', '下の棚部分　洗浄交換', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'テラス：補充', '食器洗剤【毎回】', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'テラス：補充', 'パイプユニッシュ（都度）', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'テラス：補充', '水切りネット', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'テラス：補充', 'スポンジ（汚れている場合）2枚', sortOrder++, 'Y', 'Y'],

      // ===== 2階ベランダ =====
      ['item_' + itemId++, '2階ベランダ：テラス側', '鳥の糞除去（濡らしたティッシュなどで拭き掃除）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：テラス側', '虫の死骸除去', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：テラス側', 'クモの巣（クモがいたら殺す。くも用スプレーの使用も可）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：テラス側', 'ゴミ拾い', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：テラス側', '屋外スリッパの整頓（スリッパ大2個）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：テラス側', 'テーブルとイスの整頓', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：テラス側', 'ほうきの整頓', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：和室側', '障子破れていない？（補修キット用意する予定）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：和室側', '鳥の糞除去（濡らしたティッシュなどで拭き掃除）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：和室側', '虫の死骸除去', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：和室側', 'クモの巣（クモがいたら殺す。くも用スプレーの使用も可）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：和室側', 'ゴミ拾い', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：和室側', 'スリッパなしが正解', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：和室側', 'テーブルとイスなしが正解', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：和室側', '窓を施錠', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階ベランダ：和室側', '障子を閉める', sortOrder++, 'Y', 'N'],

      // ===== 室内全体 =====
      ['item_' + itemId++, '室内全体：損傷チェック', '全部屋　写真か動画を撮影（損害あり → 西山へ）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '室内全体：損傷チェック', '写真はLINEグループのアルバムへ', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '室内全体：損傷チェック', 'タバコのにおいチェック（あり → 西山へ）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '室内全体：換気', '和室押入', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '室内全体：換気', '1階備品庫（番号007）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '室内全体：換気', 'キッチン換気扇　常時ON', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '室内全体：換気', '脱衣所収納', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '室内全体：換気', 'お風呂換気扇　常時ON', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '室内全体：リネン回収', 'タオル集め（トイレx2、キッチンx1、洗面所x1、脱衣所人数分）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '室内全体：リネン回収', 'シーツ集め（2階和室マットも見ること）', sortOrder++, 'Y', 'N'],

      // ===== 2階和室 =====
      ['item_' + itemId++, '2階和室', '布団の片付け・掃除', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階和室', '畳の掃除機がけ', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階和室', '押入れの中チェック（忘れ物）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階和室', '窓の施錠確認', sortOrder++, 'Y', 'N'],

      // ===== 2階リビング =====
      ['item_' + itemId++, '2階リビング', '冷蔵庫の中チェック（空にする）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング', 'ゴミの回収', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング', 'ゴミ箱の中に予備のゴミ袋あるか？5枚程度（30L）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング', 'ゴミ箱にゴミ袋（30L）を装着', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング', 'おもちゃ片付け（除菌シート、ほこり取り）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング', 'エアコンリモコン（黒）電池ある？', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング', 'カウンター照明リモコン電池ある？', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング：ほこり取り', '照明器具', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング：ほこり取り', '消火器', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング：ほこり取り', 'エアコン上', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング：ほこり取り', 'テレビ・テレビ台', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング：ほこり取り', '棚・カウンター', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング：ほこり取り', '窓枠・サッシ', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '2階リビング：補充', 'ティッシュ（都度）', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, '2階リビング：補充', '殺虫スプレー（都度）', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, '2階リビング：補充', 'コロコロ（都度）', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, '2階リビング：補充', 'マモルーム（ゴキブリ忌避）（都度）', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, '2階リビング：補充', 'ダニスプレー（都度）', sortOrder++, 'Y', 'Y'],

      // ===== キッチン =====
      ['item_' + itemId++, 'キッチン：確認', 'ロールスクリーン上げる', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：確認', 'イス7個あるか', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：確認', 'テーブル2個あるか', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：確認', '食器が全て戻っているか', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：洗い物', 'シンク内の食器洗い', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：洗い物', '水切りかごの片付け', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：洗い物', '排水口ネット交換', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：拭き掃除', '冷蔵庫の中', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：拭き掃除', '電子レンジの中', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：拭き掃除', '炊飯器', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：拭き掃除', 'コンロ周り', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：拭き掃除', 'カウンター・天板', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：床掃除', '掃除機がけ', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：床掃除', '床拭き（汚れがある場合）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'キッチン：補充', '洗剤【毎回】', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'キッチン：補充', 'ハンドソープ【毎回】', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'キッチン：補充', '水切りネット【毎回】', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'キッチン：補充', 'ティッシュ【毎回】', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'キッチン：補充', 'ゴミ袋（45L）', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'キッチン：補充', 'ラップ・アルミホイル（都度）', sortOrder++, 'Y', 'Y'],

      // ===== お風呂 =====
      ['item_' + itemId++, 'お風呂：清掃', '浴槽の洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'お風呂：清掃', '壁・床の洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'お風呂：清掃', '鏡の水垢取り', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'お風呂：清掃', '排水口の髪の毛除去', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'お風呂：清掃', 'シャワーヘッド・蛇口のカルキ取り', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'お風呂：清掃', 'イス・おけの洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'お風呂：清掃', '換気扇 常時ON', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'お風呂：補充', 'シャンプー【毎回】', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'お風呂：補充', 'コンディショナー【毎回】', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'お風呂：補充', 'ボディソープ【毎回】', sortOrder++, 'Y', 'Y'],

      // ===== 脱衣所・洗面所 =====
      ['item_' + itemId++, '脱衣所・洗面所：清掃', '洗面台の洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '脱衣所・洗面所：清掃', '鏡の拭き掃除', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '脱衣所・洗面所：清掃', '床の拭き掃除', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '脱衣所・洗面所：清掃', '排水口の清掃', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '脱衣所・洗面所：清掃', '収納の換気', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '脱衣所・洗面所：補充', 'タオルセット（人数分）', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, '脱衣所・洗面所：補充', 'ドライヤー動作確認', sortOrder++, 'Y', 'N'],

      // ===== トイレ =====
      ['item_' + itemId++, 'トイレ：1階', '便器の洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'トイレ：1階', '便座・フタの拭き掃除', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'トイレ：1階', '床の拭き掃除', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'トイレ：1階', '補充：ハンドソープ【毎回】', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'トイレ：1階', '補充：トイレットペーパー【毎回】', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'トイレ：1階', 'タオル交換', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'トイレ：2階', '便器の洗浄', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'トイレ：2階', '便座・フタの拭き掃除', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'トイレ：2階', '床の拭き掃除', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, 'トイレ：2階', '補充：ハンドソープ【毎回】', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'トイレ：2階', '補充：トイレットペーパー【毎回】', sortOrder++, 'Y', 'Y'],
      ['item_' + itemId++, 'トイレ：2階', 'タオル交換', sortOrder++, 'Y', 'N'],

      // ===== 玄関・廊下・階段 =====
      ['item_' + itemId++, '玄関・廊下・階段', '玄関の掃き掃除', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '玄関・廊下・階段', '靴箱チェック（忘れ物）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '玄関・廊下・階段', 'スリッパの整頓・除菌', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '玄関・廊下・階段', '廊下の掃除機がけ', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '玄関・廊下・階段', '階段の掃除機がけ', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '玄関・廊下・階段', '施錠確認（全ドア・窓）', sortOrder++, 'Y', 'N'],

      // ===== 最終チェック =====
      ['item_' + itemId++, '最終チェック', '全室照明OFF', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '最終チェック', 'エアコンOFF（シーズン中はつけっぱなし指示あり）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '最終チェック', '窓の施錠（全箇所）', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '最終チェック', '玄関ドア施錠', sortOrder++, 'Y', 'N'],
      ['item_' + itemId++, '最終チェック', 'ゴミ出し完了', sortOrder++, 'Y', 'N']
    ];

    // チェックリスト項目を一括書き込み
    if (items.length > 0) {
      sheet.getRange(2, 1, items.length, 6).setValues(items);
    }

    // 撮影箇所データ（カテゴリは大カテゴリ名と一致させる）
    var spots = [
      ['spot_' + spotId++, '駐車場', 'ビフォー/アフター', '', 1, 'Y', '屋外'],
      ['spot_' + spotId++, 'テラス全景', 'ビフォー/アフター', '', 2, 'Y', 'テラス'],
      ['spot_' + spotId++, 'テラス：ガスコンロ', 'ビフォー/アフター', '', 3, 'Y', 'テラス'],
      ['spot_' + spotId++, 'テラス：流し台', 'ビフォー/アフター', '', 4, 'Y', 'テラス'],
      ['spot_' + spotId++, '2階ベランダ：テラス側', 'ビフォー/アフター', '', 5, 'Y', '2階ベランダ'],
      ['spot_' + spotId++, '2階ベランダ：和室側', 'ビフォー/アフター', '', 6, 'Y', '2階ベランダ'],
      ['spot_' + spotId++, '2階和室', 'アフター', '', 7, 'Y', '2階和室'],
      ['spot_' + spotId++, '2階リビング', 'アフター', '', 8, 'Y', '2階リビング'],
      ['spot_' + spotId++, 'キッチン', 'アフター', '', 9, 'Y', 'キッチン'],
      ['spot_' + spotId++, 'お風呂', 'アフター', '', 10, 'Y', 'お風呂'],
      ['spot_' + spotId++, '脱衣所・洗面所', 'アフター', '', 11, 'Y', '脱衣所・洗面所'],
      ['spot_' + spotId++, 'トイレ：1階', 'アフター', '', 12, 'Y', 'トイレ'],
      ['spot_' + spotId++, 'トイレ：2階', 'アフター', '', 13, 'Y', 'トイレ'],
      ['spot_' + spotId++, '玄関', 'アフター', '', 14, 'Y', '玄関・廊下・階段']
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
