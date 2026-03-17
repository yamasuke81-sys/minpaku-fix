/**
 * チェックインアプリ — Code.gs
 * 宿泊者がチェックイン時にポストのスマホで自分の予約情報を確認・修正するためのWebアプリ
 */

// ===== エントリーポイント =====

function doGet(e) {
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
  { key: 'guestCount', label: '宿泊人数', visible: true },
  { key: 'guestCountInfants', label: '3才以下の人数', visible: true },
  { key: 'checkIn', label: 'チェックイン', visible: true },
  { key: 'checkOut', label: 'チェックアウト', visible: true },
  { key: 'guestName', label: '氏名', visible: true },
  { key: 'age', label: '年齢', visible: true },
  { key: 'address', label: '住所', visible: true },
  { key: 'tel', label: '電話番号', visible: true },
  { key: 'nationality', label: '国籍', visible: true },
  { key: 'passportNumber', label: '旅券番号', visible: true },
  { key: 'passportPhoto', label: 'パスポート写真', visible: true },
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
    settingsPin: props.getProperty('SETTINGS_PIN') || '0000',
    sheetName: props.getProperty('SHEET_NAME') || 'フォームの回答 1',
    displayFields: fields
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
  if (s.settingsPin !== undefined) props.setProperty('SETTINGS_PIN', s.settingsPin);
  if (s.sheetName !== undefined) props.setProperty('SHEET_NAME', s.sheetName);
  if (s.displayFields !== undefined) props.setProperty('DISPLAY_FIELDS', JSON.stringify(s.displayFields));
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
    contactType: props.getProperty('CONTACT_TYPE') || 'meet',
    meetUrl: props.getProperty('MEET_URL') || '',
    phoneNumber: props.getProperty('PHONE_NUMBER') || ''
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

/** ヘッダーからカラムマップを構築 */
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

  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').trim();
    var hl = h.toLowerCase();

    // チェックイン・チェックアウト
    if (h.indexOf('チェックイン') > -1 && h.indexOf('チェックアウト') === -1 && map.checkIn < 0) map.checkIn = i;
    if (h.indexOf('チェックアウト') > -1 && map.checkOut < 0) map.checkOut = i;

    // 宿泊人数
    if (h.indexOf('宿泊人数') > -1 && h.indexOf('3才以下') === -1 && h.indexOf('3歳以下') === -1 && map.guestCount < 0) map.guestCount = i;
    if ((h.indexOf('3才以下') > -1 || h.indexOf('3歳以下') > -1) && map.guestCountInfants < 0) map.guestCountInfants = i;

    // 前泊地・後泊地
    if (h.indexOf('前泊地') > -1 && map.prevStay < 0) map.prevStay = i;
    if ((h.indexOf('後泊地') > -1 || h.indexOf('行先地') > -1) && map.nextStay < 0) map.nextStay = i;

    // 氏名（複数ゲスト対応）
    if (h.indexOf('氏名') > -1 || hl === 'full name' || hl.indexOf('full name') > -1) {
      map.guestNameCols.push(i);
    }

    // 住所（複数ゲスト対応）
    if (h.indexOf('住所') > -1 || hl.indexOf('address') > -1) {
      map.addressCols.push(i);
    }

    // 年齢（複数ゲスト対応）
    if (h.indexOf('年齢') > -1 || (hl.indexOf('age') > -1 && hl.indexOf('page') === -1)) {
      map.ageCols.push(i);
    }

    // 国籍（複数ゲスト対応）
    if (h.indexOf('国籍') > -1 || hl.indexOf('nationality') > -1) {
      map.nationalityCols.push(i);
    }

    // 旅券番号（パスポート写真と区別）
    if (h.indexOf('旅券番号') > -1 || hl.indexOf('passport number') > -1) {
      map.passportNumberCols.push(i);
    }

    // パスポート写真
    if ((h.indexOf('パスポート') > -1 || hl.indexOf('passport') > -1) &&
        (h.indexOf('アップロード') > -1 || h.indexOf('upload') > -1 || hl.indexOf('upload') > -1 || hl.indexOf('photo') > -1)) {
      map.passportPhotoCols.push(i);
    }

    // 電話番号
    if ((h.indexOf('電話') > -1 || h.indexOf('TEL') > -1 || hl.indexOf('phone') > -1) &&
        h.indexOf('オーナー') === -1) {
      map.telCols.push(i);
    }

    // メールアドレス
    if ((h.indexOf('メール') > -1 || hl.indexOf('mail') > -1 || hl.indexOf('email') > -1) &&
        h.indexOf('オーナー') === -1 && h.indexOf('非常に重要') === -1) {
      map.emailCols.push(i);
    }
  }

  return map;
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

/** ゲストを名前・電話番号で検索 */
function searchGuest(name, phone) {
  try {
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

    for (var r = 1; r < data.length; r++) {
      var row = data[r];

      // チェックアウトが過去の予約はスキップ（3日前まで許容）
      if (map.checkOut >= 0) {
        var coVal = row[map.checkOut];
        if (coVal) {
          var coDate = new Date(coVal);
          if (!isNaN(coDate.getTime())) {
            var cutoff = new Date(today);
            cutoff.setDate(cutoff.getDate() - 3);
            if (coDate < cutoff) continue;
          }
        }
      }

      // チェックインが30日以上先の予約はスキップ
      if (map.checkIn >= 0) {
        var ciVal = row[map.checkIn];
        if (ciVal) {
          var ciDate = new Date(ciVal);
          if (!isNaN(ciDate.getTime())) {
            var future = new Date(today);
            future.setDate(future.getDate() + 30);
            if (ciDate > future) continue;
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

      if (nameMatch || phoneMatch) {
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
          guestCount: gc,
          matchType: nameMatch && phoneMatch ? 'both' : (nameMatch ? 'name' : 'phone')
        });
      }
    }

    // マッチ度順にソート（both > name/phone）
    results.sort(function(a, b) {
      var order = { both: 0, name: 1, phone: 2 };
      return (order[a.matchType] || 9) - (order[b.matchType] || 9);
    });

    return JSON.stringify({ success: true, results: results });
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

/** ゲスト詳細を取得 */
function getGuestDetails(rowNumber) {
  try {
    var sheet = getSheet_();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var map = buildCheckinColumnMap_(headers);
    var row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];

    // 基本情報
    var result = {
      rowNumber: rowNumber,
      checkIn: map.checkIn >= 0 ? formatDate_(row[map.checkIn]) : '',
      checkOut: map.checkOut >= 0 ? formatDate_(row[map.checkOut]) : '',
      guestCount: map.guestCount >= 0 ? String(row[map.guestCount] || '').trim() : '',
      guestCountInfants: map.guestCountInfants >= 0 ? String(row[map.guestCountInfants] || '').trim() : '',
      prevStay: map.prevStay >= 0 ? String(row[map.prevStay] || '').trim() : '',
      nextStay: map.nextStay >= 0 ? String(row[map.nextStay] || '').trim() : '',
      guests: [],
      tel1: map.telCols.length > 0 ? String(row[map.telCols[0]] || '').trim() : '',
      tel2: map.telCols.length > 1 ? String(row[map.telCols[1]] || '').trim() : '',
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
      var gName = String(row[map.guestNameCols[g]] || '').trim();
      if (!gName && g > 0) continue; // 2人目以降は名前がなければスキップ

      var guest = {
        index: g,
        name: gName,
        address: g < map.addressCols.length ? String(row[map.addressCols[g]] || '').trim() : '',
        age: g < map.ageCols.length ? String(row[map.ageCols[g]] || '').trim() : '',
        nationality: g < map.nationalityCols.length ? String(row[map.nationalityCols[g]] || '').trim() : '',
        passportNumber: g < map.passportNumberCols.length ? String(row[map.passportNumberCols[g]] || '').trim() : '',
        passportPhotoUrl: ''
      };

      // パスポート写真URL
      if (g < map.passportPhotoCols.length) {
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

// ===== ゲスト情報更新（自動保存） =====

/** 単一セルを更新 */
function updateGuestField(rowNumber, colIndex, value) {
  try {
    var sheet = getSheet_();
    // colIndex は 0-based → Range は 1-based
    sheet.getRange(rowNumber, colIndex + 1).setValue(value);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// ===== チェックイン確認記録 =====

/** チェックイン確認を記録 */
function confirmCheckin(rowNumber) {
  try {
    var sheet = getSheet_();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var map = buildCheckinColumnMap_(headers);

    // ゲスト名を取得（ログ用）
    var row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
    var guestName = map.guestNameCols.length > 0 ? String(row[map.guestNameCols[0]] || '') : '';

    // チェックイン記録をScriptPropertiesに保存
    var props = PropertiesService.getScriptProperties();
    var log = JSON.parse(props.getProperty('CHECKIN_LOG') || '[]');
    log.push({
      rowNumber: rowNumber,
      guestName: guestName,
      confirmedAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')
    });
    // 最新100件のみ保持
    if (log.length > 100) log = log.slice(log.length - 100);
    props.setProperty('CHECKIN_LOG', JSON.stringify(log));

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
