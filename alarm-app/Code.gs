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
    .setTitle('騒音アラーム')
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

  // ALARM_TIMES（複数時刻）対応。旧ALARM_TIME（単一）からの移行もサポート
  var alarmTimesJson = props.getProperty('ALARM_TIMES') || '';
  var alarmTimes;
  if (alarmTimesJson) {
    try { alarmTimes = JSON.parse(alarmTimesJson); } catch (e) { alarmTimes = []; }
  } else {
    // 旧形式（単一時刻）からの移行
    var singleTime = props.getProperty('ALARM_TIME') || '10:00';
    alarmTimes = [singleTime];
  }

  var coMsgJson = props.getProperty('CHECKOUT_MESSAGES') || '[]';
  var checkoutMessages;
  try { checkoutMessages = JSON.parse(coMsgJson); } catch (e) { checkoutMessages = []; }

  return JSON.stringify({
    spreadsheetId: props.getProperty('SPREADSHEET_ID') || '',
    alarmTimes: alarmTimes,
    alarmMessage: props.getProperty('ALARM_MESSAGE') || 'チェックアウトの時間です。\nお忘れ物がないかご確認のうえ、ご退室をお願いいたします。\nご利用ありがとうございました。',
    alarmMessageEn: props.getProperty('ALARM_MESSAGE_EN') || 'It is checkout time.\nPlease make sure you have all your belongings before leaving.\nThank you for your stay.',
    pin: props.getProperty('ALARM_PIN') || '1234',
    scheduledMessages: schedules,
    checkoutMessages: checkoutMessages,
    // 音量・音種設定（各アラームタイプ別）
    checkoutVolume: Number(props.getProperty('CHECKOUT_VOLUME') || '80'),
    checkoutSound: props.getProperty('CHECKOUT_SOUND') || 'chime',
    messageVolume: Number(props.getProperty('MESSAGE_VOLUME') || '60'),
    messageSound: props.getProperty('MESSAGE_SOUND') || 'chime',
    complaintVolume: Number(props.getProperty('COMPLAINT_VOLUME') || '100'),
    complaintSound: props.getProperty('COMPLAINT_SOUND') || 'alarm'
  });
}

/** アラーム設定を保存 */
function saveAlarmSettings(settings) {
  var props = PropertiesService.getScriptProperties();
  if (settings.spreadsheetId !== undefined) props.setProperty('SPREADSHEET_ID', settings.spreadsheetId);
  if (settings.alarmTimes !== undefined) props.setProperty('ALARM_TIMES', JSON.stringify(settings.alarmTimes));
  if (settings.alarmMessage !== undefined) props.setProperty('ALARM_MESSAGE', settings.alarmMessage);
  if (settings.alarmMessageEn !== undefined) props.setProperty('ALARM_MESSAGE_EN', settings.alarmMessageEn);
  if (settings.pin !== undefined) props.setProperty('ALARM_PIN', settings.pin);
  if (settings.scheduledMessages !== undefined) {
    props.setProperty('SCHEDULED_MESSAGES', JSON.stringify(settings.scheduledMessages));
  }
  // 音量・音種設定
  if (settings.checkoutVolume !== undefined) props.setProperty('CHECKOUT_VOLUME', String(settings.checkoutVolume));
  if (settings.checkoutSound !== undefined) props.setProperty('CHECKOUT_SOUND', settings.checkoutSound);
  if (settings.messageVolume !== undefined) props.setProperty('MESSAGE_VOLUME', String(settings.messageVolume));
  if (settings.messageSound !== undefined) props.setProperty('MESSAGE_SOUND', settings.messageSound);
  if (settings.complaintVolume !== undefined) props.setProperty('COMPLAINT_VOLUME', String(settings.complaintVolume));
  if (settings.complaintSound !== undefined) props.setProperty('COMPLAINT_SOUND', settings.complaintSound);
  return JSON.stringify({ success: true });
}

/** PIN認証 */
function verifyPin(pin) {
  var stored = PropertiesService.getScriptProperties().getProperty('ALARM_PIN') || '1234';
  return JSON.stringify({ ok: pin === stored });
}

/**
 * 診断用関数 — GASエディタで手動実行してログを確認
 * Script Properties、スコープ、スプレッドシートアクセスをチェック
 */
function diagAlarmSetup() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('SPREADSHEET_ID');
  Logger.log('=== アラームアプリ診断 ===');
  Logger.log('SPREADSHEET_ID: ' + (ssId || '(未設定)'));
  Logger.log('SPREADSHEET_ID length: ' + (ssId ? ssId.length : 0));
  Logger.log('ALARM_PIN: ' + (props.getProperty('ALARM_PIN') || '(未設定→デフォルト1234)'));
  Logger.log('ALARM_TIMES: ' + (props.getProperty('ALARM_TIMES') || '(未設定)'));

  if (!ssId) {
    Logger.log('★ エラー: SPREADSHEET_IDが設定されていません！');
    Logger.log('★ 対処: GASエディタ左サイドバー「プロジェクトの設定」→「スクリプト プロパティ」で SPREADSHEET_ID を追加してください');
    return;
  }

  try {
    var ss = SpreadsheetApp.openById(ssId);
    Logger.log('✅ SpreadsheetApp.openById 成功: ' + ss.getName());
    var sheet = ss.getSheetByName('フォームの回答 1');
    if (sheet) {
      Logger.log('✅ シート「フォームの回答 1」発見: ' + sheet.getLastRow() + '行');
    } else {
      Logger.log('★ シート「フォームの回答 1」が見つかりません');
    }
  } catch (e) {
    Logger.log('★ SpreadsheetApp.openById エラー: ' + e.message);
    Logger.log('★ スタック: ' + e.stack);
    Logger.log('★ 対処: 権限の再承認が必要です。https://myaccount.google.com/permissions でこのアプリのアクセス権を一旦削除してから、この関数を再実行してください');
  }
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

/** チェックアウトメッセージテンプレートの保存 */
function saveCheckoutMessages(messages) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('CHECKOUT_MESSAGES', JSON.stringify(messages));
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
 * 予約のチェックアウト配信チェック状態を保存
 * flags: { "rowNumber": { "co_msg_1": true }, ... }
 */
function saveBookingCoFlags(flags) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('BOOKING_CO_FLAGS', JSON.stringify(flags));
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
  if (!ssId) return JSON.stringify({ error: 'SPREADSHEET_ID未設定。管理画面→基本設定でスプレッドシートIDを設定してください', checkouts: [], debug: { ssId: ssId, hasProps: !!PropertiesService.getScriptProperties() } });

  try {
    Logger.log('[DEBUG-ALARM] ssId=' + ssId + ', length=' + ssId.length);
    var ss = SpreadsheetApp.openById(ssId);
    Logger.log('[DEBUG-ALARM] openById success');
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
      var guestCountAdultsRaw = colMap.guestCount >= 0 ? String(row[colMap.guestCount] || '').trim() : '';
      var guestCountInfantsRaw = colMap.guestCountInfants >= 0 ? String(row[colMap.guestCountInfants] || '').trim() : '';
      var guestCountAdults = extractGuestCount_(guestCountAdultsRaw);
      var guestCountInfants = extractGuestCount_(guestCountInfantsRaw);
      var guestCountDisplay = formatGuestCountDisplay_(guestCountAdults, guestCountInfants);
      var cleaningStaff = colMap.cleaningStaff >= 0 ? String(row[colMap.cleaningStaff] || '') : '';
      var bbq = colMap.bbq >= 0 ? String(row[colMap.bbq] || '') : '';

      var booking = {
        rowNumber: i + 2,
        guestName: guestName,
        checkIn: ciStr,
        checkOut: coStr,
        checkOutTime: Utilities.formatDate(coDate, 'Asia/Tokyo', 'HH:mm'),
        bookingSite: bookingSite,
        guestCount: guestCountAdults || guestCountDisplay,
        guestCountAdults: guestCountAdults,
        guestCountInfants: guestCountInfants,
        guestCountDisplay: guestCountDisplay,
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

    // 重複排除（CI一致でマージ、実名優先）
    checkouts = deduplicateBookings_(checkouts);
    currentStays = deduplicateBookings_(currentStays);

    // 次のチェックイン情報
    var nextCheckins = deduplicateBookings_(getNextCheckins_(data, colMap, todayStr));

    // アラーム設定
    var props = PropertiesService.getScriptProperties();
    var alarmTimesJson = props.getProperty('ALARM_TIMES') || '';
    var alarmTimes;
    if (alarmTimesJson) {
      try { alarmTimes = JSON.parse(alarmTimesJson); } catch (e) { alarmTimes = []; }
    } else {
      alarmTimes = [(props.getProperty('ALARM_TIME') || '10:00')];
    }
    var alarmMessage = props.getProperty('ALARM_MESSAGE') || 'チェックアウトの時間です。\nお忘れ物がないかご確認のうえ、ご退室をお願いいたします。\nご利用ありがとうございました。';
    var alarmMessageEn = props.getProperty('ALARM_MESSAGE_EN') || 'It is checkout time.\nPlease make sure you have all your belongings before leaving.\nThank you for your stay.';

    // スケジュールメッセージ設定
    var schedulesJson = props.getProperty('SCHEDULED_MESSAGES') || '[]';
    var schedules;
    try { schedules = JSON.parse(schedulesJson); } catch (e) { schedules = []; }

    // チェックアウトメッセージ設定
    var coMsgJson = props.getProperty('CHECKOUT_MESSAGES') || '[]';
    var checkoutMessages;
    try { checkoutMessages = JSON.parse(coMsgJson); } catch (e) { checkoutMessages = []; }

    // 予約のメッセージ配信フラグ
    var flagsJson = props.getProperty('BOOKING_MSG_FLAGS') || '{}';
    var flags;
    try { flags = JSON.parse(flagsJson); } catch (e) { flags = {}; }

    // 予約のCO配信フラグ
    var coFlagsJson = props.getProperty('BOOKING_CO_FLAGS') || '{}';
    var coFlags;
    try { coFlags = JSON.parse(coFlagsJson); } catch (e) { coFlags = {}; }

    // 本日の確認済みアラーム
    var todayKey = 'DISMISSED_' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
    var dismissedJson = props.getProperty(todayKey) || '{}';
    var dismissed;
    try { dismissed = JSON.parse(dismissedJson); } catch (e) { dismissed = {}; }

    return JSON.stringify({
      checkouts: checkouts,
      currentStays: currentStays,
      nextCheckins: nextCheckins,
      alarmTimes: alarmTimes,
      alarmMessage: alarmMessage,
      alarmMessageEn: alarmMessageEn,
      scheduledMessages: schedules,
      checkoutMessages: checkoutMessages,
      bookingMsgFlags: flags,
      bookingCoFlags: coFlags,
      dismissed: dismissed,
      serverTime: Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'),
      serverTimeHHMM: nowTime,
      checkoutVolume: Number(props.getProperty('CHECKOUT_VOLUME') || '80'),
      checkoutSound: props.getProperty('CHECKOUT_SOUND') || 'chime',
      messageVolume: Number(props.getProperty('MESSAGE_VOLUME') || '60'),
      messageSound: props.getProperty('MESSAGE_SOUND') || 'chime',
      complaintVolume: Number(props.getProperty('COMPLAINT_VOLUME') || '100'),
      complaintSound: props.getProperty('COMPLAINT_SOUND') || 'alarm'
    });

  } catch (e) {
    return JSON.stringify({ error: '[getTodayCheckouts] ' + e.message + ' | ssId=' + ssId + ' | stack=' + (e.stack || 'なし'), checkouts: [] });
  }
}

/**
 * 管理画面用: 現在宿泊中＋本日チェックインの予約一覧
 */
function getActiveBookings() {
  var ssId = getSpreadsheetId_();
  if (!ssId) return JSON.stringify({ error: 'SPREADSHEET_ID未設定。管理画面→基本設定でスプレッドシートIDを設定してください', bookings: [] });

  try {
    Logger.log('[DEBUG-ALARM] getActiveBookings ssId=' + ssId);
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

      // 宿泊中 or 今後の予約（CO >= 今日）を表示。過去の予約は除外
      if (coStr < todayStr) continue;

      var guestName = colMap.guestName >= 0 ? String(row[colMap.guestName] || '') : '';
      var guestCountAdultsRaw = colMap.guestCount >= 0 ? String(row[colMap.guestCount] || '').trim() : '';
      var guestCountInfantsRaw = colMap.guestCountInfants >= 0 ? String(row[colMap.guestCountInfants] || '').trim() : '';
      var guestCountAdults = extractGuestCount_(guestCountAdultsRaw);
      var guestCountInfants = extractGuestCount_(guestCountInfantsRaw);
      var guestCountDisplay = formatGuestCountDisplay_(guestCountAdults, guestCountInfants);
      var bookingSite = colMap.bookingSite >= 0 ? String(row[colMap.bookingSite] || '') : '';
      var bbq = colMap.bbq >= 0 ? String(row[colMap.bbq] || '') : '';

      // 年齢データ収集（複数ゲスト対応）
      var ages = [];
      if (colMap.guestNameCols.length > 0 && colMap.ageCols.length > 0) {
        for (var gi = 0; gi < colMap.guestNameCols.length; gi++) {
          var nameCol = colMap.guestNameCols[gi];
          var nextNameCol = (gi + 1 < colMap.guestNameCols.length) ? colMap.guestNameCols[gi + 1] : -1;
          var gn = String(row[nameCol] || '').trim();
          if (!gn) continue;
          // 名前カラムに最も近い年齢カラムを探す
          var ageCol = -1;
          for (var ai = 0; ai < colMap.ageCols.length; ai++) {
            if (colMap.ageCols[ai] > nameCol && (nextNameCol < 0 || colMap.ageCols[ai] < nextNameCol)) {
              if (ageCol < 0) ageCol = colMap.ageCols[ai];
              if (String(row[colMap.ageCols[ai]] || '').trim()) { ageCol = colMap.ageCols[ai]; break; }
            }
          }
          var ageVal = ageCol >= 0 ? String(row[ageCol] || '').trim() : '';
          if (ageVal) ages.push(ageVal);
        }
      }

      bookings.push({
        rowNumber: i + 2,
        guestName: guestName,
        checkIn: ciStr,
        checkOut: coStr,
        guestCount: guestCountAdults || guestCountDisplay,
        guestCountAdults: guestCountAdults,
        guestCountInfants: guestCountInfants,
        guestCountDisplay: guestCountDisplay,
        bookingSite: bookingSite,
        bbq: bbq,
        ages: ages
      });
    }

    // 重複排除（CI一致でマージ、実名優先）
    bookings = deduplicateBookings_(bookings);

    // メッセージ配信フラグ
    var props = PropertiesService.getScriptProperties();
    var flagsJson = props.getProperty('BOOKING_MSG_FLAGS') || '{}';
    var flags;
    try { flags = JSON.parse(flagsJson); } catch (e) { flags = {}; }

    // スケジュールメッセージ
    var schedulesJson = props.getProperty('SCHEDULED_MESSAGES') || '[]';
    var schedules;
    try { schedules = JSON.parse(schedulesJson); } catch (e) { schedules = []; }

    // チェックアウトメッセージ
    var coMsgJson = props.getProperty('CHECKOUT_MESSAGES') || '[]';
    var checkoutMessages;
    try { checkoutMessages = JSON.parse(coMsgJson); } catch (e) { checkoutMessages = []; }

    // CO配信フラグ
    var coFlagsJson = props.getProperty('BOOKING_CO_FLAGS') || '{}';
    var coFlags;
    try { coFlags = JSON.parse(coFlagsJson); } catch (e) { coFlags = {}; }

    return JSON.stringify({
      bookings: bookings,
      bookingMsgFlags: flags,
      bookingCoFlags: coFlags,
      scheduledMessages: schedules,
      checkoutMessages: checkoutMessages
    });

  } catch (e) {
    return JSON.stringify({ error: '[getActiveBookings] ' + e.message + ' | ssId=' + ssId + ' | stack=' + (e.stack || 'なし'), bookings: [] });
  }
}

// ===== 重複排除 =====

/**
 * プレースホルダ名かどうか判定（メインアプリのisPlaceholderNameと同じロジック）
 */
function isPlaceholderName_(name) {
  if (!name) return true;
  return /^(Not available|Reserved|CLOSED|Blocked|Airbnb(予約)?|Booking\.com(予約)?|Rakuten|楽天)$/i.test(String(name).trim());
}

/**
 * 予約配列の重複排除（CI一致でマージ、実名優先）
 * メインアプリのbuildCalendarEventsと同じロジック
 */
function deduplicateBookings_(bookings) {
  var merged = [];
  var ciKeyMap = {}; // checkIn → merged配列のindex

  for (var i = 0; i < bookings.length; i++) {
    var b = bookings[i];
    var ci = b.checkIn;
    if (!ci) { merged.push(b); continue; }

    if (ciKeyMap[ci] !== undefined) {
      var existing = merged[ciKeyMap[ci]];
      // guestName: プレースホルダ名より実名を優先
      if (isPlaceholderName_(existing.guestName) && !isPlaceholderName_(b.guestName)) {
        existing.guestName = b.guestName;
      }
      // 各フィールド: 空の値を補完（メインアプリと同じロジック）
      var fields = ['guestCount', 'guestCountAdults', 'guestCountInfants', 'bookingSite', 'cleaningStaff', 'bbq'];
      for (var f = 0; f < fields.length; f++) {
        if (!existing[fields[f]] && b[fields[f]]) existing[fields[f]] = b[fields[f]];
      }
      // guestCountDisplay: 「-」より実データを優先
      if (b.guestCountDisplay && b.guestCountDisplay !== '-' && (!existing.guestCountDisplay || existing.guestCountDisplay === '-')) {
        existing.guestCountDisplay = b.guestCountDisplay;
      }
      // ages: より多いデータを優先
      if (b.ages && b.ages.length > 0 && (!existing.ages || existing.ages.length === 0)) {
        existing.ages = b.ages;
      }
      // CO不一致時: より後の日付（有効な方）を採用
      if (b.checkOut && existing.checkOut && b.checkOut !== existing.checkOut) {
        var eCoValid = existing.checkOut > ci;
        var bCoValid = b.checkOut > ci;
        if (!eCoValid && bCoValid) {
          existing.checkOut = b.checkOut;
        } else if (eCoValid && bCoValid && b.checkOut > existing.checkOut) {
          existing.checkOut = b.checkOut;
        }
      } else if (!existing.checkOut && b.checkOut) {
        existing.checkOut = b.checkOut;
      }
      // checkOutTime補完
      if (!existing.checkOutTime && b.checkOutTime) existing.checkOutTime = b.checkOutTime;
      continue;
    }

    ciKeyMap[ci] = merged.length;
    merged.push(b);
  }
  return merged;
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

// ===== 騒音クレームアラーム =====

/**
 * 外部から騒音クレームを受信するWebhookエンドポイント
 * LINE Messaging API Webhook or メール転送からPOSTで呼ばれる
 */
function doPost(e) {
  var props = PropertiesService.getScriptProperties();

  // LINE Messaging API Webhook
  if (e.postData && e.postData.type === 'application/json') {
    try {
      var body = JSON.parse(e.postData.contents);
      // LINE Webhook検証（チャレンジ応答）
      if (!body.events || body.events.length === 0) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      for (var i = 0; i < body.events.length; i++) {
        var ev = body.events[i];

        // LINE ID収集（全イベントからsource情報を記録）
        collectLineSource_(ev, props);

        if (ev.type !== 'message' || ev.message.type !== 'text') continue;

        var text = ev.message.text || '';
        var keywords = (props.getProperty('COMPLAINT_KEYWORDS') || '騒音,うるさい,noise,noisy,loud').split(',');
        var isComplaint = false;
        for (var k = 0; k < keywords.length; k++) {
          if (text.toLowerCase().indexOf(keywords[k].trim().toLowerCase()) >= 0) {
            isComplaint = true;
            break;
          }
        }

        if (isComplaint) {
          // 返信先を特定（グループならグループID、個人ならユーザーID）
          var replyTo = '';
          if (ev.source.type === 'group') {
            replyTo = ev.source.groupId || '';
          } else if (ev.source.type === 'room') {
            replyTo = ev.source.roomId || '';
          } else {
            replyTo = ev.source.userId || '';
          }

          triggerComplaintAlarm_({
            source: 'LINE',
            senderName: ev.source.userId || 'LINE User',
            message: text,
            replyTo: replyTo
          });

          // 近隣住民にLINE自動返信（reply APIで即時返信）
          replyToComplaint_(ev.replyToken, props);
        }
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      Logger.log('doPost LINE error: ' + err.message);
      return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // URLパラメータ形式（メール転送やカスタムトリガー）
  var params = e.parameter || {};
  if (params.action === 'complaint') {
    triggerComplaintAlarm_({
      source: params.source || 'manual',
      senderName: params.sender || '不明',
      message: params.message || '騒音クレームが報告されました'
    });

    return ContentService.createTextOutput(JSON.stringify({ status: 'alarm_triggered' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ignored' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 騒音クレームアラームを発報する */
function triggerComplaintAlarm_(info) {
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');

  // アラーム状態を保存（フロントエンドがポーリングで検知）
  var alarm = {
    active: true,
    triggeredAt: nowStr,
    source: info.source,
    senderName: info.senderName,
    message: info.message,
    replyTo: info.replyTo || ''  // 停止時の返信先（ユーザーID or グループID）
  };
  props.setProperty('COMPLAINT_ALARM', JSON.stringify(alarm));

  // オーナーに通知
  notifyOwnerComplaint_(info, 'triggered', nowStr);

  Logger.log('Complaint alarm triggered: ' + JSON.stringify(info));
}

/** 近隣住民にLINE自動返信 */
function replyToComplaint_(replyToken, props) {
  var token = props.getProperty('LINE_CHANNEL_TOKEN') || '';
  if (!token || !replyToken) return;

  var replyMsg = props.getProperty('COMPLAINT_REPLY_MESSAGE') ||
    '【自動送信です】\nご連絡ありがとうございます。\nご迷惑をおかけし大変申し訳ありません。\n宿泊者に注意喚起いたしました。\n（室内でアラーム発報、注意メッセージ表示）\n引き続きご迷惑をおかけする場合は、再度ご連絡ください。';

  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages: [{ type: 'text', text: replyMsg }]
      })
    });
  } catch (e) {
    Logger.log('LINE reply error: ' + e.message);
  }
}

/** オーナーにクレーム通知（発報時/停止時） */
function notifyOwnerComplaint_(info, event, timeStr) {
  var props = PropertiesService.getScriptProperties();
  var ownerEmail = props.getProperty('OWNER_EMAIL') || '';
  var lineToken = props.getProperty('LINE_CHANNEL_TOKEN') || '';
  var lineGroupId = props.getProperty('LINE_NOTIFY_GROUP_ID') || '';

  var subject, body;
  if (event === 'triggered') {
    subject = '【騒音クレーム】アラーム発報';
    body = '騒音クレームを受信し、施設タブレットにアラームを発報しました。\n\n'
      + '受信元: ' + info.source + '\n'
      + '送信者: ' + info.senderName + '\n'
      + 'メッセージ: ' + info.message + '\n'
      + '発報時刻: ' + timeStr;
  } else {
    subject = '【騒音クレーム】アラーム停止確認';
    body = '宿泊者がアラームを停止しました。\n\n'
      + '停止時刻: ' + timeStr;
  }

  // メール送信
  if (ownerEmail) {
    try { GmailApp.sendEmail(ownerEmail, subject, body); } catch (e) { Logger.log('Owner email error: ' + e.message); }
  }

  // LINE送信
  if (lineToken && lineGroupId) {
    try {
      UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'post',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lineToken },
        payload: JSON.stringify({
          to: lineGroupId,
          messages: [{ type: 'text', text: subject + '\n\n' + body }]
        })
      });
    } catch (e) { Logger.log('Owner LINE error: ' + e.message); }
  }
}

/** フロントエンドからポーリングで呼ばれる: 騒音クレームアラーム状態取得 */
function getComplaintAlarmStatus() {
  var props = PropertiesService.getScriptProperties();
  var json = props.getProperty('COMPLAINT_ALARM') || '{"active":false}';
  return json;
}

/** フロントエンドからアラーム停止時に呼ばれる */
function dismissComplaintAlarm() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');

  // アラーム状態から返信先を取得してからクリア
  var alarmData = {};
  try { alarmData = JSON.parse(props.getProperty('COMPLAINT_ALARM') || '{}'); } catch(e) {}
  var replyTo = alarmData.replyTo || '';

  // アラーム状態をクリア
  props.setProperty('COMPLAINT_ALARM', JSON.stringify({ active: false, dismissedAt: nowStr }));

  // オーナー+近隣住民に停止通知
  notifyOwnerComplaint_({}, 'dismissed', nowStr);
  notifyNeighborDismissed_(nowStr, replyTo);

  return JSON.stringify({ success: true });
}

/** 近隣住民にアラーム停止（確認済み）通知
 *  @param {string} timeStr 停止日時
 *  @param {string} replyTo クレーム送信元のLINE ID（ユーザーID or グループID）
 */
function notifyNeighborDismissed_(timeStr, replyTo) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('LINE_CHANNEL_TOKEN') || '';
  // 送信先: クレーム送信元 → 設定のグループID → なければ送信しない
  var sendTo = replyTo || props.getProperty('NEIGHBOR_LINE_GROUP_ID') || '';
  if (!token || !sendTo) return;

  var msg = props.getProperty('COMPLAINT_DISMISSED_MESSAGE') ||
    '【自動送信です】\n宿泊者が騒音についての注意を確認しました。\n引き続きご迷惑な場合は、お手数ですが再度ご連絡ください。\nご迷惑おかけして大変申し訳ありませんでした。';

  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({
        to: sendTo,
        messages: [{ type: 'text', text: msg }]
      })
    });
  } catch (e) { Logger.log('Neighbor LINE error: ' + e.message); }
}

/** 騒音クレーム設定を取得 */
function getComplaintSettings() {
  var props = PropertiesService.getScriptProperties();
  return JSON.stringify({
    ownerEmail: props.getProperty('OWNER_EMAIL') || '',
    lineChannelToken: props.getProperty('LINE_CHANNEL_TOKEN') || '',
    lineNotifyGroupId: props.getProperty('LINE_NOTIFY_GROUP_ID') || '',
    ownerLineId: props.getProperty('OWNER_LINE_ID') || '',
    cleaningGroupId: props.getProperty('CLEANING_GROUP_ID') || '',
    neighborLineGroupId: props.getProperty('NEIGHBOR_LINE_GROUP_ID') || '',
    complaintKeywords: props.getProperty('COMPLAINT_KEYWORDS') || '騒音,うるさい,noise,noisy,loud',
    complaintReplyMessage: props.getProperty('COMPLAINT_REPLY_MESSAGE') || '【自動送信です】\nご連絡ありがとうございます。\nご迷惑をおかけし大変申し訳ありません。\n宿泊者に注意喚起いたしました。\n（室内でアラーム発報、注意メッセージ表示）\n引き続きご迷惑をおかけする場合は、再度ご連絡ください。',
    complaintDismissedMessage: props.getProperty('COMPLAINT_DISMISSED_MESSAGE') || '【自動送信です】\n宿泊者が騒音についての注意を確認しました。\n引き続きご迷惑な場合は、お手数ですが再度ご連絡ください。\nご迷惑おかけして大変申し訳ありませんでした。',
    warningMessageJa: props.getProperty('COMPLAINT_WARNING_JA') || '近隣の方から騒音のクレームが入りました。\n\nただちに静かにしてください。\n\n静かにしない場合、警察に連絡します。\n即時退室していただく場合もあります。',
    warningMessageEn: props.getProperty('COMPLAINT_WARNING_EN') || 'A noise complaint has been received from a neighbor.\n\nPlease be quiet immediately.\n\nIf you do not comply, the police will be called.\nYou may be asked to leave immediately.'
  });
}

/** 騒音クレーム設定を保存 */
function saveComplaintSettings(settings) {
  var props = PropertiesService.getScriptProperties();
  if (settings.ownerEmail !== undefined) props.setProperty('OWNER_EMAIL', settings.ownerEmail);
  if (settings.lineChannelToken !== undefined) props.setProperty('LINE_CHANNEL_TOKEN', settings.lineChannelToken);
  if (settings.lineNotifyGroupId !== undefined) props.setProperty('LINE_NOTIFY_GROUP_ID', settings.lineNotifyGroupId);
  if (settings.ownerLineId !== undefined) props.setProperty('OWNER_LINE_ID', settings.ownerLineId);
  if (settings.cleaningGroupId !== undefined) props.setProperty('CLEANING_GROUP_ID', settings.cleaningGroupId);
  if (settings.neighborLineGroupId !== undefined) props.setProperty('NEIGHBOR_LINE_GROUP_ID', settings.neighborLineGroupId);
  if (settings.complaintKeywords !== undefined) props.setProperty('COMPLAINT_KEYWORDS', settings.complaintKeywords);
  if (settings.complaintReplyMessage !== undefined) props.setProperty('COMPLAINT_REPLY_MESSAGE', settings.complaintReplyMessage);
  if (settings.complaintDismissedMessage !== undefined) props.setProperty('COMPLAINT_DISMISSED_MESSAGE', settings.complaintDismissedMessage);
  if (settings.warningMessageJa !== undefined) props.setProperty('COMPLAINT_WARNING_JA', settings.warningMessageJa);
  if (settings.warningMessageEn !== undefined) props.setProperty('COMPLAINT_WARNING_EN', settings.warningMessageEn);
  return JSON.stringify({ success: true });
}

/** 手動でクレームアラームを発報するテスト用関数 */
function testTriggerComplaintAlarm() {
  triggerComplaintAlarm_({
    source: 'test',
    senderName: 'テスト',
    message: 'テスト: 騒音クレームアラーム発報テスト'
  });
}

/**
 * メッセージのテスト送信
 * @param {Object} params { messageId, label, message, messageEn, channels: { email, line } }
 * @return {string} JSON { success, results: { email, line } }
 */
function sendTestMessage(params) {
  try {
    var props = PropertiesService.getScriptProperties();
    var results = {};
    var subject = '【テスト】アラームアプリ: ' + (params.label || 'メッセージ');
    var body = '--- テスト送信 ---\n\n'
      + '■ ラベル: ' + (params.label || '') + '\n'
      + '■ メッセージ（日本語）:\n' + (params.message || '') + '\n\n'
      + '■ メッセージ（英語）:\n' + (params.messageEn || '') + '\n\n'
      + '--- このメールはアラームアプリからのテスト送信です ---';

    // メール送信
    if (params.channels && params.channels.email) {
      var ownerEmail = props.getProperty('OWNER_EMAIL') || '';
      if (!ownerEmail) {
        results.email = { success: false, error: 'OWNER_EMAILが未設定です。騒音クレーム設定タブでオーナーメールを設定してください。' };
      } else {
        try {
          GmailApp.sendEmail(ownerEmail, subject, body);
          results.email = { success: true, to: ownerEmail };
        } catch (e) {
          results.email = { success: false, error: e.message };
        }
      }
    }

    // LINE送信
    if (params.channels && params.channels.line) {
      var lineToken = props.getProperty('LINE_CHANNEL_TOKEN') || '';
      var lineGroupId = props.getProperty('LINE_NOTIFY_GROUP_ID') || '';
      if (!lineToken || !lineGroupId) {
        results.line = { success: false, error: 'LINE設定が不完全です。基本設定タブでトークン・オーナー通知先LINEグループIDを設定してください。' };
      } else {
        try {
          UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
            method: 'post',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lineToken },
            payload: JSON.stringify({
              to: lineGroupId,
              messages: [{ type: 'text', text: subject + '\n\n' + body }]
            })
          });
          results.line = { success: true };
        } catch (e) {
          results.line = { success: false, error: e.message };
        }
      }
    }

    return JSON.stringify({ success: true, results: results });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// ===== チェックアウト連絡通知 =====

/**
 * 宿泊者がチェックアウト時に「退室連絡」ボタンを押した際に呼ばれる
 * 設定された送信先（LINE清掃グループ、オーナーLINE、オーナーメール）に通知を送信
 */
function sendCheckoutNotify(bookingInfo) {
  try {
    var props = PropertiesService.getScriptProperties();
    var settJson = props.getProperty('CHECKOUT_NOTIFY_SETTINGS') || '{}';
    var sett;
    try { sett = JSON.parse(settJson); } catch (e) { sett = {}; }

    var results = {};
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    var guestName = bookingInfo.guestName || '(名前なし)';
    var guestCount = bookingInfo.guestCountDisplay || bookingInfo.guestCount || '?';

    // テンプレートから件名・本文を生成（プレースホルダー置換）
    var subjectTpl = sett.notifySubject || '【退室連絡】{ゲスト名} 様が退室しました';
    var bodyTpl = sett.notifyBody || '退室連絡がありました。\n\n■ ゲスト名: {ゲスト名}\n■ 宿泊人数: {人数}名\n■ チェックアウト日: {チェックアウト日}\n■ 退室連絡時刻: {退室時刻}';

    var replacePlaceholders_ = function(text) {
      return text
        .replace(/\{ゲスト名\}/g, guestName)
        .replace(/\{人数\}/g, guestCount)
        .replace(/\{チェックアウト日\}/g, bookingInfo.checkOut || '')
        .replace(/\{退室時刻\}/g, now);
    };

    var subject = replacePlaceholders_(subjectTpl);
    var body = replacePlaceholders_(bodyTpl);

    var lineToken = props.getProperty('LINE_CHANNEL_TOKEN') || '';

    // 1) オーナー通知先LINEグループ（IDは基本設定から取得）
    if (sett.lineNotifyGroup && lineToken) {
      var notifyGroupId = props.getProperty('LINE_NOTIFY_GROUP_ID') || '';
      if (notifyGroupId) {
        try {
          UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
            method: 'post',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lineToken },
            payload: JSON.stringify({ to: notifyGroupId, messages: [{ type: 'text', text: subject + '\n\n' + body }] })
          });
          results.lineNotifyGroup = { success: true };
        } catch (e) { results.lineNotifyGroup = { success: false, error: e.message }; }
      }
    }

    // 2) LINE清掃グループ
    if (sett.lineCleaningGroup && lineToken) {
      var cleaningGroupId = props.getProperty('CLEANING_GROUP_ID') || '';
      if (cleaningGroupId) {
        try {
          UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
            method: 'post',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lineToken },
            payload: JSON.stringify({ to: cleaningGroupId, messages: [{ type: 'text', text: subject + '\n\n' + body }] })
          });
          results.lineCleaningGroup = { success: true };
        } catch (e) { results.lineCleaningGroup = { success: false, error: e.message }; }
      }
    }

    // 3) オーナー個別LINE
    if (sett.lineOwner && lineToken) {
      var ownerLineId = props.getProperty('OWNER_LINE_ID') || '';
      if (ownerLineId) {
        try {
          UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
            method: 'post',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lineToken },
            payload: JSON.stringify({ to: ownerLineId, messages: [{ type: 'text', text: subject + '\n\n' + body }] })
          });
          results.lineOwner = { success: true };
        } catch (e) { results.lineOwner = { success: false, error: e.message }; }
      }
    }

    // 4) オーナーメール
    if (sett.ownerEmail) {
      var emails = props.getProperty('OWNER_EMAIL') || '';
      if (emails) {
        try {
          GmailApp.sendEmail(emails, subject, body);
          results.email = { success: true, to: emails };
        } catch (e) { results.email = { success: false, error: e.message }; }
      }
    }

    return JSON.stringify({ success: true, results: results });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/** チェックアウト連絡設定を取得 */
function getCheckoutNotifySettings() {
  var props = PropertiesService.getScriptProperties();
  var json = props.getProperty('CHECKOUT_NOTIFY_SETTINGS') || '{}';
  try { return json; } catch (e) { return '{}'; }
}

/** チェックアウト連絡設定を保存 */
function saveCheckoutNotifySettings(settings) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('CHECKOUT_NOTIFY_SETTINGS', JSON.stringify(settings));
  return JSON.stringify({ success: true });
}

// ===== LINE ID収集 =====

/** Webhookイベントからsource情報を収集してScript Propertiesに蓄積 */
function collectLineSource_(ev, props) {
  if (!ev || !ev.source) return;
  var src = ev.source;
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');

  var collected = [];
  try {
    var raw = props.getProperty('LINE_COLLECTED_SOURCES');
    if (raw) collected = JSON.parse(raw);
  } catch (e) { collected = []; }

  // 表示名を取得（Profile API）
  var displayName = '';
  if (src.userId) {
    var token = props.getProperty('LINE_CHANNEL_TOKEN') || '';
    if (token) {
      try {
        if (src.type === 'group' && src.groupId) {
          var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/group/' + src.groupId + '/member/' + src.userId, {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          displayName = JSON.parse(res.getContentText()).displayName || '';
        } else {
          var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + src.userId, {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          displayName = JSON.parse(res.getContentText()).displayName || '';
        }
      } catch (e) { /* Profile API失敗は無視 */ }
    }
  }

  // グループ名を取得
  var groupName = '';
  if (src.type === 'group' && src.groupId) {
    var token = props.getProperty('LINE_CHANNEL_TOKEN') || '';
    if (token) {
      try {
        var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/group/' + src.groupId + '/summary', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        groupName = JSON.parse(res.getContentText()).groupName || '';
      } catch (e) { /* 失敗は無視 */ }
    }
  }

  var entry = {
    type: src.type || '',          // 'user', 'group', 'room'
    userId: src.userId || '',
    groupId: src.groupId || '',
    roomId: src.roomId || '',
    displayName: displayName,
    groupName: groupName,
    messageType: ev.type || '',
    messageText: (ev.message && ev.message.text) ? ev.message.text.substring(0, 50) : '',
    timestamp: now
  };

  // 既に同じuserId+groupIdの組み合わせがあれば上書き（最新のtimestampに更新）
  var found = false;
  for (var i = 0; i < collected.length; i++) {
    if (collected[i].userId === entry.userId && collected[i].groupId === entry.groupId) {
      collected[i] = entry;
      found = true;
      break;
    }
  }
  if (!found) collected.push(entry);

  // 最大50件保持
  if (collected.length > 50) collected = collected.slice(-50);

  props.setProperty('LINE_COLLECTED_SOURCES', JSON.stringify(collected));
}

/** 収集済みLINE source情報を取得 */
function getLineCollectedSources() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('LINE_COLLECTED_SOURCES') || '[]';
  try {
    return JSON.stringify({ sources: JSON.parse(raw) });
  } catch (e) {
    return JSON.stringify({ sources: [] });
  }
}

/** 収集済みLINE source情報をクリア */
function clearLineCollectedSources() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('LINE_COLLECTED_SOURCES');
  return JSON.stringify({ success: true });
}

// ===== 内部ヘルパー =====

function extractGuestCount_(str) {
  if (!str || typeof str !== 'string') return '';
  var trimmed = str.trim();
  if (!trimmed) return '';
  var match = trimmed.match(/\d+/);
  return match ? match[0] : '';
}

function formatGuestCountDisplay_(guestCountAdults, guestCountInfants) {
  if (!guestCountAdults && !guestCountInfants) return '-';
  var parts = [];
  if (guestCountAdults) parts.push('大人' + guestCountAdults + '名');
  if (guestCountInfants) parts.push('3歳以下' + guestCountInfants + '名');
  return parts.join('、');
}

function buildAlarmColumnMap_(headers) {
  var map = {
    checkIn: -1, checkOut: -1, guestName: -1, bookingSite: -1,
    guestCount: -1, guestCountInfants: -1, cleaningStaff: -1, bbq: -1, cancelledAt: -1,
    guestNameCols: [], ageCols: []
  };

  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').trim();
    var hl = h.toLowerCase();
    if (h === 'チェックイン / Check-in' && map.checkIn < 0) map.checkIn = i;
    if (h === 'チェックアウト / Check-out' && map.checkOut < 0) map.checkOut = i;
    if (h.indexOf('氏名') > -1 && map.guestName < 0) map.guestName = i;
    if (h.indexOf('氏名') > -1 || h.indexOf('名前') > -1 || hl === 'full name') map.guestNameCols.push(i);
    if (h.indexOf('年齢') > -1 || (hl.indexOf('age') > -1 && hl.indexOf('page') === -1)) map.ageCols.push(i);
    if (h.indexOf('どこでこのホテルを予約') > -1 && map.bookingSite < 0) map.bookingSite = i;
    if (h.indexOf('宿泊人数') > -1 && h.indexOf('3才以下') === -1 && map.guestCount < 0) map.guestCount = i;
    if (h.indexOf('3才以下') > -1 && map.guestCountInfants < 0) map.guestCountInfants = i;
    if (h === '清掃担当' && map.cleaningStaff < 0) map.cleaningStaff = i;
    if (h.indexOf('バーベキュー') > -1 && map.bbq < 0) map.bbq = i;
    if (h === 'キャンセル日時' && map.cancelledAt < 0) map.cancelledAt = i;
  }

  return map;
}
