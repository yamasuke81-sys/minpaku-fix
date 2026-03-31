/**
 * チェックインアプリ — Code.gs
 * 宿泊者がチェックイン時にポストのスマホで自分の予約情報を確認・修正するためのWebアプリ
 */

// ===== エントリーポイント =====

function doGet(e) {
  var mode = (e && e.parameter && e.parameter.mode) || '';
  if (mode === 'admin') {
    var adminHtml = HtmlService.createHtmlOutputFromFile('admin').getContent();
    // ベースURLを埋め込む（宿泊者画面リンク用）
    var baseUrl = ScriptApp.getService().getUrl();
    adminHtml = adminHtml.replace('<!--APP_BASE_URL-->', baseUrl || '');
    return HtmlService.createHtmlOutput(adminHtml)
      .setTitle('管理者画面')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return HtmlService.createHtmlOutputFromFile('checkin')
    .setTitle('チェックイン')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ===== 設定管理 =====

/** スプレッドシートIDを取得 */
function getSpreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
}

/** デフォルトの表示フィールド定義 */
var DEFAULT_FIELDS_ = [
  { key: 'guestCount', label: '宿泊人数 / Number of Guests', visible: true },
  { key: 'guestCountInfants', label: '3才以下の乳幼児の人数 / Number of infants under 3 years old', visible: true },
  { key: 'checkIn', label: 'チェックイン / Check-in', visible: true },
  { key: 'checkOut', label: 'チェックアウト / Check-out', visible: true },
  { key: 'guestName', label: '氏名 / Full Name', visible: true },
  { key: 'age', label: '年齢 / Age', visible: true },
  { key: 'address', label: '住所 / Address', visible: true },
  { key: 'tel', label: '電話番号', visible: true },
  { key: 'nationality', label: '国籍 / Nationality', visible: true },
  { key: 'passportNumber', label: '旅券番号を入力してください / Please enter your passport number.', visible: true },
  { key: 'passportPhoto', label: 'パスポートの写真をアップロードしてください / Please upload a photo of your passport.', visible: true },
  { key: 'prevStay', label: '前泊地', visible: true },
  { key: 'nextStay', label: '行先地', visible: true }
];

/** 設定を取得 */
function getCheckinSettings() {
  var props = PropertiesService.getScriptProperties();
  var fieldsJson = props.getProperty('DISPLAY_FIELDS');
  var fields = fieldsJson ? JSON.parse(fieldsJson) : DEFAULT_FIELDS_;
  return JSON.stringify({
    spreadsheetId: props.getProperty('SPREADSHEET_ID') || '',
    contactType: props.getProperty('CONTACT_TYPE') || 'meet',
    meetUrl: props.getProperty('MEET_URL') || '',
    phoneNumber: props.getProperty('PHONE_NUMBER') || '',
    devicePhone: props.getProperty('DEVICE_PHONE') || '',
    lineOaId: props.getProperty('LINE_OA_ID') || '',
    lineCallUrl: props.getProperty('LINE_CALL_URL') || '',
    notifyEmail: props.getProperty('NOTIFY_EMAIL') || '',
    settingsPin: props.getProperty('SETTINGS_PIN') || '0000',
    sheetName: props.getProperty('SHEET_NAME') || 'フォームの回答 1',
    displayFields: fields,
    alarmAppUrl: props.getProperty('ALARM_APP_URL') || '',
    alarmEnabled: props.getProperty('ALARM_ENABLED') === 'true'
  });
}

/** 設定を保存 */
function saveCheckinSettings(settingsJson) {
  var s = JSON.parse(settingsJson);
  var props = PropertiesService.getScriptProperties();
  if (s.spreadsheetId !== undefined) props.setProperty('SPREADSHEET_ID', s.spreadsheetId);
  if (s.contactType !== undefined) props.setProperty('CONTACT_TYPE', s.contactType);
  if (s.meetUrl !== undefined) props.setProperty('MEET_URL', s.meetUrl);
  if (s.phoneNumber !== undefined) props.setProperty('PHONE_NUMBER', s.phoneNumber);
  if (s.devicePhone !== undefined) props.setProperty('DEVICE_PHONE', s.devicePhone);
  if (s.lineOaId !== undefined) props.setProperty('LINE_OA_ID', s.lineOaId);
  if (s.lineCallUrl !== undefined) props.setProperty('LINE_CALL_URL', s.lineCallUrl);
  if (s.notifyEmail !== undefined) props.setProperty('NOTIFY_EMAIL', s.notifyEmail);
  if (s.settingsPin !== undefined) props.setProperty('SETTINGS_PIN', s.settingsPin);
  if (s.sheetName !== undefined) props.setProperty('SHEET_NAME', s.sheetName);
  if (s.displayFields !== undefined) props.setProperty('DISPLAY_FIELDS', JSON.stringify(s.displayFields));
  if (s.alarmAppUrl !== undefined) props.setProperty('ALARM_APP_URL', s.alarmAppUrl);
  if (s.alarmEnabled !== undefined) props.setProperty('ALARM_ENABLED', s.alarmEnabled ? 'true' : 'false');
  return JSON.stringify({ success: true });
}

/** 表示フィールド設定を取得（フロントエンド用） */
function getDisplayFields() {
  var fieldsJson = PropertiesService.getScriptProperties().getProperty('DISPLAY_FIELDS');
  return fieldsJson || JSON.stringify(DEFAULT_FIELDS_);
}

/** PIN検証 */
function verifyPin(pin) {
  var stored = PropertiesService.getScriptProperties().getProperty('SETTINGS_PIN') || '0000';
  return JSON.stringify({ valid: pin === stored });
}

/** 連絡先設定のみ取得（フロントエンド用） */
function getContactSettings() {
  var props = PropertiesService.getScriptProperties();
  return JSON.stringify({
    contactType: props.getProperty('CONTACT_TYPE') || 'line',
    meetUrl: props.getProperty('MEET_URL') || '',
    phoneNumber: props.getProperty('PHONE_NUMBER') || '',
    lineOaId: props.getProperty('LINE_OA_ID') || '',
    lineCallUrl: props.getProperty('LINE_CALL_URL') || ''
  });
}

// ===== スプレッドシートアクセス =====

/** シートを取得 */
function getSheet_() {
  var ssId = getSpreadsheetId_();
  if (!ssId) throw new Error('スプレッドシートIDが設定されていません。設定画面で設定してください。');
  var ss = SpreadsheetApp.openById(ssId);
  var sheetName = PropertiesService.getScriptProperties().getProperty('SHEET_NAME') || 'フォームの回答 1';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('シート「' + sheetName + '」が見つかりません。');
  return sheet;
}

/** ヘッダーの種別を判定 */
function classifyHeader_(h, hl) {
  // 氏名
  if (h.indexOf('氏名') > -1 || hl === 'full name' || hl.indexOf('full name') > -1) return 'name';
  // 住所（「メールアドレス / Email Address」を除外）
  if ((h.indexOf('住所') > -1 || hl.indexOf('address') > -1) &&
      h.indexOf('メール') === -1 && hl.indexOf('email') === -1 && hl.indexOf('mail') === -1) return 'address';
  // 年齢
  if (h.indexOf('年齢') > -1 || (hl.indexOf('age') > -1 && hl.indexOf('page') === -1)) return 'age';
  // 国籍
  if (h.indexOf('国籍') > -1 || hl.indexOf('nationality') > -1) return 'nationality';
  // 旅券番号（パスポート写真より先に判定）
  if (h.indexOf('旅券番号') > -1 || hl.indexOf('passport number') > -1) return 'passportNumber';
  // パスポート写真
  if ((h.indexOf('パスポート') > -1 || hl.indexOf('passport') > -1) &&
      (h.indexOf('アップロード') > -1 || h.indexOf('upload') > -1 || hl.indexOf('upload') > -1 || hl.indexOf('photo') > -1)) return 'passportPhoto';
  // 電話番号
  if ((h.indexOf('電話') > -1 || h.indexOf('TEL') > -1 || hl.indexOf('phone') > -1) && h.indexOf('オーナー') === -1) return 'tel';
  // メールアドレス
  if ((h.indexOf('メール') > -1 || hl.indexOf('mail') > -1 || hl.indexOf('email') > -1) &&
      h.indexOf('オーナー') === -1 && h.indexOf('非常に重要') === -1) return 'email';
  return null;
}

/** ヘッダーからカラムマップを構築
 *  各氏名カラムの右側を走査し、最初に出現する住所/年齢/国籍/旅券番号/パスポート写真を
 *  そのゲストに紐づける（次の氏名カラムが出現するまでの範囲） */
function buildCheckinColumnMap_(headers) {
  var map = {
    checkIn: -1,
    checkOut: -1,
    guestCount: -1,
    guestCountInfants: -1,
    prevStay: -1,
    nextStay: -1,
    guestNameCols: [],
    addressCols: [],
    ageCols: [],
    nationalityCols: [],
    passportNumberCols: [],
    passportPhotoCols: [],
    telCols: [],
    emailCols: []
  };

  // 1パス目: 単一フィールド（チェックイン/アウト、宿泊人数等）+ 氏名カラム位置を収集
  var allNamePositions = [];
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').trim();
    var hl = h.toLowerCase();

    if (h.indexOf('チェックイン') > -1 && h.indexOf('チェックアウト') === -1
        && h.indexOf('案内') === -1 && h.indexOf('お願い') === -1 && map.checkIn < 0) map.checkIn = i;
    if (h.indexOf('チェックアウト') > -1 && map.checkOut < 0) map.checkOut = i;
    if (h.indexOf('宿泊人数') > -1 && h.indexOf('乳幼児') === -1 && hl.indexOf('infants') === -1
        && h.indexOf('ベッド') === -1 && h.indexOf('お答え') === -1 && h.indexOf('iCal') === -1
        && map.guestCount < 0) map.guestCount = i;
    if ((h.indexOf('3才以下') > -1 || h.indexOf('3歳以下') > -1)
        && (h.indexOf('乳幼児') > -1 || hl.indexOf('infants') > -1) && map.guestCountInfants < 0) map.guestCountInfants = i;
    if (h.indexOf('前泊地') > -1 && map.prevStay < 0) map.prevStay = i;
    if ((h.indexOf('後泊地') > -1 || h.indexOf('行先地') > -1) && map.nextStay < 0) map.nextStay = i;

    var cls = classifyHeader_(h, hl);
    if (cls === 'name') allNamePositions.push(i);
    if (cls === 'tel') map.telCols.push(i);
    if (cls === 'email') map.emailCols.push(i);
  }

  // 2パス目: 各氏名カラムの右側から、次の氏名カラム（または末尾）までの範囲で
  //          最初に出現する住所/年齢/国籍/旅券番号/パスポート写真を紐づけ
  for (var ni = 0; ni < allNamePositions.length; ni++) {
    var nameCol = allNamePositions[ni];
    var rangeEnd = (ni + 1 < allNamePositions.length) ? allNamePositions[ni + 1] : headers.length;

    map.guestNameCols.push(nameCol);

    var foundAddr = -1, foundAge = -1, foundNat = -1, foundPpNum = -1, foundPpPhoto = -1;
    for (var j = nameCol + 1; j < rangeEnd; j++) {
      var hj = String(headers[j] || '').trim();
      var hlj = hj.toLowerCase();
      var clsj = classifyHeader_(hj, hlj);
      if (clsj === 'address' && foundAddr < 0) foundAddr = j;
      if (clsj === 'age' && foundAge < 0) foundAge = j;
      if (clsj === 'nationality' && foundNat < 0) foundNat = j;
      if (clsj === 'passportNumber' && foundPpNum < 0) foundPpNum = j;
      if (clsj === 'passportPhoto' && foundPpPhoto < 0) foundPpPhoto = j;
    }

    map.addressCols.push(foundAddr);
    map.ageCols.push(foundAge);
    map.nationalityCols.push(foundNat);
    map.passportNumberCols.push(foundPpNum);
    map.passportPhotoCols.push(foundPpPhoto);
  }

  return map;
}

// ===== 編集シート管理 =====

var EDIT_SHEET_NAME_ = 'チェックインappゲスト編集分';
var EDIT_HEADERS_ = ['行番号', 'カラム番号', 'フィールド名', '元の値', '編集後の値', '編集日時'];

/** 編集シートを取得（なければ作成） */
function getEditSheet_() {
  var ssId = getSpreadsheetId_();
  if (!ssId) throw new Error('スプレッドシートIDが設定されていません。');
  var ss = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName(EDIT_SHEET_NAME_);
  if (!sheet) {
    sheet = ss.insertSheet(EDIT_SHEET_NAME_);
    sheet.getRange(1, 1, 1, EDIT_HEADERS_.length).setValues([EDIT_HEADERS_]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** 特定行番号の編集データを全て取得 → { colIndex: { original, edited, fieldName, editedAt } } */
function getEditsForRow_(rowNumber) {
  var sheet = getEditSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  var data = sheet.getRange(2, 1, lastRow - 1, EDIT_HEADERS_.length).getValues();
  var edits = {};
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === String(rowNumber)) {
      edits[String(data[i][1])] = {
        original: data[i][3],
        edited: data[i][4],
        fieldName: data[i][2],
        editedAt: data[i][5],
        sheetRow: i + 2 // 編集シート上の行番号（削除用）
      };
    }
  }
  return edits;
}

/** フィールド名を推定（カラムインデックスとヘッダーから） */
function getFieldNameForCol_(headers, colIndex) {
  if (colIndex >= 0 && colIndex < headers.length) {
    var h = String(headers[colIndex] || '');
    // 長いヘッダーは先頭30文字に切り詰め
    return h.length > 30 ? h.substring(0, 30) + '…' : h;
  }
  return 'col_' + colIndex;
}

// ===== ゲスト検索 =====

/** 電話番号を正規化（数字のみ、先頭の+81を0に変換） */
function normalizePhone_(phone) {
  if (!phone) return '';
  var digits = String(phone).replace(/[^\d+]/g, '');
  // +81を0に変換
  if (digits.indexOf('+81') === 0) digits = '0' + digits.substring(3);
  if (digits.indexOf('81') === 0 && digits.length >= 11) digits = '0' + digits.substring(2);
  return digits.replace(/\D/g, '');
}

/** 名前を正規化（スペース除去、小文字化、全角→半角） */
function normalizeName_(name) {
  if (!name) return '';
  var s = String(name).trim();
  // 全角英数→半角
  s = s.replace(/[\uff01-\uff5e]/g, function(c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
  // 全角スペース→半角
  s = s.replace(/\u3000/g, ' ');
  // スペース除去、小文字化
  s = s.replace(/\s+/g, '').toLowerCase();
  return s;
}

// ===== テスト予約（実スプシに影響なし） =====
var TEST_ROW_NUMBER_ = -1; // テスト予約の識別用行番号
var TEST_GUEST_ = {
  name: '西山恭介',
  phone: '09075009595',
  checkIn: (function() { var d = new Date(); return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/M/d') + ' 15:00'; })(),
  checkOut: (function() { var d = new Date(); d.setDate(d.getDate() + 1); return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/M/d') + ' 10:00'; })(),
  guestCount: '2',
  guestCountInfants: '1',
  nationality: '日本 / Japan（テスト）',
  age: '35',
  address: '東京都渋谷区テスト1-2-3',
  passportNumber: 'TK1234567',
  passportPhotoUrl: 'https://placehold.co/300x400/e8e8e8/555?text=PASSPORT%0APHOTO%0A(TEST)',
  prevStay: '東京（テスト）',
  nextStay: '大阪（テスト）',
  tel2: '08012345678',
  email: 'test@example.com'
};

function isTestSearch_(name, phone) {
  return normalizeName_(name) === normalizeName_(TEST_GUEST_.name)
    && normalizePhone_(phone) === normalizePhone_(TEST_GUEST_.phone);
}

function getTestSearchResult_() {
  return {
    rowNumber: TEST_ROW_NUMBER_,
    guestName: TEST_GUEST_.name,
    checkIn: TEST_GUEST_.checkIn,
    checkOut: TEST_GUEST_.checkOut,
    guestCount: TEST_GUEST_.guestCount
  };
}

function getTestGuestDetails_() {
  return {
    rowNumber: TEST_ROW_NUMBER_,
    checkIn: TEST_GUEST_.checkIn,
    checkOut: TEST_GUEST_.checkOut,
    guestCount: TEST_GUEST_.guestCount,
    guestCountInfants: TEST_GUEST_.guestCountInfants,
    prevStay: TEST_GUEST_.prevStay,
    nextStay: TEST_GUEST_.nextStay,
    guests: [
      {
        index: 0,
        name: TEST_GUEST_.name,
        address: TEST_GUEST_.address,
        age: TEST_GUEST_.age,
        nationality: TEST_GUEST_.nationality,
        passportNumber: TEST_GUEST_.passportNumber,
        passportPhotoUrl: TEST_GUEST_.passportPhotoUrl
      },
      {
        index: 1,
        name: '西山花子',
        address: '東京都渋谷区テスト1-2-3',
        age: '32',
        nationality: 'アメリカ / USA（テスト）',
        passportNumber: 'US9876543',
        passportPhotoUrl: 'https://placehold.co/300x400/d4edda/155724?text=PASSPORT%0APHOTO+2%0A(TEST)'
      },
      {
        index: 2,
        name: '西山太郎',
        address: '東京都渋谷区テスト1-2-3',
        age: '5',
        nationality: '日本 / Japan（テスト）',
        passportNumber: 'TK7654321',
        passportPhotoUrl: 'https://placehold.co/300x400/cce5ff/004085?text=PASSPORT%0APHOTO+3%0A(TEST)'
      }
    ],
    tel1: TEST_GUEST_.phone,
    tel2: TEST_GUEST_.tel2,
    hasEdits: false,
    editedCols: {},
    colMap: {
      checkIn: 0, checkOut: 1, guestCount: 2, guestCountInfants: 3,
      prevStay: 4, nextStay: 5, telCols: [6, 7],
      guestNameCols: [8, 14, 15], addressCols: [9, 16, 17], ageCols: [10, 18, 19],
      nationalityCols: [11, 20, 21], passportNumberCols: [12, 22, 23], passportPhotoCols: [13, 24, 25]
    }
  };
}

/** ゲストを名前・電話番号で検索 */
function searchGuest(name, phone) {
  try {
    // テスト予約チェック
    if (isTestSearch_(name, phone)) {
      return JSON.stringify({ success: true, results: [getTestSearchResult_()], ciFutureMatched: 0 });
    }

    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true, results: [] });

    var data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
    var headers = data[0];
    var map = buildCheckinColumnMap_(headers);

    var normalizedSearchName = normalizeName_(name);
    var normalizedSearchPhone = normalizePhone_(phone);
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var results = [];
    var ciFutureMatched = 0; // CI30日以上先だが名前+電話マッチした件数

    for (var r = 1; r < data.length; r++) {
      var row = data[r];

      // チェックアウトが過去の予約はスキップ
      if (map.checkOut >= 0) {
        var coVal = row[map.checkOut];
        if (coVal) {
          var coDate = new Date(coVal);
          if (!isNaN(coDate.getTime())) {
            if (coDate < today) continue;
          }
        }
      }

      // チェックインが30日以上先か判定
      var isCiFuture = false;
      if (map.checkIn >= 0) {
        var ciVal = row[map.checkIn];
        if (ciVal) {
          var ciDate = new Date(ciVal);
          if (!isNaN(ciDate.getTime())) {
            var future = new Date(today);
            future.setDate(future.getDate() + 30);
            if (ciDate > future) isCiFuture = true;
          }
        }
      }

      var nameMatch = false;
      var phoneMatch = false;

      // 名前マッチ
      if (normalizedSearchName) {
        for (var ni = 0; ni < map.guestNameCols.length; ni++) {
          var cellName = normalizeName_(row[map.guestNameCols[ni]]);
          if (cellName && (cellName === normalizedSearchName || cellName.indexOf(normalizedSearchName) > -1 || normalizedSearchName.indexOf(cellName) > -1)) {
            nameMatch = true;
            break;
          }
        }
      }

      // 電話番号マッチ
      if (normalizedSearchPhone && normalizedSearchPhone.length >= 4) {
        for (var ti = 0; ti < map.telCols.length; ti++) {
          var cellPhone = normalizePhone_(row[map.telCols[ti]]);
          if (cellPhone && cellPhone === normalizedSearchPhone) {
            phoneMatch = true;
            break;
          }
        }
      }

      // CI未来フィルタでスキップ（マッチしていた場合はカウント）
      if (isCiFuture) {
        if (nameMatch && phoneMatch) ciFutureMatched++;
        continue;
      }

      if (nameMatch && phoneMatch) {
        var primaryName = '';
        if (map.guestNameCols.length > 0) primaryName = String(row[map.guestNameCols[0]] || '').trim();
        var ci = map.checkIn >= 0 ? formatDate_(row[map.checkIn]) : '';
        var co = map.checkOut >= 0 ? formatDate_(row[map.checkOut]) : '';
        var gc = map.guestCount >= 0 ? String(row[map.guestCount] || '').trim() : '';

        results.push({
          rowNumber: r + 1,
          guestName: primaryName,
          checkIn: ci,
          checkOut: co,
          guestCount: gc
        });
      }
    }

    return JSON.stringify({ success: true, results: results, ciFutureMatched: ciFutureMatched });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// ===== ゲスト詳細取得 =====

/** 日付フォーマット */
function formatDate_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy/M/d HH:mm');
  }
  return String(val).trim();
}

/** ゲスト詳細を取得（編集シートの差分をオーバーレイ） */
function getGuestDetails(rowNumber) {
  try {
    // テスト予約
    if (rowNumber === TEST_ROW_NUMBER_) {
      return JSON.stringify({ success: true, data: getTestGuestDetails_() });
    }

    var sheet = getSheet_();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var map = buildCheckinColumnMap_(headers);
    var row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];

    // 編集シートから差分を取得
    var edits = getEditsForRow_(rowNumber);
    var editedCols = {}; // colIndex → true（編集済みマーカー）
    for (var k in edits) editedCols[k] = true;

    /** セル値を取得（編集があればそちらを優先） */
    function cellVal_(colIndex) {
      if (colIndex < 0) return '';
      if (edits[String(colIndex)]) return String(edits[String(colIndex)].edited || '');
      var v = row[colIndex];
      if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/M/d HH:mm');
      return String(v || '').trim();
    }

    // 基本情報
    var result = {
      rowNumber: rowNumber,
      checkIn: map.checkIn >= 0 ? (edits[String(map.checkIn)] ? cellVal_(map.checkIn) : formatDate_(row[map.checkIn])) : '',
      checkOut: map.checkOut >= 0 ? (edits[String(map.checkOut)] ? cellVal_(map.checkOut) : formatDate_(row[map.checkOut])) : '',
      guestCount: cellVal_(map.guestCount),
      guestCountInfants: cellVal_(map.guestCountInfants),
      prevStay: cellVal_(map.prevStay),
      nextStay: cellVal_(map.nextStay),
      guests: [],
      tel1: map.telCols.length > 0 ? cellVal_(map.telCols[0]) : '',
      tel2: map.telCols.length > 1 ? cellVal_(map.telCols[1]) : '',
      hasEdits: Object.keys(edits).length > 0,
      editedCols: editedCols,
      // 編集可能なカラムインデックスのマップ
      colMap: {
        checkIn: map.checkIn,
        checkOut: map.checkOut,
        guestCount: map.guestCount,
        guestCountInfants: map.guestCountInfants,
        prevStay: map.prevStay,
        nextStay: map.nextStay,
        telCols: map.telCols,
        guestNameCols: map.guestNameCols,
        addressCols: map.addressCols,
        ageCols: map.ageCols,
        nationalityCols: map.nationalityCols,
        passportNumberCols: map.passportNumberCols,
        passportPhotoCols: map.passportPhotoCols
      }
    };

    // ゲスト一覧を構築（最大10名）
    var maxGuests = map.guestNameCols.length;
    for (var g = 0; g < maxGuests; g++) {
      var gNameColIdx = map.guestNameCols[g];
      var gName = cellVal_(gNameColIdx);
      if (!gName && g > 0) continue; // 2人目以降は名前がなければスキップ

      var guest = {
        index: g,
        name: gName,
        address: g < map.addressCols.length ? cellVal_(map.addressCols[g]) : '',
        age: g < map.ageCols.length ? cellVal_(map.ageCols[g]) : '',
        nationality: g < map.nationalityCols.length ? cellVal_(map.nationalityCols[g]) : '',
        passportNumber: g < map.passportNumberCols.length ? cellVal_(map.passportNumberCols[g]) : '',
        passportPhotoUrl: ''
      };

      // パスポート写真URL（編集対象外なので元の値を使う）
      if (g < map.passportPhotoCols.length && map.passportPhotoCols[g] >= 0) {
        var pVal = String(row[map.passportPhotoCols[g]] || '').trim();
        if (pVal && pVal.indexOf('http') === 0) {
          guest.passportPhotoUrl = pVal;
        }
      }

      result.guests.push(guest);
    }

    return JSON.stringify({ success: true, data: result });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// ===== ゲスト情報更新（編集シートに差分記録） =====

/** 単一セルを編集シートに記録（フォームの回答1は変更しない） */
function updateGuestField(rowNumber, colIndex, value) {
  try {
    // テスト予約は保存しない（UIの動作確認のみ）
    if (rowNumber === TEST_ROW_NUMBER_) {
      return JSON.stringify({ success: true });
    }

    var sheet = getSheet_();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var originalValue = sheet.getRange(rowNumber, colIndex + 1).getValue();
    var originalStr = (originalValue instanceof Date)
      ? Utilities.formatDate(originalValue, 'Asia/Tokyo', 'yyyy/M/d HH:mm')
      : String(originalValue || '');
    var fieldName = getFieldNameForCol_(headers, colIndex);
    var editSheet = getEditSheet_();
    var lastRow = editSheet.getLastRow();

    // 既存の編集エントリを探す
    var existingRow = -1;
    if (lastRow >= 2) {
      var data = editSheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][0]) === String(rowNumber) && String(data[i][1]) === String(colIndex)) {
          existingRow = i + 2;
          break;
        }
      }
    }

    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

    // 元の値と同じに戻された場合はエントリ削除
    if (String(value).trim() === originalStr.trim()) {
      if (existingRow > 0) {
        editSheet.deleteRow(existingRow);
      }
      return JSON.stringify({ success: true, reverted: true });
    }

    if (existingRow > 0) {
      // 既存エントリを更新
      editSheet.getRange(existingRow, 4, 1, 3).setValues([[originalStr, value, now]]);
    } else {
      // 新規エントリ追加
      editSheet.appendRow([rowNumber, colIndex, fieldName, originalStr, value, now]);
    }

    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/** ゲスト編集をリセット（編集シートから該当行の全エントリを削除） */
function resetGuestEdits(rowNumber) {
  try {
    if (rowNumber === TEST_ROW_NUMBER_) {
      return JSON.stringify({ success: true, deleted: 0 });
    }

    var editSheet = getEditSheet_();
    var lastRow = editSheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true, deleted: 0 });

    var data = editSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var deleted = 0;
    // 下の行から削除していく（行番号がずれないように）
    for (var i = data.length - 1; i >= 0; i--) {
      if (String(data[i][0]) === String(rowNumber)) {
        editSheet.deleteRow(i + 2);
        deleted++;
      }
    }
    return JSON.stringify({ success: true, deleted: deleted });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/** ゲスト編集履歴を取得（設定画面用） */
function getGuestEditLog() {
  try {
    var editSheet = getEditSheet_();
    var lastRow = editSheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true, edits: [] });

    var data = editSheet.getRange(2, 1, lastRow - 1, EDIT_HEADERS_.length).getValues();
    var edits = [];
    for (var i = 0; i < data.length; i++) {
      edits.push({
        rowNumber: data[i][0],
        colIndex: data[i][1],
        fieldName: data[i][2],
        original: String(data[i][3] || ''),
        edited: String(data[i][4] || ''),
        editedAt: data[i][5]
      });
    }
    return JSON.stringify({ success: true, edits: edits });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// ===== チェックイン確認記録 =====

/** チェックイン確認を記録 */
function confirmCheckin(rowNumber) {
  try {
    // テスト予約は記録しない
    if (rowNumber === TEST_ROW_NUMBER_) {
      return JSON.stringify({ success: true });
    }

    var sheet = getSheet_();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var map = buildCheckinColumnMap_(headers);

    // ゲスト名を取得（ログ用）
    var row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
    var guestName = map.guestNameCols.length > 0 ? String(row[map.guestNameCols[0]] || '') : '';

    // チェックイン記録をScriptPropertiesに保存
    var props = PropertiesService.getScriptProperties();
    var confirmedAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    var log = JSON.parse(props.getProperty('CHECKIN_LOG') || '[]');
    log.push({
      rowNumber: rowNumber,
      guestName: guestName,
      confirmedAt: confirmedAt
    });
    // 最新100件のみ保持
    if (log.length > 100) log = log.slice(log.length - 100);
    props.setProperty('CHECKIN_LOG', JSON.stringify(log));

    // スプレッドシートの「チェックイン確認日時」列にも書き込み（alarm-app連携用）
    var ciConfirmCol = -1;
    for (var ci = 0; ci < headers.length; ci++) {
      if (String(headers[ci] || '').trim() === 'チェックイン確認日時') { ciConfirmCol = ci + 1; break; }
    }
    if (ciConfirmCol < 0) {
      // 列がなければ末尾に作成
      ciConfirmCol = headers.length + 1;
      sheet.getRange(1, ciConfirmCol).setValue('チェックイン確認日時');
    }
    sheet.getRange(rowNumber, ciConfirmCol).setValue(confirmedAt);

    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/** Google Meet通話開始時にオーナーへメール通知 */
function notifyMeetCall(rowNumber) {
  try {
    // テスト予約はメール通知しない
    if (rowNumber === TEST_ROW_NUMBER_) {
      return JSON.stringify({ success: true });
    }

    var props = PropertiesService.getScriptProperties();
    var notifyEmailRaw = props.getProperty('NOTIFY_EMAIL') || '';
    if (!notifyEmailRaw) return JSON.stringify({ success: false, error: '通知先メールアドレスが未設定です' });
    // カンマ・改行・セミコロン区切りで複数メール対応
    var notifyEmails = notifyEmailRaw.split(/[,;\s\n]+/).filter(function(e) { return e && e.indexOf('@') > 0; });
    if (notifyEmails.length === 0) return JSON.stringify({ success: false, error: '有効なメールアドレスがありません' });

    var contactType = props.getProperty('CONTACT_TYPE') || 'meet';
    var meetUrl = props.getProperty('MEET_URL') || '';
    var lineOaId = props.getProperty('LINE_OA_ID') || '';
    var devicePhone = props.getProperty('DEVICE_PHONE') || '';
    var phoneNumber = props.getProperty('PHONE_NUMBER') || '';

    // ゲスト情報を取得
    var sheet = getSheet_();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var map = buildCheckinColumnMap_(headers);
    var row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];

    // 編集情報を取得
    var edits = getEditsForRow_(rowNumber);

    /** セル値を取得 */
    function cellVal_(colIndex) {
      if (colIndex < 0) return '';
      var v = row[colIndex];
      if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/M/d HH:mm');
      return String(v || '').trim();
    }

    var guestName = map.guestNameCols.length > 0 ? cellVal_(map.guestNameCols[0]) : '(不明)';
    var checkIn = map.checkIn >= 0 ? cellVal_(map.checkIn) : '';
    var checkOut = map.checkOut >= 0 ? cellVal_(map.checkOut) : '';
    var guestCount = map.guestCount >= 0 ? cellVal_(map.guestCount) : '';
    var tel = map.telCols.length > 0 ? cellVal_(map.telCols[0]) : '';

    // メール本文を構築
    var body = '';
    body += '宿泊者がチェックインの確認を完了しました。\n\n';

    // 連絡方法に応じたスタッフ向け案内
    var showLine = (contactType === 'line' || contactType === 'line_meet' || contactType === 'line_phone' || contactType === 'all');
    var showMeet = (contactType === 'meet' || contactType === 'line_meet' || contactType === 'all');
    var showPhone = (contactType === 'phone' || contactType === 'line_phone' || contactType === 'all');

    body += '【宿泊者への連絡方法】\n';
    if (showLine && lineOaId) {
      body += '・LINE: 宿泊者にはLINE公式アカウント(' + lineOaId + ')への発信を案内しています。LINE公式アカウントへの着信をお待ちください。\n';
    }
    if (showMeet && meetUrl) {
      body += '・Google Meet: 宿泊者には以下のURLで参加するよう案内しています。\n  ' + meetUrl + '\n';
    }
    if (showPhone) {
      body += '・電話: 宿泊者には電話で連絡するよう案内しています。';
      if (devicePhone) {
        body += '\n  チェックインapp端末の電話番号: ' + devicePhone + '\n  この番号への着信をお待ちください。\n';
      } else if (phoneNumber) {
        body += '\n  連絡先電話番号: ' + phoneNumber + '\n';
      } else {
        body += '\n';
      }
    }
    if (!showLine && !showMeet && !showPhone) {
      body += '（連絡方法が設定されていません）\n';
    }
    body += '\n';

    var guestCountInfants = map.guestCountInfants >= 0 ? cellVal_(map.guestCountInfants) : '';
    var prevStay = map.prevStay >= 0 ? cellVal_(map.prevStay) : '';
    var nextStay = map.nextStay >= 0 ? cellVal_(map.nextStay) : '';
    var tel2 = map.telCols.length > 1 ? cellVal_(map.telCols[1]) : '';
    var email1 = (map.emailCols && map.emailCols.length > 0) ? cellVal_(map.emailCols[0]) : '';

    // 予約情報
    body += '【予約情報】\n';
    if (checkIn) body += 'チェックイン: ' + checkIn + '\n';
    if (checkOut) body += 'チェックアウト: ' + checkOut + '\n';
    if (guestCount) body += '人数: ' + guestCount + '名\n';
    if (guestCountInfants) body += '乳幼児: ' + guestCountInfants + '名\n';
    if (tel) body += '電話番号1: ' + tel + '\n';
    if (tel2) body += '電話番号2: ' + tel2 + '\n';
    if (email1) body += 'メール: ' + email1 + '\n';
    if (prevStay) body += '前の滞在地: ' + prevStay + '\n';
    if (nextStay) body += '次の滞在地: ' + nextStay + '\n';

    // 全ゲスト情報（国籍・旅券番号・パスポート写真含む）
    for (var g = 0; g < map.guestNameCols.length; g++) {
      var gn = cellVal_(map.guestNameCols[g]);
      if (!gn && g > 0) continue;
      body += '\n[宿泊者' + (g + 1) + ']\n';
      body += '名前: ' + (gn || '(未入力)') + '\n';
      if (g < map.nationalityCols.length) {
        var nat = cellVal_(map.nationalityCols[g]);
        if (nat) body += '国籍: ' + nat + '\n';
      }
      if (g < map.passportNumberCols.length) {
        var ppNum = cellVal_(map.passportNumberCols[g]);
        if (ppNum) body += '旅券番号: ' + ppNum + '\n';
      }
      if (g < map.passportPhotoCols.length && map.passportPhotoCols[g] >= 0) {
        var ppPhoto = String(row[map.passportPhotoCols[g]] || '').trim();
        if (ppPhoto && ppPhoto.indexOf('http') === 0) body += 'パスポート写真: ' + ppPhoto + '\n';
      }
      if (g < map.addressCols.length) {
        var addr = cellVal_(map.addressCols[g]);
        if (addr) body += '住所: ' + addr + '\n';
      }
      if (g < map.ageCols.length) {
        var age = cellVal_(map.ageCols[g]);
        if (age) body += '年齢: ' + age + '\n';
      }
    }

    // 修正内容
    var editKeys = Object.keys(edits);
    if (editKeys.length > 0) {
      body += '\n【宿泊者が修正した内容】\n';
      for (var e = 0; e < editKeys.length; e++) {
        var ed = edits[editKeys[e]];
        body += '・' + (ed.fieldName || 'カラム' + editKeys[e]) + ': ';
        body += '「' + (ed.original || '(空)') + '」→「' + (ed.edited || '(空)') + '」\n';
      }
    } else {
      body += '\n※ 宿泊者による情報の修正はありません。\n';
    }

    body += '\n---\nこのメールはチェックインアプリから自動送信されました。';

    var subject = '【チェックイン】' + guestName + ' さんが確認を完了しました';
    for (var ei = 0; ei < notifyEmails.length; ei++) {
      MailApp.sendEmail(notifyEmails[ei], subject, body);
    }

    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/** チェックイン記録一覧を取得（設定画面用） */
function getCheckinLog() {
  var log = PropertiesService.getScriptProperties().getProperty('CHECKIN_LOG') || '[]';
  return log;
}

// ===== 管理者画面用API =====

/** 今後の予約一覧を取得（チェックアウトが今日以降）
 *  データ取得ロジックはgetGuestDetails/searchGuestに準拠:
 *  - buildCheckinColumnMap_ でカラムマップ構築
 *  - getEditsForRow_ で編集シートの差分をオーバーレイ
 *  - formatDate_ で日付フォーマット
 *  - 全ゲスト情報（名前・国籍・年齢・住所・旅券番号）を含む
 */
function getAdminGuestList() {
  try {
    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true, guests: [] });

    var data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
    var headers = data[0];
    var map = buildCheckinColumnMap_(headers);

    // チェックイン確認日時カラムを検索
    var ciConfirmCol = -1;
    for (var ci = 0; ci < headers.length; ci++) {
      if (String(headers[ci] || '').trim() === 'チェックイン確認日時') { ciConfirmCol = ci; break; }
    }

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    // 90日以上前のチェックアウトをスキップ（メインアプリgetData()と同じ）
    var cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    var guests = [];
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var rowNumber = r + 1;

      // 90日以上前の予約はスキップ（メインアプリgetData()と同じ）
      if (map.checkOut >= 0) {
        var coVal = row[map.checkOut];
        if (coVal) {
          var coDate = coVal instanceof Date ? coVal : new Date(coVal);
          if (!isNaN(coDate.getTime()) && coDate < cutoffDate) continue;
        }
      }

      // 編集シートから差分を取得（getGuestDetailsと同じパターン）
      var edits = getEditsForRow_(rowNumber);

      /** セル値を取得（編集があればそちらを優先）— getGuestDetailsのcellVal_と同じ */
      function cellVal_(colIndex) {
        if (colIndex < 0) return '';
        if (edits[String(colIndex)]) return String(edits[String(colIndex)].edited || '');
        var v = row[colIndex];
        if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/M/d HH:mm');
        return String(v || '').trim();
      }

      // 代表ゲスト名（1人目）— メインアプリgetData()と同じくフィルタしない
      var primaryName = '';
      if (map.guestNameCols.length > 0) primaryName = cellVal_(map.guestNameCols[0]);

      // CI/CO（編集シートオーバーレイ適用）— getGuestDetailsと同じパターン
      var ciStr = map.checkIn >= 0
        ? (edits[String(map.checkIn)] ? cellVal_(map.checkIn) : formatDate_(row[map.checkIn]))
        : '';
      var coStr = map.checkOut >= 0
        ? (edits[String(map.checkOut)] ? cellVal_(map.checkOut) : formatDate_(row[map.checkOut]))
        : '';

      // CI/COが両方ない完全な空行のみスキップ（メインアプリgetData()準拠）
      if (!ciStr && !coStr) continue;

      // 基本情報
      var gc = cellVal_(map.guestCount);
      var gci = cellVal_(map.guestCountInfants);
      var tel1 = map.telCols.length > 0 ? cellVal_(map.telCols[0]) : '';
      var tel2 = map.telCols.length > 1 ? cellVal_(map.telCols[1]) : '';
      var email = (map.emailCols && map.emailCols.length > 0) ? cellVal_(map.emailCols[0]) : '';
      var prevStay = cellVal_(map.prevStay);
      var nextStay = cellVal_(map.nextStay);
      var checkinAt = ciConfirmCol >= 0 ? String(row[ciConfirmCol] || '').trim() : '';

      // 全ゲスト情報（getGuestDetailsと同じパターン）
      var guestNames = [];
      var guestDetails = [];
      for (var g = 0; g < map.guestNameCols.length; g++) {
        var gName = cellVal_(map.guestNameCols[g]);
        if (!gName && g > 0) continue; // 2人目以降は名前がなければスキップ
        guestNames.push(gName);
        guestDetails.push({
          name: gName,
          nationality: g < map.nationalityCols.length ? cellVal_(map.nationalityCols[g]) : '',
          age: g < map.ageCols.length ? cellVal_(map.ageCols[g]) : '',
          address: g < map.addressCols.length ? cellVal_(map.addressCols[g]) : '',
          passportNumber: g < map.passportNumberCols.length ? cellVal_(map.passportNumberCols[g]) : '',
          passportPhotoUrl: (function() {
            // パスポート写真URL（getGuestDetailsと同じパターン）
            if (g < map.passportPhotoCols.length && map.passportPhotoCols[g] >= 0) {
              var pVal = String(row[map.passportPhotoCols[g]] || '').trim();
              if (pVal && pVal.indexOf('http') === 0) return pVal;
            }
            return '';
          })()
        });
      }

      guests.push({
        rowNumber: rowNumber,
        guestName: primaryName,
        guestNames: guestNames,
        guests: guestDetails,
        checkIn: ciStr,
        checkOut: coStr,
        checkInParsed: ciStr.replace(/\s.*$/, ''), // ソート・マージ用の日付部分のみ
        guestCount: gc,
        guestCountInfants: gci,
        tel: tel1,
        tel2: tel2,
        email: email,
        prevStay: prevStay,
        nextStay: nextStay,
        nationality: guestDetails.length > 0 ? guestDetails[0].nationality : '',
        checkinConfirmedAt: checkinAt,
        hasEdits: Object.keys(edits).length > 0
      });
    }

    // 重複排除マージ（メインアプリindex.htmlのbuildCalendarEventsと同じロジック）
    // マッチ条件: チェックイン日が同じなら常にマージ（同一物件で同日CIは1予約のみ）
    var merged = [];
    var ciKeyMap = {}; // checkInParsed → merged配列のindex
    for (var mi = 0; mi < guests.length; mi++) {
      var entry = guests[mi];
      var ciKey = entry.checkInParsed;
      if (!ciKey) { merged.push(entry); continue; }

      if (ciKeyMap[ciKey] !== undefined) {
        var existIdx = ciKeyMap[ciKey];
        var existing = merged[existIdx];
        mergeGuestEntry_(existing, entry);
        continue;
      }
      ciKeyMap[ciKey] = merged.length;
      merged.push(entry);
    }

    // チェックイン日でソート（昇順）
    merged.sort(function(a, b) {
      return (a.checkIn || '').localeCompare(b.checkIn || '');
    });

    // テスト予約を先頭に追加（管理者画面の名簿でもテストデータを確認可能）
    var testDetail = getTestGuestDetails_();
    merged.unshift({
      rowNumber: TEST_ROW_NUMBER_,
      guestName: TEST_GUEST_.name + '（テスト）',
      guestNames: [TEST_GUEST_.name],
      guests: testDetail.guests,
      checkIn: TEST_GUEST_.checkIn,
      checkOut: TEST_GUEST_.checkOut,
      checkInParsed: TEST_GUEST_.checkIn.replace(/\s.*$/, ''),
      guestCount: TEST_GUEST_.guestCount,
      guestCountInfants: TEST_GUEST_.guestCountInfants,
      tel: TEST_GUEST_.phone,
      tel2: TEST_GUEST_.tel2,
      email: TEST_GUEST_.email,
      prevStay: TEST_GUEST_.prevStay,
      nextStay: TEST_GUEST_.nextStay,
      nationality: TEST_GUEST_.nationality,
      checkinConfirmedAt: '',
      hasEdits: false
    });

    return JSON.stringify({ success: true, guests: merged });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/** プレースホルダ名判定（メインアプリindex.htmlのisPlaceholderNameと同じ） */
function isPlaceholderName_(name) {
  if (!name) return true;
  return /^(Not available|Reserved|CLOSED|Blocked|Airbnb(予約)?|Booking\.com(予約)?|Rakuten|楽天)$/i.test(name.trim());
}

/** 同一CI予約のマージ（メインアプリindex.htmlのmergeBookingDataと同じパターン）
 *  - プレースホルダ名より実名を優先
 *  - 空フィールドを補完
 *  - ゲスト詳細情報を統合
 */
function mergeGuestEntry_(existing, b) {
  // guestName: プレースホルダ名より実名を優先
  if (isPlaceholderName_(existing.guestName) && !isPlaceholderName_(b.guestName)) {
    existing.guestName = b.guestName;
  }
  // 空フィールドを補完
  var fields = ['guestCount', 'guestCountInfants', 'tel', 'tel2', 'email', 'prevStay', 'nextStay', 'nationality', 'checkinConfirmedAt'];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (!existing[f] && b[f]) existing[f] = b[f];
  }
  // checkOut補完・不一致時の解決（メインアプリと同じ）
  if (!existing.checkOut && b.checkOut) {
    existing.checkOut = b.checkOut;
  } else if (existing.checkOut && b.checkOut && existing.checkOut !== b.checkOut) {
    // 両方にCOがある場合、後の日付を採用
    if (b.checkOut > existing.checkOut) existing.checkOut = b.checkOut;
  }
  // ゲスト詳細: 実名ゲストの情報を優先
  if (b.guests && b.guests.length > 0) {
    if (!existing.guests || existing.guests.length === 0 ||
        (existing.guests.length === 1 && isPlaceholderName_(existing.guests[0].name))) {
      existing.guests = b.guests;
      existing.guestNames = b.guestNames;
    }
  }
  // 編集済みフラグ
  if (b.hasEdits) existing.hasEdits = true;
  // マージ元の行番号を記録
  if (!existing.mergedRowNumbers) existing.mergedRowNumbers = [existing.rowNumber];
  existing.mergedRowNumbers.push(b.rowNumber);
}

/** WebアプリのベースURLを取得 */
function getAppBaseUrl() {
  return ScriptApp.getService().getUrl();
}

/** スプレッドシートURLを取得 */
function getSpreadsheetUrl() {
  var ssId = getSpreadsheetId_();
  if (!ssId) return JSON.stringify({ success: false, error: 'スプレッドシートIDが未設定です' });
  return JSON.stringify({ success: true, url: 'https://docs.google.com/spreadsheets/d/' + ssId });
}

/** カメラ設定を取得 */
function getCameraSettings() {
  var json = PropertiesService.getScriptProperties().getProperty('CAMERA_LIST') || '[]';
  return json;
}

/** カメラ設定を保存 */
function saveCameraSettings(camerasJson) {
  PropertiesService.getScriptProperties().setProperty('CAMERA_LIST', camerasJson);
  return JSON.stringify({ success: true });
}
