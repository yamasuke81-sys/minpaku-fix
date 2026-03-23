/**
 * アラームアプリ — Code.gs
 * タブレット（Fully Kiosk Browser）でチェックアウト当日の清掃アラーム＋
 * スケジュールメッセージ（静音時間通知等）を表示するWebアプリ
 *
 * 機能:
 * - 30秒ごとのポーリングで本日チェックアウトの予約を検出→清掃アラーム
 * - 管理画面で予約にチェック→任意の時間にカスタムメッセージ表示＋アラーム
 * - 複数メッセージテンプレート×異なる時間帯を設定可能
 * - 待機中は時計表示（デジタルサイネージ風）
 */

// ===== エントリーポイント =====

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('alarm')
    .setTitle('清掃アラーム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ===== 設定管理 =====

function getSpreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
}

/** アラーム設定を取得 */
function getAlarmSettings() {
  var props = PropertiesService.getScriptProperties();
  var schedulesJson = props.getProperty('SCHEDULED_MESSAGES') || '[]';
  var schedules;
  try { schedules = JSON.parse(schedulesJson); } catch (e) { schedules = []; }

  return JSON.stringify({
    spreadsheetId: props.getProperty('SPREADSHEET_ID') || '',
    alarmTime: props.getProperty('ALARM_TIME') || '10:00',
    alarmMessage: props.getProperty('ALARM_MESSAGE') || '本日チェックアウトあり！清掃準備をお願いします',
    pin: props.getProperty('ALARM_PIN') || '1234',
    scheduledMessages: schedules
  });
}

/** アラーム設定を保存 */
function saveAlarmSettings(settings) {
  var props = PropertiesService.getScriptProperties();
  if (settings.spreadsheetId !== undefined) props.setProperty('SPREADSHEET_ID', settings.spreadsheetId);
  if (settings.alarmTime !== undefined) props.setProperty('ALARM_TIME', settings.alarmTime);
  if (settings.alarmMessage !== undefined) props.setProperty('ALARM_MESSAGE', settings.alarmMessage);
  if (settings.pin !== undefined) props.setProperty('ALARM_PIN', settings.pin);
  if (settings.scheduledMessages !== undefined) {
    props.setProperty('SCHEDULED_MESSAGES', JSON.stringify(settings.scheduledMessages));
  }
  return JSON.stringify({ success: true });
}

/** PIN認証 */
function verifyPin(pin) {
  var stored = PropertiesService.getScriptProperties().getProperty('ALARM_PIN') || '1234';
  return JSON.stringify({ ok: pin === stored });
}

// ===== スケジュールメッセージ管理 =====

/**
 * スケジュールメッセージのデフォルトテンプレート
 * scheduledMessages配列の各要素:
 * {
 *   id: "msg_1",
 *   label: "静音時間のお知らせ",
 *   message: "まもなく静音時間です。22時以降は...",
 *   messageEn: "Quiet hours begin at 10 PM...",
 *   times: ["21:30", "22:00"],
 *   enabled: true
 * }
 */

/** スケジュールメッセージの保存 */
function saveScheduledMessages(messages) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SCHEDULED_MESSAGES', JSON.stringify(messages));
  return JSON.stringify({ success: true });
}

/** 予約のメッセージ配信チェック状態を取得 */
function getBookingMessageFlags() {
  var props = PropertiesService.getScriptProperties();
  var json = props.getProperty('BOOKING_MSG_FLAGS') || '{}';
  try { return json; } catch (e) { return '{}'; }
}

/**
 * 予約のメッセージ配信チェック状態を保存
 * flags: { "rowNumber": { "msg_1": true, "msg_2": false }, ... }
 */
function saveBookingMessageFlags(flags) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('BOOKING_MSG_FLAGS', JSON.stringify(flags));
  return JSON.stringify({ success: true });
}

/**
 * アラーム確認記録を保存（フロントエンドから呼ばれる）
 * alarmId: "checkout_10:00" or "msg_1_21:30" など
 */
function recordAlarmDismiss(alarmId) {
  var props = PropertiesService.getScriptProperties();
  var todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var key = 'DISMISSED_' + todayStr;
  var json = props.getProperty(key) || '{}';
  var dismissed;
  try { dismissed = JSON.parse(json); } catch (e) { dismissed = {}; }
  dismissed[alarmId] = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm:ss');
  props.setProperty(key, JSON.stringify(dismissed));
  return JSON.stringify({ success: true });
}

// ===== 予約データ取得 =====

/**
 * ポーリング用: 本日のチェックアウト + スケジュールメッセージ対象予約 + 確認済みアラーム
 * フロントエンドから30秒ごとに呼ばれる
 */
function getTodayCheckouts() {
  var ssId = getSpreadsheetId_();
  if (!ssId) return JSON.stringify({ error: 'SPREADSHEET_ID未設定', checkouts: [] });

  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName('フォームの回答 1');
    if (!sheet) return JSON.stringify({ error: 'シートが見つかりません', checkouts: [] });

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ checkouts: [], nextCheckins: [], scheduledAlarms: [] });

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colMap = buildAlarmColumnMap_(headers);

    if (colMap.checkOut < 0) return JSON.stringify({ error: 'チェックアウト列が見つかりません', checkouts: [] });

    var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    var now = new Date();
    var todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd');
    var nowTime = Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm');

    // 本日チェックアウト
    var checkouts = [];
    // 現在宿泊中の予約（CI <= 今日 < CO）
    var currentStays = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (colMap.cancelledAt >= 0 && row[colMap.cancelledAt]) continue;

      var coVal = row[colMap.checkOut];
      var ciVal = colMap.checkIn >= 0 ? row[colMap.checkIn] : null;
      if (!coVal) continue;

      var coDate = coVal instanceof Date ? coVal : new Date(coVal);
      if (isNaN(coDate.getTime())) continue;
      var coStr = Utilities.formatDate(coDate, 'Asia/Tokyo', 'yyyy/MM/dd');

      var ciDate = null, ciStr = '';
      if (ciVal) {
        ciDate = ciVal instanceof Date ? ciVal : new Date(ciVal);
        if (!isNaN(ciDate.getTime())) ciStr = Utilities.formatDate(ciDate, 'Asia/Tokyo', 'yyyy/MM/dd');
        else ciDate = null;
      }

      var guestName = colMap.guestName >= 0 ? String(row[colMap.guestName] || '') : '';
      var bookingSite = colMap.bookingSite >= 0 ? String(row[colMap.bookingSite] || '') : '';
      var guestCount = colMap.guestCount >= 0 ? String(row[colMap.guestCount] || '') : '';
      var cleaningStaff = colMap.cleaningStaff >= 0 ? String(row[colMap.cleaningStaff] || '') : '';
      var bbq = colMap.bbq >= 0 ? String(row[colMap.bbq] || '') : '';

      var booking = {
        rowNumber: i + 2,
        guestName: guestName,
        checkIn: ciStr,
        checkOut: coStr,
        checkOutTime: Utilities.formatDate(coDate, 'Asia/Tokyo', 'HH:mm'),
        bookingSite: bookingSite,
        guestCount: guestCount,
        cleaningStaff: cleaningStaff,
        bbq: bbq
      };

      // 本日チェックアウト
      if (coStr === todayStr) {
        checkouts.push(booking);
      }

      // 現在宿泊中（CI <= 今日 かつ CO > 今日、またはCO == 今日）
      if (ciDate && ciStr <= todayStr && coStr >= todayStr) {
        currentStays.push(booking);
      }
    }

    // 次のチェックイン情報
    var nextCheckins = getNextCheckins_(data, colMap, todayStr);

    // アラーム設定
    var props = PropertiesService.getScriptProperties();
    var alarmTime = props.getProperty('ALARM_TIME') || '10:00';
    var alarmMessage = props.getProperty('ALARM_MESSAGE') || '本日チェックアウトあり！清掃準備をお願いします';

    // スケジュールメッセージ設定
    var schedulesJson = props.getProperty('SCHEDULED_MESSAGES') || '[]';
    var schedules;
    try { schedules = JSON.parse(schedulesJson); } catch (e) { schedules = []; }

    // 予約のメッセージ配信フラグ
    var flagsJson = props.getProperty('BOOKING_MSG_FLAGS') || '{}';
    var flags;
    try { flags = JSON.parse(flagsJson); } catch (e) { flags = {}; }

    // 本日の確認済みアラーム
    var todayKey = 'DISMISSED_' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
    var dismissedJson = props.getProperty(todayKey) || '{}';
    var dismissed;
    try { dismissed = JSON.parse(dismissedJson); } catch (e) { dismissed = {}; }

    return JSON.stringify({
      checkouts: checkouts,
      currentStays: currentStays,
      nextCheckins: nextCheckins,
      alarmTime: alarmTime,
      alarmMessage: alarmMessage,
      scheduledMessages: schedules,
      bookingMsgFlags: flags,
      dismissed: dismissed,
      serverTime: Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'),
      serverTimeHHMM: nowTime
    });

  } catch (e) {
    return JSON.stringify({ error: e.message, checkouts: [] });
  }
}

/**
 * 管理画面用: 現在宿泊中＋本日チェックインの予約一覧
 */
function getActiveBookings() {
  var ssId = getSpreadsheetId_();
  if (!ssId) return JSON.stringify({ error: 'SPREADSHEET_ID未設定', bookings: [] });

  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName('フォームの回答 1');
    if (!sheet) return JSON.stringify({ error: 'シートが見つかりません', bookings: [] });

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ bookings: [] });

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colMap = buildAlarmColumnMap_(headers);
    var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    var now = new Date();
    var todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd');

    var bookings = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (colMap.cancelledAt >= 0 && row[colMap.cancelledAt]) continue;

      var coVal = row[colMap.checkOut];
      var ciVal = colMap.checkIn >= 0 ? row[colMap.checkIn] : null;
      if (!coVal || !ciVal) continue;

      var coDate = coVal instanceof Date ? coVal : new Date(coVal);
      var ciDate = ciVal instanceof Date ? ciVal : new Date(ciVal);
      if (isNaN(coDate.getTime()) || isNaN(ciDate.getTime())) continue;

      var coStr = Utilities.formatDate(coDate, 'Asia/Tokyo', 'yyyy/MM/dd');
      var ciStr = Utilities.formatDate(ciDate, 'Asia/Tokyo', 'yyyy/MM/dd');

      // 現在宿泊中（CI <= 今日 かつ CO >= 今日）またはCI==今日
      if (!(ciStr <= todayStr && coStr >= todayStr)) continue;

      var guestName = colMap.guestName >= 0 ? String(row[colMap.guestName] || '') : '';
      var guestCount = colMap.guestCount >= 0 ? String(row[colMap.guestCount] || '') : '';
      var bookingSite = colMap.bookingSite >= 0 ? String(row[colMap.bookingSite] || '') : '';
      var bbq = colMap.bbq >= 0 ? String(row[colMap.bbq] || '') : '';

      bookings.push({
        rowNumber: i + 2,
        guestName: guestName,
        checkIn: ciStr,
        checkOut: coStr,
        guestCount: guestCount,
        bookingSite: bookingSite,
        bbq: bbq
      });
    }

    // メッセージ配信フラグ
    var props = PropertiesService.getScriptProperties();
    var flagsJson = props.getProperty('BOOKING_MSG_FLAGS') || '{}';
    var flags;
    try { flags = JSON.parse(flagsJson); } catch (e) { flags = {}; }

    // スケジュールメッセージ
    var schedulesJson = props.getProperty('SCHEDULED_MESSAGES') || '[]';
    var schedules;
    try { schedules = JSON.parse(schedulesJson); } catch (e) { schedules = []; }

    return JSON.stringify({
      bookings: bookings,
      bookingMsgFlags: flags,
      scheduledMessages: schedules
    });

  } catch (e) {
    return JSON.stringify({ error: e.message, bookings: [] });
  }
}

// ===== 内部ヘルパー =====

function getNextCheckins_(data, colMap, todayStr) {
  if (colMap.checkIn < 0) return [];

  var checkins = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (colMap.cancelledAt >= 0 && row[colMap.cancelledAt]) continue;

    var ciVal = row[colMap.checkIn];
    if (!ciVal) continue;
    var ciDate = ciVal instanceof Date ? ciVal : new Date(ciVal);
    if (isNaN(ciDate.getTime())) continue;
    var ciStr = Utilities.formatDate(ciDate, 'Asia/Tokyo', 'yyyy/MM/dd');
    if (ciStr !== todayStr) continue;

    var guestName = colMap.guestName >= 0 ? String(row[colMap.guestName] || '') : '';
    var guestCount = colMap.guestCount >= 0 ? String(row[colMap.guestCount] || '') : '';
    var bbq = colMap.bbq >= 0 ? String(row[colMap.bbq] || '') : '';

    var coVal = colMap.checkOut >= 0 ? row[colMap.checkOut] : null;
    var coStr = '';
    if (coVal) {
      var coDate = coVal instanceof Date ? coVal : new Date(coVal);
      if (!isNaN(coDate.getTime())) coStr = Utilities.formatDate(coDate, 'Asia/Tokyo', 'yyyy/MM/dd');
    }

    checkins.push({
      guestName: guestName,
      checkIn: ciStr,
      checkOut: coStr,
      guestCount: guestCount,
      bbq: bbq
    });
  }
  return checkins;
}

function buildAlarmColumnMap_(headers) {
  var map = {
    checkIn: -1, checkOut: -1, guestName: -1, bookingSite: -1,
    guestCount: -1, cleaningStaff: -1, bbq: -1, cancelledAt: -1
  };

  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').trim();
    if (h === 'チェックイン / Check-in' && map.checkIn < 0) map.checkIn = i;
    if (h === 'チェックアウト / Check-out' && map.checkOut < 0) map.checkOut = i;
    if (h.indexOf('氏名') > -1 && map.guestName < 0) map.guestName = i;
    if (h.indexOf('どこでこのホテルを予約') > -1 && map.bookingSite < 0) map.bookingSite = i;
    if (h.indexOf('宿泊人数') > -1 && h.indexOf('3才以下') === -1 && map.guestCount < 0) map.guestCount = i;
    if (h === '清掃担当' && map.cleaningStaff < 0) map.cleaningStaff = i;
    if (h.indexOf('バーベキュー') > -1 && map.bbq < 0) map.bbq = i;
    if (h === 'キャンセル日時' && map.cancelledAt < 0) map.cancelledAt = i;
  }

  return map;
}
