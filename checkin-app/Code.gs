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
    // [DEBUG] 検索過程を記録
    var _dbgSkipped = { coPast: 0, ciFuture: 0, noMatch: 0 };
    var _dbgSamples = []; // 最初の5行のサンプル

    for (var r = 1; r < data.length; r++) {
      var row = data[r];

      // [DEBUG] 最初の5行のサンプルを記録
      if (_dbgSamples.length < 5) {
        var sampleNames = [];
        for (var sni = 0; sni < Math.min(map.guestNameCols.length, 2); sni++) {
          sampleNames.push(String(row[map.guestNameCols[sni]] || '').substring(0, 20));
        }
        var samplePhones = [];
        for (var sti = 0; sti < Math.min(map.telCols.length, 2); sti++) {
          samplePhones.push(String(row[map.telCols[sti]] || '').substring(0, 20));
        }
        _dbgSamples.push({
          row: r + 1,
          ci: map.checkIn >= 0 ? String(row[map.checkIn] || '').substring(0, 30) : '(unmapped)',
          co: map.checkOut >= 0 ? String(row[map.checkOut] || '').substring(0, 30) : '(unmapped)',
          names: sampleNames,
          phones: samplePhones
        });
      }

      // チェックアウトが過去の予約はスキップ
      if (map.checkOut >= 0) {
        var coVal = row[map.checkOut];
        if (coVal) {
          var coDate = new Date(coVal);
          if (!isNaN(coDate.getTime())) {
            if (coDate < today) { _dbgSkipped.coPast++; continue; }
          }
        }
      }

      // チェックインが30日以上先の予約はスキップ（ただし名前/電話マッチを先にチェック）
      var _skippedByCiFuture = false;
      if (map.checkIn >= 0) {
        var ciVal = row[map.checkIn];
        if (ciVal) {
          var ciDate = new Date(ciVal);
          if (!isNaN(ciDate.getTime())) {
            var future = new Date(today);
            future.setDate(future.getDate() + 30);
            if (ciDate > future) { _skippedByCiFuture = true; }
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
      if (_skippedByCiFuture) {
        _dbgSkipped.ciFuture++;
        if (nameMatch && phoneMatch) {
          if (!_dbgSkipped.ciFutureMatched) _dbgSkipped.ciFutureMatched = 0;
          _dbgSkipped.ciFutureMatched++;
        }
        continue;
      }

      if (!(nameMatch && phoneMatch)) { _dbgSkipped.noMatch++; }

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

    return JSON.stringify({ success: true, results: results, _debug: {
      searchInput: { name: name, phone: phone, normalizedName: normalizedSearchName, normalizedPhone: normalizedSearchPhone },
      colMap: { checkIn: map.checkIn, checkOut: map.checkOut, guestCount: map.guestCount, guestNameCols: map.guestNameCols.slice(0,3), telCols: map.telCols },
      totalRows: data.length - 1,
      skipped: _dbgSkipped,
      samples: _dbgSamples,
      today: Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy/M/d')
    }});
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

    // [DEBUG] カラムマップ＋ヘッダー名＋生値をデバッグ情報として返す
    var debugColMap = {};
    var singleKeys = ['checkIn','checkOut','guestCount','guestCountInfants','prevStay','nextStay'];
    for (var si = 0; si < singleKeys.length; si++) {
      var sk = singleKeys[si];
      var idx = map[sk];
      debugColMap[sk] = {
        colIndex: idx,
        header: idx >= 0 ? String(headers[idx] || '').substring(0, 50) : '(未検出)',
        rawValue: idx >= 0 ? String(row[idx] || '').substring(0, 50) : ''
      };
    }
    var arrayKeys = ['guestNameCols','addressCols','ageCols','nationalityCols','passportNumberCols','passportPhotoCols','telCols','emailCols'];
    for (var ai = 0; ai < arrayKeys.length; ai++) {
      var ak = arrayKeys[ai];
      var arr = map[ak] || [];
      debugColMap[ak] = [];
      for (var aidx = 0; aidx < arr.length; aidx++) {
        var ci = arr[aidx];
        debugColMap[ak].push({
          colIndex: ci,
          header: ci >= 0 ? String(headers[ci] || '').substring(0, 50) : '(未検出)',
          rawValue: ci >= 0 ? String(row[ci] || '').substring(0, 50) : ''
        });
      }
    }
    // 全ヘッダー一覧（最初の60列）
    var allHeaders = [];
    for (var hi = 0; hi < Math.min(headers.length, 60); hi++) {
      allHeaders.push({ col: hi, header: String(headers[hi] || '').substring(0, 60) });
    }
    result._debug = { colMap: debugColMap, allHeaders: allHeaders, totalCols: headers.length };

    return JSON.stringify({ success: true, data: result });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// ===== ゲスト情報更新（編集シートに差分記録） =====

/** 単一セルを編集シートに記録（フォームの回答1は変更しない） */
function updateGuestField(rowNumber, colIndex, value) {
  try {
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
