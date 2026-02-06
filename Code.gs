/**
 * 民泊予約・清掃管理Webアプリ - Google Apps Script
 * スプレッドシート「フォームの回答 1」をバックエンドとして使用
 */

const SHEET_NAME = 'フォームの回答 1';

/**********************************************
 * フォーム送信時・手動編集時ともに自動ソート
 * 対象：シート名「フォームの回答 1」
 * ソート基準：D列（チェックイン）降順
 **********************************************/

// フォーム送信トリガー（既存予約とマージして詳細を反映、ソート、募集作成・告知）
function onFormSubmit(e) {
  if (e && e.range) {
    mergeFormResponseToExistingBooking_(e);
  }
  sortFormResponses_();
  checkAndCreateRecruitments();
}

// 手動編集トリガー
function onEdit(e) {
  sortFormResponses_();
}

// ソート本体（チェックイン列で降順）
function sortFormResponses_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow <= 2) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colMap = buildColumnMap(headers);
  const sortCol = colMap.checkIn >= 0 ? colMap.checkIn + 1 : 4; // 1始まり、デフォルトD列

  sheet
    .getRange(2, 1, lastRow - 1, lastCol)
    .sort({ column: sortCol, ascending: false });
}

/**********************************************
 * 民泊Webアプリ（カレンダー・清掃担当編集）
 **********************************************/

// 列ヘッダー定義（動的検索用）
const HEADERS = {
  CHECK_IN: 'チェックイン / Check-in',
  CHECK_OUT: 'チェックアウト / Check-out',
  GUEST_NAME: '氏名 / Full Name',
  BOOKING_SITE: 'どこでこのホテルを予約しましたか？',
  BBQ: 'バーベキューセットをご利用されますか？',
  GUEST_COUNT_PREFIX: '宿泊人数',
  GUEST_COUNT_INFANTS_PREFIX: '3才以下',
  CLEANING_STAFF: '清掃担当',
  ICAL_SYNC: 'iCal同期', // iCal取り込み行の識別用（この列が空でない＝iCal由来）
  ICAL_GUEST_COUNT: 'iCal宿泊人数',
  // 駐車場: 「徒歩15分、有料駐車場を利用する方はお読みください」にマッチ（「お車は何台…」は除外）
};

// オーナー・設定用シート名
const SHEET_OWNER = '設定_オーナー';
const SHEET_SUB_OWNERS = 'サブオーナー';
const SHEET_STAFF = '清掃スタッフ';
const SHEET_JOB_TYPES = '仕事内容マスタ';
const SHEET_COMPENSATION = 'スタッフ報酬';
const SHEET_SPECIAL_RATES = '特別料金';
const SHEET_RECRUIT_SETTINGS = '募集設定';
const SHEET_RECRUIT = '募集';
const SHEET_RECRUIT_VOLUNTEERS = '募集_立候補';
const SHEET_CANCEL_REQUESTS = 'キャンセル申請';
const SHEET_SYNC_SETTINGS = '設定_連携';
const SHEET_NOTIFICATIONS = '通知履歴';
const SHEET_STAFF_SHARE = 'スタッフ共有用';
const SHEET_BED_COUNT_MASTER = 'ベッド数マスタ';

/**
 * Webアプリのメインエントリーポイント
 * ?action=setStaffUrl&url=xxx&secret=yyy でデプロイスクリプトからスタッフURLを自動保存
 */
function doGet(e) {
  e = e || {};
  var params = (e.parameter || {});
  var action = params.action;
  var url = params.url;
  var secret = params.secret;
  if (action === 'setStaffUrl' && url && typeof url === 'string') {
    var storedSecret = PropertiesService.getDocumentProperties().getProperty('urlUpdateSecret');
    if (storedSecret && secret !== storedSecret) {
      return ContentService.createTextOutput('NG: invalid secret').setMimeType(ContentService.MimeType.TEXT);
    }
    var u = String(url).trim();
    if (u.indexOf('staff=1') < 0 && u.indexOf('staff=true') < 0) u = u + (u.indexOf('?') >= 0 ? '&' : '?') + 'staff=1';
    PropertiesService.getDocumentProperties().setProperty('staffDeployUrl', u);
    return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
  }
  const template = HtmlService.createTemplateFromFile('index');
  template.baseUrl = ScriptApp.getService().getUrl();
  const html = template.evaluate()
    .setTitle('民泊予約・清掃管理')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  return html;
}

/**
 * index.html のインクルード用（複数HTMLファイルがある場合）
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * スプレッドシートからデータを取得し、JSON形式で返す
 * ヘッダー名で列を動的に特定
 */
function getData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      return JSON.stringify({
        success: false,
        error: 'シート「' + SHEET_NAME + '」が見つかりません。',
        data: null,
        columnMap: null
      });
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    
    if (lastRow < 2 || lastCol < 1) {
      return JSON.stringify({
        success: true,
        data: [],
        columnMap: {},
        message: 'データがありません。'
      });
    }

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const columnMap = buildColumnMap(headers);
    
    if (columnMap.checkIn < 0 || columnMap.checkOut < 0) {
      return JSON.stringify({
        success: false,
        error: '必要な列（チェックイン/チェックアウト）が見つかりません。ヘッダーを確認してください。',
        data: null,
        columnMap: null
      });
    }

    const rawData = sheet.getRange(2, 1, lastRow, lastCol).getValues();
    const data = [];

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNumber = i + 2; // スプレッドシートの行番号（1行目がヘッダー）

      const checkInVal = columnMap.checkIn >= 0 ? String(row[columnMap.checkIn] || '').trim() : '';
      const checkOutVal = columnMap.checkOut >= 0 ? String(row[columnMap.checkOut] || '').trim() : '';

      // 日付のパース（無効な場合はスキップしないが、フラグを付ける）
      const checkIn = parseDate(checkInVal);
      const checkOut = parseDate(checkOutVal);
      const isValidDates = checkIn && checkOut && checkOut >= checkIn;

      const guestName = columnMap.guestName >= 0 ? String(row[columnMap.guestName] || '').trim() : '';
      const icalSource = columnMap.icalSync >= 0 ? String(row[columnMap.icalSync] || '').trim() : '';
      const formBookingSite = columnMap.bookingSite >= 0 ? String(row[columnMap.bookingSite] || '').trim() : '';
      const icalPart = icalSource || '-';
      const formPart = formBookingSite || '-';
      const bookingSite = icalPart + '（' + formPart + '）';
      const bbq = columnMap.bbq >= 0 ? String(row[columnMap.bbq] || '').trim() : '';
      const guestCountAdultsRaw = columnMap.guestCount >= 0 ? String(row[columnMap.guestCount] || '').trim() : '';
      const guestCountInfantsRaw = columnMap.guestCountInfants >= 0 ? String(row[columnMap.guestCountInfants] || '').trim() : '';
      const guestCountAdults = extractGuestCount_(guestCountAdultsRaw);
      const guestCountInfants = extractGuestCount_(guestCountInfantsRaw);
      const icalGuestCountRaw = columnMap.icalGuestCount >= 0 ? String(row[columnMap.icalGuestCount] || '').trim() : '';
      const formGuestCountFmt = (guestCountAdults || guestCountInfants) ? ((guestCountAdults ? '大人' + guestCountAdults + '名' : '') + (guestCountInfants ? (guestCountAdults ? '、' : '') + '3歳以下' + guestCountInfants + '名' : '')) : '';
      const guestCountDisplay = (icalGuestCountRaw || '-') + '（' + (formGuestCountFmt || '-') + '）';
      const cleaningStaff = columnMap.cleaningStaff >= 0 ? String(row[columnMap.cleaningStaff] || '').trim() : '';
      const parking = columnMap.parking >= 0 ? String(row[columnMap.parking] || '').trim() : '';
      const bedChoice = columnMap.bedChoice >= 0 ? String(row[columnMap.bedChoice] || '').trim() : '';
      const tel1 = columnMap.tel1 >= 0 ? String(row[columnMap.tel1] || '').trim() : '';
      const tel2 = columnMap.tel2 >= 0 ? String(row[columnMap.tel2] || '').trim() : '';
      const email = columnMap.email >= 0 ? String(row[columnMap.email] || '').trim() : '';
      const email2 = columnMap.email2 >= 0 ? String(row[columnMap.email2] || '').trim() : '';
      const passportUrls = (columnMap.passportCols || []).map(function(ci) {
        var v = row[ci];
        if (!v) return null;
        if (typeof v === 'string' && v.indexOf('http') === 0) return v;
        if (v && v.toString && v.toString().indexOf('http') === 0) return v.toString();
        return null;
      }).filter(Boolean);
      var carDisplay = '';
      if (columnMap.carCols && columnMap.carCols.length) {
        var parts = [];
        columnMap.carCols.forEach(function(c) {
          var val = String(row[c.col] || '').trim().replace(/台$/, '');
          if (val && val !== '0' && val !== 'なし') {
            var num = parseInt(val, 10);
            parts.push(isNaN(num) ? val : c.label + val + '台');
          }
        });
        carDisplay = parts.length ? parts.join('\n') : '';
      }
      const nationality = columnMap.nationality >= 0 ? String(row[columnMap.nationality] || '').trim() : '';
      const purpose = columnMap.purpose >= 0 ? String(row[columnMap.purpose] || '').trim() : '';
      const memo = columnMap.memo >= 0 ? String(row[columnMap.memo] || '').trim() : '';
      const cleaningNotice = columnMap.cleaningNotice >= 0 ? String(row[columnMap.cleaningNotice] || '').trim() : '';
      // 宿泊者名一覧（複数カラム対応）と年齢
      var guestNames = [];
      if (columnMap.guestNameCols && columnMap.guestNameCols.length) {
        for (var gi = 0; gi < columnMap.guestNameCols.length; gi++) {
          var gn = String(row[columnMap.guestNameCols[gi]] || '').trim();
          var ga = (columnMap.ageCols && columnMap.ageCols[gi] !== undefined && columnMap.ageCols[gi] >= 0) ? String(row[columnMap.ageCols[gi]] || '').trim() : '';
          if (gn) guestNames.push({ name: gn, age: ga });
        }
      }

      data.push({
        rowNumber: rowNumber,
        checkIn: checkInVal,
        checkOut: checkOutVal,
        checkInParsed: checkIn ? toDateKeySafe_(checkIn) : null,
        checkOutParsed: checkOut ? toDateKeySafe_(checkOut) : null,
        guestName: guestName,
        bookingSite: bookingSite,
        bbq: bbq,
        guestCountAdults: guestCountAdults,
        guestCountInfants: guestCountInfants,
        guestCountDisplay: guestCountDisplay,
        cleaningStaff: cleaningStaff,
        parking: parking,
        bedChoice: bedChoice,
        tel1: tel1,
        tel2: tel2,
        email: email,
        email2: email2,
        passportUrls: passportUrls,
        carDisplay: carDisplay,
        nationality: nationality,
        purpose: purpose,
        memo: memo,
        cleaningNotice: cleaningNotice,
        guestNames: guestNames,
        isValidDates: isValidDates,
        nights: isValidDates ? Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)) : 0
      });
    }

    return JSON.stringify({
      success: true,
      data: data,
      columnMap: columnMap
    });

  } catch (e) {
    return JSON.stringify({
      success: false,
      error: 'データ取得中にエラーが発生しました: ' + e.toString(),
      data: null,
      columnMap: null
    });
  }
}

/**
 * ヘッダー配列から列インデックスのマップを生成
 * 複数該当する列がある場合は、一番左の列（最小インデックス）を採用
 * 氏名: 「氏名」を含む列のうち最左
 * 宿泊人数（大人）: 「宿泊人数」を含み「3才以下の乳幼児」を含まない列のうち最左
 * 3才以下: 「3才以下の乳幼児」を含む列のうち最左
 */
function buildColumnMap(headers) {
  const map = {
    checkIn: -1,
    checkOut: -1,
    guestName: -1,
    bookingSite: -1,
    bbq: -1,
    guestCount: -1,
    guestCountInfants: -1,
    cleaningStaff: -1,
    parking: -1,
    icalSync: -1,
    icalGuestCount: -1,
    nationality: -1,
    bedChoice: -1,
    twoGuestChoice: -1,
    bedCount: -1,
    tel1: -1,
    tel2: -1,
    email: -1,
    email2: -1,
    passportCols: [],
    carCols: [],
    purpose: -1,
    memo: -1,
    cleaningNotice: -1,
    guestNameCols: [],
    ageCols: []
  };

  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    const hl = h.toLowerCase();
    if (h === HEADERS.CHECK_IN && map.checkIn < 0) map.checkIn = i;
    if (h === HEADERS.CHECK_OUT && map.checkOut < 0) map.checkOut = i;
    if (h.indexOf('氏名') > -1 && map.guestName < 0) map.guestName = i;
    if (h.indexOf('氏名') > -1 || h.indexOf('名前') > -1 || hl === 'full name') map.guestNameCols.push(i);
    if (h.indexOf('年齢') > -1 || (hl.indexOf('age') > -1 && hl.indexOf('page') === -1)) map.ageCols.push(i);
    if ((h.indexOf('旅の目的') > -1 || h.indexOf('目的') > -1) && map.purpose < 0) map.purpose = i;
    if ((h === 'メモ' || h === '備考' || h.indexOf('メモ') > -1) && h.indexOf('オーナー') === -1 && h.indexOf('募集') === -1 && map.memo < 0) map.memo = i;
    if ((h === '連絡事項' || h === '清掃連絡事項') && map.cleaningNotice < 0) map.cleaningNotice = i;
    if ((h === HEADERS.BOOKING_SITE || h.indexOf('どこでこのホテルを予約しましたか') > -1) && map.bookingSite < 0) map.bookingSite = i;
    if ((h.indexOf('バーベキュー') > -1 || h.toLowerCase().indexOf('bbq') > -1) && map.bbq < 0) map.bbq = i;
    if (h.indexOf(HEADERS.GUEST_COUNT_PREFIX) > -1 && h.indexOf('3才以下の乳幼児') === -1 && map.guestCount < 0) map.guestCount = i;
    if (h.indexOf('3才以下の乳幼児') > -1 && map.guestCountInfants < 0) map.guestCountInfants = i;
    if (h === HEADERS.CLEANING_STAFF && map.cleaningStaff < 0) map.cleaningStaff = i;
    if (h.indexOf('有料駐車場を利用する方') > -1 && map.parking < 0) map.parking = i;
    if ((h === HEADERS.ICAL_SYNC || (h.indexOf('iCal') >= 0 && h.indexOf('同期') >= 0)) && map.icalSync < 0) map.icalSync = i;
    if ((h === HEADERS.ICAL_GUEST_COUNT || (h.indexOf('iCal') >= 0 && h.indexOf('宿泊人数') >= 0)) && map.icalGuestCount < 0) map.icalGuestCount = i;
    if ((h.indexOf('国籍') > -1 || h.toLowerCase().indexOf('nationality') > -1) && map.nationality < 0) map.nationality = i;
    if (h.indexOf('宿泊人数2名のお客様のみお答えください') > -1 && h.indexOf('ベッド') > -1 && map.bedChoice < 0) map.bedChoice = i;
    if (h.indexOf('宿泊人数2名') > -1 && map.twoGuestChoice < 0) map.twoGuestChoice = i;
    if (h.indexOf('ベッド数') > -1 && map.bedCount < 0) map.bedCount = i;
    if ((h.indexOf('電話') > -1 || h.indexOf('TEL') > -1 || h.toLowerCase().indexOf('phone') > -1) && h.indexOf('オーナー') === -1) {
      if (map.tel1 < 0) map.tel1 = i;
      else if (map.tel2 < 0) map.tel2 = i;
    }
    if ((h.indexOf('メール') > -1 || h.indexOf('mail') > -1) && h.indexOf('オーナー') === -1) {
      if (map.email < 0) map.email = i;
      else if (map.email2 < 0) map.email2 = i;
    }
    if (h.indexOf('パスポート') > -1 || h.indexOf('passport') > -1 || h.indexOf('Passport') > -1) {
      map.passportCols.push(i);
    }
    var carMatch = h.match(/お車は何台でお越しになりますか[\s　]*[?\？]\s*\[([^\]]+)\]/);
    if (carMatch) map.carCols.push({ col: i, label: carMatch[1].trim() });
  }
  return map;
}

/**
 * 宿泊人数の文字列から数値を抽出（「4人」「4」「大人4名」などに対応）
 */
function extractGuestCount_(str) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/\d+/);
  return match ? match[0] : trimmed;
}

/**
 * iCalのSUMMARY/DESCRIPTIONから宿泊人数を抽出
 * 例: "3 guests", "4 people", "3人", "Guests: 4"
 */
function extractGuestCountFromIcalText_(text) {
  if (!text || typeof text !== 'string') return '';
  var t = text.trim();
  if (!t) return '';
  var m = t.match(/(\d+)\s*(?:guests?|people|person)/i) || t.match(/(\d+)\s*人/) || t.match(/guests?[:\s]+(\d+)/i) || t.match(/人数[：:\s]+(\d+)/) || t.match(/\b(\d+)\s*(?:guests?|名)/i);
  return m && m[1] ? m[1] + '名' : '';
}

/**
 * 日付を YYYY-MM-DD に正規化（Asia/Tokyo基準・重複判定用）
 * toISOString() はUTCになるため日付がずれる問題を回避
 */
function toDateKeySafe_(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  var str = String(val).trim();
  if (!str) return '';
  var m = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  var num = parseFloat(str);
  if (!isNaN(num) && num > 0) {
    try {
      var d = new Date((num - 25569) * 86400 * 1000);
      return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
    } catch (e) {}
  }
  var d = new Date(str);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * 日付文字列を Date オブジェクトに変換
 * 対応: ISO形式、スラッシュ区切り、ハイフン区切り
 */
function parseDate(str) {
  if (!str) return null;
  if (str instanceof Date) return str;
  if (typeof str !== 'string') return null;
  str = str.trim();
  if (!str) return null;

  // ISO/スラッシュ区切り日付文字列を先にチェック（シリアル値誤認防止）
  var m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // 数値（日付シリアル値）の場合
  const num = parseFloat(str);
  if (!isNaN(num) && num > 0) {
    try {
      return new Date((num - 25569) * 86400 * 1000); // Excel日付シリアル
    } catch (e) {
      return null;
    }
  }

  // 文字列としてパース
  const d2 = new Date(str);
  return isNaN(d2.getTime()) ? null : d2;
}

/**
 * 指定行の清掃担当者を更新する
 * @param {number} rowNumber - スプレッドシートの行番号（1始まり）
 * @param {string} staffName - 清掃担当者名
 */
/**
 * 予約のメモを保存（オーナーのみ）
 */
function saveBookingMemo(rowNumber, memoText) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || rowNumber < 2 || rowNumber > sheet.getLastRow()) return JSON.stringify({ success: false, error: '無効な行です。' });
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colMap = buildColumnMap(headers);
    if (colMap.memo < 0) return JSON.stringify({ success: false, error: 'メモ列が見つかりません。' });
    sheet.getRange(rowNumber, colMap.memo + 1).setValue(memoText || '');
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function saveCleaningNotice(rowNumber, noticeText) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || rowNumber < 2 || rowNumber > sheet.getLastRow()) return JSON.stringify({ success: false, error: '無効な行です。' });
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colMap = buildColumnMap(headers);
    if (colMap.cleaningNotice < 0) {
      // 連絡事項列を自動作成
      var newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue('連絡事項');
      colMap.cleaningNotice = newCol - 1;
    }
    sheet.getRange(rowNumber, colMap.cleaningNotice + 1).setValue(noticeText || '');
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function updateCleaningStaff(rowNumber, staffName) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);

    if (!sheet) {
      return JSON.stringify({
        success: false,
        error: 'シート「' + SHEET_NAME + '」が見つかりません。'
      });
    }

    const lastRow = sheet.getLastRow();
    if (rowNumber < 2 || rowNumber > lastRow) {
      return JSON.stringify({
        success: false,
        error: '無効な行番号です: ' + rowNumber
      });
    }

    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const columnMap = buildColumnMap(headers);

    if (columnMap.cleaningStaff < 0) {
      return JSON.stringify({
        success: false,
        error: '「清掃担当」列が見つかりません。'
      });
    }

    const colIndex = columnMap.cleaningStaff + 1;
    const value = staffName ? String(staffName).trim() : '';
    sheet.getRange(rowNumber, colIndex).setValue(value);

    if (recruitSheet && recruitSheet.getLastRow() >= 2) {
      var rows = recruitSheet.getRange(2, 1, recruitSheet.getLastRow(), 5).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (Number(rows[i][1]) === rowNumber) {
          var recruitRowIndex = i + 2;
          recruitSheet.getRange(recruitRowIndex, 5).setValue(value);
          recruitSheet.getRange(recruitRowIndex, 4).setValue(value ? '選定済' : '募集中');
          break;
        }
      }
    }

    return JSON.stringify({
      success: true,
      message: value ? '清掃担当者を更新しました。' : '清掃担当を削除しました。募集中に変更しました。',
      rowNumber: rowNumber,
      cleaningStaff: value
    });

  } catch (e) {
    return JSON.stringify({
      success: false,
      error: '更新中にエラーが発生しました: ' + e.toString()
    });
  }
}

/**********************************************
 * オーナー判定・設定（オーナーのみ閲覧・編集）
 **********************************************/

/**
 * アカウント切り替え用URLを取得（ログアウト後にアプリへ戻る）
 */
function getAccountSwitchUrl() {
  try {
    var appUrl = '';
    try {
      appUrl = ScriptApp.getService().getUrl();
    } catch (e) {
      appUrl = '';
    }
    if (!appUrl) return JSON.stringify({ success: false, url: '', error: 'URL取得不可' });
    var switchUrl = 'https://www.google.com/accounts/Logout?continue=' + encodeURIComponent(appUrl);
    return JSON.stringify({ success: true, url: switchUrl, appUrl: appUrl });
  } catch (e) {
    return JSON.stringify({ success: false, url: '', error: e.toString() });
  }
}

/**
 * スタッフ用URL（?staff=1付き）を取得。設定済みならそれを、未設定なら現在のデプロイURL+?staff=1を返す
 */
function getStaffDeployUrl() {
  try {
    var stored = PropertiesService.getDocumentProperties().getProperty('staffDeployUrl');
    if (stored && String(stored).trim()) return JSON.stringify({ success: true, url: String(stored).trim(), isStored: true });
    var base = '';
    try { base = ScriptApp.getService().getUrl(); } catch (e) {}
    var url = base ? (base.indexOf('?') >= 0 ? base + '&staff=1' : base + '?staff=1') : '';
    return JSON.stringify({ success: true, url: url, isStored: false });
  } catch (e) { return JSON.stringify({ success: false, url: '', isStored: false, error: e.toString() }); }
}

/**
 * デプロイスクリプト用シークレットを設定（初回1回のみ、スクリプトエディタで実行）
 * 1. 下の setupDeploySecret 内の 'mySecret123' を任意の文字列に変更
 * 2. メニュー「実行」→「関数を実行」→ setupDeploySecret を選択して実行
 * 3. deploy-config.json の urlUpdateSecret に同じ値を設定
 */
function setUrlUpdateSecretForDeploy(secret) {
  try {
    if (!secret || typeof secret !== 'string') return;
    PropertiesService.getDocumentProperties().setProperty('urlUpdateSecret', String(secret).trim());
    Logger.log('urlUpdateSecret を設定しました。deploy-config.json の urlUpdateSecret に同じ値を設定してください。');
  } catch (e) { Logger.log(e.toString()); }
}
function setupDeploySecret() {
  setUrlUpdateSecretForDeploy('mySecret123'); // この値を任意の文字列に変更してから実行
}

/**
 * urlUpdateSecretを削除（スタッフURL自動反映で「反映できませんでした」となる場合、これを実行して秘密をクリアすると、秘密なしで自動反映が動作する）
 * 実行: メニュー「実行」→「関数を実行」→ clearUrlUpdateSecret
 */
function clearUrlUpdateSecret() {
  try {
    PropertiesService.getDocumentProperties().deleteProperty('urlUpdateSecret');
    Logger.log('urlUpdateSecret を削除しました。これで npm run deploy のスタッフURL自動反映が動作するはずです。');
  } catch (e) { Logger.log(e.toString()); }
}

/**
 * スタッフ用URLを保存（オーナーのみ）
 */
function setStaffDeployUrl(url) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ設定できます。' });
    var u = String(url || '').trim();
    if (u && u.indexOf('staff=1') < 0 && u.indexOf('staff=true') < 0) u = u + (u.indexOf('?') >= 0 ? '&' : '?') + 'staff=1';
    PropertiesService.getDocumentProperties().setProperty('staffDeployUrl', u);
    return JSON.stringify({ success: true });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
}

/**
 * オーナー判定＋アカウント切り替えURL＋現在のアカウント表示名をまとめて取得（画面初期表示用）
 */
function getOwnerAndSwitchUrl() {
  try {
    var ownerRes = JSON.parse(isOwner());
    var switchRes = JSON.parse(getAccountSwitchUrl());
    var userRes = JSON.parse(getCurrentUserEmail());
    return JSON.stringify({
      success: ownerRes.success && switchRes.success,
      isOwner: ownerRes.isOwner,
      ownerNotSet: ownerRes.ownerNotSet,
      switchUrl: switchRes.url || '',
      currentAccountName: userRes.displayName || getAccountDisplayName_(userRes.email || ''),
      error: switchRes.success ? ownerRes.error : switchRes.error
    });
  } catch (e) {
    return JSON.stringify({ success: false, isOwner: false, ownerNotSet: false, switchUrl: '', currentAccountName: '', error: e.toString() });
  }
}

/**
 * メールアドレスから表示用アカウント名を取得（@の前の部分、例: user@gmail.com → user）
 */
function getAccountDisplayName_(email) {
  if (!email || typeof email !== 'string') return '';
  const e = String(email).trim();
  const at = e.indexOf('@');
  return at > 0 ? e.slice(0, at) : e;
}

/**
 * 現在のログインユーザーのメールアドレスと表示名（「Google アカウントを持つ全員」でデプロイ時のみ取得可能）
 * 表示名: サブオーナーにカスタム表示名があればそれ、なければメールの@前（例: yamasuke81）
 */
function getCurrentUserEmail() {
  try {
    const email = Session.getActiveUser().getEmail() || '';
    var displayName = getAccountDisplayName_(email);
    try {
      ensureSheetsExist();
      const subSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SUB_OWNERS);
      if (subSheet && subSheet.getLastRow() >= 2) {
        const rows = subSheet.getRange(2, 1, subSheet.getLastRow(), 2).getValues();
        for (var i = 0; i < rows.length; i++) {
          if (String(rows[i][0] || '').trim().toLowerCase() === String(email).toLowerCase()) {
            var dn = String(rows[i][1] || '').trim();
            if (dn) displayName = dn;
            break;
          }
        }
      }
    } catch (e) {}
    return JSON.stringify({ success: true, email: email, displayName: displayName || getAccountDisplayName_(email) });
  } catch (e) {
    return JSON.stringify({ success: false, email: '', displayName: '', error: e.toString() });
  }
}

/**
 * オーナーメールを取得（設定_オーナーシートのA2）
 * オーナー未設定でも取得可能
 */
function getOwnerEmail() {
  try {
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_OWNER);
    if (!sheet || sheet.getLastRow() < 2) {
      return JSON.stringify({ success: true, email: '' });
    }
    const email = String(sheet.getRange(2, 1).getValue() || '').trim();
    return JSON.stringify({ success: true, email: email });
  } catch (e) {
    return JSON.stringify({ success: false, email: '', error: e.toString() });
  }
}

/** パスワードをSHA-256でハッシュ化 */
function hashPassword_(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password || ''));
  return Utilities.base64Encode(digest);
}

/** パスワード検証 */
function verifyOwnerPassword_(password) {
  const stored = PropertiesService.getScriptProperties().getProperty('OWNER_PASSWORD_HASH');
  if (!stored) return false;
  return hashPassword_(password) === stored;
}

/**
 * 初回オーナー登録（メール＋パスワード）
 * ownerNotSet のときのみ実行可能
 */
function setOwnerWithPassword(email, password) {
  try {
    ensureSheetsExist();
    const ownerRes = JSON.parse(getOwnerEmail());
    const currentOwner = (ownerRes.email || '').trim();
    if (currentOwner) {
      return JSON.stringify({ success: false, error: 'オーナーは既に登録済みです。メール変更は設定画面からパスワードを入力して行ってください。' });
    }
    const pw = String(password || '').trim();
    if (pw.length < 6) {
      return JSON.stringify({ success: false, error: 'パスワードは6文字以上で入力してください。' });
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_OWNER);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_OWNER);
      sheet.getRange(1, 1).setValue('オーナーメールアドレス');
      sheet.getRange(2, 1).setValue('');
    }
    sheet.getRange(2, 1).setValue(String(email || '').trim());
    PropertiesService.getScriptProperties().setProperty('OWNER_PASSWORD_HASH', hashPassword_(pw));
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * オーナーメール変更（パスワード必須）
 * オーナーのみ実行可能
 */
function changeOwnerEmail(newEmail, password) {
  try {
    if (!requireOwner() || !requireOwnerIsSet_()) {
      return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    }
    if (!verifyOwnerPassword_(password)) {
      return JSON.stringify({ success: false, error: 'パスワードが正しくありません。' });
    }
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_OWNER);
    if (!sheet) return JSON.stringify({ success: false, error: 'シートが見つかりません。' });
    sheet.getRange(2, 1).setValue(String(newEmail || '').trim());
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * オーナー登録をリセット（初回登録からやり直したいときに実行）
 * Apps Script エディタで「実行」→ resetOwnerRegistration を選択して実行してください。
 */
function resetOwnerRegistration() {
  try {
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_OWNER);
    if (sheet && sheet.getLastRow() >= 2) {
      sheet.getRange(2, 1).setValue('');
    }
    PropertiesService.getScriptProperties().deleteProperty('OWNER_PASSWORD_HASH');
    Logger.log('オーナー登録をリセットしました。Webアプリを再読み込みしてください。');
    return 'リセット完了。Webアプリを再読み込みしてください。';
  } catch (e) {
    Logger.log('resetOwnerRegistration: ' + e.toString());
    throw e;
  }
}

/** オーナーが設定済みか（パスワード含む） */
function requireOwnerIsSet_() {
  const ownerRes = JSON.parse(getOwnerEmail());
  return !!(ownerRes.email || '').trim();
}

/** パスワードが設定済みか */
function hasOwnerPassword_() {
  return !!PropertiesService.getScriptProperties().getProperty('OWNER_PASSWORD_HASH');
}

/**
 * 初回パスワード設定（オーナー設定済みでパスワード未設定のとき）
 * 過去に setOwnerEmail で登録した場合の移行用
 */
function setInitialPassword(password) {
  try {
    if (!requireOwner() || !requireOwnerIsSet_()) {
      return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    }
    if (hasOwnerPassword_()) {
      return JSON.stringify({ success: false, error: 'パスワードは既に設定済みです。' });
    }
    const pw = String(password || '').trim();
    if (pw.length < 6) {
      return JSON.stringify({ success: false, error: 'パスワードは6文字以上で入力してください。' });
    }
    PropertiesService.getScriptProperties().setProperty('OWNER_PASSWORD_HASH', hashPassword_(pw));
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/** オーナー状態を取得（パスワード設定有無・現在アカウント名を含む） */
function getOwnerStatus() {
  try {
    const res = JSON.parse(getOwnerEmail());
    const isOwnerRes = JSON.parse(isOwner());
    const userRes = JSON.parse(getCurrentUserEmail());
    return JSON.stringify({
      success: true,
      email: res.email || '',
      hasPassword: hasOwnerPassword_(),
      isOwner: isOwnerRes.isOwner,
      ownerNotSet: isOwnerRes.ownerNotSet,
      currentAccountName: userRes.displayName || getAccountDisplayName_(userRes.email || '')
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 現在のユーザーがオーナーまたはサブオーナーかどうか、およびオーナー未設定かどうか
 * ownerNotSet: true のときは誰でも設定タブにアクセスし初回セットアップ可能
 */
function isOwner() {
  try {
    const current = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    const res = JSON.parse(getOwnerEmail());
    const owner = (res.email || '').trim().toLowerCase();
    const ownerNotSet = !owner;
    var isOwnerUser = owner && current === owner;
    if (!isOwnerUser && owner) {
      try {
        ensureSheetsExist();
        const subSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SUB_OWNERS);
        if (subSheet && subSheet.getLastRow() >= 2) {
          const rows = subSheet.getRange(2, 1, subSheet.getLastRow(), 1).getValues();
          for (var i = 0; i < rows.length; i++) {
            if (String(rows[i][0] || '').trim().toLowerCase() === current) {
              isOwnerUser = true;
              break;
            }
          }
        }
      } catch (e) {}
    }
    return JSON.stringify({
      success: true,
      isOwner: !!isOwnerUser,
      ownerNotSet: !!ownerNotSet
    });
  } catch (e) {
    return JSON.stringify({ success: false, isOwner: false, ownerNotSet: false, error: e.toString() });
  }
}

/** オーナーのみ実行可能チェック（設定系API用）※オーナー未設定時は setOwnerWithPassword のみ許可 */
function requireOwner() {
  const res = JSON.parse(isOwner());
  return res.success && res.isOwner;
}

/**********************************************
 * サブオーナー管理（オーナーのみ）
 **********************************************/

function getSubOwnerList() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。', list: [] });
    ensureSheetsExist();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SUB_OWNERS);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: true, list: [] });
    const rows = sheet.getRange(2, 1, sheet.getLastRow(), 2).getValues();
    const list = rows.map(function(row, i) {
      var email = String(row[0] || '').trim();
      if (!email) return null;
      return {
        rowIndex: i + 2,
        email: email,
        displayName: String(row[1] || '').trim() || getAccountDisplayName_(email)
      };
    }).filter(function(x) { return x; });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), list: [] });
  }
}

function saveSubOwner(rowIndex, email, displayName) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_SUB_OWNERS);
    if (!sheet) return JSON.stringify({ success: false, error: 'サブオーナーシートが見つかりません。' });
    email = String(email || '').trim();
    if (!email) return JSON.stringify({ success: false, error: 'メールアドレスを入力してください。' });
    const lastRow = sheet.getLastRow();
    if (rowIndex && rowIndex >= 2 && rowIndex <= lastRow) {
      sheet.getRange(rowIndex, 1, 1, 2).setValues([[email, String(displayName || '').trim()]]);
      return JSON.stringify({ success: true, rowIndex: rowIndex });
    }
    const nextRow = Math.max(lastRow, 1) + 1;
    sheet.getRange(nextRow, 1, 1, 2).setValues([[email, String(displayName || '').trim()]]);
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function deleteSubOwner(rowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ削除できます。' });
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SUB_OWNERS);
    if (!sheet || rowIndex < 2) return JSON.stringify({ success: false, error: '無効な行' });
    sheet.deleteRow(rowIndex);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 設定用シートを自動作成（存在しない場合）
 */
function ensureSheetsExist() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss.getSheetByName(SHEET_OWNER)) {
    const s = ss.insertSheet(SHEET_OWNER);
    s.getRange(1, 1).setValue('オーナーメールアドレス');
    s.getRange(2, 1).setValue('');
  }

  if (!ss.getSheetByName(SHEET_SUB_OWNERS)) {
    const s = ss.insertSheet(SHEET_SUB_OWNERS);
    s.getRange(1, 1, 1, 2).setValues([['メール', '表示名']]);
  }

  if (!ss.getSheetByName(SHEET_STAFF)) {
    const s = ss.insertSheet(SHEET_STAFF);
    s.getRange(1, 1, 1, 9).setValues([['名前', '住所', 'メール', '金融機関名', '支店名', '口座種類', '口座番号', '口座名義', '有効']]);
  }

  if (!ss.getSheetByName(SHEET_JOB_TYPES)) {
    const s = ss.insertSheet(SHEET_JOB_TYPES);
    s.getRange(1, 1, 1, 3).setValues([['仕事内容名', '表示順', '有効']]);
    s.getRange(2, 1, 2, 3).setValues([['1名で清掃', 1, 'Y']]);
    s.getRange(3, 1, 3, 3).setValues([['2名で清掃', 2, 'Y']]);
    s.getRange(4, 1, 4, 3).setValues([['3名で清掃', 3, 'Y']]);
    s.getRange(5, 1, 5, 3).setValues([['コインランドリー交通費', 4, 'Y']]);
    s.getRange(6, 1, 6, 3).setValues([['コインランドリー実費', 5, 'Y']]);
    s.getRange(7, 1, 7, 3).setValues([['直前点検', 6, 'Y']]);
  }

  if (!ss.getSheetByName(SHEET_COMPENSATION)) {
    const s = ss.insertSheet(SHEET_COMPENSATION);
    s.getRange(1, 1, 1, 4).setValues([['スタッフ名', '仕事内容名', '報酬額', '備考']]);
  }

  if (!ss.getSheetByName(SHEET_SPECIAL_RATES)) {
    const s = ss.insertSheet(SHEET_SPECIAL_RATES);
    s.getRange(1, 1, 1, 5).setValues([['仕事内容名', '対象開始日', '対象終了日', '項目名', '追加金額']]);
  }

  if (!ss.getSheetByName(SHEET_RECRUIT_SETTINGS)) {
    const s = ss.insertSheet(SHEET_RECRUIT_SETTINGS);
    s.getRange(1, 1, 1, 2).setValues([['項目', '値']]);
    s.getRange(2, 1, 2, 2).setValues([['募集開始週数', 4]]);
    s.getRange(3, 1, 3, 2).setValues([['最少回答者数', 2]]);
    s.getRange(4, 1, 4, 2).setValues([['リマインド間隔週', 1]]);
    s.getRange(5, 1, 5, 2).setValues([['選定人数', 2]]);
  }

  if (!ss.getSheetByName(SHEET_RECRUIT)) {
    const s = ss.insertSheet(SHEET_RECRUIT);
    s.getRange(1, 1, 1, 14).setValues([['チェックアウト日', '予約行番号', '告知日', 'ステータス', '選定スタッフ', 'リマインド最終日', '作成日', '予約ID', '告知方法', '予約日付', '予約人数', '予約BBQ', '予約国籍', 'メモ']]);
  } else {
    ensureRecruitNotifyMethodColumn_();
    ensureRecruitDetailColumns_();
  }

  if (!ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS)) {
    const s = ss.insertSheet(SHEET_RECRUIT_VOLUNTEERS);
    s.getRange(1, 1, 1, 7).setValues([['募集ID', 'スタッフ名', 'メール', '立候補日時', '対応可能条件', 'ステータス', '保留理由']]);
  } else {
    ensureVolunteerMemoColumn_();
    ensureVolunteerStatusColumns_();
  }
  if (!ss.getSheetByName(SHEET_CANCEL_REQUESTS)) {
    ss.insertSheet(SHEET_CANCEL_REQUESTS).getRange(1, 1, 1, 5).setValues([['募集ID', 'スタッフ名', 'メール', '申請日時', 'ステータス']]);
  }

  if (!ss.getSheetByName(SHEET_SYNC_SETTINGS)) {
    const s = ss.insertSheet(SHEET_SYNC_SETTINGS);
    s.getRange(1, 1, 1, 4).setValues([['プラットフォーム名', 'iCal URL', '有効', '最終同期']]);
    s.getRange(2, 1, 2, 4).setValues([['Airbnb', '', 'Y', '']]);
    s.getRange(3, 1, 3, 4).setValues([['Booking.com', '', 'Y', '']]);
  }
  if (!ss.getSheetByName(SHEET_NOTIFICATIONS)) {
    const s = ss.insertSheet(SHEET_NOTIFICATIONS);
    s.getRange(1, 1, 1, 4).setValues([['日時', '種類', '内容', '既読']]);
  }
}

function formatNotificationMessage_(kind, message) {
  if (!message) return message;
  var m = String(message).match(/^(\d{4}-\d{1,2}-\d{1,2})\s*:\s*(.+?)\s+が立候補しました$/);
  if (m && kind === '立候補') {
    var d = m[1].replace(/-/g, '/');
    return m[2].trim() + ' が' + d + 'の清掃に立候補しました';
  }
  m = String(message).match(/^(\d{4}-\d{1,2}-\d{1,2})\s*:\s*(.+?)\s+が立候補を取り消しました$/);
  if (m && kind === '立候補取消') {
    var d2 = m[1].replace(/-/g, '/');
    return m[2].trim() + ' が' + d2 + 'の清掃の立候補を取り消しました';
  }
  return message;
}

function addNotification_(kind, message, data) {
  try {
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NOTIFICATIONS);
    if (!sheet) return;
    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    const nextRow = sheet.getLastRow() + 1;
    var lastCol = sheet.getLastColumn();
    if (lastCol < 5) {
      if (lastCol < 4) sheet.getRange(1, 4).setValue('既読');
      sheet.getRange(1, 5).setValue('データ');
      lastCol = 5;
    }
    var dataStr = data ? JSON.stringify(data) : '';
    sheet.getRange(nextRow, 1, 1, 5).setValues([[now, kind, message, '', dataStr]]);
  } catch (e) {}
}

/**
 * 予約を削除（オーナーのみ）キャンセルや誤登録の削除用
 */
function deleteBooking(rowNumber) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ削除できます。' });
    var row = parseInt(rowNumber, 10);
    if (isNaN(row) || row < 2) return JSON.stringify({ success: false, error: '無効な行番号です。' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = ss.getSheetByName(SHEET_NAME);
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    if (!formSheet || formSheet.getLastRow() < row) return JSON.stringify({ success: false, error: '指定された行が見つかりません。' });
    if (recruitSheet && recruitSheet.getLastRow() >= 2) {
      var recruitData = recruitSheet.getRange(2, 1, recruitSheet.getLastRow(), 8).getValues();
      var toDelRecruit = [];
      for (var i = 0; i < recruitData.length; i++) {
        var rn = parseInt(recruitData[i][1], 10);
        if (rn === row) toDelRecruit.push(i + 2);
        else if (rn > row) recruitSheet.getRange(i + 2, 2).setValue(rn - 1);
      }
      for (var d = toDelRecruit.length - 1; d >= 0; d--) {
        var recruitId = 'r' + toDelRecruit[d];
        if (volSheet && volSheet.getLastRow() >= 2) {
          var volData = volSheet.getRange(2, 1, volSheet.getLastRow(), 1).getValues();
          for (var v = volData.length - 1; v >= 0; v--) {
            if (String(volData[v][0] || '').trim() === recruitId) volSheet.deleteRow(v + 2);
          }
        }
        recruitSheet.deleteRow(toDelRecruit[d]);
      }
    }
    var colMap = buildColumnMap(formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0]);
    var gn = colMap.guestName >= 0 ? String(formSheet.getRange(row, colMap.guestName + 1).getValue() || '').trim() : '';
    formSheet.deleteRow(row);
    addNotification_('予約削除', '予約が削除されました' + (gn ? ': ' + gn : ''));
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 予約シートに「iCal同期」列があることを保証（iCal由来行の識別用）
 */
function ensureICalSyncColumn_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 1) return;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').trim() === HEADERS.ICAL_SYNC) {
        ensureICalGuestCountColumn_();
        return;
      }
    }
    sheet.insertColumnAfter(sheet.getLastColumn());
    sheet.getRange(1, sheet.getLastColumn()).setValue(HEADERS.ICAL_SYNC);
    ensureICalGuestCountColumn_();
  } catch (e) {}
}

function ensureICalGuestCountColumn_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 1) return;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').trim() === HEADERS.ICAL_GUEST_COUNT) return;
    }
    sheet.insertColumnAfter(sheet.getLastColumn());
    sheet.getRange(1, sheet.getLastColumn()).setValue(HEADERS.ICAL_GUEST_COUNT);
  } catch (e) {}
}

/**
 * 募集シートに「告知方法」列があることを保証
 */
function ensureRecruitNotifyMethodColumn_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!sheet || sheet.getLastRow() < 1) return;
    if (sheet.getLastColumn() >= 9) return;
    sheet.insertColumnAfter(sheet.getLastColumn());
    sheet.getRange(1, sheet.getLastColumn()).setValue('告知方法');
  } catch (e) {}
}

/**
 * 募集シートに次回予約情報・メモ・ベッド数列があることを保証
 */
function ensureRecruitDetailColumns_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!sheet || sheet.getLastRow() < 1) return;
    var extraHeaders = ['予約日付', '予約人数', '予約BBQ', '予約国籍', 'メモ', 'ベッド数'];
    for (var i = 0; i < extraHeaders.length; i++) {
      if (sheet.getLastColumn() >= 10 + i) continue;
      sheet.insertColumnAfter(sheet.getLastColumn());
      sheet.getRange(1, sheet.getLastColumn()).setValue(extraHeaders[i]);
    }
  } catch (e) {}
}

function ensureVolunteerMemoColumn_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    if (!sheet || sheet.getLastColumn() >= 5) return;
    while (sheet.getLastColumn() < 5) {
      sheet.insertColumnAfter(sheet.getLastColumn());
      sheet.getRange(1, 5).setValue('対応可能条件');
    }
  } catch (e) {}
}

function ensureVolunteerStatusColumns_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    if (!sheet || sheet.getLastColumn() >= 7) return;
    while (sheet.getLastColumn() < 6) {
      sheet.insertColumnAfter(sheet.getLastColumn());
      sheet.getRange(1, 6).setValue('ステータス');
    }
    if (sheet.getLastColumn() < 7) {
      sheet.insertColumnAfter(sheet.getLastColumn());
      sheet.getRange(1, 7).setValue('保留理由');
    }
  } catch (e) {}
}

/**
 * フォーム送信時: 同じチェックイン・チェックアウトの既存行があれば詳細（人数・BBQ・駐車場など）をマージし、重複行を削除
 */
function mergeFormResponseToExistingBooking_(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || !e.range) return;
    ensureICalSyncColumn_();

    const newRow = e.range.getRow();
    if (newRow < 2) return;

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const colMap = buildColumnMap(headers);
    if (colMap.checkIn < 0 || colMap.checkOut < 0) return;

    const newRowData = sheet.getRange(newRow, 1, 1, lastCol).getValues()[0];
    const newCheckIn = parseDate(String(newRowData[colMap.checkIn] || ''));
    const newCheckOut = parseDate(String(newRowData[colMap.checkOut] || ''));
    if (!newCheckIn || !newCheckOut) return;

    const newCheckInStr = toDateKeySafe_(newCheckIn);
    const newCheckOutStr = toDateKeySafe_(newCheckOut);
    if (!newCheckInStr || !newCheckOutStr) return;

    for (var r = 2; r <= lastRow; r++) {
      if (r === newRow) continue;
      const rowData = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
      var ciStr = toDateKeySafe_(rowData[colMap.checkIn]);
      var coStr = toDateKeySafe_(rowData[colMap.checkOut]);
      if (!ciStr || !coStr) continue;
      if (ciStr === newCheckInStr && coStr === newCheckOutStr) {
        var updates = [];
        if (colMap.guestName >= 0) updates.push({ col: colMap.guestName + 1, val: String(newRowData[colMap.guestName] || '').trim() });
        if (colMap.bookingSite >= 0) updates.push({ col: colMap.bookingSite + 1, val: String(newRowData[colMap.bookingSite] || '').trim() });
        if (colMap.bbq >= 0) updates.push({ col: colMap.bbq + 1, val: String(newRowData[colMap.bbq] || '').trim() });
        if (colMap.guestCount >= 0) updates.push({ col: colMap.guestCount + 1, val: String(newRowData[colMap.guestCount] || '').trim() });
        if (colMap.guestCountInfants >= 0) updates.push({ col: colMap.guestCountInfants + 1, val: String(newRowData[colMap.guestCountInfants] || '').trim() });
        if (colMap.parking >= 0) updates.push({ col: colMap.parking + 1, val: String(newRowData[colMap.parking] || '').trim() });
        updates.forEach(function(u) { sheet.getRange(r, u.col).setValue(u.val); });
        sheet.deleteRow(newRow);
        addNotification_('フォーム回答', newCheckInStr + '～' + newCheckOutStr + ': フォームの回答が入力されました');
        break;
      }
    }
  } catch (err) {
    Logger.log('mergeFormResponseToExistingBooking_: ' + err.toString());
  }
}

/**********************************************
 * 連携設定・iCal同期（オーナーのみ）
 **********************************************/

function getSyncSettings() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。', list: [] });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const s = ss.getSheetByName(SHEET_SYNC_SETTINGS);
    if (!s || s.getLastRow() < 2) return JSON.stringify({ success: true, list: [] });
    var lastCol = Math.max(s.getLastColumn(), 4);
    const rows = s.getRange(2, 1, s.getLastRow(), lastCol).getValues();
    var list = rows.map(function(row, i) {
      return {
        rowIndex: i + 2,
        platformName: String(row[0] || '').trim(),
        icalUrl: String(row[1] || '').trim(),
        active: String(row[2] || 'Y').trim(),
        lastSync: String(row[3] || '').trim()
      };
    }).filter(function(item) { return item.platformName; });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), list: [] });
  }
}

function setSyncSetting(rowIndex, platformName, icalUrl, active) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const s = ss.getSheetByName(SHEET_SYNC_SETTINGS);
    if (!s) return JSON.stringify({ success: false, error: '連携設定シートが見つかりません。' });
    var lastRow = s.getLastRow();
    if (rowIndex && rowIndex >= 2 && rowIndex <= lastRow) {
      s.getRange(rowIndex, 1, 1, 3).setValues([[platformName || '', icalUrl || '', active !== 'N' ? 'Y' : 'N']]);
      return JSON.stringify({ success: true, rowIndex: rowIndex });
    }
    var nextRow = lastRow + 1;
    s.getRange(nextRow, 1, 1, 3).setValues([[platformName || '', icalUrl || '', active !== 'N' ? 'Y' : 'N']]);
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function deleteSyncSetting(rowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ削除できます。' });
    const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SYNC_SETTINGS);
    if (!s || rowIndex < 2) return JSON.stringify({ success: false, error: '無効な行' });
    s.deleteRow(rowIndex);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * iCalの日付文字列をAsia/TokyoのYYYY-MM-DDに変換
 * VALUE=DATE、UTC(Z)、TZID、ローカル時刻に対応
 */
function parseICalDateToKey_(dtStr) {
  if (!dtStr || typeof dtStr !== 'string') return '';
  var raw = dtStr.trim();
  if (!raw) return '';
  var digits = raw.replace(/\D/g, '');
  var dateMatch = digits.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!dateMatch) return '';
  var y = dateMatch[1], m = dateMatch[2], d = dateMatch[3];
  var isUTC = raw.toUpperCase().indexOf('Z') >= 0;
  var hasTime = raw.indexOf('T') >= 0;
  if (!hasTime) return y + '-' + m + '-' + d;
  if (isUTC) {
    var hour = parseInt(digits.substring(8, 10) || '0', 10);
    var min = parseInt(digits.substring(10, 12) || '0', 10);
    var sec = parseInt(digits.substring(12, 14) || '0', 10);
    var utcDate = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), hour, min, sec));
    return Utilities.formatDate(utcDate, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  var tzMatch = raw.match(/TZID=([^:;]+)/i);
  if (tzMatch && tzMatch[1]) {
    var tz = tzMatch[1].trim();
    if (tz.toUpperCase() === 'ASIA/TOKYO' || tz === 'Japan') {
      return y + '-' + m + '-' + d;
    }
  }
  return y + '-' + m + '-' + d;
}

/**
 * iCal文字列をパースして予約一覧を返す
 * 行の折り返し、タイムゾーン、重複排除に対応
 */
/**
 * iCal DURATION (P1D, P3D等) を日数に変換
 */
function parseICalDurationToDays_(durStr) {
  if (!durStr || typeof durStr !== 'string') return 0;
  var s = durStr.trim().toUpperCase();
  var days = 0;
  var wMatch = s.match(/(\d+)W/);
  if (wMatch) days += parseInt(wMatch[1], 10) * 7;
  var dMatch = s.match(/(\d+)D/);
  if (dMatch) days += parseInt(dMatch[1], 10);
  if (days > 0) return days;
  var hMatch = s.match(/(\d+)H/);
  if (hMatch || s.indexOf('T') >= 0) return 1;
  return 0;
}

/**
 * YYYY-MM-DDに日数を加算
 */
function addDaysToDateKey_(dateKey, days) {
  if (!dateKey || !days) return dateKey;
  var d = new Date(dateKey + 'T12:00:00+09:00');
  d.setDate(d.getDate() + days);
  var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}

function parseICal_(icalText, platformName) {
  var events = [];
  var raw = (icalText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var unfolded = raw.replace(/\n[ \t]/g, '');
  var lines = unfolded.split('\n');
  var current = null;
  var seenUids = {};
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf('BEGIN:VEVENT') === 0) {
      current = { dtstart: '', dtend: '', duration: '', summary: '', description: '', uid: '', status: '' };
    } else if (current && line.indexOf('END:VEVENT') === 0) {
      if (/^CANCELLED$/i.test(String(current.status || '').trim())) {
        current = null;
        continue;
      }
      var checkIn = parseICalDateToKey_(current.dtstart);
      var checkOut = parseICalDateToKey_(current.dtend);
      if (!checkOut && checkIn && current.duration) {
        var days = parseICalDurationToDays_(current.duration);
        if (days > 0) checkOut = addDaysToDateKey_(checkIn, days);
      }
      if (checkIn && checkOut) {
        var uid = (current.uid || '').trim();
        var dupKey = uid || (checkIn + '|' + checkOut + '|' + (platformName || ''));
        if (seenUids[dupKey]) {
          current = null;
          continue;
        }
        seenUids[dupKey] = true;
        var sum = (current.summary || '').trim();
        if (/cancel/i.test(sum)) continue;
        var guestName = sum.replace(/^Reserved\s*$/i, '').replace(/^CLOSED[^a-zA-Z]*/i, '').replace(/Not available/gi, '').trim() || '';
        var guestLower = guestName.toLowerCase();
        if (/^(airbnb|booking\.com|rakuten|楽天)\s*\([^)]*\)?\s*$/i.test(guestName) || guestLower === 'airbnb' || guestLower === 'booking.com' || guestLower === 'rakuten') continue;
        var combinedText = ((current.summary || '') + ' ' + (current.description || '')).trim();
        var icalGuestCount = extractGuestCountFromIcalText_(combinedText);
        events.push({
          checkIn: checkIn,
          checkOut: checkOut,
          guestName: guestName,
          platform: platformName || '',
          guestCount: icalGuestCount
        });
      }
      current = null;
    } else if (current) {
      if (line.indexOf('DTSTART') === 0) current.dtstart = line.indexOf(':') >= 0 ? line.substring(line.indexOf(':') + 1) : '';
      if (line.indexOf('DTEND') === 0) current.dtend = line.indexOf(':') >= 0 ? line.substring(line.indexOf(':') + 1) : '';
      if (line.indexOf('DURATION') === 0) current.duration = line.indexOf(':') >= 0 ? line.substring(line.indexOf(':') + 1) : '';
      if (line.indexOf('SUMMARY') === 0) current.summary = (line.indexOf(':') >= 0 ? line.substring(line.indexOf(':') + 1) : '').replace(/\\,/g, ',').replace(/\\n/g, ' ').trim();
      if (line.indexOf('DESCRIPTION') === 0) current.description = (line.indexOf(':') >= 0 ? line.substring(line.indexOf(':') + 1) : '').replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\;/g, ';').trim();
      if (line.indexOf('UID') === 0) current.uid = line.indexOf(':') >= 0 ? line.substring(line.indexOf(':') + 1) : '';
      if (line.indexOf('STATUS') === 0) current.status = line.indexOf(':') >= 0 ? line.substring(line.indexOf(':') + 1).trim() : '';
    }
  }
  return events;
}

/**
 * iCal URLから予約を取得してシートに追加（重複はスキップ）
 */
function syncFromICal() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。', added: 0 });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const syncSheet = ss.getSheetByName(SHEET_SYNC_SETTINGS);
    const formSheet = ss.getSheetByName(SHEET_NAME);
    if (!syncSheet || !formSheet) return JSON.stringify({ success: false, error: 'シートが見つかりません。', added: 0 });

    var added = 0;
    var removed = 0;
    var lastRow = syncSheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true, added: 0 });

    ensureICalSyncColumn_();
    if (syncSheet.getLastColumn() < 4) {
      syncSheet.insertColumnAfter(3);
      syncSheet.getRange(1, 4).setValue('最終同期');
    }
    var syncRows = syncSheet.getRange(2, 1, lastRow, 4).getValues();
    var existingPairs = {};
    var existingRowByKey = {};
    var formLastRow = formSheet.getLastRow();
    var formLastCol = formSheet.getLastColumn();
    if (formLastRow >= 2 && formLastCol >= 1) {
      var headers = formSheet.getRange(1, 1, 1, formLastCol).getValues()[0];
      var colMap = buildColumnMap(headers);
      if (colMap.checkIn >= 0 && colMap.checkOut >= 0) {
        var data = formSheet.getRange(2, 1, formLastRow, formLastCol).getValues();
        for (var i = 0; i < data.length; i++) {
          var ciKey = toDateKeySafe_(data[i][colMap.checkIn]);
          var coKey = toDateKeySafe_(data[i][colMap.checkOut]);
          if (ciKey && coKey) {
            var k = ciKey + '|' + coKey;
            existingPairs[k] = true;
            existingRowByKey[k] = i + 2;
          }
        }
      }
    }

    var details = [];
    for (var si = 0; si < syncRows.length; si++) {
      var platformName = String(syncRows[si][0] || '').trim();
      var url = String(syncRows[si][1] || '').trim();
      var active = String(syncRows[si][2] || 'Y').trim();
      if (!platformName || !url || active === 'N') continue;

      var icalText;
      try {
        var resp = UrlFetchApp.fetch(url, {
          muteHttpExceptions: true,
          followRedirects: true,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CalendarSync/1.0)' }
        });
        if (resp.getResponseCode() !== 200) {
          var errMsg = 'HTTP ' + resp.getResponseCode();
          details.push({ platform: platformName, fetched: 0, added: 0, removed: 0, error: errMsg });
          syncSheet.getRange(si + 2, 4).setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d HH:mm') + ' ' + errMsg);
          continue;
        }
        icalText = resp.getContentText();
      } catch (fetchErr) {
        var errMsg = fetchErr.toString();
        details.push({ platform: platformName, fetched: 0, added: 0, removed: 0, error: errMsg });
        syncSheet.getRange(si + 2, 4).setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d HH:mm') + ' ' + errMsg);
        continue;
      }

      var events = parseICal_(icalText, platformName);
      var platformAdded = 0;
      var colMap = buildColumnMap(formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0]);
      var nextRow = formSheet.getLastRow() + 1;
      var validPairs = {};
      for (var vi = 0; vi < events.length; vi++) validPairs[events[vi].checkIn + '|' + events[vi].checkOut] = true;

      for (var ei = 0; ei < events.length; ei++) {
        var ev = events[ei];
        var key = ev.checkIn + '|' + ev.checkOut;
        if (existingPairs[key]) {
          var updateRowNum = existingRowByKey[key];
          if (updateRowNum) {
            var existingIcal = colMap.icalSync >= 0 ? String(formSheet.getRange(updateRowNum, colMap.icalSync + 1).getValue() || '').trim().toLowerCase() : '';
            var existingSite = colMap.bookingSite >= 0 ? String(formSheet.getRange(updateRowNum, colMap.bookingSite + 1).getValue() || '').trim().toLowerCase() : '';
            var newPlatform = String(ev.platform || '').trim().toLowerCase();
            var hasBooking = existingIcal.indexOf('booking') >= 0 || existingSite.indexOf('booking') >= 0;
            var isNewAirbnb = newPlatform.indexOf('airbnb') >= 0;
            if (hasBooking && isNewAirbnb) continue;
            if (colMap.icalSync >= 0) formSheet.getRange(updateRowNum, colMap.icalSync + 1).setValue(ev.platform || '');
            if (colMap.icalGuestCount >= 0 && ev.guestCount) formSheet.getRange(updateRowNum, colMap.icalGuestCount + 1).setValue(ev.guestCount || '');
          }
          continue;
        }
        var overlaps = false;
        for (var ek in existingPairs) {
          var parts = ek.split('|');
          if (parts.length >= 2) {
            var exCi = parts[0], exCo = parts[1];
            if (ev.checkIn < exCo && ev.checkOut > exCi) {
              overlaps = true;
              break;
            }
          }
        }
        if (overlaps) continue;
        existingPairs[key] = true;

        var formLastCol = formSheet.getLastColumn();
        var rowData = [];
        for (var c = 0; c < formLastCol; c++) rowData[c] = '';
        if (colMap.checkIn >= 0) rowData[colMap.checkIn] = ev.checkIn;
        if (colMap.checkOut >= 0) rowData[colMap.checkOut] = ev.checkOut;
        if (colMap.guestName >= 0) rowData[colMap.guestName] = ev.guestName || '';
        if (colMap.icalSync >= 0) rowData[colMap.icalSync] = ev.platform || '';
        if (colMap.icalGuestCount >= 0) rowData[colMap.icalGuestCount] = ev.guestCount || '';

        formSheet.getRange(nextRow, 1, 1, formLastCol).setValues([rowData]);
        nextRow++;
        added++;
        platformAdded++;
      }
      var platformRemoved = 0;
      if (colMap.icalSync >= 0) {
        var formData = formSheet.getRange(2, 1, formSheet.getLastRow(), formSheet.getLastColumn()).getValues();
        var toDel = [];
        for (var ri = 0; ri < formData.length; ri++) {
          var icalVal = String(formData[ri][colMap.icalSync] || '').trim();
          if (icalVal.toLowerCase() !== platformName.toLowerCase()) continue;
          var ciKey = toDateKeySafe_(formData[ri][colMap.checkIn]);
          var coKey = toDateKeySafe_(formData[ri][colMap.checkOut]);
          if (!ciKey || !coKey) continue;
          if (!validPairs[ciKey + '|' + coKey]) toDel.push(ri + 2);
        }
        toDel.sort(function(a, b) { return b - a; });
        for (var di = 0; di < toDel.length; di++) {
          var res = JSON.parse(deleteBooking(toDel[di]));
          if (res.success) { platformRemoved++; removed++; }
        }
      }
      var statusStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d HH:mm') + ' 取得' + events.length + '件';
      if (platformAdded > 0) statusStr += ' 追加' + platformAdded;
      if (platformRemoved > 0) statusStr += ' 削除' + platformRemoved;
      syncSheet.getRange(si + 2, 4).setValue(statusStr);
      if (platformAdded > 0) addNotification_('予約追加', platformName + 'から' + platformAdded + '件の予約が追加されました');
      if (platformRemoved > 0) addNotification_('予約削除', platformName + 'から' + platformRemoved + '件の予約が削除されました');
      details.push({ platform: platformName, fetched: events.length, added: platformAdded, removed: platformRemoved, error: '' });
    }

    return JSON.stringify({ success: true, added: added, removed: removed, details: details });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), added: 0, removed: 0, details: [] });
  }
}

/**
 * 別スプレッドシートから予約データを読み込み（オーナーのみ）
 * フォーム回答のバックアップや削除したスプシの復元用
 */
function importFromSpreadsheet(spreadsheetUrl, skipDuplicates) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。', imported: 0, skipped: 0 });
    if (!spreadsheetUrl || typeof spreadsheetUrl !== 'string') return JSON.stringify({ success: false, error: 'URLを指定してください。', imported: 0, skipped: 0 });
    var idMatch = spreadsheetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!idMatch || !idMatch[1]) return JSON.stringify({ success: false, error: 'URLが無効です。スプレッドシートのURLを貼り付けてください。', imported: 0, skipped: 0 });
    var sourceId = idMatch[1];
    if (sourceId === SpreadsheetApp.getActiveSpreadsheet().getId()) return JSON.stringify({ success: false, error: '同じスプレッドシートを指定しています。別のスプシのURLを入力してください。', imported: 0, skipped: 0 });
    ensureSheetsExist();
    ensureICalSyncColumn_();
    var sourceSs, sourceSheet;
    try {
      sourceSs = SpreadsheetApp.openById(sourceId);
      sourceSheet = sourceSs.getSheets()[0];
    } catch (openErr) {
      return JSON.stringify({ success: false, error: 'スプレッドシートを開けません。共有設定で「リンクを知っている全員が閲覧可」にしてください。', imported: 0, skipped: 0 });
    }
    if (!sourceSheet || sourceSheet.getLastRow() < 2) return JSON.stringify({ success: true, imported: 0, skipped: 0 });
    var sourceHeaders = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues()[0];
    var srcMap = buildColumnMapFromSource_(sourceHeaders);
    if (srcMap.checkIn < 0 || srcMap.checkOut < 0) return JSON.stringify({ success: false, error: 'チェックイン・チェックアウト列が見つかりません。フォーム回答スプシの1行目にヘッダーがあるか確認してください。', imported: 0, skipped: 0 });
    var formSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    var destHeaders = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    var destMap = buildColumnMap(destHeaders);
    if (destMap.checkIn < 0 || destMap.checkOut < 0) return JSON.stringify({ success: false, error: '予約シートの形式が不正です。', imported: 0, skipped: 0 });
    var existingPairs = {};
    if (skipDuplicates && formSheet.getLastRow() >= 2) {
      var destData = formSheet.getRange(2, 1, formSheet.getLastRow(), formSheet.getLastColumn()).getValues();
      for (var i = 0; i < destData.length; i++) {
        var ci = toDateKeySafe_(destData[i][destMap.checkIn]);
        var co = toDateKeySafe_(destData[i][destMap.checkOut]);
        if (ci && co) existingPairs[ci + '|' + co] = true;
      }
    }
    var sourceData = sourceSheet.getRange(2, 1, sourceSheet.getLastRow(), sourceSheet.getLastColumn()).getValues();
    var rowsToAdd = [];
    var skipped = 0;
    for (var r = 0; r < sourceData.length; r++) {
      var row = sourceData[r];
      var ciVal = row[srcMap.checkIn];
      var coVal = row[srcMap.checkOut];
      var ciStr = toDateKeySafe_(ciVal);
      var coStr = toDateKeySafe_(coVal);
      if (!ciStr || !coStr) continue;
      if (skipDuplicates && existingPairs[ciStr + '|' + coStr]) { skipped++; continue; }
      existingPairs[ciStr + '|' + coStr] = true;
      var destRow = [];
      for (var c = 0; c < destHeaders.length; c++) destRow[c] = '';
      if (destMap.checkIn >= 0) destRow[destMap.checkIn] = ciStr;
      if (destMap.checkOut >= 0) destRow[destMap.checkOut] = coStr;
      if (destMap.guestName >= 0 && srcMap.guestName >= 0) destRow[destMap.guestName] = String(row[srcMap.guestName] || '').trim();
      if (destMap.bookingSite >= 0 && srcMap.bookingSite >= 0) destRow[destMap.bookingSite] = String(row[srcMap.bookingSite] || '').trim();
      if (destMap.bbq >= 0 && srcMap.bbq >= 0) destRow[destMap.bbq] = String(row[srcMap.bbq] || '').trim();
      if (destMap.guestCount >= 0 && srcMap.guestCount >= 0) destRow[destMap.guestCount] = String(row[srcMap.guestCount] || '').trim();
      if (destMap.guestCountInfants >= 0 && srcMap.guestCountInfants >= 0) destRow[destMap.guestCountInfants] = String(row[srcMap.guestCountInfants] || '').trim();
      if (destMap.cleaningStaff >= 0 && srcMap.cleaningStaff >= 0) destRow[destMap.cleaningStaff] = String(row[srcMap.cleaningStaff] || '').trim();
      if (destMap.parking >= 0 && srcMap.parking >= 0) destRow[destMap.parking] = String(row[srcMap.parking] || '').trim();
      if (destMap.icalSync >= 0) destRow[destMap.icalSync] = '';
      rowsToAdd.push(destRow);
    }
    if (rowsToAdd.length === 0) return JSON.stringify({ success: true, imported: 0, skipped: skipped });
    var nextRow = formSheet.getLastRow() + 1;
    formSheet.getRange(nextRow, 1, rowsToAdd.length, destHeaders.length).setValues(rowsToAdd);
    sortFormResponses_();
    return JSON.stringify({ success: true, imported: rowsToAdd.length, skipped: skipped });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), imported: 0, skipped: 0 });
  }
}

/**
 * 読み込み元スプシ用の緩い列マッピング（ヘッダー名のゆらぎに対応）
 */
function buildColumnMapFromSource_(headers) {
  var map = { checkIn: -1, checkOut: -1, guestName: -1, bookingSite: -1, bbq: -1, guestCount: -1, guestCountInfants: -1, cleaningStaff: -1, parking: -1, nationality: -1, bedCount: -1, bedChoice: -1, twoGuestChoice: -1, icalGuestCount: -1 };
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').trim();
    var hl = h.toLowerCase();
    if ((hl.indexOf('チェックイン') > -1 || hl.indexOf('check-in') > -1) && map.checkIn < 0) map.checkIn = i;
    if ((hl.indexOf('チェックアウト') > -1 || hl.indexOf('check-out') > -1) && map.checkOut < 0) map.checkOut = i;
    if ((hl.indexOf('氏名') > -1 || hl.indexOf('名前') > -1 || hl === 'full name') && map.guestName < 0) map.guestName = i;
    if ((hl.indexOf('予約') > -1 && hl.indexOf('どこ') > -1) || hl.indexOf('booking') > -1 || hl.indexOf('予約サイト') > -1) { if (map.bookingSite < 0) map.bookingSite = i; }
    if ((hl.indexOf('バーベキュー') > -1 || hl.indexOf('bbq') > -1) && map.bbq < 0) map.bbq = i;
    if (hl.indexOf('宿泊人数') > -1 && hl.indexOf('3才以下') === -1 && hl.indexOf('乳幼児') === -1 && map.guestCount < 0) map.guestCount = i;
    if ((hl.indexOf('3才以下') > -1 || hl.indexOf('乳幼児') > -1) && map.guestCountInfants < 0) map.guestCountInfants = i;
    if (hl.indexOf('清掃担当') > -1 && map.cleaningStaff < 0) map.cleaningStaff = i;
    if (hl.indexOf('有料駐車場') > -1 && map.parking < 0) map.parking = i;
    if ((hl.indexOf('国籍') > -1 || hl.indexOf('nationality') > -1) && map.nationality < 0) map.nationality = i;
    if (h.indexOf('ベッド数') > -1 && map.bedCount < 0) map.bedCount = i;
    if (h.indexOf('宿泊人数2名') > -1 && h.indexOf('ベッド') > -1 && map.bedChoice < 0) map.bedChoice = i;
    if (h.indexOf('宿泊人数2名') > -1 && map.twoGuestChoice < 0) map.twoGuestChoice = i;
    if ((h.indexOf('iCal') >= 0 && h.indexOf('宿泊人数') >= 0) && map.icalGuestCount < 0) map.icalGuestCount = i;
  }
  return map;
}

/**
 * iCal同期の紐付けを一括解除（オーナーのみ）
 * ※行は削除せず、「iCal同期」列のみクリア。フォーム回答・予約データは残る
 */
function clearSyncedBookings() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。', cleared: 0 });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = ss.getSheetByName(SHEET_NAME);
    if (!formSheet) return JSON.stringify({ success: false, error: 'シートが見つかりません。', cleared: 0 });
    var formLastRow = formSheet.getLastRow();
    var formLastCol = formSheet.getLastColumn();
    if (formLastRow < 2 || formLastCol < 1) return JSON.stringify({ success: true, cleared: 0 });
    var headers = formSheet.getRange(1, 1, 1, formLastCol).getValues()[0];
    var colMap = buildColumnMap(headers);
    if (colMap.icalSync < 0) return JSON.stringify({ success: true, cleared: 0 });
    var data = formSheet.getRange(2, 1, formLastRow, formLastCol).getValues();
    var cleared = 0;
    for (var i = 0; i < data.length; i++) {
      var icalVal = String(data[i][colMap.icalSync] || '').trim();
      if (icalVal) {
        formSheet.getRange(i + 2, colMap.icalSync + 1).setValue('');
        if (colMap.icalGuestCount >= 0) formSheet.getRange(i + 2, colMap.icalGuestCount + 1).setValue('');
        cleared++;
      }
    }
    return JSON.stringify({ success: true, cleared: cleared });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), cleared: 0 });
  }
}

/**
 * 手動で予約を追加（オーナーのみ）プラットフォーム連携の先行登録用
 */
function addBookingManually(checkIn, checkOut, guestName, bookingSite, guestCount) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return JSON.stringify({ success: false, error: '予約シートが見つかりません。' });

    var ci = parseDate(String(checkIn || ''));
    var co = parseDate(String(checkOut || ''));
    if (!ci || !co) return JSON.stringify({ success: false, error: 'チェックイン・チェックアウトの日付が無効です。' });

    var ciStr = toDateKeySafe_(ci);
    var coStr = toDateKeySafe_(co);
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return JSON.stringify({ success: false, error: 'シートに列がありません。' });

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var colMap = buildColumnMap(headers);
    var nextRow = sheet.getLastRow() + 1;

    var rowData = [];
    for (var c = 0; c < lastCol; c++) rowData[c] = '';
    if (colMap.checkIn >= 0) rowData[colMap.checkIn] = ciStr;
    if (colMap.checkOut >= 0) rowData[colMap.checkOut] = coStr;
    if (colMap.guestName >= 0) rowData[colMap.guestName] = String(guestName || '').trim();
    if (colMap.bookingSite >= 0) rowData[colMap.bookingSite] = String(bookingSite || '').trim();
    if (colMap.guestCount >= 0 && guestCount) rowData[colMap.guestCount] = String(guestCount).trim();

    sheet.getRange(nextRow, 1, 1, lastCol).setValues([rowData]);
    sortFormResponses_();
    addNotification_('予約追加', ciStr + '～' + coStr + ': 予約が追加されました' + (guestName ? ' (' + String(guestName).trim() + ')' : ''));
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function getNotifications(unreadOnly) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, list: [] });
    ensureSheetsExist();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NOTIFICATIONS);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: true, list: [] });
    var lastCol = Math.max(sheet.getLastColumn(), 5);
    const data = sheet.getRange(2, 1, sheet.getLastRow(), lastCol).getValues();
    var list = data.map(function(r, i) {
      var readVal = lastCol >= 4 ? String(r[3] || '').trim() : '';
      var atVal = r[0];
      var atStr = '';
      if (atVal instanceof Date) {
        atStr = Utilities.formatDate(atVal, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
      } else {
        atStr = String(atVal || '');
      }
      var msg = String(r[2] || '');
      msg = formatNotificationMessage_(String(r[1] || ''), msg);
      var nData = null;
      try { var raw = String(r[4] || '').trim(); if (raw) nData = JSON.parse(raw); } catch (e) {}
      return {
        rowIndex: i + 2,
        at: atStr,
        kind: String(r[1] || ''),
        message: msg,
        read: readVal === 'Y' || readVal === 'y',
        data: nData
      };
    }).reverse();
    if (unreadOnly) list = list.filter(function(n) { return !n.read; });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, list: [], error: e.toString() });
  }
}

function markNotificationAsRead(rowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false });
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NOTIFICATIONS);
    if (!sheet || rowIndex < 2 || rowIndex > sheet.getLastRow()) return JSON.stringify({ success: false });
    var lastCol = Math.max(sheet.getLastColumn(), 4);
    if (lastCol < 4) {
      sheet.getRange(1, 4).setValue('既読');
      lastCol = 4;
    }
    sheet.getRange(rowIndex, 4).setValue('Y');
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**********************************************
 * 清掃スタッフ（オーナーのみ）
 **********************************************/

function getStaffList() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。', list: [] });
    ensureSheetsExist();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STAFF);
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const lastCol = 9;
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow, lastCol).getValues() : [];
    const list = rows.map(function(row, i) {
      return {
        rowIndex: i + 2,
        name: String(row[0] || '').trim(),
        address: String(row[1] || '').trim(),
        email: String(row[2] || '').trim(),
        bankName: String(row[3] || '').trim(),
        bankBranch: String(row[4] || '').trim(),
        accountType: String(row[5] || '').trim(),
        accountNumber: String(row[6] || '').trim(),
        accountHolder: String(row[7] || '').trim(),
        active: String(row[8] || 'Y').trim()
      };
    }).filter(function(item) { return item.name || item.email; });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), list: [] });
  }
}

function saveStaff(rowIndex, data) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_STAFF);
    const lastRow = sheet.getLastRow();
    if (rowIndex && rowIndex >= 2 && rowIndex <= lastRow) {
      sheet.getRange(rowIndex, 1, 1, 9).setValues([[
        data.name || '', data.address || '', data.email || '',
        data.bankName || '', data.bankBranch || '', data.accountType || '',
        data.accountNumber || '', data.accountHolder || '', data.active !== 'N' ? 'Y' : 'N'
      ]]);
      return JSON.stringify({ success: true, rowIndex: rowIndex });
    }
    const nextRow = lastRow + 1;
    sheet.getRange(nextRow, 1, 1, 9).setValues([[
      data.name || '', data.address || '', data.email || '',
      data.bankName || '', data.bankBranch || '', data.accountType || '',
      data.accountNumber || '', data.accountHolder || '', data.active !== 'N' ? 'Y' : 'N'
    ]]);
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function deleteStaff(rowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ削除できます。' });
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STAFF);
    if (!sheet || rowIndex < 2) return JSON.stringify({ success: false, error: '無効な行' });
    sheet.deleteRow(rowIndex);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**********************************************
 * 仕事内容マスタ（オーナーのみ）
 **********************************************/

/**
 * 報酬追加モーダル用：スタッフ一覧と仕事内容一覧をまとめて取得
 */
function getCompFormOptions() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, staffList: [], jobList: [] });
    var staffRes = JSON.parse(getStaffList());
    var jobRes = JSON.parse(getJobTypes());
    var staffList = staffRes.success && staffRes.list ? staffRes.list : [];
    var jobList = jobRes.success && jobRes.list ? jobRes.list : [];
    return JSON.stringify({ success: true, staffList: staffList, jobList: jobList });
  } catch (e) {
    return JSON.stringify({ success: false, staffList: [], jobList: [], error: e.toString() });
  }
}

function getJobTypes() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。', list: [] });
    ensureSheetsExist();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_JOB_TYPES);
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow, 3).getValues() : [];
    const list = rows.map(function(row, i) {
      return {
        rowIndex: i + 2,
        name: String(row[0] || '').trim(),
        sortOrder: parseInt(row[1], 10) || 0,
        active: String(row[2] || 'Y').trim()
      };
    }).filter(function(item) { return item.name; });
    list.sort(function(a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), list: [] });
  }
}

function saveJobType(rowIndex, name, sortOrder) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_JOB_TYPES);
    const lastRow = sheet.getLastRow();
    const order = parseInt(sortOrder, 10) || 0;
    if (rowIndex && rowIndex >= 2 && rowIndex <= lastRow) {
      sheet.getRange(rowIndex, 1, 1, 3).setValues([[name || '', order, 'Y']]);
      return JSON.stringify({ success: true, rowIndex: rowIndex });
    }
    const nextRow = lastRow + 1;
    sheet.getRange(nextRow, 1, 1, 3).setValues([[name || '', order, 'Y']]);
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function deleteJobType(rowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ削除できます。' });
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_JOB_TYPES);
    if (!sheet || rowIndex < 2) return JSON.stringify({ success: false, error: '無効な行' });
    var jobName = String(sheet.getRange(rowIndex, 1).getValue() || '').trim();
    if (jobName) {
      deleteCompensationByJob_(jobName);
      deleteSpecialRatesByJob_(jobName);
    }
    sheet.deleteRow(rowIndex);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function deleteCompensationByJob_(jobName) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_COMPENSATION);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var data = sheet.getRange(2, 1, lastRow, 2).getValues();
    var toDelete = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][1] || '').trim() === jobName) toDelete.push(i + 2);
    }
    for (var d = toDelete.length - 1; d >= 0; d--) sheet.deleteRow(toDelete[d]);
  } catch (e) {}
}

function deleteSpecialRatesByJob_(jobName) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SPECIAL_RATES);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var data = sheet.getRange(2, 1, lastRow, 1).getValues();
    var toDelete = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === jobName) toDelete.push(i + 2);
    }
    for (var d = toDelete.length - 1; d >= 0; d--) sheet.deleteRow(toDelete[d]);
  } catch (e) {}
}

/**
 * 全仕事内容の特別料金を取得（byJob形式）
 */
function getAllSpecialRates() {
  try {
    ensureSheetsExist();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SPECIAL_RATES);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: true, byJob: {} });
    var data = sheet.getRange(2, 1, sheet.getLastRow(), 5).getValues();
    var byJob = {};
    for (var i = 0; i < data.length; i++) {
      var job = String(data[i][0] || '').trim();
      if (!job) continue;
      if (!byJob[job]) byJob[job] = [];
      byJob[job].push({
        startDate: toDateKeySafe_(data[i][1]) || String(data[i][1] || '').trim(),
        endDate: toDateKeySafe_(data[i][2]) || String(data[i][2] || '').trim(),
        itemName: String(data[i][3] || '').trim(),
        amount: String(data[i][4] || '').trim()
      });
    }
    return JSON.stringify({ success: true, byJob: byJob });
  } catch (e) {
    return JSON.stringify({ success: false, byJob: {}, error: e.toString() });
  }
}

/**
 * 仕事内容の特別料金一覧を取得
 */
function getSpecialRatesForJob(jobName) {
  try {
    if (!jobName || typeof jobName !== 'string') return JSON.stringify({ success: false, list: [] });
    ensureSheetsExist();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SPECIAL_RATES);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: true, list: [] });
    var data = sheet.getRange(2, 1, sheet.getLastRow(), 5).getValues();
    var list = [];
    var job = String(jobName).trim();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0] || '').trim() !== job) continue;
      list.push({
        startDate: toDateKeySafe_(data[i][1]) || String(data[i][1] || '').trim(),
        endDate: toDateKeySafe_(data[i][2]) || String(data[i][2] || '').trim(),
        itemName: String(data[i][3] || '').trim(),
        amount: String(data[i][4] || '').trim()
      });
    }
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, list: [], error: e.toString() });
  }
}

/**
 * 仕事内容の特別料金を保存
 */
function saveSpecialRatesForJob(jobName, entries) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    if (!jobName || typeof jobName !== 'string') return JSON.stringify({ success: false, error: '仕事内容を指定してください。' });
    var job = String(jobName).trim();
    if (!job) return JSON.stringify({ success: false, error: '仕事内容を指定してください。' });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_SPECIAL_RATES);
    if (!sheet) return JSON.stringify({ success: false, error: 'シートが見つかりません。' });
    deleteSpecialRatesByJob_(job);
    var validEntries = [];
    if (entries && Array.isArray(entries)) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var start = (e && e.startDate) ? String(e.startDate).trim() : '';
        var item = (e && e.itemName) ? String(e.itemName).trim() : '';
        var amt = (e && e.amount != null && e.amount !== '') ? String(e.amount).trim() : '';
        if (start && item && amt) {
          var end = (e && e.endDate) ? String(e.endDate).trim() : start;
          validEntries.push([job, start, end, item, amt]);
        }
      }
    }
    if (validEntries.length > 0) {
      var nextRow = sheet.getLastRow() + 1;
      sheet.getRange(nextRow, 1, validEntries.length, 5).setValues(validEntries);
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**********************************************
 * スタッフ報酬（オーナーのみ）
 **********************************************/

function getCompensation() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。', list: [] });
    ensureSheetsExist();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_COMPENSATION);
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow, 4).getValues() : [];
    const list = rows.map(function(row, i) {
      return {
        rowIndex: i + 2,
        staffName: String(row[0] || '').trim(),
        jobName: String(row[1] || '').trim(),
        amount: String(row[2] || '').trim(),
        note: String(row[3] || '').trim()
      };
    });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), list: [] });
  }
}

function saveCompensation(rowIndex, staffName, jobName, amount, note) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_COMPENSATION);
    const lastRow = sheet.getLastRow();
    if (rowIndex && rowIndex >= 2 && rowIndex <= lastRow) {
      sheet.getRange(rowIndex, 1, 1, 4).setValues([[staffName || '', jobName || '', amount || '', note || '']]);
      return JSON.stringify({ success: true, rowIndex: rowIndex });
    }
    const nextRow = lastRow + 1;
    sheet.getRange(nextRow, 1, 1, 4).setValues([[staffName || '', jobName || '', amount || '', note || '']]);
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function deleteCompensation(rowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ削除できます。' });
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_COMPENSATION);
    if (!sheet || rowIndex < 2) return JSON.stringify({ success: false, error: '無効な行' });
    sheet.deleteRow(rowIndex);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 担当者ごとに報酬を一括保存（既存分を削除して上書き）
 * entries: [{jobName, amount}, ...]
 */
function saveCompensationBatch(staffName, entries) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    if (!staffName || typeof staffName !== 'string') return JSON.stringify({ success: false, error: 'スタッフ名を指定してください。' });
    var staff = String(staffName).trim();
    if (!staff) return JSON.stringify({ success: false, error: 'スタッフ名を指定してください。' });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_COMPENSATION);
    var lastRow = sheet.getLastRow();
    var toDelete = [];
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow, 1).getValues();
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][0] || '').trim() === staff) toDelete.push(i + 2);
      }
    }
    for (var d = toDelete.length - 1; d >= 0; d--) sheet.deleteRow(toDelete[d]);
    var validEntries = [];
    if (entries && Array.isArray(entries)) {
      for (var j = 0; j < entries.length; j++) {
        var e = entries[j];
        var job = (e && e.jobName) ? String(e.jobName).trim() : '';
        var amt = (e && e.amount != null && e.amount !== '') ? String(e.amount).trim() : '';
        if (job && amt) validEntries.push({ jobName: job, amount: amt });
      }
    }
    if (validEntries.length === 0) return JSON.stringify({ success: true });
    var nextRow = sheet.getLastRow() + 1;
    var rows = validEntries.map(function(e) { return [staff, e.jobName, e.amount, '']; });
    sheet.getRange(nextRow, 1, rows.length, 4).setValues(rows);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 仕事内容ごとに報酬を一括保存（共通＋スタッフ別）
 * entries: [{staffName, amount}, ...]  staffName='共通'は全スタッフ共通
 */
function saveCompensationForJob(jobName, entries) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    if (!jobName || typeof jobName !== 'string') return JSON.stringify({ success: false, error: '仕事内容を指定してください。' });
    var job = String(jobName).trim();
    if (!job) return JSON.stringify({ success: false, error: '仕事内容を指定してください。' });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_COMPENSATION);
    var lastRow = sheet.getLastRow();
    var toDelete = [];
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow, 2).getValues();
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][1] || '').trim() === job) toDelete.push(i + 2);
      }
    }
    for (var d = toDelete.length - 1; d >= 0; d--) sheet.deleteRow(toDelete[d]);
    var validEntries = [];
    if (entries && Array.isArray(entries)) {
      for (var j = 0; j < entries.length; j++) {
        var e = entries[j];
        var staff = (e && e.staffName) ? String(e.staffName).trim() : '';
        var amt = (e && e.amount != null && e.amount !== '') ? String(e.amount).trim() : '';
        if (staff && amt) validEntries.push({ staffName: staff, amount: amt });
      }
    }
    if (validEntries.length === 0) return JSON.stringify({ success: true });
    var nextRow = sheet.getLastRow() + 1;
    var rows = validEntries.map(function(e) { return [e.staffName, job, e.amount, '']; });
    sheet.getRange(nextRow, 1, rows.length, 4).setValues(rows);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 担当者の報酬設定をすべて削除
 */
function deleteCompensationByStaff(staffName) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ削除できます。' });
    if (!staffName || typeof staffName !== 'string') return JSON.stringify({ success: false, error: 'スタッフ名を指定してください。' });
    var staff = String(staffName).trim();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_COMPENSATION);
    if (!sheet) return JSON.stringify({ success: false, error: 'シートが見つかりません。' });
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true });
    var data = sheet.getRange(2, 1, lastRow, 1).getValues();
    var toDelete = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === staff) toDelete.push(i + 2);
    }
    for (var d = toDelete.length - 1; d >= 0; d--) sheet.deleteRow(toDelete[d]);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**********************************************
 * 募集設定（オーナーのみ）
 **********************************************/

function getRecruitmentSettings() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。' });
    ensureSheetsExist();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT_SETTINGS);
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow, 2).getValues() : [];
    const settings = {};
    rows.forEach(function(row) {
      const key = String(row[0] || '').trim();
      if (key) settings[key] = row[1];
    });
    return JSON.stringify({
      success: true,
      settings: {
        recruitStartWeeks: parseInt(settings['募集開始週数'], 10) || 4,
        minRespondents: parseInt(settings['最少回答者数'], 10) || 2,
        reminderIntervalWeeks: parseInt(settings['リマインド間隔週'], 1) || 1,
        selectCount: parseInt(settings['選定人数'], 10) || 2
      }
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function setRecruitmentSettings(settings) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_RECRUIT_SETTINGS);
    var keys = ['募集開始週数', '最少回答者数', 'リマインド間隔週', '選定人数'];
    var values = [
      settings.recruitStartWeeks != null ? settings.recruitStartWeeks : 4,
      settings.minRespondents != null ? settings.minRespondents : 2,
      settings.reminderIntervalWeeks != null ? settings.reminderIntervalWeeks : 1,
      settings.selectCount != null ? settings.selectCount : 2
    ];
    for (var i = 0; i < keys.length; i++) {
      var row = i + 2;
      sheet.getRange(row, 1).setValue(keys[i]);
      sheet.getRange(row, 2).setValue(values[i]);
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**********************************************
 * 募集・立候補・選定
 **********************************************/

function getRecruitmentList() {
  try {
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_RECRUIT);
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    ensureRecruitNotifyMethodColumn_();
    ensureRecruitDetailColumns_();
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const maxCol = Math.max(sheet.getLastColumn(), 15);
    const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow, maxCol).getValues() : [];
    const list = [];
    for (var i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = 'r' + (i + 2);
      const checkoutDate = row[0] ? (row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[0])) : '';
      const bookingRowNum = row[1] ? Number(row[1]) : 0;
      const notifiedAt = row[2] ? String(row[2]) : '';
      const status = String(row[3] || '').trim() || '募集中';
      const selectedStaff = String(row[4] || '').trim();
      const lastRemind = row[5] ? String(row[5]) : '';
      const createdAt = row[6] ? String(row[6]) : '';
      const bookingId = String(row[7] || '').trim();
      const notifyMethod = String(row[8] || '').trim() || 'メール';
      const reserveDate = String(row[9] || '').trim();
      const reserveGuestCount = String(row[10] || '').trim();
      const reserveBBQ = String(row[11] || '').trim();
      const reserveNationality = String(row[12] || '').trim();
      const reserveMemo = String(row[13] || '').trim();
      const reserveBedCount = String(row[14] || '').trim();
      var volunteers = [];
      if (volSheet && volSheet.getLastRow() >= 2) {
        const volRows = volSheet.getRange(2, 1, volSheet.getLastRow(), 4).getValues();
        volRows.forEach(function(vr) {
          if (String(vr[0] || '').trim() === id) {
            volunteers.push({ staffName: String(vr[1] || '').trim(), email: String(vr[2] || '').trim(), at: String(vr[3] || '').trim() });
          }
        });
      }
      list.push({
        id: id,
        rowIndex: i + 2,
        checkoutDate: checkoutDate,
        bookingRowNumber: bookingRowNum,
        notifiedAt: notifiedAt,
        status: status,
        selectedStaff: selectedStaff,
        lastRemindAt: lastRemind,
        createdAt: createdAt,
        bookingId: bookingId,
        notifyMethod: notifyMethod,
        reserveDate: reserveDate,
        reserveGuestCount: reserveGuestCount,
        reserveBBQ: reserveBBQ,
        reserveNationality: reserveNationality,
        reserveMemo: reserveMemo,
        reserveBedCount: reserveBedCount,
        volunteers: volunteers
      });
    }
    list.sort(function(a, b) { return (b.checkoutDate || '').localeCompare(a.checkoutDate || ''); });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), list: [] });
  }
}

/**
 * 募集の告知方法を更新
 */
function updateRecruitmentNotifyMethod(recruitRowIndex, notifyMethod) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureRecruitNotifyMethodColumn_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!sheet || sheet.getLastRow() < recruitRowIndex) return JSON.stringify({ success: false, error: '募集が見つかりません。' });
    sheet.getRange(recruitRowIndex, 9).setValue((notifyMethod || 'メール').trim() || 'メール');
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 募集を告知（メール送信 or LINE用テキスト返却）
 */
function announceRecruitment(recruitRowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    ensureRecruitNotifyMethodColumn_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!sheet || sheet.getLastRow() < recruitRowIndex) return JSON.stringify({ success: false, error: '募集が見つかりません。' });
    var row = sheet.getRange(recruitRowIndex, 1, recruitRowIndex, 9).getValues()[0];
    var checkoutDateStr = row[0] ? (row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[0])) : '';
    var bookingRowNumber = row[1] ? Number(row[1]) : 0;
    var notifyMethod = String(row[8] || '').trim() || 'メール';
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    sheet.getRange(recruitRowIndex, 3).setValue(now);
    if (notifyMethod === 'LINE') {
      var detStr = getBookingDetailsForRecruit(bookingRowNumber, recruitRowIndex);
      var det = JSON.parse(detStr);
      var nextRes = det.success && det.nextReservation ? det.nextReservation : null;
      var appUrl = '';
      try { appUrl = ScriptApp.getService().getUrl(); } catch (e) {}
      return JSON.stringify({ success: true, copyText: buildRecruitmentCopyText_(checkoutDateStr, nextRes, appUrl) });
    }
    notifyStaffForRecruitment(recruitRowIndex, checkoutDateStr, bookingRowNumber);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * スタッフ共有シートと同じ計算でベッド数を算出（フォームの回答1の生値は使わない）
 * ベッド数マスタ B:C を参照。2名かつ宿泊人数2名の選択肢に応じて C3/C4、それ以外は VLOOKUP
 */
function calculateBedCountLikeStaffShare_(formRow, colMap, ss) {
  if (!ss || !formRow) return '';
  var masterSheet = ss.getSheetByName(SHEET_BED_COUNT_MASTER);
  if (!masterSheet || masterSheet.getLastRow() < 2) return '';
  var guestsRaw = colMap.guestCount >= 0 ? String(formRow[colMap.guestCount] || '').trim() : '';
  var guestsNum = parseInt(extractGuestCount_(guestsRaw), 10);
  if (isNaN(guestsNum) || guestsRaw === '') return '';
  var twoGuestChoice = (colMap.bedChoice >= 0 ? String(formRow[colMap.bedChoice] || '').trim() : '') || (colMap.twoGuestChoice >= 0 ? String(formRow[colMap.twoGuestChoice] || '').trim() : '');
  var masterData = masterSheet.getRange(1, 1, Math.min(masterSheet.getLastRow(), 100), 3).getValues();
  if (guestsNum === 2) {
    if (twoGuestChoice.indexOf('2人で1台') >= 0 || twoGuestChoice === '2人で1台のベッドを利用（2階リビング）') {
      if (masterData.length >= 3 && masterData[2][2] != null) return String(masterData[2][2]).trim();
      return '';
    }
    if (twoGuestChoice.indexOf('1人1台') >= 0 || twoGuestChoice === '1人1台ずつベッドを利用（1階和室）') {
      if (masterData.length >= 4 && masterData[3][2] != null) return String(masterData[3][2]).trim();
      return '';
    }
  }
  for (var r = 1; r < masterData.length; r++) {
    var bVal = masterData[r][1];
    var bNum = parseInt(String(bVal || '').trim(), 10);
    if (!isNaN(bNum) && bNum === guestsNum && masterData[r][2] != null) {
      return String(masterData[r][2]).trim();
    }
  }
  return '';
}

/**
 * スタッフ共有用シートからチェックイン日が一致する行のベッド数を取得（優先）
 */
function getBedCountFromStaffShare_(ss, checkInStr) {
  if (!ss || !checkInStr) return '';
  var sheet = ss.getSheetByName(SHEET_STAFF_SHARE);
  if (!sheet || sheet.getLastRow() < 2) return '';
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = buildColumnMapFromSource_(headers);
  if (map.checkIn < 0) return '';
  var data = sheet.getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var ci = parseDate(row[map.checkIn]);
    if (!ci) continue;
    var ciStr = toDateKeySafe_(ci);
    if (ciStr === checkInStr && map.bedCount >= 0) {
      return String(row[map.bedCount] || '').trim();
    }
  }
  return '';
}

/**
 * 清掃日のチェックアウト以降にチェックインする「次回予約」を取得
 * フォームの回答 1 で取得できなければ スタッフ共有用 をフォールバック
 * @param {Sheet} formSheet
 * @param {Object} colMap
 * @param {string} currentCheckoutStr - 今回の清掃日（チェックアウト日）YYYY-MM-DD
 * @param {number} excludeRowNumber - 除外する行（今回の予約行）
 * @param {Spreadsheet} [ss] - フォールバック用（スタッフ共有用・ベッド数取得）
 */
function getNextReservationAfterCheckout_(formSheet, colMap, currentCheckoutStr, excludeRowNumber, ss) {
  if (!currentCheckoutStr) return null;
  var best = null;
  var bestCheckInStr = '9999-12-31';
  var usedColMap = colMap;
  var useFallback = false;

  var bestFormRow = null;
  var bestColMap = null;
  if (formSheet && (colMap.checkIn >= 0 && colMap.checkOut >= 0)) {
    var data = formSheet.getRange(2, 1, formSheet.getLastRow(), formSheet.getLastColumn()).getValues();
    // 除外行のチェックイン日を取得（重複行スキップ用）
    var excludeCi = '';
    if (excludeRowNumber && excludeRowNumber >= 2 && (excludeRowNumber - 2) < data.length) {
      var exCiVal = colMap.checkIn >= 0 ? data[excludeRowNumber - 2][colMap.checkIn] : null;
      var exCi = parseDate(exCiVal);
      if (exCi) excludeCi = toDateKeySafe_(exCi);
    }
    for (var i = 0; i < data.length; i++) {
      var rowNum = i + 2;
      if (rowNum === excludeRowNumber) continue;
      // 同一チェックイン日の重複行をスキップ（iCal+フォーム重複対策）
      if (excludeCi) {
        var rowCiVal = colMap.checkIn >= 0 ? data[i][colMap.checkIn] : null;
        var rowCiParsed = parseDate(rowCiVal);
        if (rowCiParsed && toDateKeySafe_(rowCiParsed) === excludeCi) continue;
      }
      var row = data[i];
      var checkInVal = colMap.checkIn >= 0 ? row[colMap.checkIn] : null;
      var checkOutVal = colMap.checkOut >= 0 ? row[colMap.checkOut] : null;
      var checkIn = parseDate(checkInVal);
      if (!checkIn) continue;
      var checkInStr = toDateKeySafe_(checkIn);
      if (!checkInStr) continue;
      if (checkInStr < currentCheckoutStr) continue;
      if (!best || checkInStr < bestCheckInStr) {
        bestCheckInStr = checkInStr;
        var checkOut = parseDate(checkOutVal);
        var coStr = checkOut ? toDateKeySafe_(checkOut) : '';
        var adult = colMap.guestCount >= 0 ? extractGuestCount_(String(row[colMap.guestCount] || '')) : '';
        var infant = colMap.guestCountInfants >= 0 ? extractGuestCount_(String(row[colMap.guestCountInfants] || '')) : '';
        var formFmt = (adult || infant) ? (adult ? '大人' + adult + '名' : '') + (infant ? (adult ? '、' : '') + '3歳以下' + infant + '名' : '') : '';
        var icalCnt = colMap.icalGuestCount >= 0 ? String(row[colMap.icalGuestCount] || '').trim() : '';
        var guestCount = (icalCnt || '－') + '（' + (formFmt || '－') + '）';
        best = {
          date: checkInStr || '',
          dateRange: (checkInStr || '') + ' ～ ' + (coStr || ''),
          guestCount: guestCount,
          bbq: colMap.bbq >= 0 ? String(row[colMap.bbq] || '').trim() : '',
          nationality: (colMap.nationality >= 0 ? String(row[colMap.nationality] || '').trim() : '') || '日本',
          memo: '',
          bedCount: ''
        };
        bestFormRow = row;
        bestColMap = colMap;
      }
    }
  }

  if (!best && ss) {
    var staffSheet = ss.getSheetByName(SHEET_STAFF_SHARE);
    if (staffSheet && staffSheet.getLastRow() >= 2) {
      usedColMap = buildColumnMapFromSource_(staffSheet.getRange(1, 1, 1, staffSheet.getLastColumn()).getValues()[0]);
      if (usedColMap.checkIn >= 0 && usedColMap.checkOut >= 0) {
        var staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow(), staffSheet.getLastColumn()).getValues();
        for (var j = 0; j < staffData.length; j++) {
          var sRow = staffData[j];
          var sCheckIn = parseDate(sRow[usedColMap.checkIn]);
          if (!sCheckIn) continue;
          var sCheckInStr = toDateKeySafe_(sCheckIn);
          if (!sCheckInStr || sCheckInStr < currentCheckoutStr) continue;
          if (!best || sCheckInStr < bestCheckInStr) {
            bestCheckInStr = sCheckInStr;
            var sCheckOut = parseDate(usedColMap.checkOut >= 0 ? sRow[usedColMap.checkOut] : null);
            var sCoStr = sCheckOut ? toDateKeySafe_(sCheckOut) : '';
            var sAdult = usedColMap.guestCount >= 0 ? extractGuestCount_(String(sRow[usedColMap.guestCount] || '')) : '';
            var sInfant = usedColMap.guestCountInfants >= 0 ? extractGuestCount_(String(sRow[usedColMap.guestCountInfants] || '')) : '';
            var sFormFmt = (sAdult || sInfant) ? (sAdult ? '大人' + sAdult + '名' : '') + (sInfant ? (sAdult ? '、' : '') + '3歳以下' + sInfant + '名' : '') : '';
            var sIcalCnt = (usedColMap.icalGuestCount >= 0) ? String(sRow[usedColMap.icalGuestCount] || '').trim() : '';
            var sGuestCount = (sIcalCnt || '－') + '（' + (sFormFmt || '－') + '）';
            var sBedCount = usedColMap.bedCount >= 0 ? String(sRow[usedColMap.bedCount] || '').trim() : '';
            best = {
              date: sCheckInStr || '',
              dateRange: (sCheckInStr || '') + ' ～ ' + (sCoStr || ''),
              guestCount: sGuestCount,
              bbq: usedColMap.bbq >= 0 ? String(sRow[usedColMap.bbq] || '').trim() : '',
              nationality: (usedColMap.nationality >= 0 ? String(sRow[usedColMap.nationality] || '').trim() : '') || '日本',
              memo: '',
              bedCount: sBedCount
            };
            bestFormRow = null;
            bestColMap = null;
          }
        }
      }
    }
  }

  if (best && ss) {
    var ciStr = (best.date || '').split(/\s*～\s*/)[0].trim();
    if (!best.bedCount) {
      best.bedCount = getBedCountFromStaffShare_(ss, ciStr);
      if (!best.bedCount && bestFormRow && bestColMap) {
        best.bedCount = calculateBedCountLikeStaffShare_(bestFormRow, bestColMap, ss);
      }
    }
    var staffSheet = ss.getSheetByName(SHEET_STAFF_SHARE);
    if (staffSheet && staffSheet.getLastRow() >= 2 && (!best.guestCount || !best.bbq)) {
      var staffMap = buildColumnMapFromSource_(staffSheet.getRange(1, 1, 1, staffSheet.getLastColumn()).getValues()[0]);
      if (staffMap.checkIn >= 0) {
        var staffRows = staffSheet.getRange(2, 1, staffSheet.getLastRow(), staffSheet.getLastColumn()).getValues();
        for (var k = 0; k < staffRows.length; k++) {
          var sCheckIn = parseDate(staffRows[k][staffMap.checkIn]);
          if (!sCheckIn) continue;
          var sCi = toDateKeySafe_(sCheckIn);
          if (sCi !== ciStr) continue;
          if (!best.guestCount && staffMap.guestCount >= 0) {
            var sa = staffMap.guestCount >= 0 ? extractGuestCount_(String(staffRows[k][staffMap.guestCount] || '')) : '';
            var si = staffMap.guestCountInfants >= 0 ? extractGuestCount_(String(staffRows[k][staffMap.guestCountInfants] || '')) : '';
            var sForm = (sa || si) ? (sa ? '大人' + sa + '名' : '') + (si ? (sa ? '、' : '') + '3歳以下' + si + '名' : '') : '';
            if (sForm) best.guestCount = '－（' + sForm + '）';
          }
          if (!best.bbq && staffMap.bbq >= 0) {
            var sb = String(staffRows[k][staffMap.bbq] || '').trim();
            if (sb) best.bbq = sb;
          }
          if (!best.bedCount && staffMap.bedCount >= 0) {
            var sBed = String(staffRows[k][staffMap.bedCount] || '').trim();
            if (sBed) best.bedCount = sBed;
          }
          break;
        }
      }
    }
  }
  return best;
}

/**
 * 次回予約が取得できない場合の原因調査用（スクリプトエディタで実行）
 * 例: Logger.log( getNextReservationDebug(5) );  // 5行目の予約について診断
 */
function getNextReservationDebug(bookingRowNumber) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var formSheet = ss.getSheetByName(SHEET_NAME);
    var staffSheet = ss.getSheetByName(SHEET_STAFF_SHARE);
    var out = { bookingRow: bookingRowNumber, formExists: !!formSheet, staffShareExists: !!staffSheet };
    if (!formSheet || formSheet.getLastRow() < bookingRowNumber) {
      out.error = 'フォームシートまたは指定行がありません';
      return JSON.stringify(out, null, 2);
    }
    var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    var colMap = buildColumnMap(headers);
    if (colMap.checkIn < 0 || colMap.checkOut < 0) colMap = buildColumnMapFromSource_(headers);
    out.colMap = { checkIn: colMap.checkIn, checkOut: colMap.checkOut, guestCount: colMap.guestCount };
    var row = formSheet.getRange(bookingRowNumber, 1, 1, formSheet.getLastColumn()).getValues()[0];
    var checkOutVal = colMap.checkOut >= 0 ? row[colMap.checkOut] : null;
    var cleaningDate = checkOutVal ? (checkOutVal instanceof Date ? Utilities.formatDate(checkOutVal, 'Asia/Tokyo', 'yyyy-MM-dd') : (toDateKeySafe_(parseDate(checkOutVal) || checkOutVal) || String(checkOutVal))) : '';
    out.cleaningDateRaw = String(checkOutVal);
    out.cleaningDateNorm = cleaningDate;
    var data = formSheet.getRange(2, 1, formSheet.getLastRow(), formSheet.getLastColumn()).getValues();
    var candidates = [];
    for (var i = 0; i < data.length; i++) {
      var rn = i + 2;
      if (rn === bookingRowNumber) continue;
      var r = data[i];
      var ciVal = colMap.checkIn >= 0 ? r[colMap.checkIn] : null;
      var coVal = colMap.checkOut >= 0 ? r[colMap.checkOut] : null;
      var ci = parseDate(ciVal);
      var ciStr = ci ? toDateKeySafe_(ci) : '';
      var pass = ciStr && ciStr >= cleaningDate;
      candidates.push({ row: rn, checkInRaw: String(ciVal).slice(0, 30), checkInNorm: ciStr, pass: pass });
    }
    out.candidates = candidates;
    var nextRes = getNextReservationAfterCheckout_(formSheet, colMap, cleaningDate, bookingRowNumber, ss);
    out.nextResFound = !!nextRes;
    out.nextRes = nextRes;
    return JSON.stringify(out, null, 2);
  } catch (e) {
    return JSON.stringify({ error: e.toString() }, null, 2);
  }
}

/**
 * 募集詳細用に予約の情報を取得（清掃日・次回予約情報）
 * 次回予約＝清掃日（今回のチェックアウト）以降にチェックインする予約
 * @param {number} bookingRowNumber - 予約行
 * @param {number} [recruitRowIndex] - 募集行（あれば保存済みの詳細を優先）
 */
function getBookingDetailsForRecruit(bookingRowNumber, recruitRowIndex) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = ss.getSheetByName(SHEET_NAME);
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    var dateStr = '', guestCount = '', bbq = '', nationality = '日本', memo = '', bedCount = '', cleaningDate = '', cleaningStaff = '';
    if (recruitRowIndex && recruitSheet && recruitSheet.getLastRow() >= recruitRowIndex) {
      ensureRecruitDetailColumns_();
      var maxRecruitCol = Math.max(recruitSheet.getLastColumn(), 15);
      var recruitRow = recruitSheet.getRange(recruitRowIndex, 1, 1, maxRecruitCol).getValues()[0];
      var rawDate = recruitRow[0];
      cleaningDate = rawDate ? (rawDate instanceof Date ? Utilities.formatDate(rawDate, 'Asia/Tokyo', 'yyyy-MM-dd') : toDateKeySafe_(rawDate) || String(rawDate).trim()) : '';
      cleaningStaff = String(recruitRow[4] || '').trim();
      if (String(recruitRow[9] || '').trim() || String(recruitRow[10] || '').trim() || String(recruitRow[11] || '').trim() || String(recruitRow[12] || '').trim() || String(recruitRow[13] || '').trim() || String(recruitRow[14] || '').trim()) {
        dateStr = String(recruitRow[9] || '').trim();
        guestCount = String(recruitRow[10] || '').trim();
        bbq = String(recruitRow[11] || '').trim();
        nationality = String(recruitRow[12] || '').trim() || '日本';
        memo = String(recruitRow[13] || '').trim();
        bedCount = String(recruitRow[14] || '').trim();
      }
    }
    if (formSheet && formSheet.getLastRow() >= bookingRowNumber) {
      const headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
      var colMap = buildColumnMap(headers);
      if (colMap.checkIn < 0 || colMap.checkOut < 0) colMap = buildColumnMapFromSource_(headers);
      const row = formSheet.getRange(bookingRowNumber, 1, 1, formSheet.getLastColumn()).getValues()[0];
      if (!cleaningDate) {
        var checkOut = colMap.checkOut >= 0 ? row[colMap.checkOut] : null;
        cleaningDate = checkOut ? (checkOut instanceof Date ? Utilities.formatDate(checkOut, 'Asia/Tokyo', 'yyyy-MM-dd') : (toDateKeySafe_(checkOut) || String(checkOut).trim())) : '';
      }
      if (!cleaningStaff && colMap.cleaningStaff >= 0) cleaningStaff = String(row[colMap.cleaningStaff] || '').trim();
      var cd = cleaningDate || '';
      var normCleaningDate = cd.match(/^\d{4}-\d{2}-\d{2}$/) ? cd : (toDateKeySafe_(parseDate(cd) || cd) || cd);
      var nextRes = getNextReservationAfterCheckout_(formSheet, colMap, normCleaningDate, bookingRowNumber, ss);
      if (nextRes) {
        if (!dateStr) dateStr = nextRes.dateRange || nextRes.date || '';
        if (!guestCount) guestCount = nextRes.guestCount || '';
        if (!bbq) bbq = nextRes.bbq || '';
        if (!nationality) nationality = nextRes.nationality || '日本';
        if (!memo) memo = nextRes.memo || '';
        if (!bedCount) bedCount = nextRes.bedCount || '';
      }
    }
    return JSON.stringify({ success: true, cleaningDate: cleaningDate, cleaningStaff: cleaningStaff, nextReservation: { date: dateStr, guestCount: guestCount, bbq: bbq, nationality: nationality, memo: memo, bedCount: bedCount } });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 募集詳細を保存（新規作成または更新）
 */
function saveRecruitmentDetail(recruitRowIndexOrNull, bookingRowNumber, checkoutDateStr, detail) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureRecruitDetailColumns_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!sheet) return JSON.stringify({ success: false, error: 'シートが見つかりません。' });
    if (recruitRowIndexOrNull) {
      if (sheet.getLastRow() < recruitRowIndexOrNull) return JSON.stringify({ success: false, error: '募集が見つかりません。' });
      if (detail.notifyMethod) sheet.getRange(recruitRowIndexOrNull, 9).setValue(detail.notifyMethod);
      sheet.getRange(recruitRowIndexOrNull, 10).setValue(detail.date || '');
      sheet.getRange(recruitRowIndexOrNull, 11).setValue(detail.guestCount || '');
      sheet.getRange(recruitRowIndexOrNull, 12).setValue(detail.bbq || '');
      sheet.getRange(recruitRowIndexOrNull, 13).setValue(detail.nationality || '');
      sheet.getRange(recruitRowIndexOrNull, 14).setValue(detail.memo || '');
      sheet.getRange(recruitRowIndexOrNull, 15).setValue(detail.bedCount || '');
      var staffVal = (detail.cleaningStaff || '').trim();
      sheet.getRange(recruitRowIndexOrNull, 5).setValue(staffVal);
      if (staffVal) sheet.getRange(recruitRowIndexOrNull, 4).setValue('選定済');
      var formSheet = ss.getSheetByName(SHEET_NAME);
      if (formSheet && bookingRowNumber && formSheet.getLastRow() >= bookingRowNumber) {
        var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
        var colMap = buildColumnMap(headers);
        if (colMap.cleaningStaff >= 0) formSheet.getRange(bookingRowNumber, colMap.cleaningStaff + 1).setValue(staffVal);
      }
      return JSON.stringify({ success: true, rowIndex: recruitRowIndexOrNull });
    }
    var rows = sheet.getRange(2, 1, Math.max(sheet.getLastRow(), 1), 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (Number(rows[i][1]) === bookingRowNumber) return JSON.stringify({ success: true, alreadyExists: true, rowIndex: i + 2 });
    }
    var nextRow = sheet.getLastRow() + 1;
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    var staffVal = (detail.cleaningStaff || '').trim();
    var status = staffVal ? '選定済' : '募集中';
    ensureRecruitDetailColumns_();
    sheet.getRange(nextRow, 1, 1, 15).setValues([[checkoutDateStr, bookingRowNumber, '', status, staffVal, '', now, '', detail.notifyMethod || 'メール', detail.date || '', detail.guestCount || '', detail.bbq || '', detail.nationality || '', detail.memo || '', detail.bedCount || '']]);
    if (staffVal) {
      var formSheet = ss.getSheetByName(SHEET_NAME);
      if (formSheet && bookingRowNumber && formSheet.getLastRow() >= bookingRowNumber) {
        var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
        var colMap = buildColumnMap(headers);
        if (colMap.cleaningStaff >= 0) formSheet.getRange(bookingRowNumber, colMap.cleaningStaff + 1).setValue(staffVal);
      }
    }
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 募集を一覧から削除（取消）
 */
function deleteRecruitment(recruitRowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    const formSheet = ss.getSheetByName(SHEET_NAME);
    if (!recruitSheet || recruitSheet.getLastRow() < recruitRowIndex) return JSON.stringify({ success: false, error: '募集が見つかりません。' });
    var bookingRow = recruitSheet.getRange(recruitRowIndex, 2).getValue();
    if (formSheet && bookingRow && formSheet.getLastRow() >= bookingRow) {
      var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
      var colMap = buildColumnMap(headers);
      if (colMap.cleaningStaff >= 0) formSheet.getRange(bookingRow, colMap.cleaningStaff + 1).setValue('');
    }
    if (volSheet && volSheet.getLastRow() >= 2) {
      var volData = volSheet.getRange(2, 1, volSheet.getLastRow(), 1).getValues();
      for (var v = volData.length - 1; v >= 0; v--) {
        if (String(volData[v][0]).trim() === 'r' + recruitRowIndex) volSheet.deleteRow(v + 2);
      }
    }
    recruitSheet.deleteRow(recruitRowIndex);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 募集のLINE用コピーテキストを取得
 * @param {string} checkoutDateStr - チェックアウト日
 * @param {number} bookingRowNumber - 予約行番号
 * @param {Object} [detail] - 次回予約の情報（省略時はフォーム/募集から取得）
 */
function getRecruitmentCopyText(checkoutDateStr, bookingRowNumber, detail) {
  try {
    // detail に有効な情報があるか（nationality デフォルト値のみは除外）
    var hasDetail = detail && (detail.date || detail.guestCount || detail.bbq);
    var nextRes = hasDetail ? detail : null;
    if (!nextRes) {
      var detStr = getBookingDetailsForRecruit(bookingRowNumber, null);
      var det = JSON.parse(detStr);
      if (det.success && det.nextReservation) nextRes = det.nextReservation;
    }
    var appUrl = '';
    try {
      var stored = PropertiesService.getDocumentProperties().getProperty('staffDeployUrl');
      if (stored && String(stored).trim()) {
        appUrl = String(stored).trim();
      } else {
        appUrl = ScriptApp.getService().getUrl();
        if (appUrl && appUrl.indexOf('staff=1') < 0 && appUrl.indexOf('staff=true') < 0) appUrl = appUrl + (appUrl.indexOf('?') >= 0 ? '&' : '?') + 'staff=1';
      }
    } catch (e) {}
    var copyText = buildRecruitmentCopyText_(checkoutDateStr, nextRes, appUrl);
    return JSON.stringify({ success: true, copyText: copyText });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 募集がまだ作成されていない予約一覧を取得（手動追加用）
 * @param {string} [sortOrder] - 'asc' 昇順 / 'desc' 降順（デフォルト）
 */
function getBookingsWithoutRecruitment(sortOrder) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。', list: [] });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = ss.getSheetByName(SHEET_NAME);
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!formSheet || formSheet.getLastRow() < 2) return JSON.stringify({ success: true, list: [] });
    const headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    var colMap = buildColumnMap(headers);
    if (colMap.checkOut < 0) colMap = buildColumnMapFromSource_(headers);
    if (colMap.checkOut < 0) return JSON.stringify({ success: true, list: [] });
    const existingRowNumbers = [];
    if (recruitSheet && recruitSheet.getLastRow() >= 2) {
      const numRows = recruitSheet.getLastRow() - 1;
      const recruitRows = recruitSheet.getRange(2, 2, numRows, 1).getValues();
      recruitRows.forEach(function(r) { existingRowNumbers.push(Number(r[0]) || 0); });
    }
    const data = formSheet.getRange(2, 1, formSheet.getLastRow(), formSheet.getLastColumn()).getValues();
    const list = [];
    for (var i = 0; i < data.length; i++) {
      const rowNum = i + 2;
      if (existingRowNumbers.indexOf(rowNum) > -1) continue;
      const row = data[i];
      const checkOutVal = row[colMap.checkOut];
      const checkOut = parseDate(checkOutVal);
      if (!checkOut) continue;
      const checkoutStr = toDateKeySafe_(checkOut);
      const guestName = colMap.guestName >= 0 ? String(row[colMap.guestName] || '').trim() : '';
      var dateStr = '', guestCount = '', bbq = '', nationality = '日本', bedCount = '';
      var nextRes = getNextReservationAfterCheckout_(formSheet, colMap, checkoutStr, rowNum, ss);
      if (nextRes) {
        dateStr = nextRes.date || '';
        guestCount = nextRes.guestCount || '';
        bbq = nextRes.bbq || '';
        nationality = nextRes.nationality || '日本';
        bedCount = nextRes.bedCount || '';
      }
      list.push({
        rowNumber: rowNum,
        checkoutDate: checkoutStr,
        guestName: guestName,
        reserveDate: dateStr,
        reserveGuestCount: guestCount,
        reserveBBQ: bbq,
        reserveNationality: nationality,
        reserveBedCount: bedCount
      });
    }
    var desc = (sortOrder || 'desc').toLowerCase() !== 'asc';
    list.sort(function(a, b) {
      var c = (a.checkoutDate || '').localeCompare(b.checkoutDate || '');
      return desc ? -c : c;
    });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), list: [] });
  }
}

/**
 * 手動で募集を追加（オーナーのみ）
 */
function addRecruitmentManually(bookingRowNumber, checkoutDateStr) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    return createRecruitmentForBooking(bookingRowNumber, checkoutDateStr);
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function buildRecruitmentCopyText_(checkoutDateStr, nextReservation, appUrl) {
  // 作業日のフォーマット: YYYY-MM-DD → YYYY年MM月DD日
  var fmtDate = (checkoutDateStr || '－');
  var dm = fmtDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dm) fmtDate = dm[1] + '年' + ('0' + dm[2]).slice(-2) + '月' + ('0' + dm[3]).slice(-2) + '日';

  var lines = ['清掃募集', '', '作業日: ' + fmtDate, ''];
  lines.push('次回予約の情報（変更の可能性あり）:');
  var hasContent = false;
  if (nextReservation) {
    if (nextReservation.date) { var nd = nextReservation.date; var ndm = nd.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (ndm) nd = ndm[1] + '年' + ('0' + ndm[2]).slice(-2) + '月' + ('0' + ndm[3]).slice(-2) + '日'; lines.push('・チェックイン: ' + nd); hasContent = true; }
    if (nextReservation.guestCount) { lines.push('・人数: ' + nextReservation.guestCount); hasContent = true; }
    if (nextReservation.bbq) { lines.push('・BBQ: ' + nextReservation.bbq); hasContent = true; }
    if (nextReservation.nationality) { lines.push('・国籍: ' + nextReservation.nationality); hasContent = true; }
    if (nextReservation.bedCount) { lines.push('・ベッド数: ' + nextReservation.bedCount); hasContent = true; }
  }
  if (!hasContent) lines.push('・（未確定）');
  lines.push('');
  lines.push('※予約状況次第では変更となる場合があります。');
  lines.push('');
  if (appUrl) lines.push('Webアプリで立候補: ' + appUrl);
  return lines.join('\n');
}

function createRecruitmentForBooking(bookingRowNumber, checkoutDateStr) {
  try {
    ensureSheetsExist();
    ensureRecruitNotifyMethodColumn_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_RECRUIT);
    const rows = sheet.getRange(2, 1, Math.max(sheet.getLastRow(), 1), 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      const rowNum = rows[i][1] ? Number(rows[i][1]) : 0;
      if (rowNum === bookingRowNumber) {
        return JSON.stringify({ success: true, alreadyExists: true });
      }
    }
    const nextRow = sheet.getLastRow() + 1;
    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    ensureRecruitDetailColumns_();
    sheet.getRange(nextRow, 1, 1, 15).setValues([[checkoutDateStr, bookingRowNumber, '', '募集中', '', '', now, '', 'メール', '', '', '', '', '', '']]);
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function notifyStaffForRecruitment(recruitRowIndex, checkoutDateStr, bookingRowNumber) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const staffSheet = ss.getSheetByName(SHEET_STAFF);
    if (!staffSheet || staffSheet.getLastRow() < 2) return;
    const emails = [];
    const data = staffSheet.getRange(2, 3, staffSheet.getLastRow(), 3).getValues();
    data.forEach(function(row) {
      const e = String(row[0] || '').trim();
      if (e) emails.push(e);
    });
    if (emails.length === 0) return;
    // 次回予約情報を取得してメール本文に含める
    var nextRes = null;
    try {
      var detStr = getBookingDetailsForRecruit(bookingRowNumber, recruitRowIndex);
      var det = JSON.parse(detStr);
      if (det.success && det.nextReservation) nextRes = det.nextReservation;
    } catch (er) {}
    var appUrl = '';
    try {
      var stored = PropertiesService.getDocumentProperties().getProperty('staffDeployUrl');
      if (stored && String(stored).trim()) appUrl = String(stored).trim();
      else { appUrl = ScriptApp.getService().getUrl(); if (appUrl && appUrl.indexOf('staff=1') < 0) appUrl += (appUrl.indexOf('?') >= 0 ? '&' : '?') + 'staff=1'; }
    } catch (er) {}
    var body = buildRecruitmentCopyText_(checkoutDateStr, nextRes, appUrl);
    var dm = (checkoutDateStr || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    var fmtDate = dm ? dm[1] + '年' + ('0' + dm[2]).slice(-2) + '月' + ('0' + dm[3]).slice(-2) + '日' : checkoutDateStr;
    const subject = '【民泊】清掃スタッフ募集: ' + fmtDate;
    GmailApp.sendEmail(emails.join(','), subject, body);
  } catch (e) {
    Logger.log('notifyStaffForRecruitment: ' + e.toString());
  }
}

/**
 * スタッフ選択用に名前・メール一覧を取得（権限不要・Execute as Me時の立候補用）
 */
/**
 * スタッフの出勤キャンセル要望を送信（オーナーに通知・メール）
 */
function submitStaffCancelRequest(recruitRowIndex, bookingRowNumber, checkoutDateStr, staffName, staffEmail) {
  try {
    ensureSheetsExist();
    var staff = (staffName || '').trim() || (staffEmail || '').trim() || 'スタッフ';
    var dateStr = (checkoutDateStr || '').toString().trim() || '';
    var rid = 'r' + recruitRowIndex;
    // 最優先: シートへの書き込み（最速で完了させる）
    var crSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CANCEL_REQUESTS);
    if (crSheet) {
      var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
      crSheet.appendRow([rid, staffName || staff, staffEmail || '', now]);
    }
    SpreadsheetApp.flush();
    // 通知（シート書き込み）
    try { addNotification_('出勤キャンセル要望', dateStr + ': ' + staff + ' が出勤キャンセルの要望を提出しました', { bookingRowNumber: Number(bookingRowNumber) || 0, checkoutDate: dateStr }); } catch (ne) {}
    // メール送信（最も遅い処理 - 失敗しても成功扱い）
    try {
      var ownerRes = JSON.parse(getOwnerEmail());
      var ownerEmail = (ownerRes && ownerRes.email) ? String(ownerRes.email).trim() : '';
      if (ownerEmail) {
        var subject = '【民泊】清掃スタッフの出勤キャンセル要望: ' + dateStr;
        var body = '以下のスタッフが出勤キャンセルの要望を提出しました。\n\n日付: ' + dateStr + '\nスタッフ: ' + staff + '\n\n折り返しご連絡ください。';
        GmailApp.sendEmail(ownerEmail, subject, body);
      }
    } catch (mailErr) {}
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * オーナーがキャンセル申請を承認
 * → cleaningStaff削除、募集状態に戻す、ボランティアレコード削除、申請レコード削除、スタッフに通知
 */
function approveCancelRequest(recruitRowIndex, staffName, staffEmail) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    var formSheet = ss.getSheetByName(SHEET_NAME);
    var volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    var crSheet = ss.getSheetByName(SHEET_CANCEL_REQUESTS);
    if (!recruitSheet || !formSheet) return JSON.stringify({ success: false, error: 'シートが見つかりません。' });

    // 募集シートのステータスを '募集中' に戻し、選定スタッフをクリア
    recruitSheet.getRange(recruitRowIndex, 4).setValue('募集中');
    recruitSheet.getRange(recruitRowIndex, 5).setValue('');

    // メインシートの cleaningStaff をクリア（重複行も含めて全行）
    var bookingRowNumber = Number(recruitSheet.getRange(recruitRowIndex, 2).getValue());
    if (bookingRowNumber >= 2) {
      var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
      var colMap = buildColumnMap(headers);
      if (colMap.cleaningStaff >= 0) {
        formSheet.getRange(bookingRowNumber, colMap.cleaningStaff + 1).setValue('');
        SpreadsheetApp.flush();
        // 同一チェックイン日の重複行もクリア（無条件）
        if (colMap.checkIn >= 0) {
          var targetCi = toDateKeySafe_(formSheet.getRange(bookingRowNumber, colMap.checkIn + 1).getValue());
          if (targetCi) {
            var allData = formSheet.getRange(2, 1, formSheet.getLastRow() - 1, formSheet.getLastColumn()).getValues();
            for (var di = 0; di < allData.length; di++) {
              if ((di + 2) === bookingRowNumber) continue;
              var rowCi = toDateKeySafe_(allData[di][colMap.checkIn]);
              if (rowCi === targetCi) {
                formSheet.getRange(di + 2, colMap.cleaningStaff + 1).setValue('');
              }
            }
          }
        }
      }
    }
    SpreadsheetApp.flush();

    // ボランティアレコードを削除（該当スタッフのみ）
    var rid = 'r' + recruitRowIndex;
    var sName = (staffName || '').trim();
    var sEmail = (staffEmail || '').trim().toLowerCase();
    if (volSheet && volSheet.getLastRow() >= 2) {
      var volData = volSheet.getRange(2, 1, volSheet.getLastRow(), 4).getValues();
      for (var i = volData.length - 1; i >= 0; i--) {
        if (String(volData[i][0]).trim() !== rid) continue;
        var matchName = sName && String(volData[i][1] || '').trim() === sName;
        var matchEmail = sEmail && String(volData[i][2] || '').trim().toLowerCase() === sEmail;
        if (matchName || matchEmail) {
          volSheet.deleteRow(i + 2);
          break;
        }
      }
    }

    // キャンセル申請レコードを削除
    if (crSheet && crSheet.getLastRow() >= 2) {
      var crData = crSheet.getRange(2, 1, crSheet.getLastRow(), 4).getValues();
      for (var j = crData.length - 1; j >= 0; j--) {
        if (String(crData[j][0]).trim() !== rid) continue;
        var crMatchName = sName && String(crData[j][1] || '').trim() === sName;
        var crMatchEmail = sEmail && String(crData[j][2] || '').trim().toLowerCase() === sEmail;
        if (crMatchName || crMatchEmail) {
          crSheet.deleteRow(j + 2);
          break;
        }
      }
    }

    // 通知を追加
    var checkoutCell = recruitSheet.getRange(recruitRowIndex, 1).getValue();
    var checkoutStr = checkoutCell ? (checkoutCell instanceof Date ? Utilities.formatDate(checkoutCell, 'Asia/Tokyo', 'yyyy-MM-dd') : String(checkoutCell)) : '';
    addNotification_('キャンセル承認', checkoutStr + ': ' + (sName || sEmail) + ' のキャンセルを承認しました');

    // スタッフにメール通知
    if (sEmail) {
      try {
        var subject = '【民泊】出勤キャンセルが承認されました: ' + checkoutStr;
        var body = sName + ' 様\n\n' + checkoutStr + ' の出勤キャンセルが承認されました。\n清掃担当は解除されています。\n\nご確認ください。';
        GmailApp.sendEmail(sEmail, subject, body);
      } catch (mailErr) {}
    }

    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * オーナーがキャンセル申請を却下（申請レコードを削除し、スタッフに通知）
 */
function rejectCancelRequest(recruitRowIndex, staffName, staffEmail) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var crSheet = ss.getSheetByName(SHEET_CANCEL_REQUESTS);
    var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    var rid = 'r' + recruitRowIndex;
    var sName = (staffName || '').trim();
    var sEmail = (staffEmail || '').trim().toLowerCase();

    // キャンセル申請レコードを 'rejected' にマーク（5列目）
    if (crSheet && crSheet.getLastRow() >= 2) {
      var lastCol = crSheet.getLastColumn();
      if (lastCol < 5) { crSheet.getRange(1, 5).setValue('ステータス'); lastCol = 5; }
      var crData = crSheet.getRange(2, 1, crSheet.getLastRow() - 1, 5).getValues();
      for (var j = 0; j < crData.length; j++) {
        if (String(crData[j][0]).trim() !== rid) continue;
        var m1 = sName && String(crData[j][1] || '').trim() === sName;
        var m2 = sEmail && String(crData[j][2] || '').trim().toLowerCase() === sEmail;
        if (m1 || m2) { crSheet.getRange(j + 2, 5).setValue('rejected'); break; }
      }
    }

    var checkoutCell = recruitSheet ? recruitSheet.getRange(recruitRowIndex, 1).getValue() : null;
    var checkoutStr = checkoutCell ? (checkoutCell instanceof Date ? Utilities.formatDate(checkoutCell, 'Asia/Tokyo', 'yyyy-MM-dd') : String(checkoutCell)) : '';
    addNotification_('キャンセル却下', checkoutStr + ': ' + (sName || sEmail) + ' のキャンセル申請を却下しました');

    // スタッフにメール通知
    if (sEmail) {
      try {
        var subject = '【民泊】出勤キャンセルが却下されました: ' + checkoutStr;
        var body = sName + ' 様\n\n' + checkoutStr + ' の出勤キャンセルは承認されませんでした。\n予定通りご出勤ください。\n\nご不明な点がございましたらご連絡ください。';
        GmailApp.sendEmail(sEmail, subject, body);
      } catch (mailErr) {}
    }

    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * スタッフがキャンセル否認を確認後、rejectedレコードを削除してボタンを復活させる
 */
function clearCancelRejection(recruitRowIndex, staffName, staffEmail) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var crSheet = ss.getSheetByName(SHEET_CANCEL_REQUESTS);
    if (!crSheet || crSheet.getLastRow() < 2) return JSON.stringify({ success: true });
    var rid = 'r' + recruitRowIndex;
    var sName = (staffName || '').trim();
    var sEmail = (staffEmail || '').trim().toLowerCase();
    var crData = crSheet.getRange(2, 1, crSheet.getLastRow() - 1, Math.max(crSheet.getLastColumn(), 5)).getValues();
    for (var j = crData.length - 1; j >= 0; j--) {
      if (String(crData[j][0]).trim() !== rid) continue;
      var status = String(crData[j][4] || '').trim();
      if (status !== 'rejected') continue;
      var m1 = sName && String(crData[j][1] || '').trim() === sName;
      var m2 = sEmail && String(crData[j][2] || '').trim().toLowerCase() === sEmail;
      if (m1 || m2) { crSheet.deleteRow(j + 2); break; }
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function getStaffNamesForSelection() {
  try {
    ensureSheetsExist();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STAFF);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: true, list: [] });
    const lastCol = Math.max(sheet.getLastColumn(), 9);
    const rows = sheet.getRange(2, 1, sheet.getLastRow(), lastCol).getValues();
    const list = rows
      .map(function(row) {
        var name = String(row[0] || '').trim();
        var email = String(row[2] || '').trim();
        var active = lastCol >= 9 ? String(row[8] || 'Y').trim() : 'Y';
        if (active === 'N') return null;
        return (name || email) ? { name: name || email, email: email } : null;
      })
      .filter(Boolean);
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, list: [], error: e.toString() });
  }
}

/**
 * スタッフの出勤予定一覧を取得（スタッフ本人用）
 * @param {string} staffIdentifier - スタッフ名またはメール
 * @param {string} yearMonth - YYYY-MM
 */
function getStaffSchedule(staffIdentifier, yearMonth) {
  try {
    if (!staffIdentifier || typeof staffIdentifier !== 'string') return JSON.stringify({ success: false, list: [] });
    var staff = String(staffIdentifier).trim().toLowerCase();
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = ss.getSheetByName(SHEET_NAME);
    if (!formSheet || formSheet.getLastRow() < 2) return JSON.stringify({ success: true, list: [] });
    const headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    const colMap = buildColumnMap(headers);
    if (colMap.checkOut < 0 || colMap.cleaningStaff < 0) return JSON.stringify({ success: true, list: [] });
    const data = formSheet.getRange(2, 1, formSheet.getLastRow(), formSheet.getLastColumn()).getValues();
    var list = [];
    var ym = yearMonth || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
    var ymParts = ym.split('-');
    var targetYear = parseInt(ymParts[0], 10) || new Date().getFullYear();
    var targetMonth = parseInt(ymParts[1], 10) || (new Date().getMonth() + 1);
    for (var i = 0; i < data.length; i++) {
      var cleaningStaff = String(data[i][colMap.cleaningStaff] || '').trim();
      if (!cleaningStaff) continue;
      var names = cleaningStaff.split(/[,、]/).map(function(n) { return n.trim(); }).filter(Boolean);
      var isAssigned = names.some(function(n) {
        return n.toLowerCase() === staff || (n.indexOf('@') >= 0 && n.toLowerCase() === staff);
      });
      if (!isAssigned) continue;
      var partners = names.filter(function(n) {
        return n.toLowerCase() !== staff && (n.indexOf('@') < 0 || n.toLowerCase() !== staff);
      });
      var checkOutVal = data[i][colMap.checkOut];
      var checkOut = parseDate(checkOutVal);
      if (!checkOut) continue;
      var d = new Date(checkOut);
      if (d.getFullYear() !== targetYear || (d.getMonth() + 1) !== targetMonth) continue;
      list.push({
        rowNumber: i + 2,
        checkoutDate: toDateKeySafe_(checkOut),
        checkoutDisplay: Utilities.formatDate(checkOut, 'Asia/Tokyo', 'M/d'),
        partners: partners,
        guestName: colMap.guestName >= 0 ? String(data[i][colMap.guestName] || '').trim() : ''
      });
    }
    list.sort(function(a, b) { return (a.checkoutDate || '').localeCompare(b.checkoutDate || ''); });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, list: [], error: e.toString() });
  }
}

/**
 * スタッフが自分の出勤を取り消す
 */
function cancelStaffFromCleaning(bookingRowNumber, staffIdentifier) {
  try {
    if (!staffIdentifier || !bookingRowNumber) return JSON.stringify({ success: false, error: 'パラメータが不足しています' });
    var staff = String(staffIdentifier).trim();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = ss.getSheetByName(SHEET_NAME);
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!formSheet || formSheet.getLastRow() < parseInt(bookingRowNumber, 10)) return JSON.stringify({ success: false, error: '予約が見つかりません' });
    const headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    const colMap = buildColumnMap(headers);
    if (colMap.cleaningStaff < 0) return JSON.stringify({ success: false, error: '清掃担当列が見つかりません' });
    var rowNum = parseInt(bookingRowNumber, 10);
    var current = String(formSheet.getRange(rowNum, colMap.cleaningStaff + 1).getValue() || '').trim();
    var names = current.split(/[,、]/).map(function(n) { return n.trim(); }).filter(Boolean);
    var staffLower = staff.toLowerCase();
    var remaining = names.filter(function(n) {
      return n.toLowerCase() !== staffLower && (n.indexOf('@') < 0 || n.toLowerCase() !== staffLower);
    });
    if (remaining.length === names.length) return JSON.stringify({ success: false, error: 'あなたはこの清掃の担当に含まれていません' });
    formSheet.getRange(rowNum, colMap.cleaningStaff + 1).setValue(remaining.join(', '));
    if (recruitSheet && recruitSheet.getLastRow() >= 2 && recruitSheet.getLastColumn() >= 5) {
      var recruitRows = recruitSheet.getRange(2, 1, recruitSheet.getLastRow(), 5).getValues();
      for (var i = 0; i < recruitRows.length; i++) {
        if (Number(recruitRows[i][1]) === rowNum) {
          recruitSheet.getRange(i + 2, 5).setValue(remaining.join(', '));
          break;
        }
      }
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function getInvoiceFolderId() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false });
    var id = PropertiesService.getDocumentProperties().getProperty('invoiceFolderId') || '';
    return JSON.stringify({ success: true, folderId: id });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function setInvoiceFolderId(folderId) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ設定できます' });
    var id = (folderId || '').trim();
    if (id) {
      var match = id.match(/[a-zA-Z0-9_-]{20,}/);
      if (match) id = match[0];
    }
    PropertiesService.getDocumentProperties().setProperty('invoiceFolderId', id);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * スタッフの請求書を作成してDriveに保存
 */
function createStaffInvoice(yearMonth, staffIdentifier, folderIdFromClient) {
  try {
    if (!staffIdentifier) return JSON.stringify({ success: false, error: 'スタッフを特定できません' });
    var folderId = (folderIdFromClient || '').trim() || PropertiesService.getDocumentProperties().getProperty('invoiceFolderId') || '';
    if (!folderId) return JSON.stringify({ success: false, error: 'オーナーが請求書の保存先フォルダを設定していません。オーナーに設定を依頼してください。' });
    var scheduleRes = JSON.parse(getStaffSchedule(staffIdentifier, yearMonth));
    if (!scheduleRes.success || !scheduleRes.list) return JSON.stringify({ success: false, error: '出勤データの取得に失敗しました' });
    var list = scheduleRes.list || [];
    var lines = ['請求書', yearMonth, '', 'スタッフ: ' + staffIdentifier, '清掃作業: ' + list.length + '回', ''];
    list.forEach(function(item) {
      lines.push(item.checkoutDisplay + ' ' + (item.partners && item.partners.length ? '(相方: ' + item.partners.join(', ') + ')' : ''));
    });
    var content = lines.join('\n');
    var fileName = '請求書_' + staffIdentifier.replace(/[,、\s]/g, '_') + '_' + yearMonth + '.txt';
    var folder = DriveApp.getFolderById(folderId);
    var file = folder.createFile(fileName, content, MimeType.PLAIN_TEXT);
    return JSON.stringify({ success: true, fileId: file.getId(), fileName: fileName });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * ログインユーザーが清掃スタッフリストにいれば名前を返す（立候補用）
 */
function getMyStaffName() {
  try {
    const email = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    if (!email) return JSON.stringify({ success: true, name: '' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_STAFF);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: true, name: '' });
    const data = sheet.getRange(2, 1, sheet.getLastRow(), 3).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][2] || '').trim().toLowerCase() === email) {
        return JSON.stringify({ success: true, name: String(data[i][0] || '').trim() });
      }
    }
    return JSON.stringify({ success: true, name: '' });
  } catch (e) {
    return JSON.stringify({ success: false, name: '', error: e.toString() });
  }
}

function volunteerForRecruitment(recruitId, staffNameFromClient, staffEmailFromClient, staffMemoFromClient) {
  try {
    ensureSheetsExist();
    ensureVolunteerMemoColumn_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const recruitRowIndex = parseInt(String(recruitId).replace('r', ''), 10);
    if (isNaN(recruitRowIndex) || recruitRowIndex < 2) {
      return JSON.stringify({ success: false, error: '無効な募集ID' });
    }
    const status = recruitSheet.getRange(recruitRowIndex, 4).getValue();
    if (String(status).trim() === '選定済') {
      return JSON.stringify({ success: false, error: 'この募集は選定済みです' });
    }
    var staffEmail = (staffEmailFromClient || Session.getActiveUser().getEmail() || '').trim();
    var staffName = (staffNameFromClient || '').trim();
    var staffMemo = (staffMemoFromClient || '').trim();
    if (!staffName && staffEmail) {
      const nameRes = JSON.parse(getMyStaffName());
      if (nameRes.success && nameRes.name) staffName = nameRes.name;
      else staffName = staffEmail;
    }
    if (!staffName) staffName = '不明';
    const existing = volSheet.getLastRow() >= 2 ? volSheet.getRange(2, 1, volSheet.getLastRow(), 4).getValues() : [];
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0]).trim() === String(recruitId).trim() && (String(existing[i][2]).trim().toLowerCase() === staffEmail.toLowerCase() || String(existing[i][1]).trim() === staffName)) {
        return JSON.stringify({ success: true, already: true });
      }
    }
    const nextRow = volSheet.getLastRow() + 1;
    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    ensureVolunteerStatusColumns_();
    var lastCol = Math.max(volSheet.getLastColumn(), 7);
    volSheet.getRange(nextRow, 1, 1, 4).setValues([[recruitId, staffName, staffEmail, now]]);
    if (lastCol >= 5 && staffMemo) volSheet.getRange(nextRow, 5).setValue(staffMemo);
    if (lastCol >= 6) volSheet.getRange(nextRow, 6).setValue('volunteered');
    var checkoutCell = recruitSheet.getRange(recruitRowIndex, 1).getValue();
    var checkoutStr = checkoutCell ? (checkoutCell instanceof Date ? Utilities.formatDate(checkoutCell, 'Asia/Tokyo', 'yyyy-MM-dd') : String(checkoutCell)) : '';
    addNotification_('立候補', (checkoutStr || recruitId) + ': ' + staffName + ' が立候補しました' + (staffMemo ? '（' + staffMemo + '）' : ''));
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function cancelVolunteerForRecruitment(recruitId, staffNameFromClient, staffEmailFromClient) {
  try {
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const recruitRowIndex = parseInt(String(recruitId).replace('r', ''), 10);
    if (isNaN(recruitRowIndex) || recruitRowIndex < 2) {
      return JSON.stringify({ success: false, error: '無効な募集ID' });
    }
    var staffEmail = (staffEmailFromClient || '').trim().toLowerCase();
    var staffName = (staffNameFromClient || '').trim();
    if (!staffName) staffName = '不明';
    const volData = volSheet.getLastRow() >= 2 ? volSheet.getRange(2, 1, volSheet.getLastRow(), 4).getValues() : [];
    var deleted = false;
    for (var i = volData.length - 1; i >= 0; i--) {
      if (String(volData[i][0]).trim() !== String(recruitId).trim()) continue;
      var match = (staffEmail && String(volData[i][2] || '').trim().toLowerCase() === staffEmail) || String(volData[i][1] || '').trim() === staffName;
      if (match) {
        volSheet.deleteRow(i + 2);
        deleted = true;
        var checkoutCell = recruitSheet.getRange(recruitRowIndex, 1).getValue();
        var checkoutStr = checkoutCell ? (checkoutCell instanceof Date ? Utilities.formatDate(checkoutCell, 'Asia/Tokyo', 'yyyy-MM-dd') : String(checkoutCell)) : '';
        addNotification_('立候補取消', (checkoutStr || recruitId) + ': ' + (volData[i][1] || staffName) + ' が立候補を取り消しました');
        break;
      }
    }
    return JSON.stringify({ success: true, cancelled: deleted });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * スタッフが保留を設定（ボタン押下前に理由を入力）
 */
function holdForRecruitment(recruitId, staffNameFromClient, staffEmailFromClient, holdReasonFromClient) {
  try {
    ensureSheetsExist();
    ensureVolunteerStatusColumns_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const recruitRowIndex = parseInt(String(recruitId).replace('r', ''), 10);
    if (isNaN(recruitRowIndex) || recruitRowIndex < 2) {
      return JSON.stringify({ success: false, error: '無効な募集ID' });
    }
    var status = String(recruitSheet.getRange(recruitRowIndex, 4).getValue()).trim();
    if (status === '選定済') {
      return JSON.stringify({ success: false, error: 'この募集は選定済みです' });
    }
    var staffEmail = (staffEmailFromClient || Session.getActiveUser().getEmail() || '').trim();
    var staffName = (staffNameFromClient || '').trim();
    var holdReason = (holdReasonFromClient || '').trim();
    if (!staffName && staffEmail) {
      var nameRes = JSON.parse(getMyStaffName());
      if (nameRes.success && nameRes.name) staffName = nameRes.name;
      else staffName = staffEmail;
    }
    if (!staffName) staffName = '不明';
    var lastCol = Math.max(volSheet.getLastColumn(), 7);
    var volData = volSheet.getLastRow() >= 2 ? volSheet.getRange(2, 1, volSheet.getLastRow(), lastCol).getValues() : [];
    for (var i = 0; i < volData.length; i++) {
      if (String(volData[i][0]).trim() !== String(recruitId).trim()) continue;
      var match = (staffEmail && String(volData[i][2] || '').trim().toLowerCase() === staffEmail.toLowerCase()) || String(volData[i][1] || '').trim() === staffName;
      if (match) {
        volSheet.getRange(i + 2, 6).setValue('hold');
        if (lastCol >= 7) volSheet.getRange(i + 2, 7).setValue(holdReason);
        var checkoutCell = recruitSheet.getRange(recruitRowIndex, 1).getValue();
        var checkoutStr = checkoutCell ? (checkoutCell instanceof Date ? Utilities.formatDate(checkoutCell, 'Asia/Tokyo', 'yyyy-MM-dd') : String(checkoutCell)) : '';
        addNotification_('保留', (checkoutStr || recruitId) + ': ' + staffName + ' が保留しました' + (holdReason ? '（' + holdReason + '）' : ''));
        return JSON.stringify({ success: true, updated: true });
      }
    }
    var nextRow = volSheet.getLastRow() + 1;
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    volSheet.getRange(nextRow, 1, 1, 4).setValues([[recruitId, staffName, staffEmail, now]]);
    if (lastCol >= 6) volSheet.getRange(nextRow, 6).setValue('hold');
    if (lastCol >= 7 && holdReason) volSheet.getRange(nextRow, 7).setValue(holdReason);
    var checkoutCell = recruitSheet.getRange(recruitRowIndex, 1).getValue();
    var checkoutStr = checkoutCell ? (checkoutCell instanceof Date ? Utilities.formatDate(checkoutCell, 'Asia/Tokyo', 'yyyy-MM-dd') : String(checkoutCell)) : '';
    addNotification_('保留', (checkoutStr || recruitId) + ': ' + staffName + ' が保留しました' + (holdReason ? '（' + holdReason + '）' : ''));
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * カレンダー用：予約行番号ごとの募集ステータス（募集中/選定済）を取得
 */
function getRecruitmentStatusMap() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    const crSheet = ss.getSheetByName(SHEET_CANCEL_REQUESTS);
    var map = {};
    if (!recruitSheet || recruitSheet.getLastRow() < 2) return JSON.stringify({ success: true, map: map });
    ensureRecruitDetailColumns_();
    var recruitLastCol = Math.max(recruitSheet.getLastColumn(), 15);
    var rows = recruitSheet.getRange(2, 1, recruitSheet.getLastRow(), recruitLastCol).getValues();
    var volunteersByRid = {};
    ensureVolunteerStatusColumns_();
    var volLastCol = Math.max(volSheet ? volSheet.getLastColumn() : 4, 7);
    if (volSheet && volSheet.getLastRow() >= 2) {
      var volRows = volSheet.getRange(2, 1, volSheet.getLastRow(), volLastCol).getValues();
      volRows.forEach(function(vr) {
        var rid = String(vr[0] || '').trim();
        if (rid) {
          if (!volunteersByRid[rid]) volunteersByRid[rid] = [];
          var volStatus = String(vr[5] || '').trim() || 'volunteered';
          var holdReason = String(vr[6] || '').trim();
          volunteersByRid[rid].push({
            staffName: String(vr[1] || '').trim(),
            email: String(vr[2] || '').trim(),
            at: String(vr[3] || '').trim(),
            volStatus: volStatus,
            holdReason: holdReason
          });
        }
      });
    }
    var cancelByRid = {};
    if (crSheet && crSheet.getLastRow() >= 2) {
      var crLastCol = Math.max(crSheet.getLastColumn(), 5);
      var crRows = crSheet.getRange(2, 1, crSheet.getLastRow() - 1, crLastCol).getValues();
      crRows.forEach(function(cr) {
        var rid = String(cr[0] || '').trim();
        if (!rid) return;
        var crStatus = String(cr[4] || '').trim();
        if (crStatus === 'rejected') return; // 否認済みは除外
        if (!cancelByRid[rid]) cancelByRid[rid] = [];
        cancelByRid[rid].push({
          staffName: String(cr[1] || '').trim(),
          email: String(cr[2] || '').trim().toLowerCase()
        });
      });
    }

    // フォームシートを一括読み込み（次回予約の一括計算用）
    var formSheet = ss.getSheetByName(SHEET_NAME);
    var formData = null, formColMap = null;
    if (formSheet && formSheet.getLastRow() >= 2) {
      var fHeaders = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
      formColMap = buildColumnMap(fHeaders);
      if (formColMap.checkIn < 0 || formColMap.checkOut < 0) formColMap = buildColumnMapFromSource_(fHeaders);
      formData = formSheet.getRange(2, 1, formSheet.getLastRow(), formSheet.getLastColumn()).getValues();
    }
    // チェックイン日でソート済みの予約一覧を事前構築
    var sortedBookings = [];
    if (formData && formColMap && formColMap.checkIn >= 0) {
      for (var j = 0; j < formData.length; j++) {
        var ci = parseDate(formData[j][formColMap.checkIn]);
        if (!ci) continue;
        var ciStr = toDateKeySafe_(ci);
        if (!ciStr) continue;
        sortedBookings.push({ rowNum: j + 2, checkInStr: ciStr, row: formData[j] });
      }
      sortedBookings.sort(function(a, b) { return a.checkInStr < b.checkInStr ? -1 : (a.checkInStr > b.checkInStr ? 1 : 0); });
    }
    // スタッフ共有シートも一括読み込み
    var staffSheet = ss.getSheetByName(SHEET_STAFF_SHARE);
    var staffShareData = null, staffShareColMap = null;
    if (staffSheet && staffSheet.getLastRow() >= 2) {
      var sHeaders = staffSheet.getRange(1, 1, 1, staffSheet.getLastColumn()).getValues()[0];
      staffShareColMap = buildColumnMapFromSource_(sHeaders);
      staffShareData = staffSheet.getRange(2, 1, staffSheet.getLastRow(), staffSheet.getLastColumn()).getValues();
    }

    // 次回予約を一括検索するヘルパー（シートを再読み込みしない）
    function findNextRes_(checkoutStr, excludeRowNum) {
      if (!checkoutStr) return null;
      var best = null;
      // 除外行のチェックイン日・チェックアウト日を取得（重複行スキップ用）
      var excludeCi = '', excludeCo = '';
      if (excludeRowNum) {
        for (var e = 0; e < sortedBookings.length; e++) {
          if (sortedBookings[e].rowNum === excludeRowNum) {
            excludeCi = sortedBookings[e].checkInStr;
            if (formColMap.checkOut >= 0) {
              var eCo = parseDate(sortedBookings[e].row[formColMap.checkOut]);
              excludeCo = eCo ? toDateKeySafe_(eCo) : '';
            }
            break;
          }
        }
      }
      // ソート済み配列から検索（チェックアウト日以降で、現在の予約と同一でないもの）
      for (var k = 0; k < sortedBookings.length; k++) {
        if (sortedBookings[k].checkInStr < checkoutStr) continue;
        if (sortedBookings[k].rowNum === excludeRowNum) continue;
        // 同一チェックイン日の重複行をスキップ（iCal+フォーム）
        if (excludeCi && sortedBookings[k].checkInStr === excludeCi) continue;
        var sb = sortedBookings[k];
        var co = formColMap.checkOut >= 0 ? parseDate(sb.row[formColMap.checkOut]) : null;
        var coStr = co ? toDateKeySafe_(co) : '';
        var ad = formColMap.guestCount >= 0 ? extractGuestCount_(String(sb.row[formColMap.guestCount] || '')) : '';
        var inf = formColMap.guestCountInfants >= 0 ? extractGuestCount_(String(sb.row[formColMap.guestCountInfants] || '')) : '';
        var fFmt = (ad || inf) ? (ad ? '大人' + ad + '名' : '') + (inf ? (ad ? '、' : '') + '3歳以下' + inf + '名' : '') : '';
        var ical = formColMap.icalGuestCount >= 0 ? String(sb.row[formColMap.icalGuestCount] || '').trim() : '';
        best = {
          date: sb.checkInStr + (coStr ? ' ～ ' + coStr : ''),
          guestCount: (ical || '－') + '（' + (fFmt || '－') + '）',
          bbq: formColMap.bbq >= 0 ? String(sb.row[formColMap.bbq] || '').trim() : '',
          nationality: (formColMap.nationality >= 0 ? String(sb.row[formColMap.nationality] || '').trim() : '') || '日本',
          memo: '',
          bedCount: ''
        };
        break;
      }
      // フォームに無ければスタッフ共有シートから検索
      if (!best && staffShareData && staffShareColMap && staffShareColMap.checkIn >= 0) {
        var bestCi2 = '9999-12-31';
        for (var m = 0; m < staffShareData.length; m++) {
          var sCi = parseDate(staffShareData[m][staffShareColMap.checkIn]);
          if (!sCi) continue;
          var sCiStr = toDateKeySafe_(sCi);
          if (!sCiStr || sCiStr < checkoutStr) continue;
          if (sCiStr < bestCi2) {
            bestCi2 = sCiStr;
            var sCo = staffShareColMap.checkOut >= 0 ? parseDate(staffShareData[m][staffShareColMap.checkOut]) : null;
            var sAd = staffShareColMap.guestCount >= 0 ? extractGuestCount_(String(staffShareData[m][staffShareColMap.guestCount] || '')) : '';
            var sIn = staffShareColMap.guestCountInfants >= 0 ? extractGuestCount_(String(staffShareData[m][staffShareColMap.guestCountInfants] || '')) : '';
            var sFmt = (sAd || sIn) ? (sAd ? '大人' + sAd + '名' : '') + (sIn ? (sAd ? '、' : '') + '3歳以下' + sIn + '名' : '') : '';
            var sIcal = staffShareColMap.icalGuestCount >= 0 ? String(staffShareData[m][staffShareColMap.icalGuestCount] || '').trim() : '';
            var sCoStr = sCo ? toDateKeySafe_(sCo) : '';
            best = {
              date: sCiStr + (sCoStr ? ' ～ ' + sCoStr : ''),
              guestCount: (sIcal || '－') + '（' + (sFmt || '－') + '）',
              bbq: staffShareColMap.bbq >= 0 ? String(staffShareData[m][staffShareColMap.bbq] || '').trim() : '',
              nationality: (staffShareColMap.nationality >= 0 ? String(staffShareData[m][staffShareColMap.nationality] || '').trim() : '') || '日本',
              memo: '',
              bedCount: staffShareColMap.bedCount >= 0 ? String(staffShareData[m][staffShareColMap.bedCount] || '').trim() : ''
            };
          }
        }
      }
      // ベッド数をスタッフ共有シートから補完
      if (best && !best.bedCount && staffShareData && staffShareColMap && staffShareColMap.checkIn >= 0) {
        var targetCi = best.date.split(/\s*～\s*/)[0].trim();
        for (var n = 0; n < staffShareData.length; n++) {
          var nCi = parseDate(staffShareData[n][staffShareColMap.checkIn]);
          if (!nCi) continue;
          if (toDateKeySafe_(nCi) === targetCi && staffShareColMap.bedCount >= 0) {
            best.bedCount = String(staffShareData[n][staffShareColMap.bedCount] || '').trim();
            if (best.bedCount) break;
          }
        }
      }
      return best;
    }

    for (var i = 0; i < rows.length; i++) {
      var rowNum = Number(rows[i][1]);
      var status = String(rows[i][3] || '').trim() || '募集中';
      var staff = String(rows[i][4] || '').trim();
      var rid = 'r' + (i + 2);
      var volunteers = volunteersByRid[rid] || [];
      var cancelRequested = cancelByRid[rid] || [];

      // チェックアウト日
      var rawDate = rows[i][0];
      var checkoutDate = rawDate ? (rawDate instanceof Date ? Utilities.formatDate(rawDate, 'Asia/Tokyo', 'yyyy-MM-dd') : String(rawDate)) : '';

      // 次回予約情報: 募集シートのキャッシュ列を優先、無ければ一括計算
      var nextRes = null;
      if (String(rows[i][9] || '').trim() || String(rows[i][10] || '').trim() || String(rows[i][11] || '').trim()) {
        nextRes = {
          date: String(rows[i][9] || '').trim(),
          guestCount: String(rows[i][10] || '').trim(),
          bbq: String(rows[i][11] || '').trim(),
          nationality: String(rows[i][12] || '').trim() || '日本',
          memo: String(rows[i][13] || '').trim(),
          bedCount: String(rows[i][14] || '').trim()
        };
      }
      if (!nextRes && checkoutDate) {
        var normDate = checkoutDate.match(/^\d{4}-\d{2}-\d{2}$/) ? checkoutDate : (toDateKeySafe_(parseDate(checkoutDate) || checkoutDate) || checkoutDate);
        nextRes = findNextRes_(normDate, rowNum);
      }

      if (rowNum) map[rowNum] = {
        status: status,
        staff: staff,
        volunteers: volunteers,
        cancelRequested: cancelRequested,
        recruitRowIndex: i + 2,
        checkoutDate: checkoutDate,
        nextReservation: nextRes,
        selectedStaff: staff
      };
    }
    return JSON.stringify({ success: true, map: map });
  } catch (e) {
    return JSON.stringify({ success: false, map: {}, error: e.toString() });
  }
}

/**
 * 複数の予約行番号に対する次回予約情報を一括取得（フォームシートを1回だけ読む）
 */
function getNextReservationsForRows(rowNumbers) {
  try {
    if (!rowNumbers || !rowNumbers.length) return JSON.stringify({ success: true, map: {} });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var formSheet = ss.getSheetByName(SHEET_NAME);
    if (!formSheet || formSheet.getLastRow() < 2) return JSON.stringify({ success: true, map: {} });
    var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    var colMap = buildColumnMap(headers);
    if (colMap.checkIn < 0 || colMap.checkOut < 0) colMap = buildColumnMapFromSource_(headers);
    var formData = formSheet.getRange(2, 1, formSheet.getLastRow(), formSheet.getLastColumn()).getValues();
    // チェックイン日でソートした予約一覧
    var sorted = [];
    for (var j = 0; j < formData.length; j++) {
      var ci = parseDate(formData[j][colMap.checkIn]);
      if (!ci) continue;
      var ciStr = toDateKeySafe_(ci);
      if (!ciStr) continue;
      sorted.push({ rowNum: j + 2, checkInStr: ciStr, row: formData[j] });
    }
    sorted.sort(function(a, b) { return a.checkInStr < b.checkInStr ? -1 : (a.checkInStr > b.checkInStr ? 1 : 0); });
    // スタッフ共有シート
    var staffSheet = ss.getSheetByName(SHEET_STAFF_SHARE);
    var staffData = null, staffColMap = null;
    if (staffSheet && staffSheet.getLastRow() >= 2) {
      var sh = staffSheet.getRange(1, 1, 1, staffSheet.getLastColumn()).getValues()[0];
      staffColMap = buildColumnMapFromSource_(sh);
      staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow(), staffSheet.getLastColumn()).getValues();
    }
    var resultMap = {};
    var rowSet = {};
    rowNumbers.forEach(function(rn) { rowSet[rn] = true; });
    for (var i = 0; i < formData.length; i++) {
      var rn = i + 2;
      if (!rowSet[rn]) continue;
      var coVal = colMap.checkOut >= 0 ? formData[i][colMap.checkOut] : null;
      var coDate = parseDate(coVal);
      if (!coDate) continue;
      var coStr = toDateKeySafe_(coDate);
      if (!coStr) continue;
      // 現在の予約のチェックイン日を取得（重複行スキップ用）
      var currentCi = colMap.checkIn >= 0 ? toDateKeySafe_(parseDate(formData[i][colMap.checkIn])) : '';
      var best = null;
      for (var k = 0; k < sorted.length; k++) {
        if (sorted[k].checkInStr < coStr) continue;
        if (sorted[k].rowNum === rn) continue;
        if (currentCi && sorted[k].checkInStr === currentCi) continue;
        var sb = sorted[k];
        var sco = colMap.checkOut >= 0 ? parseDate(sb.row[colMap.checkOut]) : null;
        var scoStr = sco ? toDateKeySafe_(sco) : '';
        var ad = colMap.guestCount >= 0 ? extractGuestCount_(String(sb.row[colMap.guestCount] || '')) : '';
        var inf = colMap.guestCountInfants >= 0 ? extractGuestCount_(String(sb.row[colMap.guestCountInfants] || '')) : '';
        var fFmt = (ad || inf) ? (ad ? '大人' + ad + '名' : '') + (inf ? (ad ? '、' : '') + '3歳以下' + inf + '名' : '') : '';
        var ical = colMap.icalGuestCount >= 0 ? String(sb.row[colMap.icalGuestCount] || '').trim() : '';
        best = { date: sb.checkInStr + (scoStr ? ' ～ ' + scoStr : ''), guestCount: (ical || '－') + '（' + (fFmt || '－') + '）', bbq: colMap.bbq >= 0 ? String(sb.row[colMap.bbq] || '').trim() : '', nationality: (colMap.nationality >= 0 ? String(sb.row[colMap.nationality] || '').trim() : '') || '日本', memo: '', bedCount: '' };
        break;
      }
      if (!best && staffData && staffColMap && staffColMap.checkIn >= 0) {
        var bestCi = '9999-12-31';
        for (var m = 0; m < staffData.length; m++) {
          var sCi = parseDate(staffData[m][staffColMap.checkIn]);
          if (!sCi) continue;
          var sCiStr = toDateKeySafe_(sCi);
          if (!sCiStr || sCiStr < coStr) continue;
          if (sCiStr < bestCi) {
            bestCi = sCiStr;
            var sAd = staffColMap.guestCount >= 0 ? extractGuestCount_(String(staffData[m][staffColMap.guestCount] || '')) : '';
            var sIn = staffColMap.guestCountInfants >= 0 ? extractGuestCount_(String(staffData[m][staffColMap.guestCountInfants] || '')) : '';
            var sFmt = (sAd || sIn) ? (sAd ? '大人' + sAd + '名' : '') + (sIn ? (sAd ? '、' : '') + '3歳以下' + sIn + '名' : '') : '';
            var sIcal = staffColMap.icalGuestCount >= 0 ? String(staffData[m][staffColMap.icalGuestCount] || '').trim() : '';
            var sCo2 = staffColMap.checkOut >= 0 ? parseDate(staffData[m][staffColMap.checkOut]) : null;
            var sCoStr2 = sCo2 ? toDateKeySafe_(sCo2) : '';
            best = { date: sCiStr + (sCoStr2 ? ' ～ ' + sCoStr2 : ''), guestCount: (sIcal || '－') + '（' + (sFmt || '－') + '）', bbq: staffColMap.bbq >= 0 ? String(staffData[m][staffColMap.bbq] || '').trim() : '', nationality: (staffColMap.nationality >= 0 ? String(staffData[m][staffColMap.nationality] || '').trim() : '') || '日本', memo: '', bedCount: staffColMap.bedCount >= 0 ? String(staffData[m][staffColMap.bedCount] || '').trim() : '' };
          }
        }
      }
      if (best && !best.bedCount && staffData && staffColMap && staffColMap.checkIn >= 0) {
        var bestDateCi = best.date.split(/\s*～\s*/)[0].trim();
        for (var n = 0; n < staffData.length; n++) {
          var nCi = parseDate(staffData[n][staffColMap.checkIn]);
          if (!nCi) continue;
          if (toDateKeySafe_(nCi) === bestDateCi && staffColMap.bedCount >= 0) {
            best.bedCount = String(staffData[n][staffColMap.bedCount] || '').trim();
            if (best.bedCount) break;
          }
        }
      }
      if (best) resultMap[rn] = best;
    }
    return JSON.stringify({ success: true, map: resultMap });
  } catch (e) {
    return JSON.stringify({ success: false, map: {}, error: e.toString() });
  }
}

/**
 * 予約行番号に対応する募集情報（立候補者含む）を取得
 */
function getRecruitmentForBooking(bookingRowNumber) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    if (!recruitSheet || recruitSheet.getLastRow() < 2) return JSON.stringify({ success: true, recruitRowIndex: 0, volunteers: [], status: '', checkoutDate: '' });
    var rows = recruitSheet.getRange(2, 1, recruitSheet.getLastRow(), 5).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (Number(rows[i][1]) === bookingRowNumber) {
        var recruitRowIndex = i + 2;
        var checkoutDate = rows[i][0] ? (rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(rows[i][0])) : '';
        var status = String(rows[i][3] || '').trim() || '募集中';
        var volunteers = [];
        if (volSheet && volSheet.getLastRow() >= 2) {
          ensureVolunteerStatusColumns_();
          var volLastCol = Math.max(volSheet.getLastColumn(), 7);
          var volRows = volSheet.getRange(2, 1, volSheet.getLastRow(), volLastCol).getValues();
          var rid = 'r' + recruitRowIndex;
          volRows.forEach(function(vr) {
            if (String(vr[0] || '').trim() === rid) {
              volunteers.push({
                staffName: String(vr[1] || '').trim(),
                email: String(vr[2] || '').trim(),
                at: String(vr[3] || '').trim(),
                volStatus: String(vr[5] || '').trim() || 'volunteered',
                holdReason: String(vr[6] || '').trim()
              });
            }
          });
        }
        var cancelRequested = [];
        var cancelRejected = [];
        var crSheet = ss.getSheetByName(SHEET_CANCEL_REQUESTS);
        if (crSheet && crSheet.getLastRow() >= 2) {
          var crLastCol = Math.max(crSheet.getLastColumn(), 5);
          var crRows = crSheet.getRange(2, 1, crSheet.getLastRow() - 1, crLastCol).getValues();
          var rid2 = 'r' + recruitRowIndex;
          crRows.forEach(function(cr) {
            if (String(cr[0] || '').trim() === rid2) {
              var crStatus = String(cr[4] || '').trim();
              var entry = { staffName: String(cr[1] || '').trim(), email: String(cr[2] || '').trim().toLowerCase() };
              if (crStatus === 'rejected') {
                cancelRejected.push(entry);
              } else {
                cancelRequested.push(entry);
              }
            }
          });
        }
        var nextReservation = null;
        try {
          var detStr = getBookingDetailsForRecruit(bookingRowNumber, recruitRowIndex);
          var det = JSON.parse(detStr);
          if (det.success && det.nextReservation) nextReservation = det.nextReservation;
        } catch (er) {}
        var selectedStaff = String(rows[i][4] || '').trim();
        return JSON.stringify({ success: true, recruitRowIndex: recruitRowIndex, volunteers: volunteers, status: status, checkoutDate: checkoutDate, nextReservation: nextReservation, selectedStaff: selectedStaff, cancelRequested: cancelRequested, cancelRejected: cancelRejected });
      }
    }
    var nextReservation = null;
    try {
      var detStr = getBookingDetailsForRecruit(bookingRowNumber, null);
      var det = JSON.parse(detStr);
      if (det.success && det.nextReservation) nextReservation = det.nextReservation;
    } catch (er) {}
    return JSON.stringify({ success: true, recruitRowIndex: 0, volunteers: [], status: '', checkoutDate: '', nextReservation: nextReservation });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), recruitRowIndex: 0, volunteers: [] });
  }
}

function selectStaffForRecruitment(recruitRowIndex, selectedStaffComma) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ選定できます。' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const formSheet = ss.getSheetByName(SHEET_NAME);
    if (!recruitSheet || !formSheet) return JSON.stringify({ success: false, error: 'シートが見つかりません' });
    const bookingRowNumber = recruitSheet.getRange(recruitRowIndex, 2).getValue();
    recruitSheet.getRange(recruitRowIndex, 4).setValue('選定済');
    recruitSheet.getRange(recruitRowIndex, 5).setValue(selectedStaffComma || '');
    const headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    const columnMap = buildColumnMap(headers);
    if (columnMap.cleaningStaff >= 0) {
      formSheet.getRange(bookingRowNumber, columnMap.cleaningStaff + 1).setValue(selectedStaffComma || '');
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function checkAndCreateRecruitments() {
  try {
    ensureSheetsExist();
    const res = JSON.parse(getRecruitmentSettings());
    if (!res.success || !res.settings) return;
    const startWeeks = res.settings.recruitStartWeeks || 4;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = ss.getSheetByName(SHEET_NAME);
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!formSheet || formSheet.getLastRow() < 2) return;
    const headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    const colMap = buildColumnMap(headers);
    if (colMap.checkOut < 0) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rangeStart = new Date(today);
    rangeStart.setDate(rangeStart.getDate() + (startWeeks - 1) * 7);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + 7);
    const data = formSheet.getRange(2, 1, formSheet.getLastRow(), formSheet.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      const checkOutVal = data[i][colMap.checkOut];
      const checkOut = parseDate(checkOutVal);
      if (!checkOut) continue;
      const co = new Date(checkOut);
      co.setHours(0, 0, 0, 0);
      if (co < rangeStart || co >= rangeEnd) continue;
      const checkoutStr = toDateKeySafe_(checkOut);
      const rowNumber = i + 2;
      const existing = recruitSheet.getRange(2, 2, Math.max(recruitSheet.getLastRow(), 1), 2).getValues();
      var found = false;
      for (var j = 0; j < existing.length; j++) {
        if (Number(existing[j][0]) === rowNumber) { found = true; break; }
      }
      if (!found) {
        ensureRecruitNotifyMethodColumn_();
        const nextRow = recruitSheet.getLastRow() + 1;
        const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
        ensureRecruitDetailColumns_();
        recruitSheet.getRange(nextRow, 1, 1, 15).setValues([[checkoutStr, rowNumber, '', '募集中', '', '', now, '', 'メール', '', '', '', '', '', '']]);
      }
    }
  } catch (e) {
    Logger.log('checkAndCreateRecruitments: ' + e.toString());
  }
}

function checkAndSendReminders() {
  try {
    const res = JSON.parse(getRecruitmentSettings());
    if (!res.success || !res.settings) return;
    ensureRecruitNotifyMethodColumn_();
    const minResp = res.settings.minRespondents || 2;
    const intervalWeeks = res.settings.reminderIntervalWeeks || 1;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    if (!recruitSheet || recruitSheet.getLastRow() < 2) return;
    const maxCol = Math.max(recruitSheet.getLastColumn(), 9);
    const rows = recruitSheet.getRange(2, 1, recruitSheet.getLastRow(), maxCol).getValues();
    const today = new Date();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][3]).trim() !== '募集中') continue;
      if ((String(rows[i][8] || '').trim() || 'メール') === 'LINE') continue;
      const lastRemind = rows[i][5] ? new Date(rows[i][5]) : null;
      const rowIndex = i + 2;
      var volCount = 0;
      if (volSheet && volSheet.getLastRow() >= 2) {
        const volRows = volSheet.getRange(2, 1, volSheet.getLastRow(), 1).getValues();
        volRows.forEach(function(vr) {
          if (String(vr[0]).trim() === 'r' + rowIndex) volCount++;
        });
      }
      if (volCount >= minResp) continue;
      var shouldRemind = false;
      if (!lastRemind) shouldRemind = true;
      else {
        const nextRemind = new Date(lastRemind);
        nextRemind.setDate(nextRemind.getDate() + intervalWeeks * 7);
        if (today >= nextRemind) shouldRemind = true;
      }
      if (shouldRemind) {
        const staffSheet = ss.getSheetByName(SHEET_STAFF);
        if (staffSheet && staffSheet.getLastRow() >= 2) {
          const emails = staffSheet.getRange(2, 3, staffSheet.getLastRow(), 3).getValues();
          const to = [];
          emails.forEach(function(r) { if (r[0]) to.push(r[0]); });
          if (to.length) {
            GmailApp.sendEmail(to.join(','), '【民泊】清掃スタッフ募集のリマインド: ' + rows[i][0], 'まだ立候補が少ないため、再度ご案内します。チェックアウト日: ' + rows[i][0]);
          }
        }
        recruitSheet.getRange(rowIndex, 6).setValue(Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'));
      }
    }
  } catch (e) {
    Logger.log('checkAndSendReminders: ' + e.toString());
  }
}

/**
 * 次回予約デバッグ用（行番号を変更して実行）
 * 実行: 関数で myFunction を選択 → 実行
 */
function myFunction() {
  Logger.log(getNextReservationDebug(5));
}
