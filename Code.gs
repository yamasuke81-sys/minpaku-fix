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

  // ソート後に募集シートの行番号を同期（行番号ずれ防止）
  try { syncRecruitBookingRowsAfterSort_(ss, sheet, colMap); } catch (e) {}
}

/**
 * ソート後に募集シートのbookingRowNumber（列2）を
 * フォームシートの最新行番号に更新する
 */
function syncRecruitBookingRowsAfterSort_(ss, formSheet, colMap) {
  var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
  if (!recruitSheet || recruitSheet.getLastRow() < 2) return;
  if (!colMap || colMap.checkOut < 0) return;
  var formLastRow = formSheet.getLastRow();
  if (formLastRow < 2) return;
  // フォームシートからチェックアウト日→行番号リストマップを構築（同日複数予約対応）
  var formLastCol = formSheet.getLastColumn();
  var formAllData = formSheet.getRange(2, 1, formLastRow - 1, formLastCol).getValues();
  var coToRows = {};
  for (var f = 0; f < formAllData.length; f++) {
    var co = parseDate(formAllData[f][colMap.checkOut]);
    if (!co) continue;
    var coStr = toDateKeySafe_(co);
    if (coStr) {
      if (!coToRows[coStr]) coToRows[coStr] = [];
      coToRows[coStr].push({
        rowNum: f + 2,
        checkIn: colMap.checkIn >= 0 ? toDateKeySafe_(parseDate(formAllData[f][colMap.checkIn])) : ''
      });
    }
  }
  // 募集シートの各行を確認・更新
  var recruitLastRow = recruitSheet.getLastRow();
  var recruitData = recruitSheet.getRange(2, 1, recruitLastRow - 1, 2).getValues();
  // 使用済みフォーム行番号を追跡（同日複数予約で同じ行に二重割り当てしない）
  var usedFormRows = {};
  var updates = [];
  for (var ri = 0; ri < recruitData.length; ri++) {
    var recruitCo = parseDate(recruitData[ri][0]);
    if (!recruitCo) continue;
    var recruitCoStr = toDateKeySafe_(recruitCo);
    var oldRow = recruitData[ri][1] ? Number(recruitData[ri][1]) : 0;
    var candidates = coToRows[recruitCoStr];
    if (!candidates || !candidates.length) continue;
    var newRow = null;
    if (candidates.length === 1) {
      // 同日予約が1件のみ → そのまま使用
      newRow = candidates[0].rowNum;
    } else {
      // 同日予約が複数 → 旧行番号に最も近いものを選択（使用済みは除外）
      var bestDist = Infinity;
      for (var ci = 0; ci < candidates.length; ci++) {
        if (usedFormRows[candidates[ci].rowNum]) continue;
        var dist = Math.abs(candidates[ci].rowNum - oldRow);
        if (dist < bestDist) {
          bestDist = dist;
          newRow = candidates[ci].rowNum;
        }
      }
      // 全て使用済みの場合はフォールバック
      if (!newRow) newRow = candidates[0].rowNum;
    }
    if (newRow) usedFormRows[newRow] = true;
    if (newRow && newRow !== oldRow) {
      updates.push({ row: ri + 2, newVal: newRow });
    }
  }
  // バッチ更新
  for (var u = 0; u < updates.length; u++) {
    recruitSheet.getRange(updates[u].row, 2).setValue(updates[u].newVal);
  }
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
  CANCELLED_AT: 'キャンセル日時',
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

// チェックリスト機能用シート名
const SHEET_CL_MASTER = 'チェックリストマスタ';
const SHEET_CL_PHOTO_SPOTS = '撮影箇所マスタ';
const SHEET_CL_RECORDS = 'チェックリスト記録';
const SHEET_CL_PHOTOS = 'チェックリスト写真';
const SHEET_CL_MEMOS = 'チェックリストメモ';
const SHEET_CL_SUPPLIES = '要補充記録';

// クリーニング連絡用シート名
const SHEET_LAUNDRY = 'クリーニング連絡';

// 請求書履歴用シート名
const SHEET_INVOICE_HISTORY = '請求書履歴';
const SHEET_INVOICE_EXTRA = '請求書追加項目';
const SHEET_INVOICE_EXCLUDED = '請求書除外項目';

// 日付を yyyy-MM-dd に正規化するヘルパー
function normDateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  var s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
  return s;
}

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
  if (action === 'setBaseUrl' && url && typeof url === 'string') {
    PropertiesService.getScriptProperties().setProperty('APP_BASE_URL', String(url).trim());
    // デプロイIDも抽出して保存
    var m = String(url).match(/\/macros\/s\/([^\/]+)\//);
    if (m) PropertiesService.getDocumentProperties().setProperty('deploymentId', m[1]);
    return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
  }
  if (action === 'setChecklistAppUrl' && url && typeof url === 'string') {
    PropertiesService.getScriptProperties().setProperty('CHECKLIST_APP_URL', String(url).trim());
    return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
  }
  // ゲートウェイURL保存アクション
  if (action === 'setGatewayUrl' && url && typeof url === 'string') {
    PropertiesService.getScriptProperties().setProperty('GATEWAY_URL', String(url).trim());
    return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
  }
  // オーナーURL取得アクション（deploy-all.jsがデプロイ時にユーザー保存URLを確認するため）
  if (action === 'getOwnerBaseUrl') {
    var ownerUrl = '';
    try { ownerUrl = PropertiesService.getDocumentProperties().getProperty('ownerBaseUrl') || ''; } catch(e) {}
    if (!ownerUrl) { try { ownerUrl = PropertiesService.getScriptProperties().getProperty('ownerBaseUrl') || ''; } catch(e) {} }
    return ContentService.createTextOutput(JSON.stringify({ url: ownerUrl })).setMimeType(ContentService.MimeType.JSON);
  }
  // ゲートウェイ対応: どのデプロイメントからアクセスされても正常に動作するよう
  // APP_BASE_URL（最新のメインURL）を優先使用し、古いURLで上書きしない
  const template = HtmlService.createTemplateFromFile('index');
  var currentDeployUrl = '';
  try { currentDeployUrl = ScriptApp.getService().getUrl() || ''; } catch(e) {}
  var storedBaseUrl = '';
  try { storedBaseUrl = PropertiesService.getScriptProperties().getProperty('APP_BASE_URL') || ''; } catch(e) {}
  // baseURL決定: 保存済みURLがあればそれを優先（ゲートウェイからでも正しいURLを使う）
  var baseUrl = storedBaseUrl || currentDeployUrl;
  if (!baseUrl) {
    try {
      var depId = PropertiesService.getDocumentProperties().getProperty('deploymentId') || '';
      if (depId) baseUrl = 'https://script.google.com/macros/s/' + depId + '/exec';
    } catch(e) {}
  }
  // APP_BASE_URLの更新: メインデプロイメントからのアクセス時のみ（ゲートウェイから上書きしない）
  if (currentDeployUrl && (!storedBaseUrl || currentDeployUrl === storedBaseUrl)) {
    try { PropertiesService.getScriptProperties().setProperty('APP_BASE_URL', currentDeployUrl); } catch(e) {}
    baseUrl = currentDeployUrl;
  }
  if (baseUrl) {
    // スタッフURLも未保存なら自動保存
    try {
      if (!PropertiesService.getDocumentProperties().getProperty('staffDeployUrl')) {
        PropertiesService.getDocumentProperties().setProperty('staffDeployUrl', baseUrl + '?staff=1');
      }
    } catch(e) {}
  }
  template.baseUrl = baseUrl;
  // オーナーが保存したURLをテンプレートに渡す（リロード時の即座表示用）
  var savedOwnerUrl = '';
  try { savedOwnerUrl = PropertiesService.getDocumentProperties().getProperty('ownerBaseUrl') || ''; } catch(e) {}
  if (!savedOwnerUrl) { try { savedOwnerUrl = PropertiesService.getScriptProperties().getProperty('ownerBaseUrl') || ''; } catch(e) {} }
  template.savedOwnerUrl = savedOwnerUrl;
  var isStaff = (String(params.staff || '') === '1' || String(params.staff || '') === 'true');
  template.isStaffMode = isStaff;
  // GASテンプレートでbooleanが正しく出力されない場合の対策: 明示的に文字列で渡す
  template.staffModeStr = isStaff ? 'yes' : 'no';
  // ディープリンク: 指定日付の清掃詳細モーダルを自動で開く
  template.initialCleaningDate = String(params.date || '');
  // 閲覧専用モード: ?view=readonly
  var isReadOnly = (String(params.view || '') === 'readonly');
  template.readOnlyStr = isReadOnly ? 'yes' : 'no';
  // デバッグ用: クエリストリングをテンプレートに渡す（原因調査後に削除）
  template.debugQueryString = String(e.queryString || '');
  template.debugStaffParam = String(params.staff || '');
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

    // 90日以上前のチェックアウトをスキップ（パフォーマンス最適化）
    var cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNumber = i + 2; // スプレッドシートの行番号（1行目がヘッダー）

      const checkInVal = columnMap.checkIn >= 0 ? String(row[columnMap.checkIn] || '').trim() : '';
      const checkOutVal = columnMap.checkOut >= 0 ? String(row[columnMap.checkOut] || '').trim() : '';

      // 日付のパース（無効な場合はスキップしないが、フラグを付ける）
      const checkIn = parseDate(checkInVal);
      const checkOut = parseDate(checkOutVal);
      const isValidDates = checkIn && checkOut && checkOut >= checkIn;

      // 古い予約をスキップ
      if (isValidDates && checkOut < cutoffDate) continue;

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
      const guestCountDisplay = formGuestCountFmt || '-';
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
      var cancelledAtRaw = columnMap.cancelledAt >= 0 ? row[columnMap.cancelledAt] : '';
      var cancelledAt = '';
      if (cancelledAtRaw) {
        if (cancelledAtRaw instanceof Date) cancelledAt = Utilities.formatDate(cancelledAtRaw, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
        else cancelledAt = String(cancelledAtRaw).trim();
      }
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
        nights: isValidDates ? Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)) : 0,
        cancelledAt: cancelledAt
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
 * 初期データ一括取得（getData + getRecruitmentStatusMap をまとめて1回で返す）
 * CacheService で90秒キャッシュ（書き込み操作時に無効化される）
 */
function getInitData() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = getChunkedCache_(cache, 'initData');
    if (cached) return cached;

    var dataJson = getData();
    var recruitJson = getRecruitmentStatusMap();
    var dataResult = JSON.parse(dataJson);
    var recruitResult = JSON.parse(recruitJson);
    var result = JSON.stringify({
      success: dataResult.success,
      data: dataResult.data,
      columnMap: dataResult.columnMap,
      recruitMap: recruitResult.success ? recruitResult.map : {},
      error: dataResult.error || null
    });
    try { putChunkedCache_(cache, 'initData', result, 90); } catch (e) { /* ignore cache write errors */ }
    return result;
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/* ====== チャンク分割キャッシュ ヘルパー ====== */

/**
 * 大きなJSON文字列をチャンク分割してCacheServiceに保存（100KB制限対応）
 */
function putChunkedCache_(cache, key, jsonStr, ttl) {
  var CHUNK_SIZE = 90000;
  if (jsonStr.length <= CHUNK_SIZE) {
    cache.put(key, jsonStr, ttl);
    cache.put(key + '_n', '1', ttl);
    return;
  }
  var n = Math.ceil(jsonStr.length / CHUNK_SIZE);
  var map = {};
  map[key + '_n'] = String(n);
  for (var i = 0; i < n; i++) {
    map[key + '_' + i] = jsonStr.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
  }
  cache.putAll(map, ttl);
}

/**
 * チャンク分割されたキャッシュを復元して返す（未ヒット時はnull）
 */
function getChunkedCache_(cache, key) {
  var nStr = cache.get(key + '_n');
  if (!nStr) return null;
  var n = parseInt(nStr, 10);
  if (n === 1) return cache.get(key);
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var vals = cache.getAll(keys);
  var result = '';
  for (var j = 0; j < n; j++) {
    var v = vals[key + '_' + j];
    if (!v) return null;
    result += v;
  }
  return result;
}

/**
 * initDataキャッシュを無効化する（すべての書き込み操作から呼ぶ）
 */
function invalidateInitDataCache_() {
  try {
    var cache = CacheService.getScriptCache();
    var nStr = cache.get('initData_n');
    cache.remove('initData');
    cache.remove('initData_n');
    if (nStr) {
      var n = parseInt(nStr, 10);
      for (var i = 0; i < n; i++) cache.remove('initData_' + i);
    }
  } catch (e) { /* ignore */ }
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
    ageCols: [],
    cancelledAt: -1
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
    if ((h === HEADERS.CANCELLED_AT || h === 'キャンセル日時') && map.cancelledAt < 0) map.cancelledAt = i;
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
  if (!str && str !== 0) return null;
  if (str instanceof Date) return str;
  // 数値型（Excelシリアル値）の場合も処理
  if (typeof str === 'number') {
    if (str > 0) {
      try { return new Date((str - 25569) * 86400 * 1000); } catch (e) { return null; }
    }
    return null;
  }
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
    invalidateInitDataCache_();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 宿泊人数を保存（オーナーのみ）
 * Googleフォーム入力時は同じ列に上書きされるため、フォームが優先される
 */
function saveGuestCount(rowNumber, adults, infants) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || rowNumber < 2 || rowNumber > sheet.getLastRow()) return JSON.stringify({ success: false, error: '無効な行です。' });
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colMap = buildColumnMap(headers);
    if (colMap.guestCount < 0) return JSON.stringify({ success: false, error: '宿泊人数列が見つかりません。' });
    sheet.getRange(rowNumber, colMap.guestCount + 1).setValue(adults != null && adults !== '' ? String(adults) : '');
    if (colMap.guestCountInfants >= 0) {
      sheet.getRange(rowNumber, colMap.guestCountInfants + 1).setValue(infants != null && infants !== '' ? String(infants) : '');
    }
    invalidateInitDataCache_();
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
    invalidateInitDataCache_();
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
    var previousStaff = String(sheet.getRange(rowNumber, colIndex).getValue() || '').trim();
    sheet.getRange(rowNumber, colIndex).setValue(value);

    // チェックアウト日を取得（通知用）
    var coDateStr = '';
    if (columnMap.checkOut >= 0) {
      coDateStr = toDateKeySafe_(sheet.getRange(rowNumber, columnMap.checkOut + 1).getValue()) || '';
    }

    // 以前のスタッフが外された場合に通知
    if (previousStaff && previousStaff !== value) {
      var prevNames = previousStaff.split(/[,、]/).map(function(n) { return n.trim(); }).filter(Boolean);
      var newNames = value ? value.split(/[,、]/).map(function(n) { return n.trim(); }).filter(Boolean) : [];
      var removedNames = prevNames.filter(function(n) { return newNames.indexOf(n) < 0; });
      if (removedNames.length > 0) {
        addNotification_('清掃変更', removedNames.join(', ') + ' が清掃担当から外れました（' + coDateStr + '）', { bookingRowNumber: rowNumber, checkoutDate: coDateStr, removedStaff: removedNames });
      }
      // スタッフが全削除され募集再開 → 募集開始通知
      if (!value && previousStaff) {
        addNotification_('清掃募集開始', '清掃募集が再開されました（' + coDateStr + '）', { bookingRowNumber: rowNumber, checkoutDate: coDateStr });
      }
    }

    // 同一チェックイン日の重複行にもcleaningStaffを書き込む（iCal+フォーム重複対策）
    if (columnMap.checkIn >= 0 && lastRow >= 2) {
      var targetCi = toDateKeySafe_(sheet.getRange(rowNumber, columnMap.checkIn + 1).getValue());
      if (targetCi) {
        var allData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
        for (var di = 0; di < allData.length; di++) {
          if ((di + 2) === rowNumber) continue;
          var rowCi = toDateKeySafe_(allData[di][columnMap.checkIn]);
          if (rowCi === targetCi) {
            sheet.getRange(di + 2, colIndex).setValue(value);
          }
        }
      }
    }

    if (recruitSheet && recruitSheet.getLastRow() >= 2) {
      var rLastRow = recruitSheet.getLastRow();
      var rows = recruitSheet.getRange(2, 1, rLastRow - 1, 5).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (Number(rows[i][1]) === rowNumber) {
          var recruitRowIndex = i + 2;
          recruitSheet.getRange(recruitRowIndex, 5).setValue(value);
          recruitSheet.getRange(recruitRowIndex, 4).setValue(value ? 'スタッフ確定済み' : '募集中');
          break;
        }
      }
    }

    invalidateInitDataCache_();
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
    // 1. 保存済みstaffDeployUrl（deploy-all.jsが保存）
    var stored = '';
    try { stored = PropertiesService.getDocumentProperties().getProperty('staffDeployUrl') || ''; } catch(e) {}
    if (!stored) { try { stored = PropertiesService.getScriptProperties().getProperty('staffDeployUrl') || ''; } catch(e) {} }
    if (stored) return JSON.stringify({ success: true, url: stored });
    // 2. ベースURLから生成
    var base = '';
    try { base = ScriptApp.getService().getUrl() || ''; } catch(e) {}
    if (!base) {
      try { base = PropertiesService.getScriptProperties().getProperty('APP_BASE_URL') || ''; } catch(e) {}
    }
    // 3. デプロイIDから構築
    if (!base) {
      try {
        var depId = PropertiesService.getDocumentProperties().getProperty('deploymentId') || '';
        if (depId) base = 'https://script.google.com/macros/s/' + depId + '/exec';
      } catch(e) {}
    }
    if (base) {
      var url = base + (base.indexOf('?') >= 0 ? '&staff=1' : '?staff=1');
      // 次回以降のために保存
      try { PropertiesService.getDocumentProperties().setProperty('staffDeployUrl', url); } catch(e) {}
      return JSON.stringify({ success: true, url: url });
    }
    return JSON.stringify({ success: true, url: '' });
  } catch (e) { return JSON.stringify({ success: false, url: '', error: e.toString() }); }
}

/**
 * オーナーURLを直接取得（staffDeployUrlからの逆算ではなく、ownerBaseUrlプロパティを直接読む）
 * deploy-all.jsがstaffDeployUrlを上書きしてもownerBaseUrlは保持されるため安全
 */
function getOwnerBaseUrl() {
  try {
    var url = '';
    try { url = PropertiesService.getDocumentProperties().getProperty('ownerBaseUrl') || ''; } catch(e) {}
    if (!url) { try { url = PropertiesService.getScriptProperties().getProperty('ownerBaseUrl') || ''; } catch(e) {} }
    return JSON.stringify({ success: true, url: url });
  } catch (e) { return JSON.stringify({ success: false, url: '', error: e.toString() }); }
}

/**
 * オーナーURLを保存する
 */
function saveOwnerUrl(ownerUrl) {
  try {
    if (!ownerUrl) return JSON.stringify({ success: false, error: 'URLが空です' });
    var clean = ownerUrl.replace(/[?&](staff=1|view=readonly)/g, '').replace(/\?$/, '');
    // スタッフURLも生成
    var sep = clean.indexOf('?') >= 0 ? '&' : '?';
    var staffUrl = clean + sep + 'staff=1';
    // DocumentProperties に保存（メイン）
    try {
      PropertiesService.getDocumentProperties().setProperty('ownerBaseUrl', clean);
      PropertiesService.getDocumentProperties().setProperty('staffDeployUrl', staffUrl);
    } catch (de) { Logger.log('DocumentProperties save failed: ' + de.toString()); }
    // ScriptProperties にもフォールバック保存（DocumentPropertiesが使えない環境対策）
    try {
      PropertiesService.getScriptProperties().setProperty('ownerBaseUrl', clean);
      PropertiesService.getScriptProperties().setProperty('staffDeployUrl', staffUrl);
    } catch (se) { Logger.log('ScriptProperties save failed: ' + se.toString()); }
    // 保存確認（読み戻し検証）
    var verify = '';
    try { verify = PropertiesService.getDocumentProperties().getProperty('ownerBaseUrl') || ''; } catch (ve) {}
    if (!verify) { try { verify = PropertiesService.getScriptProperties().getProperty('ownerBaseUrl') || ''; } catch (ve) {} }
    if (!verify) return JSON.stringify({ success: false, error: '保存に失敗しました（プロパティストアへの書き込みができません）' });
    return JSON.stringify({ success: true, savedUrl: clean });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
}

/**
 * テキストコピー/メール用: 常に最新のスタッフURLを返す
 * ScriptApp.getService().getUrl() を優先し、保存値にフォールバック
 */
function getLatestStaffUrl_() {
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  if (!url) {
    try { url = PropertiesService.getScriptProperties().getProperty('APP_BASE_URL') || ''; } catch (e) {}
  }
  if (!url) {
    try {
      var depId = PropertiesService.getDocumentProperties().getProperty('deploymentId') || '';
      if (depId) url = 'https://script.google.com/macros/s/' + depId + '/exec';
    } catch (e) {}
  }
  if (!url) {
    try { url = PropertiesService.getDocumentProperties().getProperty('staffDeployUrl') || ''; } catch (e) {}
    return url;
  }
  if (url && url.indexOf('staff=1') < 0 && url.indexOf('staff=true') < 0) {
    url = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'staff=1';
  }
  try { PropertiesService.getDocumentProperties().setProperty('staffDeployUrl', url); } catch (e) {}
  return url;
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
/**
 * シートの空白行・空白列を削除してセル数を削減
 */
function trimAllSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var totalFreed = 0;
  sheets.forEach(function(sheet) {
    try {
      var maxRows = sheet.getMaxRows();
      var maxCols = sheet.getMaxColumns();
      var lastRow = Math.max(sheet.getLastRow(), 1);
      var lastCol = Math.max(sheet.getLastColumn(), 1);
      var targetRows = lastRow + 5;
      var targetCols = lastCol + 1;
      if (maxRows > targetRows) {
        sheet.deleteRows(targetRows + 1, maxRows - targetRows);
        totalFreed += (maxRows - targetRows) * maxCols;
      }
      if (maxCols > targetCols) {
        sheet.deleteColumns(targetCols + 1, maxCols - targetCols);
        totalFreed += Math.min(maxRows, targetRows) * (maxCols - targetCols);
      }
    } catch (e) {
      Logger.log('trimSheet skip(' + sheet.getName() + '): ' + e);
    }
  });
  return totalFreed;
}

function trimSheet_(sheet) {
  try {
    var maxRows = sheet.getMaxRows();
    var maxCols = sheet.getMaxColumns();
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    if (maxRows > lastRow + 5) sheet.deleteRows(lastRow + 6, maxRows - lastRow - 5);
    if (maxCols > lastCol + 1) sheet.deleteColumns(lastCol + 2, maxCols - lastCol - 1);
  } catch (e) {}
}

/**
 * スプレッドシートのセル数を最適化（設定画面から呼び出し可能）
 */
function trimSpreadsheet() {
  try {
    var freed = trimAllSheets_();
    return JSON.stringify({ success: true, freedCells: freed });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function ensureSheetsExist() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  function safeInsert(name, headerFn) {
    if (ss.getSheetByName(name)) return;
    try {
      var s = ss.insertSheet(name);
      if (headerFn) headerFn(s);
      trimSheet_(s);
    } catch (e) {
      if (String(e).indexOf('10000000') !== -1 || String(e).indexOf('セル数') !== -1) {
        try {
          trimAllSheets_();
          var s = ss.insertSheet(name);
          if (headerFn) headerFn(s);
          trimSheet_(s);
        } catch (e2) {
          Logger.log('シート作成スキップ(トリム後も失敗)(' + name + '): ' + e2.toString());
        }
      } else {
        Logger.log('シート作成スキップ(' + name + '): ' + e.toString());
      }
    }
  }

  safeInsert(SHEET_OWNER, function(s) {
    s.getRange(1, 1).setValue('オーナーメールアドレス');
    s.getRange(2, 1).setValue('');
  });

  safeInsert(SHEET_SUB_OWNERS, function(s) {
    s.getRange(1, 1, 1, 2).setValues([['メール', '表示名']]);
  });

  safeInsert(SHEET_STAFF, function(s) {
    s.getRange(1, 1, 1, 11).setValues([['名前', '住所', 'メール', '金融機関名', '支店名', '口座種類', '口座番号', '口座名義', '有効', 'パスワード', '表示順']]);
  });

  safeInsert(SHEET_JOB_TYPES, function(s) {
    s.getRange(1, 1, 1, 3).setValues([['仕事内容名', '表示順', '有効']]);
    s.getRange(2, 1, 6, 3).setValues([
      ['1名で清掃', 1, 'Y'],
      ['2名で清掃', 2, 'Y'],
      ['3名で清掃', 3, 'Y'],
      ['コインランドリー交通費', 4, 'Y'],
      ['コインランドリー実費', 5, 'Y'],
      ['直前点検', 6, 'Y']
    ]);
  });

  safeInsert(SHEET_COMPENSATION, function(s) {
    s.getRange(1, 1, 1, 4).setValues([['スタッフ名', '仕事内容名', '報酬額', '備考']]);
  });

  safeInsert(SHEET_SPECIAL_RATES, function(s) {
    s.getRange(1, 1, 1, 5).setValues([['仕事内容名', '対象開始日', '対象終了日', '項目名', '追加金額']]);
  });

  safeInsert(SHEET_RECRUIT_SETTINGS, function(s) {
    s.getRange(1, 1, 1, 2).setValues([['項目', '値']]);
    s.getRange(2, 1, 4, 2).setValues([
      ['募集開始週数', 4],
      ['最少回答者数', 2],
      ['リマインド間隔週', 1],
      ['選定人数', 2]
    ]);
  });

  safeInsert(SHEET_RECRUIT, function(s) {
    s.getRange(1, 1, 1, 14).setValues([['チェックアウト日', '予約行番号', '告知日', 'ステータス', '選定スタッフ', 'リマインド最終日', '作成日', '予約ID', '告知方法', '予約日付', '予約人数', '予約BBQ', '予約国籍', 'メモ']]);
  });
  if (ss.getSheetByName(SHEET_RECRUIT)) {
    try { ensureRecruitNotifyMethodColumn_(); } catch (e) { Logger.log('ensureRecruitNotifyMethodColumn_ error: ' + e); }
    try { ensureRecruitDetailColumns_(); } catch (e) { Logger.log('ensureRecruitDetailColumns_ error: ' + e); }
  }

  safeInsert(SHEET_RECRUIT_VOLUNTEERS, function(s) {
    s.getRange(1, 1, 1, 7).setValues([['募集ID', 'スタッフ名', 'メール', '立候補日時', '対応可能条件', 'ステータス', '保留理由']]);
  });
  if (ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS)) {
    try { ensureVolunteerMemoColumn_(); } catch (e) { Logger.log('ensureVolunteerMemoColumn_ error: ' + e); }
    try { ensureVolunteerStatusColumns_(); } catch (e) { Logger.log('ensureVolunteerStatusColumns_ error: ' + e); }
  }

  safeInsert(SHEET_CANCEL_REQUESTS, function(s) {
    s.getRange(1, 1, 1, 5).setValues([['募集ID', 'スタッフ名', 'メール', '申請日時', 'ステータス']]);
  });

  safeInsert(SHEET_SYNC_SETTINGS, function(s) {
    s.getRange(1, 1, 1, 4).setValues([['プラットフォーム名', 'iCal URL', '有効', '最終同期']]);
    s.getRange(2, 1, 2, 4).setValues([['Airbnb', '', 'Y', '']]);
    s.getRange(3, 1, 3, 4).setValues([['Booking.com', '', 'Y', '']]);
  });

  safeInsert(SHEET_NOTIFICATIONS, function(s) {
    s.getRange(1, 1, 1, 4).setValues([['日時', '種類', '内容', '既読']]);
  });

  safeInsert(SHEET_LAUNDRY, function(s) {
    s.getRange(1, 1, 1, 7).setValues([['チェックアウト日', '出した人', '出した日時', '受け取った人', '受け取った日時', '施設に戻した人', '施設に戻した日時']]);
  });

  safeInsert(SHEET_INVOICE_HISTORY, function(s) {
    s.getRange(1, 1, 1, 8).setValues([['スタッフ名', '対象年月', '合計金額', '明細JSON', '送信日時', 'PDFリンク', 'PDFファイルID', 'ステータス']]);
  });

  safeInsert(SHEET_INVOICE_EXTRA, function(s) {
    s.getRange(1, 1, 1, 5).setValues([['スタッフ名', '対象年月', '日付', '項目名', '金額']]);
  });

  safeInsert(SHEET_INVOICE_EXCLUDED, function(s) {
    s.getRange(1, 1, 1, 3).setValues([['スタッフ名', '対象年月', '除外日付JSON']]);
  });

}

function formatNotificationMessage_(kind, message) {
  if (!message) return message;
  var s = String(message);
  // 日付を読みやすい形式(M/d)に変換するヘルパー
  function fmtDate(isoDate) {
    var dm = String(isoDate).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    return dm ? (parseInt(dm[2], 10) + '/' + parseInt(dm[3], 10)) : isoDate;
  }
  // 新形式: 「名前 が ◎ と回答（メモ）（2026-02-23）」
  var m = s.match(/^(.+?)\s+が\s*([◎△×])\s*と回答(?:（[^）]*?）)?（(\d{4}-\d{1,2}-\d{1,2})\）$/);
  if (m && kind === '回答') {
    return m[1].trim() + ' が' + fmtDate(m[3]) + 'の清掃に' + m[2] + 'と回答しました';
  }
  // 旧形式: 「2026-02-23: 名前 が ◎ と回答」
  m = s.match(/^(\d{4}-\d{1,2}-\d{1,2})\s*:\s*(.+?)\s+が\s*([◎△×])\s*と回答/);
  if (m && kind === '回答') {
    return m[2].trim() + ' が' + fmtDate(m[1]) + 'の清掃に' + m[3] + 'と回答しました';
  }
  // 新形式: 回答取消
  m = s.match(/^(.+?)\s+が回答を取り消しました（(\d{4}-\d{1,2}-\d{1,2})\）$/);
  if (m && kind === '回答取消') {
    return m[1].trim() + ' が' + fmtDate(m[2]) + 'の清掃の回答を取り消しました';
  }
  // 旧形式: 回答取消
  m = s.match(/^(\d{4}-\d{1,2}-\d{1,2})\s*:\s*(.+?)\s+が回答を取り消しました$/);
  if (m && kind === '回答取消') {
    return m[2].trim() + ' が' + fmtDate(m[1]) + 'の清掃の回答を取り消しました';
  }
  // 旧形式の立候補通知にも対応
  m = s.match(/^(\d{4}-\d{1,2}-\d{1,2})\s*:\s*(.+?)\s+が立候補しました$/);
  if (m && kind === '立候補') {
    return m[2].trim() + ' が' + fmtDate(m[1]) + 'の清掃に回答しました';
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
 * 通知メッセージ内の古い日付を新しい日付に置換
 * 予約日付が変更された場合に既存通知のメッセージを修正する
 */
function fixNotificationDates_(oldDateStr, newDateStr) {
  try {
    if (!oldDateStr || !newDateStr || oldDateStr === newDateStr) return;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NOTIFICATIONS);
    if (!sheet || sheet.getLastRow() < 2) return;
    var numRows = sheet.getLastRow() - 1;
    var msgs = sheet.getRange(2, 3, numRows, 1).getValues(); // col3=message
    for (var i = 0; i < numRows; i++) {
      var msg = String(msgs[i][0] || '');
      if (msg.indexOf(oldDateStr) >= 0) {
        sheet.getRange(i + 2, 3).setValue(msg.split(oldDateStr).join(newDateStr));
      }
    }
  } catch (e) {}
}

/**
 * 通知メッセージ内の遠未来日付（120日以上先）を直接修復する一発修復関数。
 * 募集エントリの予約行番号から正しいチェックアウト日を取得して置換する。
 * ScriptPropertiesで実行済みフラグを管理し、修復完了後は再実行しない。
 */
function fixFarFutureNotificationDates_() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('FIX_FARFUTURE_NOTIF') === 'done') return;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var notifSheet = ss.getSheetByName(SHEET_NOTIFICATIONS);
    if (!notifSheet || notifSheet.getLastRow() < 2) return;

    var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!recruitSheet) return;

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var farFuture = new Date(today);
    farFuture.setDate(farFuture.getDate() + 120);
    var farFutureStr = Utilities.formatDate(farFuture, 'Asia/Tokyo', 'yyyy-MM-dd');

    var numRows = notifSheet.getLastRow() - 1;
    var lastCol = Math.max(notifSheet.getLastColumn(), 5);
    var rows = notifSheet.getRange(2, 1, numRows, lastCol).getValues();

    var targetKinds = { '回答': 1, '回答取消': 1, '保留': 1, '回答変更要請': 1 };

    for (var i = 0; i < numRows; i++) {
      var kind = String(rows[i][1] || '').trim();
      if (!targetKinds[kind]) continue;

      var msg = String(rows[i][2] || '');
      var dateMatch = msg.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;
      var dateInMsg = dateMatch[1];

      // 120日以上先の日付のみ対象
      if (dateInMsg <= farFutureStr) continue;

      // データ列から募集行番号を取得
      var nData = null;
      try { var raw = String(rows[i][lastCol >= 5 ? 4 : 3] || '').trim(); if (raw) nData = JSON.parse(raw); } catch (e) {}

      if (nData && nData.recruitRowIndex) {
        var correctDate = getCheckoutForRecruit_(recruitSheet, nData.recruitRowIndex, ss);
        if (correctDate && correctDate !== dateInMsg) {
          notifSheet.getRange(i + 2, 3).setValue(msg.split(dateInMsg).join(correctDate));
        }
      }
    }

    props.setProperty('FIX_FARFUTURE_NOTIF', 'done');
  } catch (e) {}
}

/**
 * 破損した募集エントリを自動修復する
 * 日付書き換えバグにより、遠い未来の日付に回答データが紐付いてしまったケースを修復。
 * 検出: 120日以上先の日付なのにアクティブな回答がある → 破損の疑い
 * 修復: 回答のない近日エントリと日付・行番号を入れ替える
 */
function repairOrphanedRecruitEntries_(recruitSheet, rows, coToCurrentRow, formData, formColMap) {
  if (!rows || !rows.length) return;

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var farFutureCutoff = new Date(today);
  farFutureCutoff.setDate(farFutureCutoff.getDate() + 120);
  var farFutureStr = toDateKeySafe_(farFutureCutoff);
  var todayStr = toDateKeySafe_(today);

  // 1. 120日以上先の日付を持つ募集エントリを抽出
  var farFutureEntries = [];
  for (var i = 0; i < rows.length; i++) {
    var rCo = parseDate(rows[i][0]);
    if (!rCo) continue;
    var rCoStr = toDateKeySafe_(rCo);
    if (rCoStr && rCoStr > farFutureStr) {
      farFutureEntries.push({ idx: i, recruitRow: i + 2, date: rCoStr, rid: 'r' + (i + 2) });
    }
  }
  if (farFutureEntries.length === 0) return;

  // 2. 立候補シートからアクティブな回答データを取得
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
  var volByRid = {};
  if (volSheet && volSheet.getLastRow() >= 2) {
    var volLastCol = Math.max(volSheet.getLastColumn(), 6);
    var volData = volSheet.getRange(2, 1, volSheet.getLastRow() - 1, volLastCol).getValues();
    for (var vi = 0; vi < volData.length; vi++) {
      var vRid = String(volData[vi][0] || '').trim();
      var vStatus = normalizeVolStatus_(String(volData[vi][5] || '').trim());
      if (vRid && vStatus && vStatus !== '未回答' && vStatus !== '×') {
        if (!volByRid[vRid]) volByRid[vRid] = { count: 0, latestResponse: '' };
        volByRid[vRid].count++;
        // Date型の場合はformatDateで安全にyyyy-MM-dd HH:mm形式に変換
        var respRaw = volData[vi][3];
        var respTime = respRaw instanceof Date
          ? Utilities.formatDate(respRaw, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm')
          : String(respRaw || '').trim();
        if (respTime > volByRid[vRid].latestResponse) volByRid[vRid].latestResponse = respTime;
      }
    }
  }

  // 3. 120日以上先の日付 + アクティブ回答あり → 破損の疑い
  var corrupted = farFutureEntries.filter(function(e) {
    return volByRid[e.rid] && volByRid[e.rid].count > 0;
  });
  if (corrupted.length === 0) return;

  // 4. 今日〜120日以内で回答なしのエントリ（checkAndCreateRecruitments が作った正規エントリ候補）
  var nearTermNoVol = [];
  for (var j = 0; j < rows.length; j++) {
    var rCo2 = parseDate(rows[j][0]);
    if (!rCo2) continue;
    var rCoStr2 = toDateKeySafe_(rCo2);
    if (!rCoStr2 || rCoStr2 <= todayStr || rCoStr2 > farFutureStr) continue;
    var rid2 = 'r' + (j + 2);
    if (!volByRid[rid2] || volByRid[rid2].count === 0) {
      nearTermNoVol.push({ idx: j, recruitRow: j + 2, date: rCoStr2 });
    }
  }
  if (nearTermNoVol.length === 0) return;

  // 5. 破損エントリと近日エントリの日付・行番号を入れ替え
  for (var ci = 0; ci < corrupted.length; ci++) {
    var c = corrupted[ci];
    var volInfo = volByRid[c.rid];
    // 回答日時に最も近い日付の近日エントリをマッチ
    var respDate = volInfo.latestResponse ? volInfo.latestResponse.substring(0, 10) : todayStr;
    var bestMatch = null;
    var bestDist = Infinity;
    for (var ni = 0; ni < nearTermNoVol.length; ni++) {
      var n = nearTermNoVol[ni];
      var dist = Math.abs(new Date(n.date) - new Date(respDate));
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = n;
      }
    }
    if (!bestMatch) continue;

    // 日付と行番号を入れ替え
    var cOldDate = c.date;
    var cOldRowNum = Number(rows[c.idx][1]) || 0;
    var nOldDate = bestMatch.date;
    var nOldRowNum = Number(rows[bestMatch.idx][1]) || 0;

    recruitSheet.getRange(c.recruitRow, 1).setValue(nOldDate);
    recruitSheet.getRange(c.recruitRow, 2).setValue(nOldRowNum);
    rows[c.idx][0] = nOldDate;
    rows[c.idx][1] = nOldRowNum;

    recruitSheet.getRange(bestMatch.recruitRow, 1).setValue(cOldDate);
    recruitSheet.getRange(bestMatch.recruitRow, 2).setValue(cOldRowNum);
    rows[bestMatch.idx][0] = cOldDate;
    rows[bestMatch.idx][1] = cOldRowNum;

    // 通知メッセージ修正
    fixNotificationDates_(cOldDate, nOldDate);

    // 使用済みマーク
    nearTermNoVol.splice(nearTermNoVol.indexOf(bestMatch), 1);
  }
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
      var recruitData = recruitSheet.getRange(2, 1, recruitSheet.getLastRow() - 1, 8).getValues();
      var toDelRecruit = [];
      for (var i = 0; i < recruitData.length; i++) {
        var rn = parseInt(recruitData[i][1], 10);
        if (rn === row) toDelRecruit.push(i + 2);
        else if (rn > row) recruitSheet.getRange(i + 2, 2).setValue(rn - 1);
      }
      // 下の行から削除（行番号ズレ防止）、削除後にridも更新
      for (var d = toDelRecruit.length - 1; d >= 0; d--) {
        var recruitId = 'r' + toDelRecruit[d];
        if (volSheet && volSheet.getLastRow() >= 2) {
          var volData = volSheet.getRange(2, 1, volSheet.getLastRow() - 1, 1).getValues();
          for (var v = volData.length - 1; v >= 0; v--) {
            if (String(volData[v][0] || '').trim() === recruitId) volSheet.deleteRow(v + 2);
          }
        }
        recruitSheet.deleteRow(toDelRecruit[d]);
        // 削除された行より後のridを全て更新
        updateRidsAfterRecruitDeletion_(ss, toDelRecruit[d]);
      }
    }
    var colMap = buildColumnMap(formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0]);
    var gn = colMap.guestName >= 0 ? String(formSheet.getRange(row, colMap.guestName + 1).getValue() || '').trim() : '';
    formSheet.deleteRow(row);
    addNotification_('予約削除', '予約が削除されました' + (gn ? ': ' + gn : ''));
    invalidateInitDataCache_();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * iCal同期で予約が消えた場合にキャンセルマークを付与し、スタッフ・オーナーに通知
 */
function cancelBookingFromICal_(formSheet, rowNumber, colMap, platformName) {
  try {
    // 既にキャンセル済みならスキップ
    if (colMap.cancelledAt >= 0) {
      var existing = String(formSheet.getRange(rowNumber, colMap.cancelledAt + 1).getValue() || '').trim();
      if (existing) return false;
    }
    // キャンセル日時列がなければ作成
    ensureCancelledColumn_();
    // 列マップを再構築
    var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    var newMap = buildColumnMap(headers);
    if (newMap.cancelledAt < 0) return false;
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    formSheet.getRange(rowNumber, newMap.cancelledAt + 1).setValue(now);

    // 予約情報を取得
    var guestName = newMap.guestName >= 0 ? String(formSheet.getRange(rowNumber, newMap.guestName + 1).getValue() || '').trim() : '';
    var cleaningStaff = newMap.cleaningStaff >= 0 ? String(formSheet.getRange(rowNumber, newMap.cleaningStaff + 1).getValue() || '').trim() : '';
    var ciVal = newMap.checkIn >= 0 ? formSheet.getRange(rowNumber, newMap.checkIn + 1).getValue() : '';
    var coVal = newMap.checkOut >= 0 ? formSheet.getRange(rowNumber, newMap.checkOut + 1).getValue() : '';
    var ciStr = ciVal ? (ciVal instanceof Date ? Utilities.formatDate(ciVal, 'Asia/Tokyo', 'yyyy-MM-dd') : String(ciVal).trim()) : '';
    var coStr = coVal ? (coVal instanceof Date ? Utilities.formatDate(coVal, 'Asia/Tokyo', 'yyyy-MM-dd') : String(coVal).trim()) : '';
    var dateRange = ciStr + '～' + coStr;

    // 募集ステータスを「キャンセル」に更新
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (recruitSheet && recruitSheet.getLastRow() >= 2) {
      var rData = recruitSheet.getRange(2, 1, recruitSheet.getLastRow() - 1, 4).getValues();
      for (var ri = 0; ri < rData.length; ri++) {
        var rn = parseInt(rData[ri][1], 10);
        if (rn === rowNumber) {
          recruitSheet.getRange(ri + 2, 4).setValue('キャンセル');
        }
      }
    }

    // オーナーに通知
    var guestLabel = guestName || platformName || '不明';
    addNotification_('予約キャンセル', guestLabel + ' の予約がキャンセルされました（' + dateRange + '）' + (cleaningStaff ? ' 清掃担当: ' + cleaningStaff : ''));

    // 清掃スタッフが確定済みの場合、スタッフにも通知＋オーナーにメール
    if (cleaningStaff) {
      var staffNames = cleaningStaff.split(/[,、]/).map(function(s) { return s.trim(); }).filter(Boolean);
      // スタッフシートからメールアドレスを取得
      var staffSheet = ss.getSheetByName(SHEET_STAFF);
      var staffEmails = {};
      if (staffSheet && staffSheet.getLastRow() >= 2) {
        var sData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 3).getValues();
        for (var si = 0; si < sData.length; si++) {
          var sName = String(sData[si][0] || '').trim();
          var sEmail = String(sData[si][2] || '').trim();
          if (sName && sEmail) staffEmails[sName] = sEmail;
        }
      }
      // 各スタッフにメール通知
      for (var sni = 0; sni < staffNames.length; sni++) {
        var name = staffNames[sni];
        var email = staffEmails[name] || '';
        if (email && isEmailNotifyEnabled_('キャンセル通知有効')) {
          try {
            var subject = '【民泊】予約キャンセルのお知らせ: ' + coStr;
            var body = name + ' 様\n\n' + dateRange + ' の予約がキャンセルされました。\nこの予約に割り当てられていた清掃業務はキャンセルとなります。\n\nご確認ください。';
            GmailApp.sendEmail(email, subject, body);
          } catch (mailErr) {}
        }
      }
      // オーナーにメールで督促
      try {
        var ownerRes = JSON.parse(getOwnerEmail());
        var ownerEmail = (ownerRes && ownerRes.email) ? String(ownerRes.email).trim() : '';
        if (ownerEmail && isEmailNotifyEnabled_('キャンセル通知有効')) {
          var oSubject = '【民泊】予約キャンセル - 清掃スタッフへの連絡をお願いします: ' + dateRange;
          var oBody = '以下の予約がキャンセルされました。\n\n' +
            '期間: ' + dateRange + '\n' +
            'ゲスト: ' + guestLabel + '\n' +
            '清掃担当: ' + cleaningStaff + '\n\n' +
            '清掃スタッフにはメールで自動通知済みですが、念のため直接ご連絡ください。';
          GmailApp.sendEmail(ownerEmail, oSubject, oBody);
        }
      } catch (ownerMailErr) {}
    }
    return true;
  } catch (e) {
    Logger.log('cancelBookingFromICal_: ' + e.toString());
    return false;
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

function ensureCancelledColumn_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 1) return;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').trim() === HEADERS.CANCELLED_AT) return;
    }
    sheet.insertColumnAfter(sheet.getLastColumn());
    sheet.getRange(1, sheet.getLastColumn()).setValue(HEADERS.CANCELLED_AT);
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
        addNotification_('フォーム回答', 'フォームの回答が入力されました（' + newCheckInStr + '～' + newCheckOutStr + '）');
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
    var resultRow;
    if (rowIndex && rowIndex >= 2 && rowIndex <= lastRow) {
      s.getRange(rowIndex, 1, 1, 3).setValues([[platformName || '', icalUrl || '', active !== 'N' ? 'Y' : 'N']]);
      resultRow = rowIndex;
    } else {
      var nextRow = lastRow + 1;
      s.getRange(nextRow, 1, 1, 3).setValues([[platformName || '', icalUrl || '', active !== 'N' ? 'Y' : 'N']]);
      resultRow = nextRow;
    }
    // ソースの有効状態が変わった場合、トリガーを自動管理
    try {
      var props = PropertiesService.getScriptProperties();
      var intervalHours = parseInt(props.getProperty('AUTO_SYNC_INTERVAL_HOURS'), 10) || 1;
      var hasActive = hasAnyActiveSyncSource_();
      props.setProperty('AUTO_SYNC_ENABLED', hasActive ? 'true' : 'false');
      setupAutoSyncTrigger_(hasActive, intervalHours);
    } catch (te) {}
    return JSON.stringify({ success: true, rowIndex: resultRow });
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
  var allDatePairs = {};  // キャンセル以外の全日付ペア（ブロック日含む）→ 誤キャンセル防止用
  var cancelledDatePairs = {};  // 明示的キャンセル（STATUS:CANCELLED or SUMMARYに"cancel"）の日付ペア
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
      // 日付を先に解析（STATUS:CANCELLEDでもcancelledDatePairsに記録するため）
      var checkIn = parseICalDateToKey_(current.dtstart);
      var checkOut = parseICalDateToKey_(current.dtend);
      if (!checkOut && checkIn && current.duration) {
        var days = parseICalDurationToDays_(current.duration);
        if (days > 0) checkOut = addDaysToDateKey_(checkIn, days);
      }
      // STATUS:CANCELLED → cancelledDatePairsに記録してスキップ
      if (/^CANCELLED$/i.test(String(current.status || '').trim())) {
        if (checkIn && checkOut) cancelledDatePairs[checkIn + '|' + checkOut] = true;
        current = null;
        continue;
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
        // SUMMARYが"Cancelled"等のキャンセル名 → cancelledDatePairsに記録してスキップ
        // 注: /cancel/i だと "Non-cancellable" 等の有効予約も除外してしまうため厳密化
        if (/^cancel(led)?$/i.test(sum) || /^cancelled?\s*[-:]/i.test(sum)) {
          cancelledDatePairs[checkIn + '|' + checkOut] = true;
          continue;
        }
        // キャンセルでないイベントの日付ペアを全て記録（ブロック日・予約名なし含む）
        // これにより、iCalフィードに存在する日付の予約を誤ってキャンセルしない
        allDatePairs[checkIn + '|' + checkOut] = true;
        // ブロック日・利用不可日は予約追加対象外（ただしallDatePairsには含める）
        if (/^not\s*available$/i.test(sum) || /^closed$/i.test(sum) || /^blocked$/i.test(sum)) { current = null; continue; }
        var guestName = sum.replace(/^CLOSED[^a-zA-Z]*/i, '').replace(/Not available/gi, '').trim() || '';
        // "Reserved" のみの場合はDESCRIPTIONからゲスト名を探す、なければプラットフォーム名で登録
        if (/^reserved$/i.test(sum) || !guestName) {
          var desc = (current.description || '').trim();
          // AirbnbのDESCRIPTIONに含まれるゲスト名パターンを試す
          var nameFromDesc = '';
          var nameMatch = desc.match(/(?:Guest|ゲスト)[:\s]+([^\n,]+)/i) || desc.match(/(?:Name|名前)[:\s]+([^\n,]+)/i);
          if (nameMatch) nameFromDesc = nameMatch[1].trim();
          guestName = nameFromDesc || (platformName || '予約者');
        }
        var guestLower = guestName.toLowerCase();
        if (/^(airbnb|booking\.com|rakuten|楽天)$/i.test(guestLower)) {
          // プラットフォーム名のみ → ゲスト名不明として登録（スキップしない）
          guestName = platformName + '予約';
        }
        if (/^(airbnb|booking\.com|rakuten|楽天)\s*\([^)]*\)?\s*$/i.test(guestName)) { current = null; continue; }
        // ゲスト名が空の場合 → プラットフォーム名で登録（ブロック日は上のフィルタで除外済み）
        if (!guestName) guestName = platformName ? (platformName + '予約') : '予約者';
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
  return { events: events, allDatePairs: allDatePairs, cancelledDatePairs: cancelledDatePairs };
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
    var syncRows = syncSheet.getRange(2, 1, lastRow - 1, 4).getValues();
    var existingPairs = {};
    var existingRowByKey = {};
    var formLastRow = formSheet.getLastRow();
    var formLastCol = formSheet.getLastColumn();
    if (formLastRow >= 2 && formLastCol >= 1) {
      var headers = formSheet.getRange(1, 1, 1, formLastCol).getValues()[0];
      var colMap = buildColumnMap(headers);
      if (colMap.checkIn >= 0 && colMap.checkOut >= 0) {
        var data = formSheet.getRange(2, 1, formLastRow - 1, formLastCol).getValues();
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
        var fetchOpts = { muteHttpExceptions: true, followRedirects: true,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CalendarSync/1.0)' } };
        var resp = UrlFetchApp.fetch(url, fetchOpts);
        // 5xx エラーは最大2回リトライ（一時的なサーバー障害対策）
        if (resp.getResponseCode() >= 500) {
          Utilities.sleep(2000);
          resp = UrlFetchApp.fetch(url, fetchOpts);
          if (resp.getResponseCode() >= 500) {
            Utilities.sleep(5000);
            resp = UrlFetchApp.fetch(url, fetchOpts);
          }
        }
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

      var parseResult = parseICal_(icalText, platformName);
      var events = parseResult.events;
      // allDatePairs: キャンセル以外の全日付（ブロック日含む）→ 既存予約の誤キャンセル防止
      var validPairs = parseResult.allDatePairs;
      var cancelledPairs = parseResult.cancelledDatePairs;
      var platformAdded = 0;
      var platformCheckIns = [];
      var colMap = buildColumnMap(formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0]);
      var nextRow = formSheet.getLastRow() + 1;

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
              Logger.log('iCal sync: overlap skip ' + platformName + ' ' + ev.checkIn + '~' + ev.checkOut + ' vs existing ' + exCi + '~' + exCo);
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
        // 自動で清掃募集を開始
        try {
          var coKey = ev.checkOut;
          if (coKey) {
            var rSheet = ss.getSheetByName(SHEET_RECRUIT);
            if (rSheet) {
              ensureRecruitDetailColumns_();
              ensureRecruitNotifyMethodColumn_();
              var rNextRow = rSheet.getLastRow() + 1;
              var nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
              rSheet.getRange(rNextRow, 1, 1, 15).setValues([[coKey, nextRow, '', '募集中', '', '', nowStr, '', 'メール', '', '', '', '', '', '']]);
            }
          }
        } catch (autoRecruitErr) {
          Logger.log('Auto-recruit error: ' + autoRecruitErr.toString());
        }
        // 1週間以内のチェックインなら即時リマインドメール送信
        try {
          sendImmediateReminderIfNeeded_(ss, ev.checkIn, ev.checkOut, platformName);
        } catch (imErr) {
          Logger.log('Immediate reminder error: ' + imErr.toString());
        }
        nextRow++;
        added++;
        platformCheckIns.push(ev.checkIn);
        platformAdded++;
      }
      var platformCancelled = 0;
      // 列マップを再取得（ensureCancelledColumn_で列が追加される可能性があるため）
      ensureCancelledColumn_();
      colMap = buildColumnMap(formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0]);
      // フィードが空（allDatePairsもcancelledPairsもゼロ）の場合はキャンセル判定をスキップ
      // （フィード取得の異常やサーバー側の一時的な問題の可能性が高い）
      var feedHasContent = Object.keys(validPairs).length > 0 || Object.keys(cancelledPairs).length > 0;
      if (colMap.icalSync >= 0 && feedHasContent) {
        var formData = formSheet.getRange(2, 1, formSheet.getLastRow() - 1, formSheet.getLastColumn()).getValues();
        for (var ri = 0; ri < formData.length; ri++) {
          var icalVal = String(formData[ri][colMap.icalSync] || '').trim();
          if (icalVal.toLowerCase() !== platformName.toLowerCase()) continue;
          var ciKey = toDateKeySafe_(formData[ri][colMap.checkIn]);
          var coKey = toDateKeySafe_(formData[ri][colMap.checkOut]);
          if (!ciKey || !coKey) continue;
          var pairKey = ciKey + '|' + coKey;
          var cancelledVal = colMap.cancelledAt >= 0 ? String(formData[ri][colMap.cancelledAt] || '').trim() : '';
          // チェックアウト日が過去の予約はキャンセル判定対象外（iCalから消えるのは正常）
          var coDate = coKey ? new Date(coKey) : null;
          var todaySync = new Date(); todaySync.setHours(0,0,0,0);
          var isPast = coDate && coDate < todaySync;
          // 明示的キャンセル（STATUS:CANCELLEDまたはSUMMARYに"cancel"） → 即キャンセル
          if (cancelledPairs[pairKey] && !isPast && !cancelledVal) {
            if (cancelBookingFromICal_(formSheet, ri + 2, colMap, platformName)) {
              platformCancelled++; removed++;
            }
          } else if (!validPairs[pairKey] && !cancelledPairs[pairKey] && !isPast) {
            // フィードから消えた（未来の予約のみ・明示的キャンセルでもない） → キャンセルマーク
            if (!cancelledVal) {
              if (cancelBookingFromICal_(formSheet, ri + 2, colMap, platformName)) {
                platformCancelled++; removed++;
              }
            }
          } else if (cancelledVal && validPairs[pairKey]) {
            // iCalに再出現 → キャンセル解除
            formSheet.getRange(ri + 2, colMap.cancelledAt + 1).setValue('');
            // 募集ステータスも募集中に戻す
            var recruitSheet2 = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT);
            if (recruitSheet2 && recruitSheet2.getLastRow() >= 2) {
              var rData2 = recruitSheet2.getRange(2, 1, recruitSheet2.getLastRow() - 1, 4).getValues();
              for (var ri2 = 0; ri2 < rData2.length; ri2++) {
                if (parseInt(rData2[ri2][1], 10) === (ri + 2) && String(rData2[ri2][3] || '').trim() === 'キャンセル') {
                  recruitSheet2.getRange(ri2 + 2, 4).setValue('募集中');
                }
              }
            }
            addNotification_('予約復活', '予約が復活しました（' + ciKey + '～' + coKey + '）');
          }
        }
      }
      var statusStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d HH:mm') + ' 取得' + events.length + '件';
      if (platformAdded > 0) statusStr += ' 追加' + platformAdded;
      if (platformCancelled > 0) statusStr += ' キャンセル' + platformCancelled;
      syncSheet.getRange(si + 2, 4).setValue(statusStr);
      if (platformAdded > 0) {
        var ciList = platformCheckIns.map(function(d) { return d.replace(/^\d{4}-/, '').replace('-', '/'); }).join(', ');
        addNotification_('予約追加', platformName + 'から' + platformAdded + '件の予約が追加されました（チェックイン: ' + ciList + '）');
      }
      details.push({ platform: platformName, fetched: events.length, added: platformAdded, removed: platformCancelled, error: '' });
    }

    // 同期後に募集レコードを自動作成（既存予約の漏れ分も含めて常に実行）
    try { checkAndCreateRecruitments(); } catch (re) { Logger.log('syncFromICal: recruitment auto-create: ' + re.toString()); }
    invalidateInitDataCache_();
    return JSON.stringify({ success: true, added: added, removed: removed, details: details });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), added: 0, removed: 0, details: [] });
  }
}

/**
 * 自動iCal同期（トリガーから呼ばれる版 - requireOwner不要）
 */
function autoSyncFromICal() {
  try {
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const syncSheet = ss.getSheetByName(SHEET_SYNC_SETTINGS);
    const formSheet = ss.getSheetByName(SHEET_NAME);
    if (!syncSheet || !formSheet) return;

    var lastRow = syncSheet.getLastRow();
    if (lastRow < 2) return;

    ensureICalSyncColumn_();
    if (syncSheet.getLastColumn() < 4) {
      syncSheet.insertColumnAfter(3);
      syncSheet.getRange(1, 4).setValue('最終同期');
    }
    var syncRows = syncSheet.getRange(2, 1, lastRow - 1, 4).getValues();
    var existingPairs = {};
    var existingRowByKey = {};
    var formLastRow = formSheet.getLastRow();
    var formLastCol = formSheet.getLastColumn();
    if (formLastRow >= 2 && formLastCol >= 1) {
      var headers = formSheet.getRange(1, 1, 1, formLastCol).getValues()[0];
      var colMap = buildColumnMap(headers);
      if (colMap.checkIn >= 0 && colMap.checkOut >= 0) {
        var data = formSheet.getRange(2, 1, formLastRow - 1, formLastCol).getValues();
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

    var added = 0;
    for (var si = 0; si < syncRows.length; si++) {
      var platformName = String(syncRows[si][0] || '').trim();
      var url = String(syncRows[si][1] || '').trim();
      var active = String(syncRows[si][2] || 'Y').trim();
      if (!platformName || !url || active === 'N') continue;

      try {
        var fetchOpts = { muteHttpExceptions: true, followRedirects: true,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CalendarSync/1.0)' } };
        var resp = UrlFetchApp.fetch(url, fetchOpts);
        // 5xx エラーは最大2回リトライ（一時的なサーバー障害対策）
        if (resp.getResponseCode() >= 500) {
          Utilities.sleep(2000);
          resp = UrlFetchApp.fetch(url, fetchOpts);
          if (resp.getResponseCode() >= 500) {
            Utilities.sleep(5000);
            resp = UrlFetchApp.fetch(url, fetchOpts);
          }
        }
        if (resp.getResponseCode() !== 200) {
          syncSheet.getRange(si + 2, 4).setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d HH:mm') + ' HTTP ' + resp.getResponseCode());
          continue;
        }
        var icalText = resp.getContentText();

        var parseResult = parseICal_(icalText, platformName);
        var events = parseResult.events;
        // allDatePairs: キャンセル以外の全日付（ブロック日含む）→ 既存予約の誤キャンセル防止
        var validPairs = parseResult.allDatePairs;
        var cancelledPairs = parseResult.cancelledDatePairs;
        var colMap = buildColumnMap(formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0]);
        var nextRow = formSheet.getLastRow() + 1;
        var platformAdded = 0;
        var platformCheckIns = [];

        for (var ei = 0; ei < events.length; ei++) {
          var ev = events[ei];
          var key = ev.checkIn + '|' + ev.checkOut;
          if (existingPairs[key]) {
            var updateRowNum = existingRowByKey[key];
            if (updateRowNum) {
              var existingIcal = colMap.icalSync >= 0 ? String(formSheet.getRange(updateRowNum, colMap.icalSync + 1).getValue() || '').trim().toLowerCase() : '';
              if (!existingIcal) {
                if (colMap.icalSync >= 0) formSheet.getRange(updateRowNum, colMap.icalSync + 1).setValue(ev.platform || '');
                if (colMap.icalGuestCount >= 0 && ev.guestCount) formSheet.getRange(updateRowNum, colMap.icalGuestCount + 1).setValue(ev.guestCount || '');
              }
            }
            continue;
          }
          existingPairs[key] = true;
          existingRowByKey[key] = nextRow;
          ensureICalGuestCountColumn_();
          ensureCancelledColumn_();
          colMap = buildColumnMap(formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0]);
          var rowData = new Array(formSheet.getLastColumn()).fill('');
          if (colMap.checkIn >= 0) rowData[colMap.checkIn] = ev.checkIn;
          if (colMap.checkOut >= 0) rowData[colMap.checkOut] = ev.checkOut;
          if (colMap.icalSync >= 0) rowData[colMap.icalSync] = ev.platform || '';
          if (colMap.icalGuestCount >= 0) rowData[colMap.icalGuestCount] = ev.guestCount || '';
          formSheet.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);
          nextRow++;
          platformCheckIns.push(ev.checkIn);
          platformAdded++;
          added++;
          try { sendImmediateReminderIfNeeded_(ss, ev.checkIn, ev.checkOut, platformName); } catch (e) {}
        }

        // iCalから消えた予約のキャンセル処理 + iCalに再出現した予約のキャンセル解除
        ensureCancelledColumn_();
        colMap = buildColumnMap(formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0]);
        // フィードが空（allDatePairsもcancelledPairsもゼロ）の場合はキャンセル判定をスキップ
        var feedHasContentAuto = Object.keys(validPairs).length > 0 || Object.keys(cancelledPairs).length > 0;
        if (formLastRow >= 2 && feedHasContentAuto) {
          var refreshData = formSheet.getRange(2, 1, formSheet.getLastRow() - 1, formSheet.getLastColumn()).getValues();
          for (var ci = 0; ci < refreshData.length; ci++) {
            var icalSrc = colMap.icalSync >= 0 ? String(refreshData[ci][colMap.icalSync] || '').trim().toLowerCase() : '';
            if (!icalSrc || icalSrc !== platformName.toLowerCase()) continue;
            var cik = toDateKeySafe_(refreshData[ci][colMap.checkIn]);
            var cok = toDateKeySafe_(refreshData[ci][colMap.checkOut]);
            if (!cik || !cok) continue;
            var autoPairKey = cik + '|' + cok;
            var cancelledValAuto = colMap.cancelledAt >= 0 ? String(refreshData[ci][colMap.cancelledAt] || '').trim() : '';
            // チェックアウト日が過去の予約はキャンセル判定対象外（iCalから消えるのは正常）
            var coDateAuto = cok ? new Date(cok) : null;
            var todayAuto = new Date(); todayAuto.setHours(0,0,0,0);
            var isPastAuto = coDateAuto && coDateAuto < todayAuto;
            // 明示的キャンセル（STATUS:CANCELLEDまたはSUMMARYに"cancel"） → 即キャンセル
            if (cancelledPairs[autoPairKey] && !isPastAuto && !cancelledValAuto) {
              try { cancelBookingFromICal_(formSheet, ci + 2, colMap, platformName); } catch (e) {}
            } else if (!validPairs[autoPairKey] && !cancelledPairs[autoPairKey] && !isPastAuto) {
              // フィードから消えた（未来の予約のみ・明示的キャンセルでもない） → キャンセルマーク
              if (!cancelledValAuto) {
                try { cancelBookingFromICal_(formSheet, ci + 2, colMap, platformName); } catch (e) {}
              }
            } else if (cancelledValAuto && validPairs[autoPairKey]) {
              // iCalに再出現 → キャンセル解除
              formSheet.getRange(ci + 2, colMap.cancelledAt + 1).setValue('');
              var recruitSheet2 = ss.getSheetByName(SHEET_RECRUIT);
              if (recruitSheet2 && recruitSheet2.getLastRow() >= 2) {
                var rData2 = recruitSheet2.getRange(2, 1, recruitSheet2.getLastRow() - 1, 4).getValues();
                for (var ri2 = 0; ri2 < rData2.length; ri2++) {
                  if (parseInt(rData2[ri2][1], 10) === (ci + 2) && String(rData2[ri2][3] || '').trim() === 'キャンセル') {
                    recruitSheet2.getRange(ri2 + 2, 4).setValue('募集中');
                  }
                }
              }
              addNotification_('予約復活', '予約が復活しました（' + cik + '～' + cok + '）');
            }
          }
        }

        var statusStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d HH:mm') + ' (自動) 取得' + events.length + '件';
        if (platformAdded > 0) statusStr += ' 追加' + platformAdded;
        syncSheet.getRange(si + 2, 4).setValue(statusStr);
        if (platformAdded > 0) {
          var ciList = platformCheckIns.map(function(d) { return d.replace(/^\d{4}-/, '').replace('-', '/'); }).join(', ');
          addNotification_('予約追加', platformName + 'から' + platformAdded + '件の予約が自動追加されました（チェックイン: ' + ciList + '）');
        }
      } catch (platformErr) {
        try { syncSheet.getRange(si + 2, 4).setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'M/d HH:mm') + ' エラー: ' + String(platformErr).substring(0, 60)); } catch (e) {}
        Logger.log('autoSyncFromICal ' + platformName + ': ' + platformErr.toString());
      }
    }

    if (added > 0) {
      try { checkAndCreateRecruitments(); } catch (re) {}
      invalidateInitDataCache_();
    }
    // 既読かつ10日以上経過した通知を自動クリーンアップ
    try { cleanupOldReadNotifications_(); } catch (ce) {}
  } catch (e) {
    Logger.log('autoSyncFromICal: ' + e.toString());
  }
}

/**
 * iCal同期バグで誤ってキャンセルされた過去予約を復元する（一回限りの修正用）
 * GASスクリプトエディタから手動実行: restoreICalCancelledPastBookings()
 */
function restoreICalCancelledPastBookings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var formSheet = ss.getSheetByName(SHEET_NAME);
  if (!formSheet || formSheet.getLastRow() < 2) return '対象シートが見つかりません';

  var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
  var colMap = buildColumnMap(headers);
  if (colMap.cancelledAt < 0) return 'キャンセル日時列がありません';
  if (colMap.checkOut < 0) return 'チェックアウト列がありません';

  var lastRow = formSheet.getLastRow();
  var data = formSheet.getRange(2, 1, lastRow - 1, formSheet.getLastColumn()).getValues();
  var today = new Date(); today.setHours(0, 0, 0, 0);

  var restored = [];
  for (var i = 0; i < data.length; i++) {
    var cancelledVal = String(data[i][colMap.cancelledAt] || '').trim();
    if (!cancelledVal) continue; // キャンセルされていない → スキップ

    var coRaw = data[i][colMap.checkOut];
    var coDate = coRaw instanceof Date ? coRaw : new Date(String(coRaw));
    if (isNaN(coDate.getTime())) continue;
    coDate.setHours(0, 0, 0, 0);

    if (coDate >= today) continue; // 未来の予約はスキップ（正当なキャンセルの可能性）

    var rowNumber = i + 2;
    var guestName = colMap.guestName >= 0 ? String(data[i][colMap.guestName] || '').trim() : '';
    var ciRaw = colMap.checkIn >= 0 ? data[i][colMap.checkIn] : '';
    var ciStr = ciRaw instanceof Date ? Utilities.formatDate(ciRaw, 'Asia/Tokyo', 'yyyy-MM-dd') : String(ciRaw || '');
    var coStr = coRaw instanceof Date ? Utilities.formatDate(coRaw, 'Asia/Tokyo', 'yyyy-MM-dd') : String(coRaw || '');
    var cleaningStaff = colMap.cleaningStaff >= 0 ? String(data[i][colMap.cleaningStaff] || '').trim() : '';

    // キャンセル日時をクリア
    formSheet.getRange(rowNumber, colMap.cancelledAt + 1).setValue('');
    restored.push({ row: rowNumber, guest: guestName, ci: ciStr, co: coStr, cancelled: cancelledVal, staff: cleaningStaff });
  }

  // 募集シートのステータスも復元
  var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
  if (recruitSheet && recruitSheet.getLastRow() >= 2) {
    var rLastRow = recruitSheet.getLastRow();
    var rData = recruitSheet.getRange(2, 1, rLastRow - 1, 5).getValues();
    for (var ri = 0; ri < rData.length; ri++) {
      var rRowNum = parseInt(rData[ri][1], 10);
      var rStatus = String(rData[ri][3] || '').trim();
      if (rStatus !== 'キャンセル') continue;
      // この募集が復元対象の予約に対応するか
      for (var j = 0; j < restored.length; j++) {
        if (rRowNum === restored[j].row) {
          var newStatus = restored[j].staff ? 'スタッフ確定済み' : '募集中';
          recruitSheet.getRange(ri + 2, 4).setValue(newStatus);
          Logger.log('募集 行' + (ri + 2) + ' ステータス復元: キャンセル → ' + newStatus);
          break;
        }
      }
    }
  }

  // ログ出力
  Logger.log('=== iCalキャンセル復元結果 ===');
  Logger.log('復元件数: ' + restored.length);
  for (var k = 0; k < restored.length; k++) {
    var r = restored[k];
    Logger.log('行' + r.row + ': ' + r.guest + ' (' + r.ci + '～' + r.co + ') キャンセル日時=' + r.cancelled);
  }

  return '復元完了: ' + restored.length + '件';
}

/**
 * 自動同期設定の取得
 */
function getAutoSyncSettings() {
  try {
    var props = PropertiesService.getScriptProperties();
    var enabled = props.getProperty('AUTO_SYNC_ENABLED') === 'true';
    var intervalHours = parseInt(props.getProperty('AUTO_SYNC_INTERVAL_HOURS'), 10) || 1;
    return JSON.stringify({ success: true, enabled: enabled, intervalHours: intervalHours });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 自動同期設定の保存＋トリガー設定
 * enabledは廃止。ソースごとの有効/無効状態から自動判定する。
 * 後方互換のため引数2つでも1つでも受け付ける。
 */
function saveAutoSyncSettings(enabledOrInterval, intervalHoursOpt) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ' });
    // 後方互換: saveAutoSyncSettings(interval) or saveAutoSyncSettings(enabled, interval)
    var intervalHours;
    if (intervalHoursOpt !== undefined) {
      intervalHours = parseInt(intervalHoursOpt, 10) || 1;
    } else {
      intervalHours = parseInt(enabledOrInterval, 10) || 1;
    }
    var props = PropertiesService.getScriptProperties();
    props.setProperty('AUTO_SYNC_INTERVAL_HOURS', String(intervalHours));
    // ソースの有効状態からトリガー要否を自動判定
    var hasActive = hasAnyActiveSyncSource_();
    props.setProperty('AUTO_SYNC_ENABLED', hasActive ? 'true' : 'false');
    setupAutoSyncTrigger_(hasActive, intervalHours);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * いずれかのiCalソースが自動同期有効かどうかを判定
 */
function hasAnyActiveSyncSource_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var syncSheet = ss.getSheetByName(SHEET_SYNC_SETTINGS);
    if (!syncSheet || syncSheet.getLastRow() < 2) return false;
    var rows = syncSheet.getRange(2, 1, syncSheet.getLastRow() - 1, 3).getValues();
    for (var i = 0; i < rows.length; i++) {
      var name = String(rows[i][0] || '').trim();
      var url = String(rows[i][1] || '').trim();
      var active = String(rows[i][2] || 'Y').trim();
      if (name && url && active !== 'N') return true;
    }
    return false;
  } catch (e) { return false; }
}

function setupAutoSyncTrigger_(enabled, intervalHours) {
  // 既存のautoSyncトリガーを全て削除
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'autoSyncFromICal') {
      ScriptApp.deleteTrigger(t);
    }
  });
  if (enabled) {
    ScriptApp.newTrigger('autoSyncFromICal')
      .timeBased()
      .everyHours(intervalHours || 1)
      .create();
  }
}

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
    invalidateInitDataCache_();
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
    invalidateInitDataCache_();
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
    addNotification_('予約追加', '予約が追加されました' + (guestName ? ' (' + String(guestName).trim() + ')' : '') + '（' + ciStr + '～' + coStr + '）');
    invalidateInitDataCache_();
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function getNotifications(unreadOnly) {
  try {
    ensureSheetsExist();
    try { fixFarFutureNotificationDates_(); } catch (e) {}
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NOTIFICATIONS);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: true, list: [] });
    var lastCol = Math.max(sheet.getLastColumn(), 5);
    var numRows = sheet.getLastRow() - 1;
    const data = sheet.getRange(2, 1, numRows, lastCol).getValues();
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

/**
 * 通知を一括削除（全行削除してヘッダーだけ残す）
 */
function clearAllNotifications() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NOTIFICATIONS);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: true });
    sheet.deleteRows(2, sheet.getLastRow() - 1);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 既読かつ通知日から10日以上経過した通知を自動削除
 */
function cleanupOldReadNotifications_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NOTIFICATIONS);
  if (!sheet || sheet.getLastRow() < 2) return;
  var now = new Date();
  var cutoff = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 5);
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  // 下の行から削除（行番号ズレ防止）
  for (var i = data.length - 1; i >= 0; i--) {
    var readVal = String(data[i][3] || '').trim();
    if (readVal !== 'Y' && readVal !== 'y') continue;
    var atVal = data[i][0];
    var atDate = (atVal instanceof Date) ? atVal : new Date(String(atVal));
    if (isNaN(atDate.getTime())) continue;
    if (atDate < cutoff) {
      sheet.deleteRow(i + 2);
    }
  }
}

/**********************************************
 * 清掃スタッフ（オーナーのみ）
 **********************************************/

function getStaffList() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。', list: [] });
    ensureSheetsExist();
    ensureStaffOrderColumn_();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STAFF);
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const lastCol = Math.max(sheet.getLastColumn(), 11);
    const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
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
        active: String(row[8] || 'Y').trim(),
        hasPassword: lastCol >= 10 ? !!String(row[9] || '').trim() : false,
        displayOrder: parseInt(row[10], 10) || 9999
      };
    }).filter(function(item) { return item.name || item.email; });
    list.sort(function(a, b) { return a.displayOrder - b.displayOrder; });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), list: [] });
  }
}

/** スタッフシートに表示順列を保証 */
function ensureStaffOrderColumn_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_STAFF);
    if (!sheet || sheet.getLastRow() < 1) return;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').trim() === '表示順') return;
    }
    var nextCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, nextCol).setValue('表示順');
    // 既存スタッフに連番を振る
    if (sheet.getLastRow() >= 2) {
      for (var r = 2; r <= sheet.getLastRow(); r++) {
        sheet.getRange(r, nextCol).setValue(r - 1);
      }
    }
  } catch (e) {}
}

/** スタッフの表示順を一括保存 */
function updateStaffOrder(orderedRowIndices) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_STAFF);
    if (!sheet) return JSON.stringify({ success: false, error: 'スタッフシートが見つかりません。' });
    ensureStaffOrderColumn_();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var orderCol = -1;
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').trim() === '表示順') { orderCol = i + 1; break; }
    }
    if (orderCol < 0) return JSON.stringify({ success: false, error: '表示順列が見つかりません。' });
    for (var j = 0; j < orderedRowIndices.length; j++) {
      var rowIdx = orderedRowIndices[j];
      if (rowIdx >= 2 && rowIdx <= sheet.getLastRow()) {
        sheet.getRange(rowIdx, orderCol).setValue(j + 1);
      }
    }
    invalidateStaffCache_();
    invalidateInitDataCache_();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
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
      // 名前変更を検知して関連シートに伝播
      var oldName = String(sheet.getRange(rowIndex, 1).getValue() || '').trim();
      var newName = (data.name || '').trim();
      sheet.getRange(rowIndex, 1, 1, 9).setValues([[
        data.name || '', data.address || '', data.email || '',
        data.bankName || '', data.bankBranch || '', data.accountType || '',
        data.accountNumber || '', data.accountHolder || '', data.active !== 'N' ? 'Y' : 'N'
      ]]);
      if (oldName && newName && oldName !== newName) {
        propagateStaffNameChange_(ss, oldName, newName);
      }
      invalidateStaffCache_();
      invalidateInitDataCache_();
      return JSON.stringify({ success: true, rowIndex: rowIndex });
    }
    const nextRow = lastRow + 1;
    sheet.getRange(nextRow, 1, 1, 9).setValues([[
      data.name || '', data.address || '', data.email || '',
      data.bankName || '', data.bankBranch || '', data.accountType || '',
      data.accountNumber || '', data.accountHolder || '', data.active !== 'N' ? 'Y' : 'N'
    ]]);
    invalidateStaffCache_();
    invalidateInitDataCache_();
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * スタッフ名変更時に関連シートの名前を一括更新
 */
function propagateStaffNameChange_(ss, oldName, newName) {
  try {
    // 単一カラムの名前を置換するヘルパー
    function replaceInColumn(sheetName, col) {
      var s = ss.getSheetByName(sheetName);
      if (!s || s.getLastRow() < 2) return;
      var range = s.getRange(2, col, s.getLastRow() - 1, 1);
      var vals = range.getValues();
      var changed = false;
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0]).trim() === oldName) {
          vals[i][0] = newName;
          changed = true;
        }
      }
      if (changed) range.setValues(vals);
    }

    // カンマ区切りの名前リスト内を置換するヘルパー
    function replaceInListColumn(sheetName, col) {
      var s = ss.getSheetByName(sheetName);
      if (!s || s.getLastRow() < 2) return;
      var range = s.getRange(2, col, s.getLastRow() - 1, 1);
      var vals = range.getValues();
      var changed = false;
      for (var i = 0; i < vals.length; i++) {
        var val = String(vals[i][0] || '').trim();
        if (!val) continue;
        var names = val.split(/[,、]/).map(function(n) { return n.trim(); });
        var updated = names.map(function(n) { return n === oldName ? newName : n; });
        var joined = updated.join('、');
        if (joined !== val) { vals[i][0] = joined; changed = true; }
      }
      if (changed) range.setValues(vals);
    }

    // 募集_立候補: B列(スタッフ名)
    replaceInColumn(SHEET_RECRUIT_VOLUNTEERS, 2);
    // 募集: E列(選定スタッフ) - カンマ区切り
    replaceInListColumn(SHEET_RECRUIT, 5);
    // キャンセル申請: B列(スタッフ名)
    replaceInColumn(SHEET_CANCEL_REQUESTS, 2);
    // 回答変更要請: B列(スタッフ名)
    var rcSheet = ss.getSheetByName('回答変更要請');
    if (rcSheet && rcSheet.getLastRow() >= 2) {
      var rcRange = rcSheet.getRange(2, 2, rcSheet.getLastRow() - 1, 1);
      var rcVals = rcRange.getValues();
      var rcChanged = false;
      for (var ri = 0; ri < rcVals.length; ri++) {
        if (String(rcVals[ri][0]).trim() === oldName) { rcVals[ri][0] = newName; rcChanged = true; }
      }
      if (rcChanged) rcRange.setValues(rcVals);
    }
    // フォーム回答: 清掃スタッフ列 - カンマ区切り
    var formSheet = ss.getSheetByName(SHEET_NAME);
    if (formSheet && formSheet.getLastRow() >= 2) {
      var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
      var colMap = buildColumnMap(headers);
      if (colMap.cleaningStaff >= 0) {
        replaceInListColumn(SHEET_NAME, colMap.cleaningStaff + 1);
      }
    }
    // スタッフ報酬: A列
    replaceInColumn(SHEET_COMPENSATION, 1);
    // 請求書関連: A列
    replaceInColumn(SHEET_INVOICE_HISTORY, 1);
    replaceInColumn(SHEET_INVOICE_EXTRA, 1);
    replaceInColumn(SHEET_INVOICE_EXCLUDED, 1);
    // クリーニング連絡: B列(出した人), D列(受け取った人), F列(施設に戻した人)
    replaceInColumn(SHEET_LAUNDRY, 2);
    replaceInColumn(SHEET_LAUNDRY, 4);
    replaceInColumn(SHEET_LAUNDRY, 6);
  } catch (e) {
    Logger.log('propagateStaffNameChange_: ' + e.toString());
  }
}

function deleteStaff(rowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ削除できます。' });
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STAFF);
    if (!sheet || rowIndex < 2) return JSON.stringify({ success: false, error: '無効な行' });
    sheet.deleteRow(rowIndex);
    invalidateStaffCache_();
    invalidateInitDataCache_();
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
    const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 3).getValues() : [];
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
    const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 4).getValues() : [];
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
      var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
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
      var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
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
    var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
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
    const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    const map = {};
    rows.forEach(function(row) {
      const key = String(row[0] || '').trim();
      if (key) map[key] = row[1];
    });
    // スケジュール（JSON配列）
    var schedules = [];
    try { schedules = JSON.parse(map['募集リマインドスケジュール'] || '[]'); } catch (e) { schedules = []; }
    while (schedules.length < 5) {
      schedules.push({ daysBefore: 0, time: '09:00', enabled: false });
    }
    return JSON.stringify({
      success: true,
      settings: {
        recruitReminderEnabled: map['募集リマインド有効'] === true || map['募集リマインド有効'] === 'true',
        recruitStartWeeks: parseInt(map['募集開始週数'], 10) || 4,
        minRespondents: parseInt(map['最少回答者数'], 10) || 2,
        selectCount: parseInt(map['選定人数'], 10) || 2,
        schedules: schedules,
        recipients: String(map['募集リマインド送信先'] || ''),
        recruitReminderSubject: String(map['募集リマインド件名'] || ''),
        recruitReminderBody: String(map['募集リマインド本文'] || '')
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
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    var rowMap = {};
    for (var i = 0; i < rows.length; i++) {
      var key = String(rows[i][0] || '').trim();
      if (key) rowMap[key] = i + 2;
    }
    var entries = [
      ['募集リマインド有効', settings.recruitReminderEnabled ? 'true' : 'false'],
      ['最少回答者数', settings.minRespondents != null ? settings.minRespondents : 2],
      ['選定人数', settings.selectCount != null ? settings.selectCount : 2],
      ['募集リマインドスケジュール', JSON.stringify(settings.schedules || [])],
      ['募集リマインド送信先', String(settings.recipients || '')],
      ['募集リマインド件名', String(settings.recruitReminderSubject || '')],
      ['募集リマインド本文', String(settings.recruitReminderBody || '')]
    ];
    for (var ei = 0; ei < entries.length; ei++) {
      var eKey = entries[ei][0], eVal = entries[ei][1];
      if (rowMap[eKey]) {
        sheet.getRange(rowMap[eKey], 2).setValue(eVal);
      } else {
        var nr = sheet.getLastRow() + 1;
        sheet.getRange(nr, 1).setValue(eKey);
        sheet.getRange(nr, 2).setValue(eVal);
        rowMap[eKey] = nr;
      }
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**********************************************
 * メール通知ON/OFF設定
 **********************************************/

var EMAIL_NOTIFY_KEYS_ = [
  '募集開始通知有効', 'スタッフ確定通知有効', 'キャンセル通知有効',
  '辞退申請通知有効', '辞退承認通知有効', '辞退却下通知有効',
  '清掃完了通知有効', '請求書送信通知有効'
];
var EMAIL_NOTIFY_JS_KEYS_ = [
  'notifyRecruitStart', 'notifyStaffConfirm', 'notifyCancel',
  'notifyCancelRequest', 'notifyCancelApprove', 'notifyCancelReject',
  'notifyCleaningDone', 'notifyInvoice'
];

function getEmailNotifySettings() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。' });
    ensureSheetsExist();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT_SETTINGS);
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    var map = {};
    rows.forEach(function(row) {
      var key = String(row[0] || '').trim();
      if (key) map[key] = row[1];
    });
    var settings = {};
    for (var i = 0; i < EMAIL_NOTIFY_KEYS_.length; i++) {
      var val = map[EMAIL_NOTIFY_KEYS_[i]];
      settings[EMAIL_NOTIFY_JS_KEYS_[i]] = val === true || String(val).trim() === 'true'; // デフォルトOFF
    }
    return JSON.stringify({ success: true, settings: settings });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function saveEmailNotifySettings(settings) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureSheetsExist();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT_SETTINGS);
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    var rowMap = {};
    rows.forEach(function(r, i) {
      var k = String(r[0] || '').trim();
      if (k) rowMap[k] = i + 2;
    });
    for (var i = 0; i < EMAIL_NOTIFY_KEYS_.length; i++) {
      var sheetKey = EMAIL_NOTIFY_KEYS_[i];
      var jsKey = EMAIL_NOTIFY_JS_KEYS_[i];
      var val = settings[jsKey] !== false ? 'true' : 'false';
      if (rowMap[sheetKey]) {
        sheet.getRange(rowMap[sheetKey], 2).setValue(val);
      } else {
        var nr = sheet.getLastRow() + 1;
        sheet.getRange(nr, 1).setValue(sheetKey);
        sheet.getRange(nr, 2).setValue(val);
        rowMap[sheetKey] = nr;
      }
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/** メール通知が有効かチェックするヘルパー（キー未設定時はデフォルトON） */
function isEmailNotifyEnabled_(sheetKey) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT_SETTINGS);
    if (!sheet || sheet.getLastRow() < 2) return true;
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === sheetKey) {
        var v = rows[i][1];
        return v === true || String(v).trim() === 'true';
      }
    }
    return true; // キーが見つからない場合はデフォルトON（設定画面で明示的にOFFにするまで有効）
  } catch (e) {
    return true;
  }
}

/**********************************************
 * 請求書要請メール設定（スタッフ宛）
 * デフォルト: 送信無し（enabled=false）
 **********************************************/

var INVOICE_REQ_KEYS_ = {
  enabled: '請求書要請メール有効',
  day: '請求書要請配信日',
  time: '請求書要請配信時刻',
  subject: '請求書要請件名',
  body: '請求書要請本文'
};

function getInvoiceRequestSettings() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。' });
    ensureSheetsExist();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT_SETTINGS);
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    var map = {};
    rows.forEach(function(row) {
      var key = String(row[0] || '').trim();
      if (key) map[key] = row[1];
    });
    var enabledVal = map[INVOICE_REQ_KEYS_.enabled];
    return JSON.stringify({
      success: true,
      settings: {
        enabled: enabledVal === true || String(enabledVal || '').trim() === 'true', // デフォルトOFF
        day: parseInt(map[INVOICE_REQ_KEYS_.day], 10) || 25,
        time: String(map[INVOICE_REQ_KEYS_.time] || '09:00').trim(),
        subject: String(map[INVOICE_REQ_KEYS_.subject] || ''),
        body: String(map[INVOICE_REQ_KEYS_.body] || '')
      }
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function saveInvoiceRequestSettings(settings) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureSheetsExist();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT_SETTINGS);
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    var rowMap = {};
    rows.forEach(function(r, i) {
      var k = String(r[0] || '').trim();
      if (k) rowMap[k] = i + 2;
    });
    var pairs = [
      [INVOICE_REQ_KEYS_.enabled, settings.enabled === true ? 'true' : 'false'],
      [INVOICE_REQ_KEYS_.day, String(settings.day || 25)],
      [INVOICE_REQ_KEYS_.time, String(settings.time || '09:00')],
      [INVOICE_REQ_KEYS_.subject, String(settings.subject || '')],
      [INVOICE_REQ_KEYS_.body, String(settings.body || '')]
    ];
    pairs.forEach(function(p) {
      var sheetKey = p[0], val = p[1];
      if (rowMap[sheetKey]) {
        sheet.getRange(rowMap[sheetKey], 2).setValue(val);
      } else {
        var nr = sheet.getLastRow() + 1;
        sheet.getRange(nr, 1).setValue(sheetKey);
        sheet.getRange(nr, 2).setValue(val);
        rowMap[sheetKey] = nr;
      }
    });
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/** 請求書要請メールをスタッフ全員に送信 */
function sendInvoiceRequestEmails(testRecipient) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_RECRUIT_SETTINGS);
    if (!sheet) return JSON.stringify({ success: false, error: '募集設定シートが見つかりません。' });
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    var map = {};
    rows.forEach(function(row) {
      var key = String(row[0] || '').trim();
      if (key) map[key] = row[1];
    });
    // テスト送信でない場合のみ有効チェック
    var testEmail = (testRecipient || '').trim();
    if (!testEmail) {
      var enabledVal = map[INVOICE_REQ_KEYS_.enabled];
      if (!(enabledVal === true || String(enabledVal || '').trim() === 'true')) {
        return JSON.stringify({ success: true, message: '請求書要請メールは無効に設定されています。', sent: 0 });
      }
    }
    var subject = String(map[INVOICE_REQ_KEYS_.subject] || '').trim();
    var bodyTpl = String(map[INVOICE_REQ_KEYS_.body] || '').trim();
    if (!subject || !bodyTpl) {
      return JSON.stringify({ success: false, error: '件名または本文が未設定です。設定画面で入力してください。' });
    }
    // 対象年月（翌月分を請求）
    var now = new Date();
    var targetMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    var ymText = targetMonth.getFullYear() + '年' + (targetMonth.getMonth() + 1) + '月';
    // 締切日（配信月の末日）
    var deadlineDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    var deadlineText = (deadlineDate.getMonth() + 1) + '/' + deadlineDate.getDate();
    // テスト送信先が指定されている場合は1通だけ送信
    if (testEmail) {
      var body = bodyTpl
        .replace(/\{スタッフ名\}/g, 'テストユーザー')
        .replace(/\{対象年月\}/g, ymText)
        .replace(/\{締切日\}/g, deadlineText);
      var subj = '【テスト】' + subject
        .replace(/\{対象年月\}/g, ymText)
        .replace(/\{スタッフ名\}/g, 'テストユーザー')
        .replace(/\{締切日\}/g, deadlineText);
      try {
        MailApp.sendEmail({ to: testEmail, subject: subj, body: body, name: '請求書要請（テスト送信）' });
        return JSON.stringify({ success: true, message: testEmail + ' にテストメールを送信しました。', sent: 1 });
      } catch (e) {
        return JSON.stringify({ success: false, error: '送信失敗: ' + e.toString() });
      }
    }
    // スタッフ一覧取得（全員に送信）
    var staffSheet = ss.getSheetByName(SHEET_STAFF);
    if (!staffSheet || staffSheet.getLastRow() < 2) {
      return JSON.stringify({ success: true, message: 'スタッフが登録されていません。', sent: 0 });
    }
    var staffRows = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 3).getValues();
    var sentCount = 0;
    var errors = [];
    staffRows.forEach(function(row) {
      var name = String(row[0] || '').trim();
      var email = String(row[1] || '').trim();
      if (!email || !/@/.test(email)) return;
      var body = bodyTpl
        .replace(/\{スタッフ名\}/g, name || 'スタッフ')
        .replace(/\{対象年月\}/g, ymText)
        .replace(/\{締切日\}/g, deadlineText);
      var subj = subject
        .replace(/\{対象年月\}/g, ymText)
        .replace(/\{スタッフ名\}/g, name || 'スタッフ')
        .replace(/\{締切日\}/g, deadlineText);
      try {
        MailApp.sendEmail({ to: email, subject: subj, body: body, name: '請求書要請（自動送信）' });
        sentCount++;
      } catch (e) {
        errors.push(name + ': ' + e.toString());
      }
    });
    var msg = sentCount + '件送信しました。';
    if (errors.length) msg += ' エラー: ' + errors.join('; ');
    return JSON.stringify({ success: true, message: msg, sent: sentCount });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/** トリガーから毎日呼ばれ、配信日なら送信 */
function checkAndSendInvoiceRequest() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_RECRUIT_SETTINGS);
    if (!sheet) return;
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    var map = {};
    rows.forEach(function(row) {
      var key = String(row[0] || '').trim();
      if (key) map[key] = row[1];
    });
    var enabledVal = map[INVOICE_REQ_KEYS_.enabled];
    if (!(enabledVal === true || String(enabledVal || '').trim() === 'true')) return;
    var day = parseInt(map[INVOICE_REQ_KEYS_.day], 10) || 25;
    var now = new Date();
    var today = now.getDate();
    // 月末調整: 設定日が今月の日数を超える場合は月末日に送信
    var lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var effectiveDay = Math.min(day, lastDayOfMonth);
    if (today !== effectiveDay) return;
    sendInvoiceRequestEmails();
  } catch (e) {
    Logger.log('請求書要請トリガーエラー: ' + e.toString());
  }
}

/** 請求書要請トリガーをセットアップ */
function setupInvoiceRequestTrigger() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    // 既存トリガー削除
    var triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function(t) {
      if (t.getHandlerFunction() === 'checkAndSendInvoiceRequest') {
        ScriptApp.deleteTrigger(t);
      }
    });
    // 時刻取得
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_RECRUIT_SETTINGS);
    var hour = 9;
    if (sheet && sheet.getLastRow() >= 2) {
      var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0] || '').trim() === INVOICE_REQ_KEYS_.time) {
          var h = parseInt(String(rows[i][1] || '9'), 10);
          if (!isNaN(h) && h >= 0 && h <= 23) hour = h;
          break;
        }
      }
    }
    ScriptApp.newTrigger('checkAndSendInvoiceRequest')
      .timeBased()
      .everyDays(1)
      .atHour(hour)
      .create();
    return JSON.stringify({ success: true, message: '毎日' + hour + '時にチェックするトリガーを設定しました。' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**********************************************
 * 名簿リマインダー設定
 **********************************************/

function getRosterReminderSettings() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。' });
    ensureSheetsExist();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT_SETTINGS);
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    const map = {};
    rows.forEach(function(row) {
      var key = String(row[0] || '').trim();
      if (key) map[key] = row[1];
    });
    // スケジュール（JSON配列）
    var schedules = [];
    try { schedules = JSON.parse(map['名簿リマインドスケジュール'] || '[]'); } catch (e) { schedules = []; }
    // 旧設定からの移行: スケジュールが空で旧設定がある場合、1件目に変換
    if (schedules.length === 0) {
      var oldDays = parseInt(map['名簿リマインダー日前'], 10);
      var oldHour = parseInt(map['名簿リマインダー送信時刻'], 10);
      if (oldDays > 0) {
        schedules.push({ enabled: true, daysBefore: oldDays, time: ('0' + (oldHour || 9)).slice(-2) + ':00' });
      }
    }
    while (schedules.length < 5) {
      schedules.push({ daysBefore: 0, time: '09:00', enabled: false });
    }
    return JSON.stringify({
      success: true,
      settings: {
        rosterReminderEnabled: map['名簿リマインダー有効'] === true || map['名簿リマインダー有効'] === 'true',
        schedules: schedules,
        recipients: String(map['名簿リマインド送信先'] || ''),
        rosterReminderSubject: String(map['名簿リマインド件名'] || ''),
        rosterReminderBody: String(map['名簿リマインド本文'] || '')
      }
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function saveRosterReminderSettings(settings) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_RECRUIT_SETTINGS);
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    var keyRowMap = {};
    rows.forEach(function(r, i) {
      var k = String(r[0] || '').trim();
      if (k) keyRowMap[k] = i + 2;
    });
    var pairs = [
      ['名簿リマインダー有効', settings.rosterReminderEnabled ? 'true' : 'false'],
      ['名簿リマインドスケジュール', JSON.stringify(settings.schedules || [])],
      ['名簿リマインド送信先', String(settings.recipients || '')],
      ['名簿リマインド件名', String(settings.rosterReminderSubject || '')],
      ['名簿リマインド本文', String(settings.rosterReminderBody || '')]
    ];
    pairs.forEach(function(pair) {
      var rowNum = keyRowMap[pair[0]];
      if (rowNum) {
        sheet.getRange(rowNum, 2).setValue(pair[1]);
      } else {
        var newRow = sheet.getLastRow() + 1;
        sheet.getRange(newRow, 1).setValue(pair[0]);
        sheet.getRange(newRow, 2).setValue(pair[1]);
      }
    });
    // トリガーの設定/解除（有効なスケジュールがあればトリガーON）
    var hasEnabled = (settings.schedules || []).some(function(s) { return s.enabled && s.daysBefore > 0; });
    setupRosterReminderTrigger(settings.rosterReminderEnabled && hasEnabled, 9);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function setupRosterReminderTrigger(enabled, hour) {
  // 既存の名簿リマインダートリガーを削除
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'checkRosterReminder') {
      ScriptApp.deleteTrigger(t);
    }
  });
  if (enabled) {
    ScriptApp.newTrigger('checkRosterReminder')
      .timeBased()
      .everyDays(1)
      .atHour(hour || 9)
      .create();
  }
}

function checkRosterReminder() {
  try {
    ensureSingleTrigger_('checkRosterReminder'); // トリガー重複クリーンアップ
    var res = JSON.parse(getRosterReminderSettings());
    if (!res.success || !res.settings || !res.settings.rosterReminderEnabled) return;
    var schedules = res.settings.schedules || [];
    var enabledSchedules = schedules.filter(function(s) { return s.enabled && s.daysBefore > 0; });
    if (enabledSchedules.length === 0) return;
    var daysBefore = Math.max.apply(null, enabledSchedules.map(function(s) { return s.daysBefore; }));
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return;

    // ヘッダーからチェックイン列・氏名列（複数対応）・キャンセル列・iCal同期列を特定
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var checkInCol = -1, guestNameCols = [], cancelledAtCol = -1, icalSyncCol = -1;
    for (var h = 0; h < headers.length; h++) {
      var hdr = String(headers[h]).trim();
      if (hdr === HEADERS.CHECK_IN) checkInCol = h;
      // 氏名列は部分一致で全て収集（buildColumnMapと同じ基準）
      if (hdr.indexOf('氏名') > -1 || hdr.indexOf('名前') > -1 || hdr.toLowerCase() === 'full name') guestNameCols.push(h);
      if ((hdr === HEADERS.CANCELLED_AT || hdr === 'キャンセル日時') && cancelledAtCol < 0) cancelledAtCol = h;
      if ((hdr === HEADERS.ICAL_SYNC || (hdr.indexOf('iCal') >= 0 && hdr.indexOf('同期') >= 0)) && icalSyncCol < 0) icalSyncCol = h;
    }
    if (checkInCol < 0) return;
    if (guestNameCols.length === 0) return; // 氏名列が見つからない場合はスキップ（全予約が誤検知になるため）

    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayStr = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd');

    // 重複送信防止: 本日分を既に送信済みなら中止
    var lastSent = PropertiesService.getScriptProperties().getProperty('rosterReminderLastSent');
    if (lastSent === todayStr) return;

    var targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + daysBefore);

    // 宿泊者名簿未記入の予約を検出
    var missing = [];
    for (var i = 0; i < rows.length; i++) {
      var checkInDate = rows[i][checkInCol] ? new Date(rows[i][checkInCol]) : null;
      if (!checkInDate) continue;
      checkInDate.setHours(0, 0, 0, 0);
      if (checkInDate < today || checkInDate > targetDate) continue;
      // キャンセル済み予約はスキップ
      if (cancelledAtCol >= 0 && String(rows[i][cancelledAtCol] || '').trim()) continue;
      // iCal同期で取り込まれた行はスキップ（名簿情報がないため誤検知になる）
      if (icalSyncCol >= 0 && String(rows[i][icalSyncCol] || '').trim()) continue;
      // いずれかの氏名列に値があれば名簿記入済みとみなす
      var hasGuestName = false;
      for (var g = 0; g < guestNameCols.length; g++) {
        if (String(rows[i][guestNameCols[g]] || '').trim()) { hasGuestName = true; break; }
      }
      if (!hasGuestName) {
        missing.push({
          checkIn: Utilities.formatDate(checkInDate, 'Asia/Tokyo', 'yyyy-MM-dd'),
          rowNumber: i + 2
        });
      }
    }
    if (missing.length === 0) return;

    // オーナーに通知 + メール
    var ownerRes = JSON.parse(getOwnerEmail());
    var ownerEmail = (ownerRes && ownerRes.email) ? String(ownerRes.email).trim() : '';
    var msgLines = missing.map(function(m) {
      return 'チェックイン ' + m.checkIn + '（行' + m.rowNumber + '）';
    });
    var message = '宿泊者名簿が未記入の予約が ' + missing.length + ' 件あります: ' + msgLines.join(', ');
    // 本日送信済みとして先に記録（競合条件による重複通知を防止）
    PropertiesService.getScriptProperties().setProperty('rosterReminderLastSent', todayStr);
    addNotification_('名簿', message, { type: 'rosterReminder', missing: missing });

    if (ownerEmail) {
      try {
        GmailApp.sendEmail(
          ownerEmail,
          '【民泊】宿泊者名簿の未記入通知（' + missing.length + '件）',
          '以下の予約について、宿泊者名簿がまだ記入されていません。\n' +
          '宿泊者への催促をお願いします。\n\n' +
          msgLines.join('\n') + '\n\n' +
          '※ アプリの通知にも同じ内容が届いています。'
        );
      } catch (e) {
        Logger.log('名簿リマインダーメール送信失敗: ' + e.toString());
      }
    }
  } catch (e) {
    Logger.log('checkRosterReminder: ' + e.toString());
  }
}

/**********************************************
 * 募集・回答・選定
 **********************************************/

function getRecruitmentList() {
  try {
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // タブを開いた時に未作成の募集を自動作成
    try { checkAndCreateRecruitments(); } catch (e) {}
    const sheet = ss.getSheetByName(SHEET_RECRUIT);
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    ensureRecruitNotifyMethodColumn_();
    ensureRecruitDetailColumns_();
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const maxCol = Math.max(sheet.getLastColumn(), 15);
    var numRows = lastRow - 1;
    const rows = numRows >= 1 ? sheet.getRange(2, 1, numRows, maxCol).getValues() : [];
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
        volunteers: [] // 後で一括マージ
      });
    }
    // 全スタッフ一覧を取得して回答とマージ
    var allStaff = getAllActiveStaff_(ss);
    var volLastCol = (volSheet && volSheet.getLastColumn()) ? Math.max(volSheet.getLastColumn(), 7) : 7;
    ensureVolunteerStatusColumns_();
    var allVolRows = (volSheet && volSheet.getLastRow() >= 2) ? volSheet.getRange(2, 1, volSheet.getLastRow() - 1, volLastCol).getValues() : [];
    var responsesByRid = {};
    allVolRows.forEach(function(vr) {
      var rid = String(vr[0] || '').trim();
      if (!rid) return;
      if (!responsesByRid[rid]) responsesByRid[rid] = {};
      var email = String(vr[2] || '').trim().toLowerCase();
      var name = String(vr[1] || '').trim().toLowerCase();
      var key = email || name;
      responsesByRid[rid][key] = {
        response: normalizeVolStatus_(String(vr[5] || '').trim()),
        memo: String(vr[4] || '').trim(),
        respondedAt: String(vr[3] || '').trim()
      };
    });
    // 有効なridのセットを構築（自己修復用）
    var validRids = {};
    list.forEach(function(item) { validRids[item.id] = true; });
    // 孤立したrid（削除によるズレ）を検出し自動修復
    var orphanedRids = {};
    Object.keys(responsesByRid).forEach(function(rid) {
      if (!validRids[rid]) orphanedRids[rid] = responsesByRid[rid];
    });
    if (Object.keys(orphanedRids).length > 0 && volSheet) {
      // 孤立ridを数値順にソートし、回答がないrecruitに割り当てる
      var orphanedKeys = Object.keys(orphanedRids).sort(function(a, b) {
        return parseInt(a.replace('r', ''), 10) - parseInt(b.replace('r', ''), 10);
      });
      orphanedKeys.forEach(function(oRid) {
        var oNum = parseInt(oRid.replace('r', ''), 10);
        // 最も近い有効なridを探す（孤立ridより小さい方向に検索）
        for (var tryNum = oNum - 1; tryNum >= 2; tryNum--) {
          var tryRid = 'r' + tryNum;
          if (validRids[tryRid] && !responsesByRid[tryRid]) {
            responsesByRid[tryRid] = orphanedRids[oRid];
            // シートも修復
            try {
              var volRepairData = volSheet.getRange(2, 1, volSheet.getLastRow() - 1, 1).getValues();
              for (var vr = 0; vr < volRepairData.length; vr++) {
                if (String(volRepairData[vr][0] || '').trim() === oRid) {
                  volSheet.getRange(vr + 2, 1).setValue(tryRid);
                }
              }
            } catch (repairErr) {}
            break;
          }
        }
      });
    }
    list.forEach(function(item) {
      var ridResponses = responsesByRid[item.id] || {};
      item.volunteers = allStaff.map(function(s) {
        var key = s.email ? s.email.toLowerCase() : s.staffName.toLowerCase();
        var resp = ridResponses[key] || ridResponses[s.staffName.toLowerCase()];
        return {
          staffName: s.staffName,
          email: s.email,
          response: resp ? resp.response : '未回答',
          memo: resp ? resp.memo : '',
          respondedAt: resp ? resp.respondedAt : ''
        };
      });
    });
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
    var row = sheet.getRange(recruitRowIndex, 1, 1, 9).getValues()[0];
    var recruitDateStr = row[0] ? (row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[0])) : '';
    var bookingRowNumber = row[1] ? Number(row[1]) : 0;
    // フォームシートのチェックアウト日を正とする（募集シートの値はソート後に古くなりうる）
    var checkoutDateStr = getCheckoutDateFromFormSheet_(bookingRowNumber, ss) || recruitDateStr;
    var notifyMethod = String(row[8] || '').trim() || 'メール';
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    sheet.getRange(recruitRowIndex, 3).setValue(now);
    if (notifyMethod === 'LINE') {
      var detStr = getBookingDetailsForRecruit(bookingRowNumber, recruitRowIndex);
      var det = JSON.parse(detStr);
      var nextRes = det.success && det.nextReservation ? det.nextReservation : null;
      var appUrl = getLatestStaffUrl_();
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
/**
 * デバッグ用: 次回予約の計算過程を返す
 */
function debugNextReservation(bookingRowNumber, recruitRowIndex) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var formSheet = ss.getSheetByName(SHEET_NAME);
    var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!formSheet || formSheet.getLastRow() < 2) return JSON.stringify({ error: 'フォームシートなし' });
    var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    var colMap = buildColumnMap(headers);
    if (colMap.checkIn < 0 || colMap.checkOut < 0) colMap = buildColumnMapFromSource_(headers);
    var cleaningDate = '';
    // フォームシートの最新値を優先（募集シートの値はソート・日付変更後に古くなりうる）
    if (recruitRowIndex && recruitSheet && recruitSheet.getLastRow() >= recruitRowIndex) {
      cleaningDate = getCheckoutForRecruit_(recruitSheet, recruitRowIndex, ss);
    }
    if (!cleaningDate && bookingRowNumber && formSheet.getLastRow() >= bookingRowNumber) {
      var coVal = colMap.checkOut >= 0 ? formSheet.getRange(bookingRowNumber, colMap.checkOut + 1).getValue() : null;
      cleaningDate = coVal ? (coVal instanceof Date ? Utilities.formatDate(coVal, 'Asia/Tokyo', 'yyyy-MM-dd') : toDateKeySafe_(coVal) || String(coVal)) : '';
    }
    var formLastRow = formSheet.getLastRow();
    var data = formSheet.getRange(2, 1, formLastRow - 1, formSheet.getLastColumn()).getValues();
    var allCheckIns = [];
    for (var i = 0; i < data.length; i++) {
      var ciRaw = data[i][colMap.checkIn];
      var ciParsed = parseDate(ciRaw);
      var ciStr = ciParsed ? toDateKeySafe_(ciParsed) : toDateKeySafe_(ciRaw);
      allCheckIns.push({ row: i + 2, rawType: typeof ciRaw, rawStr: String(ciRaw).substring(0, 30), isDate: ciRaw instanceof Date, parsed: ciStr || '(unparseable)' });
    }
    var excludeCi = '';
    if (bookingRowNumber && bookingRowNumber >= 2 && (bookingRowNumber - 2) < data.length) {
      var exRaw = colMap.checkIn >= 0 ? data[bookingRowNumber - 2][colMap.checkIn] : null;
      var exParsed = parseDate(exRaw);
      excludeCi = exParsed ? toDateKeySafe_(exParsed) : toDateKeySafe_(exRaw);
    }
    return JSON.stringify({ cleaningDate: cleaningDate, excludeRow: bookingRowNumber, excludeCi: excludeCi, totalRows: data.length, checkIns: allCheckIns });
  } catch (e) { return JSON.stringify({ error: e.toString() }); }
}

function getNextReservationAfterCheckout_(formSheet, colMap, currentCheckoutStr, excludeRowNumber, ss) {
  if (!currentCheckoutStr) return null;
  var best = null;
  var bestCheckInStr = '9999-12-31';
  var usedColMap = colMap;
  var useFallback = false;

  var bestFormRow = null;
  var bestColMap = null;
  var formLastRow = formSheet ? formSheet.getLastRow() : 0;
  if (formSheet && formLastRow >= 2 && (colMap.checkIn >= 0 && colMap.checkOut >= 0)) {
    var data = formSheet.getRange(2, 1, formLastRow - 1, formSheet.getLastColumn()).getValues();
    // 除外行のチェックイン日を取得（重複行スキップ用）
    var excludeCi = '';
    if (excludeRowNumber && excludeRowNumber >= 2 && (excludeRowNumber - 2) < data.length) {
      var exCiVal = colMap.checkIn >= 0 ? data[excludeRowNumber - 2][colMap.checkIn] : null;
      var exCi = parseDate(exCiVal);
      excludeCi = exCi ? toDateKeySafe_(exCi) : toDateKeySafe_(exCiVal);
    }
    for (var i = 0; i < data.length; i++) {
      var rowNum = i + 2;
      if (rowNum === excludeRowNumber) continue;
      // 同一チェックイン日の重複行をスキップ（iCal+フォーム重複対策）
      if (excludeCi) {
        var rowCiVal = colMap.checkIn >= 0 ? data[i][colMap.checkIn] : null;
        var rowCiStr = parseDate(rowCiVal) ? toDateKeySafe_(parseDate(rowCiVal)) : toDateKeySafe_(rowCiVal);
        if (rowCiStr && rowCiStr === excludeCi) continue;
      }
      var row = data[i];
      var checkInVal = colMap.checkIn >= 0 ? row[colMap.checkIn] : null;
      var checkOutVal = colMap.checkOut >= 0 ? row[colMap.checkOut] : null;
      var checkIn = parseDate(checkInVal);
      var checkInStr = checkIn ? toDateKeySafe_(checkIn) : toDateKeySafe_(checkInVal);
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
        var guestCount = formFmt || '-';
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
        var staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, staffSheet.getLastColumn()).getValues();
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
            var sGuestCount = sFormFmt || '-';
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
            if (sForm) best.guestCount = sForm;
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
      cleaningStaff = String(recruitRow[4] || '').trim();
      // キャッシュ列(10-15)は使わない: 常にフォームシートから最新データを計算
      // cleaningDate は募集シートではなくフォームシートから取得する（ソートで行番号がずれた場合の対策）
    }
    if (formSheet && formSheet.getLastRow() >= bookingRowNumber) {
      const headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
      var colMap = buildColumnMap(headers);
      if (colMap.checkIn < 0 || colMap.checkOut < 0) colMap = buildColumnMapFromSource_(headers);
      const row = formSheet.getRange(bookingRowNumber, 1, 1, formSheet.getLastColumn()).getValues()[0];
      // 常にフォームシートのチェックアウト日を基準にする（募集シートの値はソート後に古くなりうる）
      var checkOut = colMap.checkOut >= 0 ? row[colMap.checkOut] : null;
      cleaningDate = checkOut ? (checkOut instanceof Date ? Utilities.formatDate(checkOut, 'Asia/Tokyo', 'yyyy-MM-dd') : (toDateKeySafe_(checkOut) || String(checkOut).trim())) : '';
      if (!cleaningStaff && colMap.cleaningStaff >= 0) cleaningStaff = String(row[colMap.cleaningStaff] || '').trim();
      var cd = cleaningDate || '';
      var normCleaningDate = cd.match(/^\d{4}-\d{2}-\d{2}$/) ? cd : (toDateKeySafe_(parseDate(cd) || cd) || cd);
      var nextRes = getNextReservationAfterCheckout_(formSheet, colMap, normCleaningDate, bookingRowNumber, ss);
      if (nextRes) {
        dateStr = nextRes.dateRange || nextRes.date || '';
        guestCount = nextRes.guestCount || '';
        bbq = nextRes.bbq || '';
        nationality = nextRes.nationality || '日本';
        memo = nextRes.memo || '';
        bedCount = nextRes.bedCount || '';
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
      var prevStaff = String(sheet.getRange(recruitRowIndexOrNull, 5).getValue() || '').trim();
      sheet.getRange(recruitRowIndexOrNull, 5).setValue(staffVal);
      if (staffVal) {
        sheet.getRange(recruitRowIndexOrNull, 4).setValue('スタッフ確定済み');
      } else if (prevStaff) {
        // スタッフが全削除 → 募集再開
        sheet.getRange(recruitRowIndexOrNull, 4).setValue('募集中');
        addNotification_('清掃募集開始', '清掃募集が再開されました（' + checkoutDateStr + '）', { bookingRowNumber: bookingRowNumber, checkoutDate: checkoutDateStr });
      }
      // 以前のスタッフが外された場合に通知
      if (prevStaff && prevStaff !== staffVal) {
        var prevNames = prevStaff.split(/[,、]/).map(function(n) { return n.trim(); }).filter(Boolean);
        var newNames = staffVal ? staffVal.split(/[,、]/).map(function(n) { return n.trim(); }).filter(Boolean) : [];
        var removedNames = prevNames.filter(function(n) { return newNames.indexOf(n) < 0; });
        if (removedNames.length > 0) {
          addNotification_('清掃変更', removedNames.join(', ') + ' が清掃担当から外れました（' + checkoutDateStr + '）', { bookingRowNumber: bookingRowNumber, checkoutDate: checkoutDateStr, removedStaff: removedNames });
        }
      }
      var formSheet = ss.getSheetByName(SHEET_NAME);
      if (formSheet && bookingRowNumber && formSheet.getLastRow() >= bookingRowNumber) {
        var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
        var colMap = buildColumnMap(headers);
        if (colMap.cleaningStaff >= 0) formSheet.getRange(bookingRowNumber, colMap.cleaningStaff + 1).setValue(staffVal);
      }
      invalidateInitDataCache_();
      return JSON.stringify({ success: true, rowIndex: recruitRowIndexOrNull });
    }
    var rows = sheet.getRange(2, 1, Math.max(sheet.getLastRow(), 1), 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (Number(rows[i][1]) === bookingRowNumber) return JSON.stringify({ success: true, alreadyExists: true, rowIndex: i + 2 });
    }
    var nextRow = sheet.getLastRow() + 1;
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    var staffVal = (detail.cleaningStaff || '').trim();
    var status = staffVal ? 'スタッフ確定済み' : '募集中';
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
    invalidateInitDataCache_();
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
      var volData = volSheet.getRange(2, 1, volSheet.getLastRow() - 1, 1).getValues();
      for (var v = volData.length - 1; v >= 0; v--) {
        if (String(volData[v][0]).trim() === 'r' + recruitRowIndex) volSheet.deleteRow(v + 2);
      }
    }
    recruitSheet.deleteRow(recruitRowIndex);
    // 削除された行より後のridを全て更新
    updateRidsAfterRecruitDeletion_(ss, recruitRowIndex);
    invalidateInitDataCache_();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 募集行削除後に、関連シートのrid（'rN'形式）を更新する
 * 削除された行より後の全てのridを1つ減らす
 */
function updateRidsAfterRecruitDeletion_(ss, deletedRowIndex) {
  try {
    // 募集_立候補シートのrid更新
    var volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    if (volSheet && volSheet.getLastRow() >= 2) {
      var volData = volSheet.getRange(2, 1, volSheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < volData.length; i++) {
        var rid = String(volData[i][0] || '').trim();
        var ridNum = parseInt(rid.replace('r', ''), 10);
        if (!isNaN(ridNum) && ridNum > deletedRowIndex) {
          volSheet.getRange(i + 2, 1).setValue('r' + (ridNum - 1));
        }
      }
    }
    // キャンセル申請シートのrid更新
    var crSheet = ss.getSheetByName(SHEET_CANCEL_REQUESTS);
    if (crSheet && crSheet.getLastRow() >= 2) {
      var crData = crSheet.getRange(2, 1, crSheet.getLastRow() - 1, 1).getValues();
      for (var j = 0; j < crData.length; j++) {
        var crid = String(crData[j][0] || '').trim();
        var cridNum = parseInt(crid.replace('r', ''), 10);
        if (!isNaN(cridNum) && cridNum > deletedRowIndex) {
          crSheet.getRange(j + 2, 1).setValue('r' + (cridNum - 1));
        }
      }
    }
    // 回答変更要請シートのrid更新
    var rcSheet = ss.getSheetByName('回答変更要請');
    if (rcSheet && rcSheet.getLastRow() >= 2) {
      var rcData = rcSheet.getRange(2, 1, rcSheet.getLastRow() - 1, 1).getValues();
      for (var k = 0; k < rcData.length; k++) {
        var rcrid = String(rcData[k][0] || '').trim();
        var rcridNum = parseInt(rcrid.replace('r', ''), 10);
        if (!isNaN(rcridNum) && rcridNum > deletedRowIndex) {
          rcSheet.getRange(k + 2, 1).setValue('r' + (rcridNum - 1));
        }
      }
    }
  } catch (e) {
    Logger.log('updateRidsAfterRecruitDeletion_: ' + e.toString());
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
    // フォームシートのチェックアウト日を正とする（募集シートの値はソート後に古くなりうる）
    var formDate = getCheckoutDateFromFormSheet_(bookingRowNumber);
    if (formDate) checkoutDateStr = formDate;
    // detail に有効な情報があるか（nationality デフォルト値のみは除外）
    var hasDetail = detail && (detail.date || detail.guestCount || detail.bbq);
    var nextRes = hasDetail ? detail : null;
    if (!nextRes) {
      var detStr = getBookingDetailsForRecruit(bookingRowNumber, null);
      var det = JSON.parse(detStr);
      if (det.success && det.nextReservation) nextRes = det.nextReservation;
    }
    var appUrl = getLatestStaffUrl_();
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
    const data = formSheet.getRange(2, 1, formSheet.getLastRow() - 1, formSheet.getLastColumn()).getValues();
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

/**
 * 募集行からチェックアウト日を取得（フォームシートの最新値を優先）
 * 募集シートの値は予約日付変更・ソート後に古くなりうるため、フォームシートの値を正とする
 * @param {Sheet} recruitSheet - 募集シート
 * @param {number} recruitRowIndex - 募集行番号（1始まり）
 * @param {Spreadsheet} [ss] - スプレッドシート
 * @return {string} チェックアウト日（YYYY-MM-DD形式）
 */
function getCheckoutForRecruit_(recruitSheet, recruitRowIndex, ss) {
  var bookingRowNum = recruitSheet.getRange(recruitRowIndex, 2).getValue();
  if (bookingRowNum) {
    var formDate = getCheckoutDateFromFormSheet_(Number(bookingRowNum), ss);
    if (formDate) return formDate;
  }
  var cell = recruitSheet.getRange(recruitRowIndex, 1).getValue();
  if (!cell) return '';
  return cell instanceof Date ? Utilities.formatDate(cell, 'Asia/Tokyo', 'yyyy-MM-dd') : (toDateKeySafe_(cell) || String(cell).trim());
}

/**
 * フォームシートから予約行のチェックアウト日を取得（募集シートの値はソート後に古くなりうるため）
 */
function getCheckoutDateFromFormSheet_(bookingRowNumber, ss) {
  if (!bookingRowNumber) return '';
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var formSheet = ss.getSheetByName(SHEET_NAME);
  if (!formSheet || formSheet.getLastRow() < bookingRowNumber) return '';
  var headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
  var colMap = buildColumnMap(headers);
  if (colMap.checkOut < 0) colMap = buildColumnMapFromSource_(headers);
  if (colMap.checkOut < 0) return '';
  var val = formSheet.getRange(bookingRowNumber, colMap.checkOut + 1).getValue();
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  return toDateKeySafe_(val) || String(val).trim();
}

function buildRecruitmentCopyText_(checkoutDateStr, nextReservation, appUrl) {
  // 作業日 = チェックアウト日（清掃詳細最上部と同じ値）
  var fmtDate = (checkoutDateStr || '－');
  var dm = fmtDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dm) fmtDate = dm[1] + '年' + ('0' + dm[2]).slice(-2) + '月' + ('0' + dm[3]).slice(-2) + '日';

  var nr = nextReservation || {};
  // チェックイン期間: dateRange (YYYY-MM-DD ～ YYYY-MM-DD) があればそれを使う
  var dateRange = nr.dateRange || '';
  if (!dateRange && nr.date) dateRange = nr.date;
  // 日付表示を YYYY/M/D 形式に変換
  var checkinDisp = (dateRange || '-').replace(/(\d{4})-(\d{1,2})-(\d{1,2})/g, function(_, y, m, d) {
    return y + '/' + parseInt(m, 10) + '/' + parseInt(d, 10);
  });
  var guestDisp = nr.guestCount || '-';
  var bedDisp = nr.bedCount || '-';
  // BBQ: yes/no → あり/なし, 未入力 → -
  var bbqRaw = (nr.bbq || '').toString().trim().toLowerCase();
  var bbqDisp = '-';
  if (bbqRaw.indexOf('yes') >= 0 || bbqRaw.indexOf('はい') >= 0) bbqDisp = 'あり';
  else if (bbqRaw.indexOf('no') >= 0 || bbqRaw.indexOf('いいえ') >= 0) bbqDisp = 'なし';
  else if (nr.bbq) bbqDisp = nr.bbq;
  var natDisp = nr.nationality || '-';

  var lines = ['清掃募集', '', '作業日: ' + fmtDate, ''];
  lines.push('次回予約（変更の可能性あり）');
  lines.push('日付:\u3000\u3000' + checkinDisp);
  lines.push('人数:\u3000\u3000' + guestDisp);
  // ベッド: カンマ区切りで1行表示
  var bedParts = String(bedDisp).split(/[,、\n]/).map(function(s) { return s.trim(); }).filter(Boolean);
  lines.push('ベッド:\u3000' + bedParts.join('、'));
  lines.push('BBQ:\u3000\u3000' + bbqDisp);
  lines.push('国籍:\u3000\u3000' + natDisp);
  lines.push('');
  lines.push('※予約状況次第では変更となる場合があります。');
  lines.push('');
  if (appUrl) {
    // ディープリンク: 該当日の清掃詳細を直接開く
    var deepUrl = appUrl + (appUrl.indexOf('?') >= 0 ? '&' : '?') + 'date=' + (checkoutDateStr || '');
    lines.push('Webアプリで回答: ' + deepUrl);
  }
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
    addNotification_('清掃募集開始', '清掃募集が開始されました（' + checkoutDateStr + '）', { bookingRowNumber: bookingRowNumber, checkoutDate: checkoutDateStr });
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function notifyStaffForRecruitment(recruitRowIndex, checkoutDateStr, bookingRowNumber) {
  try {
    if (!isEmailNotifyEnabled_('募集開始通知有効')) return;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const staffSheet = ss.getSheetByName(SHEET_STAFF);
    if (!staffSheet || staffSheet.getLastRow() < 2) return;
    var emailSet = {};
    const data = staffSheet.getRange(2, 3, staffSheet.getLastRow(), 3).getValues();
    data.forEach(function(row) {
      const e = String(row[0] || '').trim().toLowerCase();
      if (e) emailSet[e] = 1;
    });
    const emails = Object.keys(emailSet);
    if (emails.length === 0) return;
    // 次回予約情報を取得してメール本文に含める
    var nextRes = null;
    try {
      var detStr = getBookingDetailsForRecruit(bookingRowNumber, recruitRowIndex);
      var det = JSON.parse(detStr);
      if (det.success && det.nextReservation) nextRes = det.nextReservation;
    } catch (er) {}
    var appUrl = getLatestStaffUrl_();
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
 * スタッフ選択用に名前・メール一覧を取得（権限不要）
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
    var sName = (staffName || staff).trim();
    var sEmail = (staffEmail || '').trim().toLowerCase();

    // 排他ロックで同時送信を防止
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var crSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CANCEL_REQUESTS);
      if (!crSheet) { lock.releaseLock(); return JSON.stringify({ success: false, error: 'キャンセル申請シートが見つかりません。管理者に連絡してください。' }); }
      // 既に同一スタッフの pending な申請があればスキップ
      var alreadyExists = false;
      if (crSheet.getLastRow() >= 2) {
        var crLastCol = Math.max(crSheet.getLastColumn(), 5);
        var crData = crSheet.getRange(2, 1, crSheet.getLastRow() - 1, crLastCol).getValues();
        for (var c = 0; c < crData.length; c++) {
          if (String(crData[c][0]).trim() !== rid) continue;
          var crStatus = String(crData[c][4] || '').trim();
          if (crStatus === 'rejected') continue;
          var m1 = sName && String(crData[c][1] || '').trim() === sName;
          var m2 = sEmail && String(crData[c][2] || '').trim().toLowerCase() === sEmail;
          if (m1 || m2) { alreadyExists = true; break; }
        }
      }
      if (!alreadyExists) {
        var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
        crSheet.appendRow([rid, staffName || staff, staffEmail || '', now, '']);
        SpreadsheetApp.flush();
      }
      lock.releaseLock();
    } catch (lockErr) {
      try { lock.releaseLock(); } catch (e2) {}
      throw lockErr;
    }

    // 既に申請済みなら通知・メールも送らない
    if (alreadyExists) return JSON.stringify({ success: true });

    // initDataキャッシュを無効化（オーナー側で最新の取消申請が表示されるように）
    invalidateInitDataCache_();

    // 通知（シート書き込み）
    try { addNotification_('出勤キャンセル要望', staff + ' が出勤キャンセルの要望を提出しました（' + dateStr + '）', { bookingRowNumber: Number(bookingRowNumber) || 0, checkoutDate: dateStr, recruitRowIndex: recruitRowIndex, staffName: staff, staffEmail: String(staffEmail || '').trim() }); } catch (ne) { Logger.log('Cancel request notification failed: ' + ne.toString()); }
    // メール送信（最も遅い処理 - 失敗しても成功扱い）
    try {
      var ownerRes = JSON.parse(getOwnerEmail());
      var ownerEmail = (ownerRes && ownerRes.email) ? String(ownerRes.email).trim() : '';
      if (ownerEmail && isEmailNotifyEnabled_('辞退申請通知有効')) {
        var subject = '【民泊】清掃スタッフの出勤キャンセル要望: ' + dateStr;
        var body = '以下のスタッフが出勤キャンセルの要望を提出しました。\n\n日付: ' + dateStr + '\nスタッフ: ' + staff + '\n\n折り返しご連絡ください。';
        GmailApp.sendEmail(ownerEmail, subject, body);
      }
    } catch (mailErr) { Logger.log('Cancel request email failed: ' + mailErr.toString()); }
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
      var volData = volSheet.getRange(2, 1, volSheet.getLastRow() - 1, 4).getValues();
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

    // キャンセル申請レコードを全て削除（重複行対策: breakしない）
    if (crSheet && crSheet.getLastRow() >= 2) {
      var crData = crSheet.getRange(2, 1, crSheet.getLastRow() - 1, Math.max(crSheet.getLastColumn(), 5)).getValues();
      for (var j = crData.length - 1; j >= 0; j--) {
        if (String(crData[j][0]).trim() !== rid) continue;
        var crMatchName = sName && String(crData[j][1] || '').trim() === sName;
        var crMatchEmail = sEmail && String(crData[j][2] || '').trim().toLowerCase() === sEmail;
        if (crMatchName || crMatchEmail) {
          crSheet.deleteRow(j + 2);
        }
      }
    }

    // 通知を追加（フォームシートの最新日付を優先）
    var checkoutStr = getCheckoutForRecruit_(recruitSheet, recruitRowIndex, ss);
    addNotification_('キャンセル承認', (sName || sEmail) + ' のキャンセルを承認しました（' + checkoutStr + '）');

    // スタッフにメール通知
    if (sEmail && isEmailNotifyEnabled_('辞退承認通知有効')) {
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
        if (m1 || m2) { crSheet.getRange(j + 2, 5).setValue('rejected'); }
      }
    }

    var checkoutStr = recruitSheet ? getCheckoutForRecruit_(recruitSheet, recruitRowIndex, ss) : '';
    addNotification_('キャンセル却下', (sName || sEmail) + ' のキャンセル申請を却下しました（' + checkoutStr + '）');

    // スタッフにメール通知
    if (sEmail && isEmailNotifyEnabled_('辞退却下通知有効')) {
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
      if (m1 || m2) { crSheet.deleteRow(j + 2); }
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
    const lastCol = Math.max(sheet.getLastColumn(), 11);
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    const list = rows
      .map(function(row) {
        var name = String(row[0] || '').trim();
        var email = String(row[2] || '').trim();
        var active = lastCol >= 9 ? String(row[8] || 'Y').trim() : 'Y';
        if (active === 'N') return null;
        var hasPassword = lastCol >= 10 ? !!String(row[9] || '').trim() : false;
        var displayOrder = parseInt(row[10], 10) || 9999;
        return (name || email) ? { name: name || email, email: email, hasPassword: hasPassword, displayOrder: displayOrder } : null;
      })
      .filter(Boolean)
      .sort(function(a, b) { return a.displayOrder - b.displayOrder; });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, list: [], error: e.toString() });
  }
}

function hashPassword_(pw) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw + '_minpaku_salt');
  return bytes.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function verifyStaffPassword(staffName, staffEmail, password) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STAFF);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: false, error: 'スタッフが見つかりません' });
    var lastCol = Math.max(sheet.getLastColumn(), 10);
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    for (var i = 0; i < rows.length; i++) {
      var n = String(rows[i][0] || '').trim();
      var e = String(rows[i][2] || '').trim();
      if (n === staffName || (staffEmail && e === staffEmail)) {
        var stored = lastCol >= 10 ? String(rows[i][9] || '').trim() : '';
        if (!stored) return JSON.stringify({ success: true, verified: true, noPassword: true });
        return JSON.stringify({ success: true, verified: hashPassword_(password) === stored });
      }
    }
    return JSON.stringify({ success: false, error: 'スタッフが見つかりません' });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

function setStaffPassword(staffName, staffEmail, oldPassword, newPassword) {
  try {
    if (!newPassword || newPassword.length < 4) return JSON.stringify({ success: false, error: 'パスワードは4文字以上で設定してください' });
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STAFF);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: false, error: 'スタッフが見つかりません' });
    // パスワード列を確保
    var lastCol = sheet.getLastColumn();
    if (lastCol < 10) { sheet.getRange(1, 10).setValue('パスワード'); lastCol = 10; }
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    for (var i = 0; i < rows.length; i++) {
      var n = String(rows[i][0] || '').trim();
      var e = String(rows[i][2] || '').trim();
      if (n === staffName || (staffEmail && e === staffEmail)) {
        var stored = String(rows[i][9] || '').trim();
        if (stored && hashPassword_(oldPassword) !== stored) return JSON.stringify({ success: false, error: '現在のパスワードが正しくありません' });
        sheet.getRange(i + 2, 10).setValue(hashPassword_(newPassword));
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: 'スタッフが見つかりません' });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

/**
 * オーナーがスタッフのパスワードをリセット
 */
function resetStaffPassword(staffName) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STAFF);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: false, error: 'スタッフが見つかりません' });
    var lastCol = Math.max(sheet.getLastColumn(), 10);
    if (lastCol < 10) { sheet.getRange(1, 10).setValue('パスワード'); lastCol = 10; }
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    for (var i = 0; i < rows.length; i++) {
      var n = String(rows[i][0] || '').trim();
      if (n === staffName) {
        sheet.getRange(i + 2, 10).setValue('');
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: 'スタッフが見つかりません' });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

/**
 * スタッフの出勤予定一覧を取得（スタッフ本人用）
 * @param {string} staffIdentifier - スタッフ名またはメール
 * @param {string} yearMonth - YYYY-MM
 */
function getStaffSchedule(staffIdentifier, yearMonth, staffEmail) {
  try {
    if (!staffIdentifier || typeof staffIdentifier !== 'string') return JSON.stringify({ success: false, list: [] });
    var staff = String(staffIdentifier).trim().toLowerCase();
    var staffEmailLower = staffEmail ? String(staffEmail).trim().toLowerCase() : '';
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = ss.getSheetByName(SHEET_NAME);
    if (!formSheet || formSheet.getLastRow() < 2) return JSON.stringify({ success: true, list: [] });
    const headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    const colMap = buildColumnMap(headers);
    if (colMap.checkOut < 0 || colMap.cleaningStaff < 0) return JSON.stringify({ success: true, list: [] });
    const data = formSheet.getRange(2, 1, formSheet.getLastRow() - 1, formSheet.getLastColumn()).getValues();
    var list = [];
    var ym = yearMonth || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
    var ymParts = ym.split('-');
    var targetYear = parseInt(ymParts[0], 10) || new Date().getFullYear();
    var targetMonth = parseInt(ymParts[1], 10) || (new Date().getMonth() + 1);
    // 募集シートから checkout → 募集行番号のマップを構築
    var recruitRowMap = {};
    var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (recruitSheet && recruitSheet.getLastRow() >= 2) {
      var rData = recruitSheet.getRange(2, 1, recruitSheet.getLastRow() - 1, 2).getValues();
      for (var ri = 0; ri < rData.length; ri++) {
        var rCheckout = parseDate(rData[ri][0]);
        if (rCheckout) recruitRowMap[toDateKeySafe_(rCheckout)] = ri + 2;
      }
    }
    // キャンセル申請シートからpendingな申請を取得
    var pendingCancelMap = {};
    var crSheet = ss.getSheetByName(SHEET_CANCEL_REQUESTS);
    if (crSheet && crSheet.getLastRow() >= 2) {
      var crLastCol = Math.max(crSheet.getLastColumn(), 5);
      var crData = crSheet.getRange(2, 1, crSheet.getLastRow() - 1, crLastCol).getValues();
      for (var ci = 0; ci < crData.length; ci++) {
        var crRid = String(crData[ci][0] || '').trim();
        var crStaffName = String(crData[ci][1] || '').trim();
        var crEmail = String(crData[ci][2] || '').trim().toLowerCase();
        var crStatus = String(crData[ci][4] || '').trim();
        if (crStatus === 'rejected') continue;
        var isMe = (crStaffName && crStaffName.toLowerCase() === staff) || (crEmail && crEmail === staff);
        if (isMe) pendingCancelMap[crRid] = true;
      }
    }
    var seenCheckouts = {};
    for (var i = 0; i < data.length; i++) {
      // キャンセル済み予約はスキップ
      if (colMap.cancelledAt >= 0) {
        var cancelledVal = String(data[i][colMap.cancelledAt] || '').trim();
        if (cancelledVal) continue;
      }
      var cleaningStaff = String(data[i][colMap.cleaningStaff] || '').trim();
      if (!cleaningStaff) continue;
      var names = cleaningStaff.split(/[,、]/).map(function(n) { return n.trim(); }).filter(Boolean);
      var isAssigned = names.some(function(n) {
        var nl = n.toLowerCase();
        return nl === staff || (staffEmailLower && nl === staffEmailLower);
      });
      if (!isAssigned) continue;
      var partners = names.filter(function(n) {
        var nl = n.toLowerCase();
        return nl !== staff && (!staffEmailLower || nl !== staffEmailLower);
      });
      var checkOutVal = data[i][colMap.checkOut];
      var checkOut = parseDate(checkOutVal);
      if (!checkOut) continue;
      var d = new Date(checkOut);
      if (d.getFullYear() !== targetYear || (d.getMonth() + 1) !== targetMonth) continue;
      var coKey = toDateKeySafe_(checkOut);
      // 同じチェックアウト日の重複を排除
      if (seenCheckouts[coKey]) continue;
      seenCheckouts[coKey] = true;
      var rri = recruitRowMap[coKey] || 0;
      var cancelPending = rri ? !!pendingCancelMap['r' + rri] : false;
      list.push({
        rowNumber: i + 2,
        checkoutDate: coKey,
        checkoutDisplay: Utilities.formatDate(checkOut, 'Asia/Tokyo', 'yyyy/M/d'),
        partners: partners,
        recruitRowIndex: rri,
        cancelPending: cancelPending
      });
    }
    // 募集_立候補シートから◎/△の回答も取得（確定前の予定）
    var confirmedCheckouts = {};
    list.forEach(function(item) { confirmedCheckouts[item.checkoutDate] = true; });
    var volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    if (volSheet && volSheet.getLastRow() >= 2 && recruitSheet && recruitSheet.getLastRow() >= 2) {
      var volLastCol = Math.max(volSheet.getLastColumn(), 7);
      var volData = volSheet.getRange(2, 1, volSheet.getLastRow() - 1, volLastCol).getValues();
      var rLastCol = Math.max(recruitSheet.getLastColumn(), 5);
      var rAllData = recruitSheet.getRange(2, 1, recruitSheet.getLastRow() - 1, rLastCol).getValues();
      // チェックアウト日→現在のフォーム行番号マップ（ソート対策）
      var coToCurrentFormRow = {};
      for (var fi2 = 0; fi2 < data.length; fi2++) {
        var fi2Co = parseDate(data[fi2][colMap.checkOut]);
        if (fi2Co) {
          var fi2Str = toDateKeySafe_(fi2Co);
          if (fi2Str && !coToCurrentFormRow[fi2Str]) coToCurrentFormRow[fi2Str] = fi2 + 2;
        }
      }
      // 募集ID → {checkoutDate, status, bookingRowNumber} マップ
      var recruitInfoMap = {};
      for (var ri2 = 0; ri2 < rAllData.length; ri2++) {
        var rid = 'r' + (ri2 + 2);
        var rCoDate = parseDate(rAllData[ri2][0]);
        var rStatus = String(rAllData[ri2][3] || '').trim();
        var rBookingRow = rAllData[ri2][1] ? Number(rAllData[ri2][1]) : 0;
        if (rCoDate) {
          var coKey = toDateKeySafe_(rCoDate);
          var coDisp = Utilities.formatDate(rCoDate, 'Asia/Tokyo', 'yyyy/M/d');
          // フォームシートから正しいチェックアウト日を取得
          // 優先順位: 1. rBookingRowの行の日付（ソート後に同期済みなので信頼性が高い）
          //          2. 日付ベースのフォームシート照合
          //          3. 募集シートの日付（フォールバック）
          if (rBookingRow >= 2 && rBookingRow <= data.length + 1) {
            var fCo = parseDate(data[rBookingRow - 2][colMap.checkOut]);
            if (fCo) {
              coKey = toDateKeySafe_(fCo) || coKey;
              coDisp = Utilities.formatDate(fCo, 'Asia/Tokyo', 'yyyy/M/d');
            }
          } else if (coToCurrentFormRow[coKey]) {
            var fRow = coToCurrentFormRow[coKey];
            if (fRow >= 2 && fRow <= data.length + 1) {
              var fCo2 = parseDate(data[fRow - 2][colMap.checkOut]);
              if (fCo2) {
                coKey = toDateKeySafe_(fCo2) || coKey;
                coDisp = Utilities.formatDate(fCo2, 'Asia/Tokyo', 'yyyy/M/d');
              }
            }
          }
          recruitInfoMap[rid] = {
            checkoutDate: coKey,
            checkoutDisplay: coDisp,
            status: rStatus,
            bookingRowNumber: rBookingRow,
            recruitRowIndex: ri2 + 2
          };
        }
      }
      for (var vi = 0; vi < volData.length; vi++) {
        var vRid = String(volData[vi][0] || '').trim();
        var vName = String(volData[vi][1] || '').trim();
        var vEmail = String(volData[vi][2] || '').trim().toLowerCase();
        var vStatus = String(volData[vi][5] || '').trim();
        // ◎ or △ のみ
        if (vStatus !== '◎' && vStatus !== '△') continue;
        // 自分の回答かチェック（名前またはメールで照合）
        var isMyVol = (vName && vName.toLowerCase() === staff) || (staffEmailLower && vEmail === staffEmailLower);
        if (!isMyVol) continue;
        var rInfo = recruitInfoMap[vRid];
        if (!rInfo) continue;
        // キャンセルされた募集は除外
        if (rInfo.status === 'キャンセル') continue;
        // 対象月チェック
        var coDate = parseDate(rInfo.checkoutDate);
        if (!coDate) continue;
        var cd = new Date(coDate);
        if (cd.getFullYear() !== targetYear || (cd.getMonth() + 1) !== targetMonth) continue;
        // 既に確定済みリストにあるものは重複しない
        if (confirmedCheckouts[rInfo.checkoutDate]) continue;
        // フォームシートから行番号を検索（checkoutDateで照合）
        var formRowNum = rInfo.bookingRowNumber;
        if (!formRowNum) {
          for (var fi = 0; fi < data.length; fi++) {
            var fCo = toDateKeySafe_(data[fi][colMap.checkOut]);
            if (fCo === rInfo.checkoutDate) { formRowNum = fi + 2; break; }
          }
        }
        list.push({
          rowNumber: formRowNum || 0,
          checkoutDate: rInfo.checkoutDate,
          checkoutDisplay: rInfo.checkoutDisplay,
          partners: [],
          recruitRowIndex: rInfo.recruitRowIndex,
          cancelPending: false,
          volunteerStatus: vStatus,
          confirmed: false
        });
        confirmedCheckouts[rInfo.checkoutDate] = true; // 重複防止
      }
    }
    // 確定済みには confirmed: true をセット
    list.forEach(function(item) { if (item.confirmed === undefined) item.confirmed = true; });
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
    // 読み取りのみのため requireOwner() を外す（設定タブ自体がオーナー専用）
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
 * 請求書テンプレートDoc IDの取得・保存
 */
function getInvoiceTemplateDocId() {
  try {
    // 読み取りのみのため requireOwner() を外す（設定タブ自体がオーナー専用）
    var id = PropertiesService.getDocumentProperties().getProperty('invoiceTemplateDocId') || '';
    return JSON.stringify({ success: true, templateDocId: id });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function setInvoiceTemplateDocId(docId) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ設定できます' });
    var id = (docId || '').trim();
    if (id) {
      var match = id.match(/[a-zA-Z0-9_-]{20,}/);
      if (match) id = match[0];
    }
    PropertiesService.getDocumentProperties().setProperty('invoiceTemplateDocId', id);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 請求書データ取得（スタッフ画面用）
 * 清掃実績から自動算出 + 仕事内容マスタのプルダウン選択肢 + 送信履歴
 */
function getInvoiceData(yearMonth, staffIdentifier) {
  try {
    if (!staffIdentifier) return JSON.stringify({ success: false, error: 'スタッフを特定できません' });
    var staffName = String(staffIdentifier).trim();
    var ym = yearMonth || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');

    ensureSheetsExist();
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // スタッフ情報（住所・銀行）
    var staffSheet = ss.getSheetByName(SHEET_STAFF);
    var staffInfo = null;
    if (staffSheet && staffSheet.getLastRow() >= 2) {
      var staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 9).getValues();
      for (var si = 0; si < staffData.length; si++) {
        if (String(staffData[si][0] || '').trim() === staffName) {
          staffInfo = {
            name: staffName,
            address: String(staffData[si][1] || '').trim(),
            email: String(staffData[si][2] || '').trim(),
            bank: String(staffData[si][3] || '').trim(),
            branch: String(staffData[si][4] || '').trim(),
            acctType: String(staffData[si][5] || '').trim(),
            acctNo: String(staffData[si][6] || '').trim(),
            holder: String(staffData[si][7] || '').trim()
          };
          break;
        }
      }
    }
    if (!staffInfo) return JSON.stringify({ success: false, error: 'スタッフ情報が見つかりません' });

    // 報酬マスター読み込み
    var compSheet = ss.getSheetByName(SHEET_COMPENSATION);
    var compMap = {}; // { "staffName-jobName": amount }
    // 正規化キーマップ（全角→半角、大文字→小文字、スペース除去）
    var compMapNorm = {};
    function normKey_(s) { return s.replace(/[０-９]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/\s+/g, '').toLowerCase(); }
    if (compSheet && compSheet.getLastRow() >= 2) {
      var compData = compSheet.getRange(2, 1, compSheet.getLastRow() - 1, 3).getValues();
      for (var ci = 0; ci < compData.length; ci++) {
        var cStaff = String(compData[ci][0] || '').trim();
        var cJob = String(compData[ci][1] || '').trim();
        var cAmt = Number(compData[ci][2] || 0);
        if (cStaff && cJob && isFinite(cAmt) && cAmt > 0) {
          compMap[cStaff + '-' + cJob] = cAmt;
          compMapNorm[normKey_(cStaff + '-' + cJob)] = cAmt;
        }
      }
    }
    // compMap検索ヘルパー：完全一致 → 正規化一致
    function lookupComp_(key) {
      if (compMap[key]) return compMap[key];
      var nk = normKey_(key);
      if (compMapNorm[nk]) return compMapNorm[nk];
      return 0;
    }

    // 特別料金の読み込み
    var specialSheet = ss.getSheetByName(SHEET_SPECIAL_RATES);
    var specialRates = [];
    if (specialSheet && specialSheet.getLastRow() >= 2) {
      var spData = specialSheet.getRange(2, 1, specialSheet.getLastRow() - 1, 5).getValues();
      for (var spi = 0; spi < spData.length; spi++) {
        var spJob = String(spData[spi][0] || '').trim();
        var spStart = spData[spi][1] ? parseDate(spData[spi][1]) : null;
        var spEnd = spData[spi][2] ? parseDate(spData[spi][2]) : null;
        var spName = String(spData[spi][3] || '').trim();
        var spAmt = Number(spData[spi][4] || 0);
        if (spJob && spName && isFinite(spAmt)) {
          specialRates.push({ jobName: spJob, startDate: spStart, endDate: spEnd, itemName: spName, amount: spAmt });
        }
      }
    }

    // スケジュール取得（確定済みのみ）
    var scheduleRes = JSON.parse(getStaffSchedule(staffName, ym));
    var scheduleList = (scheduleRes.success && scheduleRes.list) ? scheduleRes.list : [];

    // 仕事内容マスタから「清掃系」の仕事名マップを構築（人数→仕事名）
    var jobSheet = ss.getSheetByName(SHEET_JOB_TYPES);
    var cleanJobMap = {}; // { staffCount: jobTypeName }  例: { 2: "清掃2名作業" }
    var cleanJobNames = {}; // 清掃系仕事名のセット（jobOptionsから除外用）
    var allJobData = [];
    if (jobSheet && jobSheet.getLastRow() >= 2) {
      allJobData = jobSheet.getRange(2, 1, jobSheet.getLastRow() - 1, 3).getValues();
      for (var jmi = 0; jmi < allJobData.length; jmi++) {
        var jmName = String(allJobData[jmi][0] || '').trim();
        var jmActive = String(allJobData[jmi][2] || 'Y').trim();
        if (!jmName || jmActive !== 'Y') continue;
        // 名前に含まれる数字を抽出し、清掃系キーワードを含むかチェック
        var numMatch = jmName.match(/(\d)/);
        var fullWidthMatch = jmName.match(/([０-９])/);
        var num = numMatch ? parseInt(numMatch[1], 10) : (fullWidthMatch ? (fullWidthMatch[1].charCodeAt(0) - 0xFF10) : 0);
        if (num > 0 && /清掃|掃除|クリーニング/.test(jmName)) {
          cleanJobMap[num] = jmName;
          cleanJobNames[jmName] = true;
        }
      }
    }

    // 清掃実績から明細を自動算出
    var autoItems = [];
    for (var si2 = 0; si2 < scheduleList.length; si2++) {
      var item = scheduleList[si2];
      if (item.confirmed === false) continue; // 未確定はスキップ
      var staffCount = 1 + (item.partners ? item.partners.length : 0);
      // 仕事内容マスタの実際の名称を使用、なければ従来のパターン
      var jobName = cleanJobMap[staffCount] || (staffCount + '名で清掃');
      // 報酬マスターからスタッフ固有 → 共通の順で検索
      var amount = lookupComp_(staffName + '-' + jobName) || lookupComp_('共通-' + jobName) || 0;
      // 従来パターンでもフォールバック検索
      if (amount === 0 && cleanJobMap[staffCount]) {
        var fallbackJob = staffCount + '名で清掃';
        amount = lookupComp_(staffName + '-' + fallbackJob) || lookupComp_('共通-' + fallbackJob) || 0;
      }

      // 特別料金チェック
      var specialItems = [];
      var checkDate = item.checkoutDate ? parseDate(item.checkoutDate) : null;
      if (checkDate) {
        for (var sri = 0; sri < specialRates.length; sri++) {
          var sr = specialRates[sri];
          // 実際の仕事名または従来パターンどちらでもマッチ
          if (sr.jobName !== jobName && sr.jobName !== (staffCount + '名で清掃')) continue;
          var inRange = true;
          if (sr.startDate && checkDate < sr.startDate) inRange = false;
          if (sr.endDate && checkDate > sr.endDate) inRange = false;
          if (inRange) {
            specialItems.push({ name: sr.itemName, amount: sr.amount });
          }
        }
      }

      autoItems.push({
        date: item.checkoutDate || '',
        dateDisplay: item.checkoutDisplay || '',
        jobName: jobName,
        amount: amount,
        partners: item.partners || [],
        specialItems: specialItems
      });
    }

    // 仕事内容マスタから追加項目用の選択肢を取得（清掃系は自動計算なので除外）
    var jobOptions = [];
    // 全ての仕事内容（清掃系含む）の選択肢も返す
    var allJobOptions = [];
    for (var ji = 0; ji < allJobData.length; ji++) {
      var jName = String(allJobData[ji][0] || '').trim();
      var jActive = String(allJobData[ji][2] || 'Y').trim();
      if (!jName || jActive !== 'Y') continue;
      var jAmt = lookupComp_(staffName + '-' + jName) || lookupComp_('共通-' + jName) || 0;
      allJobOptions.push({ name: jName, defaultAmount: jAmt, isCleaning: !!(cleanJobNames[jName] || /^\d+名で清掃$/.test(jName)) });
      // 非清掃系のみ従来のjobOptionsに
      if (!cleanJobNames[jName] && !/^\d+名で清掃$/.test(jName)) {
        jobOptions.push({ name: jName, defaultAmount: jAmt });
      }
    }

    // 送信履歴（対象月分のみ）
    var history = getInvoiceHistoryInternal_(staffName, ym);

    // 追加項目（シートから読み込み）
    var extraItems = [];
    try {
      var extraSheet = ss.getSheetByName(SHEET_INVOICE_EXTRA);
      if (extraSheet && extraSheet.getLastRow() >= 2) {
        var extraData = extraSheet.getRange(2, 1, extraSheet.getLastRow() - 1, 5).getValues();
        for (var exi = 0; exi < extraData.length; exi++) {
          if (String(extraData[exi][0] || '').trim() === staffName && String(extraData[exi][1] || '').trim() === ym) {
            extraItems.push({
              date: String(extraData[exi][2] || ''),
              name: String(extraData[exi][3] || ''),
              amount: Number(extraData[exi][4] || 0)
            });
          }
        }
      }
    } catch (exErr) {}

    // 除外項目（シートから読み込み）
    var excludedAuto = [];
    try {
      var exclSheet = ss.getSheetByName(SHEET_INVOICE_EXCLUDED);
      if (exclSheet && exclSheet.getLastRow() >= 2) {
        var exclData = exclSheet.getRange(2, 1, exclSheet.getLastRow() - 1, 3).getValues();
        for (var exi2 = 0; exi2 < exclData.length; exi2++) {
          if (String(exclData[exi2][0] || '').trim() === staffName && String(exclData[exi2][1] || '').trim() === ym) {
            try { excludedAuto = JSON.parse(String(exclData[exi2][2] || '[]')); } catch (pe) { excludedAuto = []; }
            break;
          }
        }
      }
    } catch (exclErr) {}

    // フォルダID・テンプレートDocIDの設定状態
    var folderId = PropertiesService.getDocumentProperties().getProperty('invoiceFolderId') || '';
    var templateDocId = PropertiesService.getDocumentProperties().getProperty('invoiceTemplateDocId') || '';

    return JSON.stringify({
      success: true,
      staffInfo: staffInfo,
      autoItems: autoItems,
      jobOptions: jobOptions,
      allJobOptions: allJobOptions,
      history: history,
      extraItems: extraItems,
      excludedAuto: excludedAuto,
      hasFolder: !!folderId,
      hasTemplate: !!templateDocId
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 請求書作成・PDF化・メール送信
 * @param {string} yearMonth - YYYY-MM
 * @param {string} staffIdentifier - スタッフ名
 * @param {Array} manualItems - [{date, name, amount}]
 * @param {string} remarks - 備考
 */
function createAndSendInvoice(yearMonth, staffIdentifier, manualItems, remarks, excludedAutoItems) {
  try {
    if (!staffIdentifier) return JSON.stringify({ success: false, error: 'スタッフを特定できません' });
    var staffName = String(staffIdentifier).trim();
    var ym = yearMonth || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');

    // 設定値の取得
    var props = PropertiesService.getDocumentProperties();
    var folderId = (props.getProperty('invoiceFolderId') || '').trim();
    var templateDocId = (props.getProperty('invoiceTemplateDocId') || '').trim();

    if (!folderId) return JSON.stringify({ success: false, error: '請求書の保存先フォルダが設定されていません。オーナーに設定を依頼してください。' });
    if (!templateDocId) return JSON.stringify({ success: false, error: '請求書テンプレートが設定されていません。オーナーに設定を依頼してください。' });

    ensureSheetsExist();
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // スタッフ情報取得
    var staffSheet = ss.getSheetByName(SHEET_STAFF);
    var staffInfo = null;
    if (staffSheet && staffSheet.getLastRow() >= 2) {
      var staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 9).getValues();
      for (var si = 0; si < staffData.length; si++) {
        if (String(staffData[si][0] || '').trim() === staffName) {
          staffInfo = {
            address: String(staffData[si][1] || '').trim(),
            email: String(staffData[si][2] || '').trim(),
            bank: String(staffData[si][3] || '').trim(),
            branch: String(staffData[si][4] || '').trim(),
            acctType: String(staffData[si][5] || '').trim(),
            acctNo: String(staffData[si][6] || '').trim(),
            holder: String(staffData[si][7] || '').trim()
          };
          break;
        }
      }
    }
    if (!staffInfo) return JSON.stringify({ success: false, error: 'スタッフ情報が見つかりません' });

    // 報酬マスター
    var compSheet = ss.getSheetByName(SHEET_COMPENSATION);
    var compMap = {};
    var compMapNorm2 = {};
    function normKey2_(s) { return s.replace(/[０-９]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/\s+/g, '').toLowerCase(); }
    if (compSheet && compSheet.getLastRow() >= 2) {
      var compData = compSheet.getRange(2, 1, compSheet.getLastRow() - 1, 3).getValues();
      for (var ci = 0; ci < compData.length; ci++) {
        var cStaff = String(compData[ci][0] || '').trim();
        var cJob = String(compData[ci][1] || '').trim();
        var cAmt = Number(compData[ci][2] || 0);
        if (cStaff && cJob && isFinite(cAmt) && cAmt > 0) {
          compMap[cStaff + '-' + cJob] = cAmt;
          compMapNorm2[normKey2_(cStaff + '-' + cJob)] = cAmt;
        }
      }
    }
    function lookupComp2_(key) {
      if (compMap[key]) return compMap[key];
      var nk = normKey2_(key);
      if (compMapNorm2[nk]) return compMapNorm2[nk];
      return 0;
    }

    // 特別料金
    var specialSheet = ss.getSheetByName(SHEET_SPECIAL_RATES);
    var specialRates = [];
    if (specialSheet && specialSheet.getLastRow() >= 2) {
      var spData = specialSheet.getRange(2, 1, specialSheet.getLastRow() - 1, 5).getValues();
      for (var spi = 0; spi < spData.length; spi++) {
        var spJob = String(spData[spi][0] || '').trim();
        var spStart = spData[spi][1] ? parseDate(spData[spi][1]) : null;
        var spEnd = spData[spi][2] ? parseDate(spData[spi][2]) : null;
        var spItemName = String(spData[spi][3] || '').trim();
        var spAmt = Number(spData[spi][4] || 0);
        if (spJob && spItemName && isFinite(spAmt)) {
          specialRates.push({ jobName: spJob, startDate: spStart, endDate: spEnd, itemName: spItemName, amount: spAmt });
        }
      }
    }

    // 請求対象年月テキスト
    var ymParts = ym.split('-');
    var targetYear = parseInt(ymParts[0], 10);
    var targetMonth = parseInt(ymParts[1], 10);
    var ymText = targetYear + '年' + targetMonth + '月分';

    // 対象期間・支払期限
    var periodStart = new Date(targetYear, targetMonth - 1, 1);
    var periodEnd = new Date(targetYear, targetMonth, 0);
    var dueDate = new Date(targetYear, targetMonth, 5);
    var periodText = Utilities.formatDate(periodStart, 'Asia/Tokyo', 'yyyy年M月d日') + '～' + Utilities.formatDate(periodEnd, 'Asia/Tokyo', 'M月d日');
    var dueText = Utilities.formatDate(dueDate, 'Asia/Tokyo', 'yyyy年M月d日');
    var issueDate = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy年MM月dd日');

    // スケジュール取得
    var scheduleRes = JSON.parse(getStaffSchedule(staffName, ym));
    var scheduleList = (scheduleRes.success && scheduleRes.list) ? scheduleRes.list : [];

    // 仕事内容マスタから清掃系の仕事名マップ構築（人数→仕事名）
    var jobSheet2 = ss.getSheetByName(SHEET_JOB_TYPES);
    var cleanJobMap2 = {};
    if (jobSheet2 && jobSheet2.getLastRow() >= 2) {
      var jd2 = jobSheet2.getRange(2, 1, jobSheet2.getLastRow() - 1, 3).getValues();
      for (var jmi2 = 0; jmi2 < jd2.length; jmi2++) {
        var jn2 = String(jd2[jmi2][0] || '').trim();
        var ja2 = String(jd2[jmi2][2] || 'Y').trim();
        if (!jn2 || ja2 !== 'Y') continue;
        var nm2 = jn2.match(/(\d)/);
        var fw2 = jn2.match(/([０-９])/);
        var n2 = nm2 ? parseInt(nm2[1], 10) : (fw2 ? (fw2[1].charCodeAt(0) - 0xFF10) : 0);
        if (n2 > 0 && /清掃|掃除|クリーニング/.test(jn2)) cleanJobMap2[n2] = jn2;
      }
    }

    // 除外リスト（JSON文字列で受け取る）
    var excludedSet = {};
    var exArr = [];
    if (typeof excludedAutoItems === 'string') {
      try { exArr = JSON.parse(excludedAutoItems); } catch (ep2) { exArr = []; }
    } else if (excludedAutoItems && typeof excludedAutoItems === 'object') {
      if (typeof excludedAutoItems.length === 'number') {
        for (var el2 = 0; el2 < excludedAutoItems.length; el2++) { if (excludedAutoItems[el2]) exArr.push(excludedAutoItems[el2]); }
      }
    }
    if (!Array.isArray(exArr)) exArr = [];
    for (var ei = 0; ei < exArr.length; ei++) {
      excludedSet[String(exArr[ei])] = true;
    }

    // 明細構築
    var allItems = [];
    var total = 0;

    // 清掃実績（自動）
    for (var si2 = 0; si2 < scheduleList.length; si2++) {
      var sItem = scheduleList[si2];
      if (sItem.confirmed === false) continue;
      if (excludedSet[sItem.checkoutDate]) continue;
      var staffCount = 1 + (sItem.partners ? sItem.partners.length : 0);
      var jobName = cleanJobMap2[staffCount] || (staffCount + '名で清掃');
      var amount = lookupComp2_(staffName + '-' + jobName) || lookupComp2_('共通-' + jobName) || 0;
      // フォールバック: 従来パターンでも検索
      if (amount === 0 && cleanJobMap2[staffCount]) {
        var fb2 = staffCount + '名で清掃';
        amount = lookupComp2_(staffName + '-' + fb2) || lookupComp2_('共通-' + fb2) || 0;
      }

      if (amount > 0) {
        var checkDate = sItem.checkoutDate ? parseDate(sItem.checkoutDate) : null;
        var dateDisplay = sItem.checkoutDisplay || '';
        allItems.push({ date: checkDate, dateText: dateDisplay, name: jobName, amount: amount });
        total += amount;

        // 特別料金
        if (checkDate) {
          for (var sri = 0; sri < specialRates.length; sri++) {
            var sr = specialRates[sri];
            if (sr.jobName !== jobName && sr.jobName !== (staffCount + '名で清掃')) continue;
            var inRange = true;
            if (sr.startDate && checkDate < sr.startDate) inRange = false;
            if (sr.endDate && checkDate > sr.endDate) inRange = false;
            if (inRange) {
              allItems.push({ date: checkDate, dateText: dateDisplay, name: sr.itemName, amount: sr.amount });
              total += sr.amount;
            }
          }
        }
      }
    }

    // 手動追加項目（JSON文字列で受け取る）
    var manualList = [];
    if (typeof manualItems === 'string') {
      try { manualList = JSON.parse(manualItems); } catch (ep3) { manualList = []; }
    } else if (manualItems && typeof manualItems === 'object') {
      if (typeof manualItems.length === 'number') {
        for (var ml = 0; ml < manualItems.length; ml++) { if (manualItems[ml]) manualList.push(manualItems[ml]); }
      }
    }
    if (!Array.isArray(manualList)) manualList = [];
    if (manualList.length > 0) {
      for (var mi = 0; mi < manualList.length; mi++) {
        var mItem = manualList[mi];
        var mName = String(mItem.name || '').trim();
        var mAmt = Number(mItem.amount || 0);
        var mDate = mItem.date ? parseDate(mItem.date) : null;
        var mDateText = mDate ? Utilities.formatDate(mDate, 'Asia/Tokyo', 'yyyy/M/d') : '';
        if (mName && isFinite(mAmt) && mAmt !== 0) {
          allItems.push({ date: mDate, dateText: mDateText, name: mName, amount: mAmt });
          total += mAmt;
        }
      }
    }

    // 日付順ソート
    allItems.sort(function(a, b) {
      var ta = a.date ? a.date.getTime() : Number.MAX_SAFE_INTEGER;
      var tb = b.date ? b.date.getTime() : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });

    // --- フォルダ管理（YYYY-MM サブフォルダ自動作成） ---
    var monthKey = targetYear + '-' + ('0' + targetMonth).slice(-2);
    var rootFolder = DriveApp.getFolderById(folderId);
    var subFolderIt = rootFolder.getFoldersByName(monthKey);
    var monthFolder = subFolderIt.hasNext() ? subFolderIt.next() : rootFolder.createFolder(monthKey);

    // --- テンプレートDoc → DocumentApp replaceText → PDF変換 ---
    var docBaseName = staffName + '_' + ymText + '_請求書';
    var docName = getInvoiceUniqueName_(monthFolder, docBaseName);

    // テンプレートをコピー
    var templateFile = DriveApp.getFileById(templateDocId);
    var docCopy = templateFile.makeCopy(docName, monthFolder);
    var newDocId = docCopy.getId();

    // 明細テキストを構築（改行区切り）
    var meisaiText = '';
    if (allItems.length === 0) {
      meisaiText = '（該当する作業はありません）';
    } else {
      var meisaiLines = [];
      for (var ti = 0; ti < allItems.length; ti++) {
        meisaiLines.push(
          (allItems[ti].dateText || '') + '  ' +
          (allItems[ti].name || '') + '  ¥' +
          allItems[ti].amount.toLocaleString('ja-JP')
        );
      }
      meisaiText = meisaiLines.join('\n');
    }

    // DocumentApp で全プレースホルダーを置換（半角・全角両方対応）
    var doc = DocumentApp.openById(newDocId);
    var body = doc.getBody();
    var replacements = [
      ['請求者', staffName],
      ['住所', staffInfo.address],
      ['請求対象年月', ymText],
      ['対象期間', periodText],
      ['お支払期限', dueText],
      ['発行日', issueDate],
      ['合計金額', total.toLocaleString('ja-JP')],
      ['備考', remarks || ''],
      ['金融機関名', staffInfo.bank],
      ['口座種類', staffInfo.acctType],
      ['支店名', staffInfo.branch],
      ['口座番号', staffInfo.acctNo],
      ['口座名義', staffInfo.holder]
    ];
    for (var ri2 = 0; ri2 < replacements.length; ri2++) {
      var fieldName = replacements[ri2][0];
      var fieldValue = replacements[ri2][1] || '';
      // 半角 <<...>>
      body.replaceText('<<' + fieldName + '>>', fieldValue);
      // 全角 ≪...≫
      body.replaceText('≪' + fieldName + '≫', fieldValue);
      // 全角山括弧 <<...>>（＜＜...＞＞）
      body.replaceText('＜＜' + fieldName + '＞＞', fieldValue);
    }

    // 明細一覧プレースホルダーをテーブルに置換（罫線付き）
    var meisaiPlaceholders = ['<<明細一覧>>', '≪明細一覧≫', '＜＜明細一覧＞＞'];
    var numChildren = body.getNumChildren();
    var meisaiParaIndex = -1;
    for (var pi = 0; pi < numChildren; pi++) {
      var child = body.getChild(pi);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        var pText = child.asParagraph().getText();
        for (var mpi = 0; mpi < meisaiPlaceholders.length; mpi++) {
          if (pText.indexOf(meisaiPlaceholders[mpi]) !== -1) {
            meisaiParaIndex = pi;
            break;
          }
        }
        if (meisaiParaIndex !== -1) break;
      }
    }
    if (meisaiParaIndex !== -1) {
      body.removeChild(body.getChild(meisaiParaIndex));
      var tableData = [['日付', '作業内容', '金額']];
      if (allItems.length === 0) {
        tableData.push(['', '（該当する作業はありません）', '']);
      } else {
        for (var ti3 = 0; ti3 < allItems.length; ti3++) {
          tableData.push([
            allItems[ti3].dateText || '',
            allItems[ti3].name || '',
            '¥' + allItems[ti3].amount.toLocaleString('ja-JP')
          ]);
        }
      }
      var table = body.insertTable(meisaiParaIndex, tableData);
      table.setBorderWidth(1);
      var headerRow = table.getRow(0);
      for (var hci = 0; hci < headerRow.getNumCells(); hci++) {
        headerRow.getCell(hci).setBackgroundColor('#f0f0f0');
        headerRow.getCell(hci).editAsText().setBold(true);
        headerRow.getCell(hci).getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      }
      // 金額列（3列目）を右寄せ（ヘッダー行はスキップ）
      for (var tri = 1; tri < table.getNumRows(); tri++) {
        var amtCell = table.getRow(tri).getCell(2);
        amtCell.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      }
    }

    doc.saveAndClose();

    var docFile = DriveApp.getFileById(newDocId);

    // --- PDF化 ---
    var pdfBaseName = docBaseName + '.pdf';
    var pdfName = getInvoiceUniqueName_(monthFolder, pdfBaseName);
    var pdfBlob = docFile.getAs(MimeType.PDF);
    var pdfFile = monthFolder.createFile(pdfBlob).setName(pdfName);

    // 中間Docを削除
    docFile.setTrashed(true);

    // --- PDF閲覧権限設定（スタッフがリンクで閲覧可能に） ---
    try {
      pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      Logger.log('PDF共有設定エラー（続行）: ' + shareErr);
    }

    // --- メール送信（オーナーへ） ---
    var sendResult = '（送信先なし）';
    var ownerSheet = ss.getSheetByName(SHEET_OWNER);
    var ownerEmail = ownerSheet ? String(ownerSheet.getRange(2, 1).getValue() || '').trim() : '';
    if (ownerEmail && /@/.test(ownerEmail)) {
      var subject = '【請求書】' + staffName + ' - ' + ymText;
      var bodyText =
        staffName + ' さんから' + ymText + 'の請求書が届きました。\n\n' +
        '合計金額：¥' + total.toLocaleString('ja-JP') + '\n' +
        '対象期間：' + periodText + '\n' +
        '支払期限：' + dueText + '\n\n' +
        'PDFを添付しておりますのでご確認ください。\n' +
        '請求書はGoogleドライブにも保存されています。\n' +
        'PDF: ' + pdfFile.getUrl() + '\n';
      try {
        if (!isEmailNotifyEnabled_('請求書送信通知有効')) {
          sendResult = 'メール送信OFF（PDF作成は成功）';
        } else {
          MailApp.sendEmail({
            to: ownerEmail,
            subject: subject,
            body: bodyText,
            attachments: [pdfBlob],
            name: '請求書（自動送信）'
          });
          sendResult = '送信済み：' + ownerEmail;
        }
      } catch (mailErr) {
        sendResult = 'メール送信スキップ（PDF作成は成功）: ' + mailErr;
        Logger.log('メール送信エラー（PDF作成は成功、続行）: ' + mailErr);
      }
    }

    // --- 履歴に記録 ---
    var historySheet = ss.getSheetByName(SHEET_INVOICE_HISTORY);
    if (!historySheet) {
      // シートが存在しない場合、再作成を試みる
      try {
        historySheet = ss.insertSheet(SHEET_INVOICE_HISTORY);
        historySheet.getRange(1, 1, 1, 8).setValues([['スタッフ名', '対象年月', '合計金額', '明細JSON', '送信日時', 'PDFリンク', 'PDFファイルID', 'ステータス']]);
      } catch (sheetErr) {
        Logger.log('履歴シート作成失敗: ' + sheetErr);
      }
    }
    var historyWriteOk = false;
    if (historySheet) {
      try {
        var itemsSummary = allItems.map(function(it) { return { d: it.dateText, n: it.name, a: it.amount }; });
        var nextRow = historySheet.getLastRow() + 1;
        var sentAt = new Date();
        historySheet.getRange(nextRow, 1, 1, 8).setValues([[
          staffName,
          ym,
          total,
          JSON.stringify(itemsSummary),
          sentAt,
          pdfFile.getUrl(),
          pdfFile.getId(),
          sendResult
        ]]);
        SpreadsheetApp.flush(); // 書き込みを即座に反映
        historyWriteOk = true;
      } catch (histErr) {
        Logger.log('履歴書き込みエラー: ' + histErr);
      }
    }

    // 履歴を読み込んでレスポンスに含める（別途取得する必要をなくす）
    var updatedHistory = [];
    try {
      updatedHistory = getInvoiceHistoryInternal_(staffName, ym);
    } catch (hErr) {
      Logger.log('履歴再読込エラー: ' + hErr);
    }
    // 再読込が空でも書き込み成功なら、書き込んだデータを直接構築して返す
    if (updatedHistory.length === 0 && historyWriteOk) {
      updatedHistory = [{
        staffName: staffName,
        yearMonth: ym,
        total: total,
        sentAt: Utilities.formatDate(sentAt, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'),
        pdfUrl: pdfFile.getUrl(),
        pdfFileId: pdfFile.getId(),
        status: sendResult
      }];
    }

    return JSON.stringify({
      success: true,
      pdfUrl: pdfFile.getUrl(),
      pdfFileId: pdfFile.getId(),
      total: total,
      itemCount: allItems.length,
      sendResult: sendResult,
      history: updatedHistory,
      historyWriteOk: historyWriteOk
    });
  } catch (e) {
    var errMsg = e.toString();
    if (errMsg.indexOf('auth') !== -1 && errMsg.indexOf('denied') !== -1) {
      errMsg = 'Googleドキュメントへのアクセス権限がありません。オーナーがApps Scriptエディタで一度関数を実行し、権限を再承認してください。（詳細: ' + e.toString() + '）';
    }
    return JSON.stringify({ success: false, error: errMsg });
  }
}

/**
 * 請求書履歴取得（内部用）
 */
function getInvoiceHistoryInternal_(staffName, yearMonth) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_INVOICE_HISTORY);
    if (!sheet) { Logger.log('履歴シートが見つかりません: ' + SHEET_INVOICE_HISTORY); return []; }
    if (sheet.getLastRow() < 2) { Logger.log('履歴シートにデータ行なし: lastRow=' + sheet.getLastRow()); return []; }
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
    Logger.log('履歴読込: ' + data.length + '行, staffName=[' + staffName + '], ym=[' + yearMonth + ']');
    var list = [];
    for (var i = 0; i < data.length; i++) {
      var hStaff = String(data[i][0] || '').trim();
      var hYmRaw = data[i][1];
      var hYm = (hYmRaw instanceof Date) ? Utilities.formatDate(hYmRaw, 'Asia/Tokyo', 'yyyy-MM') : String(hYmRaw || '').trim();
      if (hStaff !== staffName) continue;
      if (yearMonth && hYm !== yearMonth) continue;
      list.push({
        staffName: hStaff,
        yearMonth: hYm,
        total: Number(data[i][2] || 0),
        sentAt: data[i][4] ? Utilities.formatDate(new Date(data[i][4]), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
        pdfUrl: String(data[i][5] || ''),
        pdfFileId: String(data[i][6] || ''),
        status: String(data[i][7] || '')
      });
    }
    return list;
  } catch (e) {
    return [];
  }
}

/**
 * 請求書履歴取得（フロント用）
 */
function getInvoiceHistory(staffIdentifier, yearMonth) {
  try {
    if (!staffIdentifier) return JSON.stringify({ success: false, error: 'スタッフを特定できません' });
    var staffName = String(staffIdentifier).trim();
    var list = getInvoiceHistoryInternal_(staffName, yearMonth || '');
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), list: [] });
  }
}

/**
 * 全スタッフの請求書履歴取得（オーナー用）
 */
function getAllInvoiceHistory(filterStaff, filterYm) {
  try {
    ensureSheetsExist();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_INVOICE_HISTORY);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: true, list: [], staffNames: [], yearMonths: [] });
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
    var list = [];
    var staffSet = {};
    var ymSet = {};
    for (var i = 0; i < data.length; i++) {
      var hStaff = String(data[i][0] || '').trim();
      var hYmRaw = data[i][1];
      var hYm = (hYmRaw instanceof Date) ? Utilities.formatDate(hYmRaw, 'Asia/Tokyo', 'yyyy-MM') : String(hYmRaw || '').trim();
      if (!hStaff) continue;
      staffSet[hStaff] = true;
      if (hYm) ymSet[hYm] = true;
      if (filterStaff && hStaff !== filterStaff) continue;
      if (filterYm && hYm !== filterYm) continue;
      list.push({
        rowIndex: i + 2,
        staffName: hStaff,
        yearMonth: hYm,
        total: Number(data[i][2] || 0),
        itemsJson: String(data[i][3] || ''),
        sentAt: data[i][4] ? Utilities.formatDate(new Date(data[i][4]), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
        pdfUrl: String(data[i][5] || ''),
        pdfFileId: String(data[i][6] || ''),
        status: String(data[i][7] || '')
      });
    }
    var staffNames = Object.keys(staffSet).sort();
    var yearMonths = Object.keys(ymSet).sort().reverse();
    return JSON.stringify({ success: true, list: list, staffNames: staffNames, yearMonths: yearMonths });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), list: [] });
  }
}

/**
 * 選択したPDFをZIPにまとめてダウンロードURLを返す
 */
function createInvoiceZipDownload(pdfFileIds) {
  try {
    if (!pdfFileIds || !Array.isArray(pdfFileIds) || pdfFileIds.length === 0) {
      return JSON.stringify({ success: false, error: 'PDFが選択されていません' });
    }
    var blobs = [];
    for (var i = 0; i < pdfFileIds.length; i++) {
      var fid = String(pdfFileIds[i]).trim();
      if (!fid) continue;
      try {
        var file = DriveApp.getFileById(fid);
        blobs.push(file.getBlob().setName(file.getName()));
      } catch (fe) {
        // ファイルが見つからない場合はスキップ
      }
    }
    if (blobs.length === 0) return JSON.stringify({ success: false, error: 'ダウンロード可能なPDFが見つかりません' });

    // 1件だけの場合はそのままPDFのURLを返す
    if (blobs.length === 1) {
      var singleFile = DriveApp.getFileById(String(pdfFileIds[0]).trim());
      return JSON.stringify({ success: true, url: singleFile.getUrl(), count: 1 });
    }

    // 複数の場合はZIPを作成
    var zipBlob = Utilities.zip(blobs, '請求書一括_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmm') + '.zip');

    // 請求書フォルダに一時保存
    var props = PropertiesService.getDocumentProperties();
    var folderId = (props.getProperty('invoiceFolderId') || '').trim();
    var folder;
    if (folderId) {
      try { folder = DriveApp.getFolderById(folderId); } catch (e) {}
    }
    if (!folder) folder = DriveApp.getRootFolder();

    var zipFile = folder.createFile(zipBlob);
    // 共有設定（リンクを知っている人が閲覧可能）
    try { zipFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

    return JSON.stringify({ success: true, url: zipFile.getUrl(), count: blobs.length });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 権限承認用ヘルパー（後方互換用・現在はDocs REST APIを使用するため不要）
 */
function authorizeDocumentApp() {
  return '請求書機能はGoogle Docs REST APIを使用するため、追加の権限承認は不要です。';
}

/**
 * 請求書追加項目を保存（シートに永続化）
 */
function saveInvoiceExtraItems(yearMonth, staffIdentifier, itemsParam) {
  try {
    if (!staffIdentifier) return JSON.stringify({ success: false, error: 'スタッフを特定できません' });
    var staffName = String(staffIdentifier).trim();
    var ym = yearMonth || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');

    // JSON文字列で受け取る（google.script.runの配列シリアライズ問題を回避）
    var itemList = [];
    if (typeof itemsParam === 'string') {
      try { itemList = JSON.parse(itemsParam); } catch (ep) { itemList = []; }
    } else if (itemsParam && typeof itemsParam === 'object') {
      if (typeof itemsParam.length === 'number') {
        for (var k = 0; k < itemsParam.length; k++) { if (itemsParam[k]) itemList.push(itemsParam[k]); }
      }
    }
    if (!Array.isArray(itemList)) itemList = [];

    ensureSheetsExist();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_INVOICE_EXTRA);
    if (!sheet) return JSON.stringify({ success: false, error: 'シートが見つかりません' });

    // 既存の該当スタッフ・月のデータを削除（上書き保存）
    if (sheet.getLastRow() >= 2) {
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
      for (var i = data.length - 1; i >= 0; i--) {
        if (String(data[i][0] || '').trim() === staffName && String(data[i][1] || '').trim() === ym) {
          sheet.deleteRow(i + 2);
        }
      }
    }

    // 新しいデータを書き込み
    if (itemList.length > 0) {
      var rows = [];
      for (var ri = 0; ri < itemList.length; ri++) {
        var it = itemList[ri];
        var itName = String(it.name || it['name'] || '').trim();
        var itDate = String(it.date || it['date'] || '');
        var itAmt = Number(it.amount || it['amount'] || 0);
        if (itName) {
          rows.push([staffName, ym, itDate, itName, itAmt]);
        }
      }
      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
      }
    }

    return JSON.stringify({ success: true, savedCount: itemList.length });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 請求書除外項目を保存（シートに永続化）
 */
function saveInvoiceExcludedAuto(yearMonth, staffIdentifier, excludedJson) {
  try {
    if (!staffIdentifier) return JSON.stringify({ success: false, error: 'スタッフを特定できません' });
    var staffName = String(staffIdentifier).trim();
    var ym = yearMonth || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
    var excludedList = [];
    if (typeof excludedJson === 'string') {
      try { excludedList = JSON.parse(excludedJson); } catch (ep) { excludedList = []; }
    }
    if (!Array.isArray(excludedList)) excludedList = [];

    ensureSheetsExist();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_INVOICE_EXCLUDED);
    if (!sheet) return JSON.stringify({ success: false, error: 'シートが見つかりません' });

    // 既存の該当スタッフ・月のデータを削除
    if (sheet.getLastRow() >= 2) {
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
      for (var i = data.length - 1; i >= 0; i--) {
        if (String(data[i][0] || '').trim() === staffName && String(data[i][1] || '').trim() === ym) {
          sheet.deleteRow(i + 2);
        }
      }
    }

    // 除外項目がある場合のみ書き込み
    if (excludedList.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, 3).setValues([[staffName, ym, JSON.stringify(excludedList)]]);
    }

    return JSON.stringify({ success: true, savedCount: excludedList.length });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 請求書追加項目を読み込み
 */
function getInvoiceExtraItems(yearMonth, staffIdentifier) {
  try {
    if (!staffIdentifier) return JSON.stringify({ success: false, items: [] });
    var staffName = String(staffIdentifier).trim();
    var ym = yearMonth || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
    ensureSheetsExist();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_INVOICE_EXTRA);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: true, items: [] });

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
    var items = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === staffName && String(data[i][1] || '').trim() === ym) {
        items.push({
          date: String(data[i][2] || ''),
          name: String(data[i][3] || ''),
          amount: Number(data[i][4] || 0)
        });
      }
    }
    return JSON.stringify({ success: true, items: items });
  } catch (e) {
    return JSON.stringify({ success: false, items: [], error: e.toString() });
  }
}

/* insertInvoiceDetailTableApi_ は廃止（Drive API HTML方式に移行済み） */

/**
 * フォルダ内で重複しないファイル名を返す
 */
function getInvoiceUniqueName_(folder, desiredName) {
  var name = desiredName;
  var dot = desiredName.lastIndexOf('.');
  var base = dot >= 0 ? desiredName.slice(0, dot) : desiredName;
  var ext = dot >= 0 ? desiredName.slice(dot) : '';
  var n = 1;
  while (folder.getFilesByName(name).hasNext()) {
    n++;
    name = base + ' (' + n + ')' + ext;
  }
  return name;
}

/**
 * ログインユーザーが清掃スタッフリストにいれば名前を返す（回答用）
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

/**
 * 旧互換ラッパー: volunteerForRecruitment → respondToRecruitment('◎')
 */
function volunteerForRecruitment(recruitId, staffNameFromClient, staffEmailFromClient, staffMemoFromClient) {
  return respondToRecruitment(recruitId, staffNameFromClient, staffEmailFromClient, '◎', staffMemoFromClient);
}

/**
 * 清掃募集に対してスタッフが回答する（◎/△/×）
 * @param {string} recruitId - 募集ID ('r' + row number)
 * @param {string} staffNameFromClient - スタッフ名
 * @param {string} staffEmailFromClient - メール
 * @param {string} response - '◎', '△', '×'
 * @param {string} memo - 備考（任意）
 */
function respondToRecruitment(recruitId, staffNameFromClient, staffEmailFromClient, response, memo) {
  try {
    ensureSheetsExist();
    ensureVolunteerMemoColumn_();
    ensureVolunteerStatusColumns_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const recruitRowIndex = parseInt(String(recruitId).replace('r', ''), 10);
    if (isNaN(recruitRowIndex) || recruitRowIndex < 2) {
      return JSON.stringify({ success: false, error: '無効な募集ID' });
    }
    const status = String(recruitSheet.getRange(recruitRowIndex, 4).getValue()).trim();
    if (status === '選定済' || status === 'スタッフ確定済み') {
      return JSON.stringify({ success: false, error: 'この募集はスタッフ確定済みです。回答を変更するには「回答変更要請」を使ってください。' });
    }
    if (['◎', '△', '×'].indexOf(response) < 0) {
      return JSON.stringify({ success: false, error: '無効な回答です。◎/△/×で回答してください。' });
    }
    var staffEmail = (staffEmailFromClient || Session.getActiveUser().getEmail() || '').trim();
    var staffName = (staffNameFromClient || '').trim();
    var staffMemo = (memo || '').trim();
    if (!staffName && staffEmail) {
      const nameRes = JSON.parse(getMyStaffName());
      if (nameRes.success && nameRes.name) staffName = nameRes.name;
      else staffName = staffEmail;
    }
    if (!staffName) staffName = '不明';
    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    var lastCol = Math.max(volSheet.getLastColumn(), 7);
    var volData = volSheet.getLastRow() >= 2 ? volSheet.getRange(2, 1, volSheet.getLastRow() - 1, lastCol).getValues() : [];
    // Upsert: 既存回答があれば更新、なければ新規挿入
    for (var i = 0; i < volData.length; i++) {
      if (String(volData[i][0]).trim() !== String(recruitId).trim()) continue;
      var match = (staffEmail && String(volData[i][2] || '').trim().toLowerCase() === staffEmail.toLowerCase()) || String(volData[i][1] || '').trim() === staffName;
      if (match) {
        volSheet.getRange(i + 2, 4).setValue(now);
        volSheet.getRange(i + 2, 5).setValue(staffMemo);
        volSheet.getRange(i + 2, 6).setValue(response);
        var checkoutStr = getCheckoutForRecruit_(recruitSheet, recruitRowIndex, ss);
        addNotification_('回答', staffName + ' が ' + response + ' と回答' + (staffMemo ? '（' + staffMemo + '）' : '') + '（' + (checkoutStr || recruitId) + '）', { recruitRowIndex: recruitRowIndex });
        invalidateInitDataCache_();
        return JSON.stringify({ success: true, updated: true });
      }
    }
    // 新規挿入
    var nextRow = volSheet.getLastRow() + 1;
    volSheet.getRange(nextRow, 1, 1, 4).setValues([[recruitId, staffName, staffEmail, now]]);
    volSheet.getRange(nextRow, 5).setValue(staffMemo);
    volSheet.getRange(nextRow, 6).setValue(response);
    var checkoutStr2 = getCheckoutForRecruit_(recruitSheet, recruitRowIndex, ss);
    addNotification_('回答', staffName + ' が ' + response + ' と回答' + (staffMemo ? '（' + staffMemo + '）' : '') + '（' + (checkoutStr2 || recruitId) + '）', { recruitRowIndex: recruitRowIndex });
    invalidateInitDataCache_();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * スタッフ確定済みの募集に対して回答変更を要請する
 */
function requestResponseChange(recruitId, staffName, staffEmail, newResponse, memo) {
  try {
    ensureSheetsExist();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    var recruitRowIndex = parseInt(String(recruitId).replace('r', ''), 10);
    if (isNaN(recruitRowIndex) || recruitRowIndex < 2) return JSON.stringify({ success: false, error: '無効な募集ID' });
    var status = String(recruitSheet.getRange(recruitRowIndex, 4).getValue()).trim();
    if (status !== 'スタッフ確定済み' && status !== '選定済') return JSON.stringify({ success: false, error: '確定済みではありません' });
    if (['◎', '△', '×'].indexOf(newResponse) < 0) return JSON.stringify({ success: false, error: '無効な回答です' });
    var checkoutStr = getCheckoutForRecruit_(recruitSheet, recruitRowIndex, ss);
    // 回答変更要請シートに記録（既存のキャンセル申請シートに列を追加して共用）
    var crSheet = ss.getSheetByName('回答変更要請');
    if (!crSheet) {
      crSheet = ss.insertSheet('回答変更要請');
      // セル数制限対策: デフォルトの行列数を最小にする
      while (crSheet.getMaxColumns() > 7) crSheet.deleteColumn(crSheet.getMaxColumns());
      while (crSheet.getMaxRows() > 2) crSheet.deleteRow(crSheet.getMaxRows());
      crSheet.getRange(1, 1, 1, 7).setValues([['募集ID', 'スタッフ名', 'メール', '変更後回答', '備考', '要請日時', 'ステータス']]);
    }
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    var nextRow = crSheet.getLastRow() + 1;
    crSheet.getRange(nextRow, 1, 1, 7).setValues([[recruitId, staffName || '', staffEmail || '', newResponse, memo || '', now, 'pending']]);
    addNotification_('回答変更要請', (staffName || '不明') + ' が回答変更を要請（' + newResponse + '）' + (memo ? '（' + memo + '）' : '') + '（' + (checkoutStr || recruitId) + '）');
    invalidateInitDataCache_();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 回答変更要請を承認する（オーナーのみ）
 */
function approveResponseChange(changeRequestRow) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var crSheet = ss.getSheetByName('回答変更要請');
    if (!crSheet || crSheet.getLastRow() < changeRequestRow) return JSON.stringify({ success: false, error: '要請が見つかりません' });
    var row = crSheet.getRange(changeRequestRow, 1, 1, 7).getValues()[0];
    var recruitId = String(row[0]).trim();
    var staffName = String(row[1]).trim();
    var staffEmail = String(row[2]).trim();
    var newResponse = String(row[3]).trim();
    var memo = String(row[4]).trim();
    crSheet.getRange(changeRequestRow, 7).setValue('approved');
    // 募集ステータスを一時的に募集中に戻して回答を反映
    var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    var recruitRowIndex = parseInt(recruitId.replace('r', ''), 10);
    var origStatus = recruitSheet.getRange(recruitRowIndex, 4).getValue();
    recruitSheet.getRange(recruitRowIndex, 4).setValue('募集中');
    var result = JSON.parse(respondToRecruitment(recruitId, staffName, staffEmail, newResponse, memo));
    recruitSheet.getRange(recruitRowIndex, 4).setValue(origStatus);
    if (result.success) {
      addNotification_('回答変更承認', staffName + ' の回答変更を承認しました（' + newResponse + '）');
    }
    invalidateInitDataCache_();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 回答変更要請を否認する（オーナーのみ）
 */
function rejectResponseChange(changeRequestRow) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var crSheet = ss.getSheetByName('回答変更要請');
    if (!crSheet || crSheet.getLastRow() < changeRequestRow) return JSON.stringify({ success: false, error: '要請が見つかりません' });
    var staffName = String(crSheet.getRange(changeRequestRow, 2).getValue()).trim();
    crSheet.getRange(changeRequestRow, 7).setValue('rejected');
    addNotification_('回答変更否認', staffName + ' の回答変更要請を否認しました');
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 未処理の回答変更要請一覧を取得
 */
function getPendingResponseChanges(recruitId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var crSheet = ss.getSheetByName('回答変更要請');
    if (!crSheet || crSheet.getLastRow() < 2) return JSON.stringify({ success: true, requests: [] });
    var rows = crSheet.getRange(2, 1, crSheet.getLastRow() - 1, 7).getValues();
    var list = [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][6]).trim() !== 'pending') continue;
      if (recruitId && String(rows[i][0]).trim() !== String(recruitId).trim()) continue;
      list.push({
        rowIndex: i + 2,
        recruitId: String(rows[i][0]).trim(),
        staffName: String(rows[i][1]).trim(),
        email: String(rows[i][2]).trim(),
        newResponse: String(rows[i][3]).trim(),
        memo: String(rows[i][4]).trim(),
        requestedAt: String(rows[i][5]).trim()
      });
    }
    return JSON.stringify({ success: true, requests: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), requests: [] });
  }
}

/**
 * 旧ステータスを新回答形式に変換するヘルパー
 */
function normalizeVolStatus_(rawStatus) {
  if (rawStatus === '◎' || rawStatus === '△' || rawStatus === '×') return rawStatus;
  if (rawStatus === 'volunteered') return '◎';
  if (rawStatus === 'hold') return '△';
  return '未回答';
}

/**
 * 全アクティブスタッフ一覧を取得するヘルパー（CacheService 付き）
 */
function getAllActiveStaff_(ss) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('activeStaffList');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }
  var staffSheet = ss.getSheetByName(SHEET_STAFF);
  if (!staffSheet || staffSheet.getLastRow() < 2) return [];
  var lastCol = Math.max(staffSheet.getLastColumn(), 11);
  var rows = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, lastCol).getValues();
  var result = rows.map(function(row) {
    var name = String(row[0] || '').trim();
    var email = String(row[2] || '').trim();
    var active = lastCol >= 9 ? String(row[8] || 'Y').trim() : 'Y';
    if (active === 'N' || (!name && !email)) return null;
    var order = parseInt(row[10], 10) || 9999;
    return { staffName: name || email, email: email, displayOrder: order };
  }).filter(Boolean).sort(function(a, b) { return a.displayOrder - b.displayOrder; });
  try { cache.put('activeStaffList', JSON.stringify(result), 600); } catch (e) { /* ignore cache write errors */ }
  return result;
}

/**
 * スタッフキャッシュを無効化するヘルパー
 */
function invalidateStaffCache_() {
  try { CacheService.getScriptCache().remove('activeStaffList'); } catch (e) { /* ignore */ }
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
    const volData = volSheet.getLastRow() >= 2 ? volSheet.getRange(2, 1, volSheet.getLastRow() - 1, 4).getValues() : [];
    var deleted = false;
    for (var i = volData.length - 1; i >= 0; i--) {
      if (String(volData[i][0]).trim() !== String(recruitId).trim()) continue;
      var match = (staffEmail && String(volData[i][2] || '').trim().toLowerCase() === staffEmail) || String(volData[i][1] || '').trim() === staffName;
      if (match) {
        volSheet.deleteRow(i + 2);
        deleted = true;
        var checkoutStr = getCheckoutForRecruit_(recruitSheet, recruitRowIndex, ss);
        addNotification_('回答取消', (volData[i][1] || staffName) + ' が回答を取り消しました（' + (checkoutStr || recruitId) + '）');
        break;
      }
    }
    invalidateInitDataCache_();
    return JSON.stringify({ success: true, cancelled: deleted });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 旧互換: holdForRecruitment → respondToRecruitment('△')
 */
function holdForRecruitment(recruitId, staffNameFromClient, staffEmailFromClient, holdReasonFromClient) {
  return respondToRecruitment(recruitId, staffNameFromClient, staffEmailFromClient, '△', holdReasonFromClient);
}
function holdForRecruitment_legacy_(recruitId, staffNameFromClient, staffEmailFromClient, holdReasonFromClient) {
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
    if (status === '選定済' || status === 'スタッフ確定済み') {
      return JSON.stringify({ success: false, error: 'この募集はスタッフ確定済みです' });
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
    var volData = volSheet.getLastRow() >= 2 ? volSheet.getRange(2, 1, volSheet.getLastRow() - 1, lastCol).getValues() : [];
    for (var i = 0; i < volData.length; i++) {
      if (String(volData[i][0]).trim() !== String(recruitId).trim()) continue;
      var match = (staffEmail && String(volData[i][2] || '').trim().toLowerCase() === staffEmail.toLowerCase()) || String(volData[i][1] || '').trim() === staffName;
      if (match) {
        volSheet.getRange(i + 2, 6).setValue('hold');
        if (lastCol >= 7) volSheet.getRange(i + 2, 7).setValue(holdReason);
        var checkoutStr = getCheckoutForRecruit_(recruitSheet, recruitRowIndex, ss);
        addNotification_('保留', staffName + ' が保留しました' + (holdReason ? '（' + holdReason + '）' : '') + '（' + (checkoutStr || recruitId) + '）');
        return JSON.stringify({ success: true, updated: true });
      }
    }
    var nextRow = volSheet.getLastRow() + 1;
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    volSheet.getRange(nextRow, 1, 1, 4).setValues([[recruitId, staffName, staffEmail, now]]);
    if (lastCol >= 6) volSheet.getRange(nextRow, 6).setValue('hold');
    if (lastCol >= 7 && holdReason) volSheet.getRange(nextRow, 7).setValue(holdReason);
    var checkoutStr2 = getCheckoutForRecruit_(recruitSheet, recruitRowIndex, ss);
    addNotification_('保留', staffName + ' が保留しました' + (holdReason ? '（' + holdReason + '）' : '') + '（' + (checkoutStr2 || recruitId) + '）');
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
    var rows = recruitSheet.getRange(2, 1, recruitSheet.getLastRow() - 1, recruitLastCol).getValues();
    var volunteersByRid = {};
    ensureVolunteerStatusColumns_();
    var volLastCol = Math.max(volSheet ? volSheet.getLastColumn() : 4, 7);
    if (volSheet && volSheet.getLastRow() >= 2) {
      var volRows = volSheet.getRange(2, 1, volSheet.getLastRow() - 1, volLastCol).getValues();
      volRows.forEach(function(vr) {
        var rid = String(vr[0] || '').trim();
        if (rid) {
          if (!volunteersByRid[rid]) volunteersByRid[rid] = [];
          volunteersByRid[rid].push({
            staffName: String(vr[1] || '').trim(),
            email: String(vr[2] || '').trim(),
            respondedAt: String(vr[3] || '').trim(),
            response: normalizeVolStatus_(String(vr[5] || '').trim()),
            memo: String(vr[4] || '').trim()
          });
        }
      });
    }
    // 全スタッフ一覧を取得（カレンダー用マージ）
    var allStaffForMap = getAllActiveStaff_(ss);
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
      formData = formSheet.getRange(2, 1, formSheet.getLastRow() - 1, formSheet.getLastColumn()).getValues();
    }
    // チェックイン日でソート済みの予約一覧を事前構築
    var sortedBookings = [];
    if (formData && formColMap && formColMap.checkIn >= 0) {
      for (var j = 0; j < formData.length; j++) {
        var ciRaw = formData[j][formColMap.checkIn];
        var ci = parseDate(ciRaw);
        var ciStr = ci ? toDateKeySafe_(ci) : toDateKeySafe_(ciRaw);
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
      staffShareData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, staffSheet.getLastColumn()).getValues();
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
          guestCount: fFmt || '-',
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
              guestCount: sFmt || '-',
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

    // チェックアウト日→現在のフォーム行番号リストのマッピングを構築（同日複数予約対応）
    var coToCurrentRows = {};
    var coToCurrentRow = {};  // 後方互換用（repairOrphanedRecruitEntries_向け）
    if (formData && formColMap && formColMap.checkOut >= 0) {
      for (var f = 0; f < formData.length; f++) {
        var fCoRaw = formData[f][formColMap.checkOut];
        var fCoStr = parseDate(fCoRaw) ? toDateKeySafe_(parseDate(fCoRaw)) : toDateKeySafe_(fCoRaw);
        if (fCoStr) {
          if (!coToCurrentRows[fCoStr]) coToCurrentRows[fCoStr] = [];
          coToCurrentRows[fCoStr].push(f + 2);
          if (!coToCurrentRow[fCoStr]) coToCurrentRow[fCoStr] = f + 2;
        }
      }
    }

    // 孤立した募集エントリ（日付がフォームシートに存在しない）を自動修復
    try { repairOrphanedRecruitEntries_(recruitSheet, rows, coToCurrentRow, formData, formColMap); } catch (e) {}

    // 使用済みフォーム行番号を追跡（同日複数予約で同じ行に二重割り当てしない）
    var usedFormRowNums = {};
    for (var i = 0; i < rows.length; i++) {
      var staleRowNum = Number(rows[i][1]);
      var status = String(rows[i][3] || '').trim() || '募集中';
      var staff = String(rows[i][4] || '').trim();
      var rid = 'r' + (i + 2);
      // 回答済みスタッフと全スタッフをマージ
      var ridResponses = volunteersByRid[rid] || [];
      var ridResponsesByKey = {};
      ridResponses.forEach(function(r) {
        var key = r.email ? r.email.toLowerCase() : r.staffName.toLowerCase();
        ridResponsesByKey[key] = r;
      });
      var volunteers = allStaffForMap.map(function(s) {
        var key = s.email ? s.email.toLowerCase() : s.staffName.toLowerCase();
        var resp = ridResponsesByKey[key] || ridResponsesByKey[s.staffName.toLowerCase()];
        return {
          staffName: s.staffName,
          email: s.email,
          response: resp ? resp.response : '未回答',
          memo: resp ? resp.memo : '',
          respondedAt: resp ? resp.respondedAt : ''
        };
      });
      var cancelRequested = cancelByRid[rid] || [];

      // チェックアウト日
      var rawDate = rows[i][0];
      var checkoutDate = rawDate ? (rawDate instanceof Date ? Utilities.formatDate(rawDate, 'Asia/Tokyo', 'yyyy-MM-dd') : String(rawDate)) : '';
      var normCo = checkoutDate.match(/^\d{4}-\d{2}-\d{2}$/) ? checkoutDate : (toDateKeySafe_(parseDate(checkoutDate) || checkoutDate) || checkoutDate);

      // 現在のフォーム行番号に変換（同日複数予約対応: staleRowNumに最も近い未使用の行番号を選択）
      var currentRowNum = staleRowNum;
      if (normCo && coToCurrentRows[normCo]) {
        var candidates = coToCurrentRows[normCo];
        if (candidates.length === 1) {
          currentRowNum = candidates[0];
        } else {
          // 同日複数予約: staleRowNumに最も近い未使用の行番号を選択
          var bestDist = Infinity;
          for (var ci = 0; ci < candidates.length; ci++) {
            if (usedFormRowNums[candidates[ci]]) continue;
            var dist = Math.abs(candidates[ci] - staleRowNum);
            if (dist < bestDist) {
              bestDist = dist;
              currentRowNum = candidates[ci];
            }
          }
        }
      }
      if (currentRowNum) usedFormRowNums[currentRowNum] = true;

      // coToCurrentRow で正しい行番号が見つかった場合、募集シートの行番号を同期
      if (currentRowNum && currentRowNum !== staleRowNum && staleRowNum) {
        try { recruitSheet.getRange(i + 2, 2).setValue(currentRowNum); } catch (e) {}
      }

      // 正しい行番号からフォームシートの最新チェックアウト日を取得
      if (currentRowNum >= 2 && formData && currentRowNum - 2 < formData.length && formColMap && formColMap.checkOut >= 0) {
        var actualCo = parseDate(formData[currentRowNum - 2][formColMap.checkOut]);
        if (actualCo) {
          var actualCoStr = toDateKeySafe_(actualCo);
          if (actualCoStr && actualCoStr !== normCo) {
            // 予約日付が変更された → 募集シートの日付を同期 + 通知メッセージも修正
            try { recruitSheet.getRange(i + 2, 1).setValue(actualCoStr); } catch (e) {}
            try { fixNotificationDates_(normCo, actualCoStr); } catch (e) {}
            checkoutDate = actualCoStr;
            normCo = actualCoStr;
          }
        }
      }

      // 次回予約情報: 常に最新データから計算（キャッシュは古くなる可能性があるため）
      var nextRes = null;
      if (checkoutDate) {
        var normDate = normCo;
        nextRes = findNextRes_(normDate, currentRowNum);
      }

      if (currentRowNum) {
        var newEntry = {
          status: status,
          staff: staff,
          volunteers: volunteers,
          cancelRequested: cancelRequested,
          recruitRowIndex: i + 2,
          checkoutDate: checkoutDate,
          nextReservation: nextRes,
          selectedStaff: staff
        };
        // 同じ予約行番号に対する重複エントリが存在する場合、回答データが多い方を優先
        if (map[currentRowNum]) {
          var existingAnswered = (map[currentRowNum].volunteers || []).filter(function(v) { return v.response && v.response !== '未回答'; }).length;
          var newAnswered = volunteers.filter(function(v) { return v.response && v.response !== '未回答'; }).length;
          if (newAnswered > existingAnswered) {
            map[currentRowNum] = newEntry;
          }
          // else: 既存エントリの方が回答データが多いので保持
        } else {
          map[currentRowNum] = newEntry;
        }
      }
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
    var formData = formSheet.getRange(2, 1, formSheet.getLastRow() - 1, formSheet.getLastColumn()).getValues();
    // チェックイン日でソートした予約一覧
    var sorted = [];
    for (var j = 0; j < formData.length; j++) {
      var ciRaw = formData[j][colMap.checkIn];
      var ci = parseDate(ciRaw);
      var ciStr = ci ? toDateKeySafe_(ci) : toDateKeySafe_(ciRaw);
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
      staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, staffSheet.getLastColumn()).getValues();
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
        best = { date: sb.checkInStr + (scoStr ? ' ～ ' + scoStr : ''), guestCount: fFmt || '-', bbq: colMap.bbq >= 0 ? String(sb.row[colMap.bbq] || '').trim() : '', nationality: (colMap.nationality >= 0 ? String(sb.row[colMap.nationality] || '').trim() : '') || '日本', memo: '', bedCount: '' };
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
            best = { date: sCiStr + (sCoStr2 ? ' ～ ' + sCoStr2 : ''), guestCount: sFmt || '-', bbq: staffColMap.bbq >= 0 ? String(staffData[m][staffColMap.bbq] || '').trim() : '', nationality: (staffColMap.nationality >= 0 ? String(staffData[m][staffColMap.nationality] || '').trim() : '') || '日本', memo: '', bedCount: staffColMap.bedCount >= 0 ? String(staffData[m][staffColMap.bedCount] || '').trim() : '' };
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
 * 予約行番号に対応する募集情報（スタッフ回答含む）を取得
 */
function getRecruitmentForBooking(bookingRowNumber) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    if (!recruitSheet || recruitSheet.getLastRow() < 2) return JSON.stringify({ success: true, recruitRowIndex: 0, volunteers: [], status: '', checkoutDate: '' });
    var rows = recruitSheet.getRange(2, 1, recruitSheet.getLastRow() - 1, 5).getValues();
    // まず行番号で一致を試みる
    var matchIdx = -1;
    for (var i = 0; i < rows.length; i++) {
      if (Number(rows[i][1]) === bookingRowNumber) {
        matchIdx = i;
        break;
      }
    }
    // 行番号で見つからなければ、チェックアウト日で一致を試みる（ソート後の行番号ずれ対策）
    if (matchIdx < 0) {
      var formSheet = ss.getSheetByName(SHEET_NAME);
      if (formSheet && formSheet.getLastRow() >= bookingRowNumber) {
        var fHeaders = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
        var fColMap = buildColumnMap(fHeaders);
        if (fColMap.checkIn < 0 || fColMap.checkOut < 0) fColMap = buildColumnMapFromSource_(fHeaders);
        var fRow = formSheet.getRange(bookingRowNumber, 1, 1, formSheet.getLastColumn()).getValues()[0];
        var targetCo = fColMap.checkOut >= 0 ? fRow[fColMap.checkOut] : null;
        var targetCoStr = targetCo ? (targetCo instanceof Date ? Utilities.formatDate(targetCo, 'Asia/Tokyo', 'yyyy-MM-dd') : (toDateKeySafe_(targetCo) || String(targetCo).trim())) : '';
        if (targetCoStr) {
          for (var j = 0; j < rows.length; j++) {
            var rCo = rows[j][0] ? (rows[j][0] instanceof Date ? Utilities.formatDate(rows[j][0], 'Asia/Tokyo', 'yyyy-MM-dd') : (toDateKeySafe_(rows[j][0]) || String(rows[j][0]).trim())) : '';
            if (rCo === targetCoStr) {
              matchIdx = j;
              // 募集シートの行番号を現在の値に自動修正（自己修復）
              recruitSheet.getRange(j + 2, 2).setValue(bookingRowNumber);
              break;
            }
          }
        }
      }
    }
    if (matchIdx >= 0) {
      var recruitRowIndex = matchIdx + 2;
      var checkoutDate = rows[matchIdx][0] ? (rows[matchIdx][0] instanceof Date ? Utilities.formatDate(rows[matchIdx][0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(rows[matchIdx][0])) : '';
      var status = String(rows[matchIdx][3] || '').trim() || '募集中';
      // 全スタッフと回答をマージ
      var allStaff = getAllActiveStaff_(ss);
      var responsesByKey = {};
      if (volSheet && volSheet.getLastRow() >= 2) {
        ensureVolunteerStatusColumns_();
        var volLastCol = Math.max(volSheet.getLastColumn(), 7);
        var volRows = volSheet.getRange(2, 1, volSheet.getLastRow() - 1, volLastCol).getValues();
        var rid = 'r' + recruitRowIndex;
        volRows.forEach(function(vr) {
          if (String(vr[0] || '').trim() === rid) {
            var email = String(vr[2] || '').trim().toLowerCase();
            var name = String(vr[1] || '').trim().toLowerCase();
            var key = email || name;
            responsesByKey[key] = {
              response: normalizeVolStatus_(String(vr[5] || '').trim()),
              memo: String(vr[4] || '').trim(),
              respondedAt: String(vr[3] || '').trim()
            };
          }
        });
      }
      var volunteers = allStaff.map(function(s) {
        var key = s.email ? s.email.toLowerCase() : s.staffName.toLowerCase();
        var resp = responsesByKey[key] || responsesByKey[s.staffName.toLowerCase()];
        return {
          staffName: s.staffName,
          email: s.email,
          response: resp ? resp.response : '未回答',
          memo: resp ? resp.memo : '',
          respondedAt: resp ? resp.respondedAt : ''
        };
      });
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
      var selectedStaff = String(rows[matchIdx][4] || '').trim();
      // 回答変更要請を取得
      var responseChangeRequests = [];
      try {
        var rcSheet = ss.getSheetByName('回答変更要請');
        if (rcSheet && rcSheet.getLastRow() >= 2) {
          var rcRows = rcSheet.getRange(2, 1, rcSheet.getLastRow() - 1, 7).getValues();
          var rid3 = 'r' + recruitRowIndex;
          rcRows.forEach(function(rc, idx) {
            if (String(rc[0]).trim() === rid3 && String(rc[6]).trim() === 'pending') {
              responseChangeRequests.push({ rowIndex: idx + 2, staffName: String(rc[1]).trim(), email: String(rc[2]).trim(), newResponse: String(rc[3]).trim(), memo: String(rc[4]).trim(), requestedAt: String(rc[5]).trim() });
            }
          });
        }
      } catch (rcErr) {}
      return JSON.stringify({ success: true, recruitRowIndex: recruitRowIndex, volunteers: volunteers, status: status, checkoutDate: checkoutDate, nextReservation: nextReservation, selectedStaff: selectedStaff, cancelRequested: cancelRequested, cancelRejected: cancelRejected, responseChangeRequests: responseChangeRequests });
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
    // スタッフ選定時はステータスを変更しない（確定ボタンで別途変更）
    recruitSheet.getRange(recruitRowIndex, 5).setValue(selectedStaffComma || '');
    const headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    const columnMap = buildColumnMap(headers);
    if (columnMap.cleaningStaff >= 0) {
      formSheet.getRange(bookingRowNumber, columnMap.cleaningStaff + 1).setValue(selectedStaffComma || '');
      // 同一チェックイン日の重複行にもcleaningStaffを書き込む（iCal+フォーム重複対策）
      if (columnMap.checkIn >= 0 && formSheet.getLastRow() >= 2) {
        var targetCi = toDateKeySafe_(formSheet.getRange(bookingRowNumber, columnMap.checkIn + 1).getValue());
        if (targetCi) {
          var allData = formSheet.getRange(2, 1, formSheet.getLastRow() - 1, formSheet.getLastColumn()).getValues();
          for (var di = 0; di < allData.length; di++) {
            if ((di + 2) === bookingRowNumber) continue;
            var rowCi = toDateKeySafe_(allData[di][columnMap.checkIn]);
            if (rowCi === targetCi) {
              formSheet.getRange(di + 2, columnMap.cleaningStaff + 1).setValue(selectedStaffComma || '');
            }
          }
        }
      }
    }
    invalidateInitDataCache_();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 募集を確定（募集締切）する。ステータスを「スタッフ確定済み」に変更。
 */
function confirmRecruitment(recruitRowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!recruitSheet || recruitSheet.getLastRow() < recruitRowIndex) return JSON.stringify({ success: false, error: '募集が見つかりません' });
    var staff = String(recruitSheet.getRange(recruitRowIndex, 5).getValue() || '').trim();
    if (!staff) return JSON.stringify({ success: false, error: 'スタッフが選定されていません。先にスタッフを選定してください。' });
    recruitSheet.getRange(recruitRowIndex, 4).setValue('スタッフ確定済み');
    addNotification_('スタッフ確定', staff + ' をスタッフとして確定しました');
    invalidateInitDataCache_();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 確定通知テンプレートのデフォルト値
 */
var DEFAULT_CONFIRM_TEMPLATE_ = 'スタッフ確定\n\n作業日: {作業日}\n\n{スタッフ一覧}\n\nよろしくお願いします\uD83C\uDF4A\n\n{次回予約}\n\n{アプリURL}';

/**
 * 確定通知テンプレートを取得
 */
function getConfirmationTemplate() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。' });
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT_SETTINGS);
    if (!sheet) return JSON.stringify({ success: true, template: DEFAULT_CONFIRM_TEMPLATE_ });
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    var template = '';
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === 'スタッフ確定通知テンプレート') {
        template = String(rows[i][1] || '');
        break;
      }
    }
    return JSON.stringify({ success: true, template: template || DEFAULT_CONFIRM_TEMPLATE_ });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 確定通知テンプレートを保存
 */
function saveConfirmationTemplate(template) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT_SETTINGS);
    if (!sheet) return JSON.stringify({ success: false, error: '募集設定シートが見つかりません。' });
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    var found = false;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === 'スタッフ確定通知テンプレート') {
        sheet.getRange(i + 2, 2).setValue(template || '');
        found = true;
        break;
      }
    }
    if (!found) {
      var nr = sheet.getLastRow() + 1;
      sheet.getRange(nr, 1).setValue('スタッフ確定通知テンプレート');
      sheet.getRange(nr, 2).setValue(template || '');
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 確定通知テンプレートを募集設定シートから読み込む（内部用）
 */
function getConfirmationTemplate_() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT_SETTINGS);
    if (!sheet) return DEFAULT_CONFIRM_TEMPLATE_;
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === 'スタッフ確定通知テンプレート') {
        return String(rows[i][1] || '') || DEFAULT_CONFIRM_TEMPLATE_;
      }
    }
    return DEFAULT_CONFIRM_TEMPLATE_;
  } catch (e) {
    return DEFAULT_CONFIRM_TEMPLATE_;
  }
}

/**
 * スタッフ確定通知テキストを生成（LINE用/メール用共通）
 * テンプレートのプレースホルダーを実データに置換する
 */
function buildConfirmationCopyText_(checkoutDateStr, selectedStaffNames, volunteers, nextReservation, appUrl) {
  var fmtDate = (checkoutDateStr || '－');
  var dm = fmtDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dm) fmtDate = dm[1] + '年' + ('0' + dm[2]).slice(-2) + '月' + ('0' + dm[3]).slice(-2) + '日';

  // 確定スタッフ一覧（備考付き）
  var staffNames = (selectedStaffNames || '').split(/[,、]/).map(function(s) { return s.trim(); }).filter(Boolean);
  var volMap = {};
  (volunteers || []).forEach(function(v) {
    if (v.staffName) volMap[v.staffName.trim()] = v.memo || '';
  });
  var staffLines = [];
  staffNames.forEach(function(name) {
    var memo = volMap[name] || '';
    staffLines.push(memo ? name + '（' + memo + '）' : name);
  });

  // 次回予約情報を構築
  var nr = nextReservation || {};
  var dateRange = nr.dateRange || '';
  if (!dateRange && nr.date) dateRange = nr.date;
  var checkinDisp = (dateRange || '-').replace(/(\d{4})-(\d{1,2})-(\d{1,2})/g, function(_, y, m, d) {
    return y + '/' + parseInt(m, 10) + '/' + parseInt(d, 10);
  });
  var guestDisp = nr.guestCount || '-';
  var bedDisp = nr.bedCount || '-';
  var bbqRaw = (nr.bbq || '').toString().trim().toLowerCase();
  var bbqDisp = '-';
  if (bbqRaw.indexOf('yes') >= 0 || bbqRaw.indexOf('はい') >= 0) bbqDisp = 'あり';
  else if (bbqRaw.indexOf('no') >= 0 || bbqRaw.indexOf('いいえ') >= 0) bbqDisp = 'なし';
  else if (nr.bbq) bbqDisp = nr.bbq;
  var natDisp = nr.nationality || '-';
  var bedParts = String(bedDisp).split(/[,、\n]/).map(function(s) { return s.trim(); }).filter(Boolean);
  var nextResBlock = '次回予約（変更の可能性あり）\n'
    + '日付:\u3000\u3000' + checkinDisp + '\n'
    + '人数:\u3000\u3000' + guestDisp + '\n'
    + 'ベッド:\u3000' + bedParts.join('、') + '\n'
    + 'BBQ:\u3000\u3000' + bbqDisp + '\n'
    + '国籍:\u3000\u3000' + natDisp + '\n\n'
    + '※予約状況次第では変更となる場合があります。';

  // アプリURL
  var appUrlText = '';
  if (appUrl) {
    var deepUrl = appUrl + (appUrl.indexOf('?') >= 0 ? '&' : '?') + 'date=' + (checkoutDateStr || '');
    appUrlText = 'Webアプリを確認: ' + deepUrl;
  }

  // テンプレートを読み込んでプレースホルダーを置換
  var template = getConfirmationTemplate_();
  var result = template
    .replace(/\{作業日\}/g, fmtDate)
    .replace(/\{スタッフ一覧\}/g, staffLines.join('\n'))
    .replace(/\{次回予約\}/g, nextResBlock)
    .replace(/\{次回予約_日付\}/g, checkinDisp)
    .replace(/\{次回予約_人数\}/g, guestDisp)
    .replace(/\{次回予約_ベッド\}/g, bedParts.join('、'))
    .replace(/\{次回予約_BBQ\}/g, bbqDisp)
    .replace(/\{次回予約_国籍\}/g, natDisp)
    .replace(/\{アプリURL\}/g, appUrlText);
  return result;
}

/**
 * スタッフ確定通知のコピーテキストを取得
 */
function getConfirmationCopyText(recruitRowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!recruitSheet || recruitSheet.getLastRow() < recruitRowIndex) return JSON.stringify({ success: false, error: '募集が見つかりません' });
    var row = recruitSheet.getRange(recruitRowIndex, 1, 1, 5).getValues()[0];
    var recruitDateStr = row[0] ? (row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[0])) : '';
    var bookingRowNumber = row[1] ? Number(row[1]) : 0;
    // フォームシートのチェックアウト日を正とする
    var checkoutDateStr = getCheckoutDateFromFormSheet_(bookingRowNumber, ss) || recruitDateStr;
    var selectedStaff = String(row[4] || '').trim();

    // 回答データ（備考取得用）
    var volunteers = [];
    try {
      var rJson = JSON.parse(getRecruitmentForBooking(bookingRowNumber));
      if (rJson.success) volunteers = rJson.volunteers || [];
    } catch (e) {}

    // 次回予約情報
    var nextRes = null;
    try {
      var det = JSON.parse(getBookingDetailsForRecruit(bookingRowNumber, recruitRowIndex));
      if (det.success && det.nextReservation) nextRes = det.nextReservation;
    } catch (e) {}

    var appUrl = getLatestStaffUrl_();
    var copyText = buildConfirmationCopyText_(checkoutDateStr, selectedStaff, volunteers, nextRes, appUrl);
    return JSON.stringify({ success: true, copyText: copyText });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * スタッフ確定通知をメールで送信
 */
function notifyStaffConfirmation(recruitRowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ実行できます。' });
    if (!isEmailNotifyEnabled_('スタッフ確定通知有効')) return JSON.stringify({ success: true, message: 'メール通知はOFFに設定されています。' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!recruitSheet || recruitSheet.getLastRow() < recruitRowIndex) return JSON.stringify({ success: false, error: '募集が見つかりません' });
    var row = recruitSheet.getRange(recruitRowIndex, 1, 1, 5).getValues()[0];
    var recruitDateStr = row[0] ? (row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[0])) : '';
    var bookingRowNumber = row[1] ? Number(row[1]) : 0;
    // フォームシートのチェックアウト日を正とする
    var checkoutDateStr = getCheckoutDateFromFormSheet_(bookingRowNumber, ss) || recruitDateStr;
    var selectedStaff = String(row[4] || '').trim();

    // スタッフ全員のメールアドレスを取得
    var staffSheet = ss.getSheetByName(SHEET_STAFF);
    if (!staffSheet || staffSheet.getLastRow() < 2) return JSON.stringify({ success: false, error: 'スタッフが登録されていません' });
    var emailSet = {};
    var data = staffSheet.getRange(2, 3, staffSheet.getLastRow() - 1, 1).getValues();
    data.forEach(function(r) { var e = String(r[0] || '').trim().toLowerCase(); if (e) emailSet[e] = 1; });
    var emails = Object.keys(emailSet);
    if (emails.length === 0) return JSON.stringify({ success: false, error: 'メールアドレスが登録されていません' });

    var volunteers = [];
    try {
      var rJson = JSON.parse(getRecruitmentForBooking(bookingRowNumber));
      if (rJson.success) volunteers = rJson.volunteers || [];
    } catch (e) {}

    var nextRes = null;
    try {
      var det = JSON.parse(getBookingDetailsForRecruit(bookingRowNumber, recruitRowIndex));
      if (det.success && det.nextReservation) nextRes = det.nextReservation;
    } catch (e) {}

    var appUrl = getLatestStaffUrl_();
    var body = buildConfirmationCopyText_(checkoutDateStr, selectedStaff, volunteers, nextRes, appUrl);
    var dm = (checkoutDateStr || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    var fmtDate = dm ? dm[1] + '年' + ('0' + dm[2]).slice(-2) + '月' + ('0' + dm[3]).slice(-2) + '日' : checkoutDateStr;
    var subject = '【民泊】スタッフ確定: ' + fmtDate;
    GmailApp.sendEmail(emails.join(','), subject, body);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function checkAndCreateRecruitments() {
  try {
    ensureSheetsExist();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const formSheet = ss.getSheetByName(SHEET_NAME);
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!formSheet || !recruitSheet || formSheet.getLastRow() < 2) return;
    const headers = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
    const colMap = buildColumnMap(headers);
    if (colMap.checkOut < 0) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 過去60日前までの予約も募集エントリを作成（履歴表示用）
    var cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 60);
    const data = formSheet.getRange(2, 1, formSheet.getLastRow() - 1, formSheet.getLastColumn()).getValues();
    // 既存の募集行番号とチェックアウト日を一括取得（重複防止）
    var existingRowNums = {};
    var existingCheckoutDates = {};
    if (recruitSheet.getLastRow() >= 2) {
      var existData = recruitSheet.getRange(2, 1, recruitSheet.getLastRow() - 1, 2).getValues();
      for (var ei = 0; ei < existData.length; ei++) {
        existingRowNums[Number(existData[ei][1])] = true;
        // チェックアウト日+行番号の組み合わせで既存エントリを追跡
        var eCo = parseDate(existData[ei][0]);
        if (eCo) {
          var eCoStr = toDateKeySafe_(eCo);
          if (eCoStr) {
            if (!existingCheckoutDates[eCoStr]) existingCheckoutDates[eCoStr] = [];
            existingCheckoutDates[eCoStr].push(Number(existData[ei][1]));
          }
        }
      }
    }
    ensureRecruitNotifyMethodColumn_();
    ensureRecruitDetailColumns_();
    for (var i = 0; i < data.length; i++) {
      // キャンセル済みの予約はスキップ
      if (colMap.cancelledAt >= 0) {
        var cancelledVal = String(data[i][colMap.cancelledAt] || '').trim();
        if (cancelledVal) continue;
      }
      const checkOutVal = data[i][colMap.checkOut];
      const checkOut = parseDate(checkOutVal);
      if (!checkOut) continue;
      const co = new Date(checkOut);
      co.setHours(0, 0, 0, 0);
      if (co < cutoff) continue;
      const checkoutStr = toDateKeySafe_(checkOut);
      const rowNumber = i + 2;
      if (existingRowNums[rowNumber]) continue;
      // 同じチェックアウト日の募集エントリが既に存在し、同日の予約が1件のみの場合はスキップ（行番号ずれによる重複防止）
      if (checkoutStr && existingCheckoutDates[checkoutStr]) {
        var sameCoFormRows = 0;
        for (var sci = 0; sci < data.length; sci++) {
          var sciCo = parseDate(data[sci][colMap.checkOut]);
          if (sciCo && toDateKeySafe_(sciCo) === checkoutStr) sameCoFormRows++;
        }
        if (sameCoFormRows <= existingCheckoutDates[checkoutStr].length) continue;
      }
      // スタッフが既に確定済みか判定
      var assignedStaff = colMap.cleaningStaff >= 0 ? String(data[i][colMap.cleaningStaff] || '').trim() : '';
      var status = assignedStaff ? 'スタッフ確定済み' : '募集中';
      const nextRow = recruitSheet.getLastRow() + 1;
      const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
      recruitSheet.getRange(nextRow, 1, 1, 15).setValues([[checkoutStr, rowNumber, '', status, assignedStaff, '', now, '', 'メール', '', '', '', '', '', '']]);
      existingRowNums[rowNumber] = true;
    }
  } catch (e) {
    Logger.log('checkAndCreateRecruitments: ' + e.toString());
  }
}

function checkAndSendReminders() {
  // トリガー重複クリーンアップ
  ensureSingleTrigger_('checkAndSendReminders');
  // 排他ロック: 同時実行による重複送信を防止
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const res = JSON.parse(getRecruitmentSettings());
    if (!res.success || !res.settings) return;
    // 募集リマインドが無効ならスキップ
    if (!res.settings.recruitReminderEnabled) return;
    ensureRecruitNotifyMethodColumn_();
    const minResp = res.settings.minRespondents || 2;
    const intervalWeeks = res.settings.reminderIntervalWeeks || 1;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    const volSheet = ss.getSheetByName(SHEET_RECRUIT_VOLUNTEERS);
    if (!recruitSheet || recruitSheet.getLastRow() < 2) return;
    const maxCol = Math.max(recruitSheet.getLastColumn(), 9);
    const rows = recruitSheet.getRange(2, 1, recruitSheet.getLastRow() - 1, maxCol).getValues();
    const today = new Date();
    var todayStr = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd');
    var props = PropertiesService.getScriptProperties();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][3]).trim() !== '募集中') continue;
      if ((String(rows[i][8] || '').trim() || 'メール') === 'LINE') continue;
      const lastRemind = rows[i][5] ? new Date(rows[i][5]) : null;
      const rowIndex = i + 2;
      var volCount = 0;
      if (volSheet && volSheet.getLastRow() >= 2) {
        const volRows = volSheet.getRange(2, 1, volSheet.getLastRow() - 1, 1).getValues();
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
        // 同日重複送信を防止（フラグを送信前にセットして競合を排除）
        var propKey = 'staffRemind_' + rowIndex + '_' + todayStr;
        if (props.getProperty(propKey)) continue;
        props.setProperty(propKey, '1');
        const staffSheet = ss.getSheetByName(SHEET_STAFF);
        if (staffSheet && staffSheet.getLastRow() >= 2) {
          const emails = staffSheet.getRange(2, 3, staffSheet.getLastRow(), 3).getValues();
          var toSet = {};
          emails.forEach(function(r) { var e = String(r[0] || '').trim().toLowerCase(); if (e) toSet[e] = 1; });
          var to = Object.keys(toSet);
          if (to.length) {
            GmailApp.sendEmail(to.join(','), '【民泊】清掃スタッフ募集のリマインド: ' + rows[i][0], 'まだ回答が少ないため、再度ご案内します。チェックアウト日: ' + rows[i][0]);
          }
        }
        recruitSheet.getRange(rowIndex, 6).setValue(Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'));
      }
    }
  } catch (e) {
    Logger.log('checkAndSendReminders: ' + e.toString());
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**********************************************
 * オーナー向けリマインドメール設定・送信
 **********************************************/

/**
 * 募集シートに「オーナーリマインド送信済」列を保証
 */
function ensureRecruitOwnerReminderColumn_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!sheet || sheet.getLastRow() < 1) return;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').trim() === 'オーナーリマインド送信済') return;
    }
    var nextCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, nextCol).setValue('オーナーリマインド送信済');
  } catch (e) {}
}

/**
 * オーナーリマインド送信済み列のインデックスを取得 (0-based)
 */
function getOwnerReminderColIndex_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim() === 'オーナーリマインド送信済') return i;
  }
  return -1;
}

/**
 * リマインドメール設定を取得
 */
function getReminderEmailSettings() {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ閲覧できます。' });
    ensureSheetsExist();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECRUIT_SETTINGS);
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow, 2).getValues() : [];
    var settings = {};
    rows.forEach(function(row) {
      var key = String(row[0] || '').trim();
      if (key) settings[key] = row[1];
    });
    var reminders = [];
    try { reminders = JSON.parse(settings['リマインドメール設定'] || '[]'); } catch (e) { reminders = []; }
    // デフォルト5件
    while (reminders.length < 5) {
      reminders.push({ daysBefore: reminders.length === 0 ? 7 : 0, time: '09:00', enabled: false });
    }
    var immediateNotify = String(settings['即時通知有効'] || 'yes');
    var reminderSubject = String(settings['リマインド件名'] || '');
    var reminderBody = String(settings['リマインド本文'] || '');
    var immediateSubject = String(settings['即時リマインド件名'] || '');
    var immediateBody = String(settings['即時リマインド本文'] || '');
    return JSON.stringify({
      success: true, reminders: reminders, immediateNotify: immediateNotify,
      reminderSubject: reminderSubject, reminderBody: reminderBody,
      immediateSubject: immediateSubject, immediateBody: immediateBody
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * リマインドメール設定を保存
 */
function setReminderEmailSettings(reminders, immediateNotify, templates) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    ensureSheetsExist();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_RECRUIT_SETTINGS);
    var lastRow = Math.max(sheet.getLastRow(), 1);
    var rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow, 2).getValues() : [];
    // 既存の行を探す
    var rowMap = {};
    for (var i = 0; i < rows.length; i++) {
      var key = String(rows[i][0] || '').trim();
      if (key) rowMap[key] = i + 2;
    }
    // 設定キーと値のペアを一括処理
    var entries = [
      ['リマインドメール設定', JSON.stringify(reminders || [])],
      ['即時通知有効', String(immediateNotify || 'yes')]
    ];
    if (templates) {
      entries.push(['リマインド件名', String(templates.reminderSubject || '')]);
      entries.push(['リマインド本文', String(templates.reminderBody || '')]);
      entries.push(['即時リマインド件名', String(templates.immediateSubject || '')]);
      entries.push(['即時リマインド本文', String(templates.immediateBody || '')]);
    }
    for (var ei = 0; ei < entries.length; ei++) {
      var eKey = entries[ei][0], eVal = entries[ei][1];
      if (rowMap[eKey]) {
        sheet.getRange(rowMap[eKey], 2).setValue(eVal);
      } else {
        var nr = sheet.getLastRow() + 1;
        sheet.getRange(nr, 1).setValue(eKey);
        sheet.getRange(nr, 2).setValue(eVal);
        rowMap[eKey] = nr;
      }
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * リマインドメールのテンプレート置換
 * プレースホルダー: {チェックイン}, {チェックアウト}, {残り日数}, {プラットフォーム}, {清掃詳細リンク}
 */
function applyReminderTemplate_(template, vars) {
  var result = template;
  var keys = Object.keys(vars);
  for (var i = 0; i < keys.length; i++) {
    var val = vars[keys[i]];
    result = result.split('{' + keys[i] + '}').join(val != null ? String(val) : '');
  }
  return result;
}

/**
 * 清掃詳細のディープリンクURLを生成
 */
function buildCleaningDetailUrl_(checkoutDateStr) {
  var base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  if (!base) { try { base = PropertiesService.getScriptProperties().getProperty('APP_BASE_URL') || ''; } catch (e) {} }
  if (!base) { try { var depId = PropertiesService.getDocumentProperties().getProperty('deploymentId') || ''; if (depId) base = 'https://script.google.com/macros/s/' + depId + '/exec'; } catch (e) {} }
  if (!base) return '';
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'date=' + encodeURIComponent(checkoutDateStr);
}

/**
 * トリガー重複クリーンアップ: 指定関数のトリガーが複数ある場合、1つだけ残して削除
 */
function ensureSingleTrigger_(funcName) {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    var found = [];
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === funcName) found.push(triggers[i]);
    }
    // 2つ以上ある場合、最初の1つを残して残りを削除
    for (var j = 1; j < found.length; j++) {
      try { ScriptApp.deleteTrigger(found[j]); } catch (e) {}
    }
  } catch (e) {}
}

/**
 * リマインド関連トリガーを一括セットアップ（重複を防止して1つずつ作成）
 * 設定画面から呼び出せる。手動でGASエディタに入る必要がなくなる。
 */
function setupReminderTriggers() {
  try {
    // 既存の該当トリガーを全削除
    var funcNames = ['checkAndSendReminders', 'checkAndSendReminderEmails'];
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (funcNames.indexOf(triggers[i].getHandlerFunction()) >= 0) {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    // 1時間ごとのトリガーを1つずつ作成
    ScriptApp.newTrigger('checkAndSendReminders')
      .timeBased()
      .everyHours(1)
      .create();
    ScriptApp.newTrigger('checkAndSendReminderEmails')
      .timeBased()
      .everyHours(1)
      .create();
    return JSON.stringify({ success: true, message: 'リマインドトリガーを設定しました（1時間ごと×2関数）' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 現在のトリガー一覧を取得（デバッグ・確認用）
 */
function listTriggers() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    var list = [];
    for (var i = 0; i < triggers.length; i++) {
      list.push({
        func: triggers[i].getHandlerFunction(),
        type: triggers[i].getEventType().toString(),
        id: triggers[i].getUniqueId()
      });
    }
    return JSON.stringify({ success: true, triggers: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * オーナー向けリマインドメールのチェック＆送信
 * 時間ベースのトリガーから呼ばれる（1時間ごと推奨）
 */
function checkAndSendReminderEmails() {
  // トリガー重複クリーンアップ（複数トリガーが設定されていたら1つに整理）
  ensureSingleTrigger_('checkAndSendReminderEmails');
  // 排他ロック: 同時実行による重複送信を防止
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // 5秒待って取れなければスキップ
  try {
    ensureSheetsExist();
    ensureRecruitOwnerReminderColumn_();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    // オーナーメール取得
    var ownerSheet = ss.getSheetByName(SHEET_OWNER);
    if (!ownerSheet || ownerSheet.getLastRow() < 2) return;
    var ownerEmail = String(ownerSheet.getRange(2, 1).getValue() || '').trim();
    if (!ownerEmail) return;
    // リマインド設定を取得（requireOwnerを回避して直接読む）
    var settingsSheet = ss.getSheetByName(SHEET_RECRUIT_SETTINGS);
    if (!settingsSheet) return;
    var sLastRow = Math.max(settingsSheet.getLastRow(), 1);
    var sRows = sLastRow >= 2 ? settingsSheet.getRange(2, 1, sLastRow, 2).getValues() : [];
    var settingsMap = {};
    sRows.forEach(function(row) {
      var key = String(row[0] || '').trim();
      if (key) settingsMap[key] = row[1];
    });
    var reminders = [];
    try { reminders = JSON.parse(settingsMap['リマインドメール設定'] || '[]'); } catch (e) { return; }
    var enabledReminders = reminders.filter(function(r, idx) { return r && r.enabled && r.daysBefore > 0; });
    if (enabledReminders.length === 0) return;

    // メールテンプレート
    var tmplSubject = String(settingsMap['リマインド件名'] || '').trim();
    var tmplBody = String(settingsMap['リマインド本文'] || '').trim();

    // 募集シート
    var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
    if (!recruitSheet || recruitSheet.getLastRow() < 2) return;
    var rLastCol = Math.max(recruitSheet.getLastColumn(), 16);
    var rData = recruitSheet.getRange(2, 1, recruitSheet.getLastRow() - 1, rLastCol).getValues();
    var reminderColIdx = getOwnerReminderColIndex_(recruitSheet);
    if (reminderColIdx < 0) return;

    // フォームシートからチェックイン日を取得するためのマップ
    var formSheet = ss.getSheetByName(SHEET_NAME);
    var checkinByCheckout = {};
    if (formSheet && formSheet.getLastRow() >= 2) {
      var fHeaders = formSheet.getRange(1, 1, 1, formSheet.getLastColumn()).getValues()[0];
      var colMap = buildColumnMap(fHeaders);
      if (colMap.checkIn >= 0 && colMap.checkOut >= 0) {
        var fData = formSheet.getRange(2, 1, formSheet.getLastRow() - 1, formSheet.getLastColumn()).getValues();
        for (var fi = 0; fi < fData.length; fi++) {
          var ciKey = toDateKeySafe_(fData[fi][colMap.checkIn]);
          var coKey = toDateKeySafe_(fData[fi][colMap.checkOut]);
          if (ciKey && coKey && !checkinByCheckout[coKey]) {
            checkinByCheckout[coKey] = ciKey;
          }
        }
      }
    }

    var now = new Date();
    var nowHour = now.getHours();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var props = PropertiesService.getScriptProperties();

    for (var ri = 0; ri < rData.length; ri++) {
      var status = String(rData[ri][3] || '').trim();
      if (status !== '募集中') continue;

      var checkoutDateStr = rData[ri][0] ? (rData[ri][0] instanceof Date ? Utilities.formatDate(rData[ri][0], 'Asia/Tokyo', 'yyyy-MM-dd') : String(rData[ri][0])) : '';
      if (!checkoutDateStr) continue;

      // チェックイン日を取得
      var checkinDateStr = checkinByCheckout[checkoutDateStr] || '';
      if (!checkinDateStr) continue;
      var checkinDate = parseDate(checkinDateStr);
      if (!checkinDate) continue;
      var checkinDay = new Date(checkinDate.getFullYear(), checkinDate.getMonth(), checkinDate.getDate());

      // 既に送信済みのリマインドインデックスを取得
      var sentStr = String(rData[ri][reminderColIdx] || '').trim();
      var sentSet = {};
      if (sentStr) {
        sentStr.split(',').forEach(function(s) { var n = parseInt(s.trim(), 10); if (!isNaN(n)) sentSet[n] = true; });
      }

      var newSent = [];
      for (var remIdx = 0; remIdx < reminders.length; remIdx++) {
        var rem = reminders[remIdx];
        if (!rem || !rem.enabled || !rem.daysBefore || rem.daysBefore <= 0) continue;
        if (sentSet[remIdx]) continue;

        // チェックイン日のX日前
        var triggerDate = new Date(checkinDay);
        triggerDate.setDate(triggerDate.getDate() - rem.daysBefore);
        var triggerHour = parseInt((rem.time || '09:00').split(':')[0], 10) || 9;

        // 現在がトリガー日の指定時刻かチェック（同日の指定時間帯のみ送信）
        var isOnTriggerDay = today.getTime() === triggerDate.getTime();
        var isPastTriggerDay = today > triggerDate;
        if (isOnTriggerDay ? (nowHour >= triggerHour) : isPastTriggerDay) {
          // 未来のチェックインのみ（過去は送らない）
          if (checkinDay >= today) {
            // PropertiesService による重複送信防止
            var propKey = 'ownerRemind_' + checkoutDateStr + '_' + remIdx;
            if (props.getProperty(propKey)) continue;
            props.setProperty(propKey, Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'));
            var daysLeft = Math.round((checkinDay - today) / (1000 * 60 * 60 * 24));
            var detailLink = buildCleaningDetailUrl_(checkoutDateStr);
            var tmplVars = { 'チェックイン': checkinDateStr, 'チェックアウト': checkoutDateStr, '残り日数': daysLeft, '清掃詳細リンク': detailLink };
            try {
              var subject = tmplSubject
                ? applyReminderTemplate_(tmplSubject, tmplVars)
                : '【民泊】清掃スタッフ未確定のリマインド: ' + checkinDateStr;
              var body = tmplBody
                ? applyReminderTemplate_(tmplBody, tmplVars)
                : '以下の予約について、清掃スタッフがまだ確定していません。\n\n'
                  + 'チェックイン: ' + checkinDateStr + '\n'
                  + 'チェックアウト: ' + checkoutDateStr + '\n'
                  + '残り日数: ' + daysLeft + '日\n\n'
                  + '清掃詳細: ' + detailLink + '\n\n'
                  + '早めに清掃スタッフの手配をお願いします。';
              GmailApp.sendEmail(ownerEmail, subject, body);
              newSent.push(remIdx);
            } catch (mailErr) {
              Logger.log('reminderEmail error: ' + mailErr.toString());
            }
          }
        }
      }

      if (newSent.length > 0) {
        var updatedSent = sentStr ? sentStr + ',' + newSent.join(',') : newSent.join(',');
        recruitSheet.getRange(ri + 2, reminderColIdx + 1).setValue(updatedSent);
      }
    }
  } catch (e) {
    Logger.log('checkAndSendReminderEmails: ' + e.toString());
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * iCal取り込み時の即時リマインド送信（1週間以内のチェックイン）
 */
function sendImmediateReminderIfNeeded_(ss, checkInStr, checkOutStr, platformName) {
  try {
    // 即時通知設定を確認
    var settingsSheet = ss.getSheetByName(SHEET_RECRUIT_SETTINGS);
    if (!settingsSheet) return;
    var sLastRow = Math.max(settingsSheet.getLastRow(), 1);
    var sRows = sLastRow >= 2 ? settingsSheet.getRange(2, 1, sLastRow, 2).getValues() : [];
    var immediateEnabled = 'yes';
    sRows.forEach(function(row) {
      if (String(row[0] || '').trim() === '即時通知有効') immediateEnabled = String(row[1] || 'yes').trim();
    });
    if (immediateEnabled !== 'yes') return;

    // 重複送信防止: 同じチェックイン/チェックアウトの組み合わせで本日送信済みならスキップ
    var todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    var immPropKey = 'immRemind_' + checkInStr + '_' + checkOutStr + '_' + todayStr;
    var immProps = PropertiesService.getScriptProperties();
    if (immProps.getProperty(immPropKey)) return;
    immProps.setProperty(immPropKey, '1');

    // チェックイン日が1週間以内かチェック
    var checkinDate = parseDate(checkInStr);
    if (!checkinDate) return;
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var oneWeekLater = new Date(today);
    oneWeekLater.setDate(oneWeekLater.getDate() + 7);
    var checkinDay = new Date(checkinDate.getFullYear(), checkinDate.getMonth(), checkinDate.getDate());
    if (checkinDay < today || checkinDay > oneWeekLater) return;

    // オーナーメール取得
    var ownerSheet = ss.getSheetByName(SHEET_OWNER);
    if (!ownerSheet || ownerSheet.getLastRow() < 2) return;
    var ownerEmail = String(ownerSheet.getRange(2, 1).getValue() || '').trim();
    if (!ownerEmail) return;

    var daysLeft = Math.round((checkinDay - today) / (1000 * 60 * 60 * 24));
    var detailLink = buildCleaningDetailUrl_(checkOutStr);
    var tmplVars = { 'チェックイン': checkInStr, 'チェックアウト': checkOutStr, 'プラットフォーム': platformName || '不明', '残り日数': daysLeft, '清掃詳細リンク': detailLink };
    // テンプレート設定を取得
    var imSubjectTmpl = '', imBodyTmpl = '';
    sRows.forEach(function(row) {
      var k = String(row[0] || '').trim();
      if (k === '即時リマインド件名') imSubjectTmpl = String(row[1] || '').trim();
      if (k === '即時リマインド本文') imBodyTmpl = String(row[1] || '').trim();
    });
    var subject = imSubjectTmpl
      ? applyReminderTemplate_(imSubjectTmpl, tmplVars)
      : '【民泊】直前予約 - 清掃スタッフ手配が必要です: ' + checkInStr;
    var body = imBodyTmpl
      ? applyReminderTemplate_(imBodyTmpl, tmplVars)
      : '1週間以内にチェックインの予約が新たに追加されました。\n\n'
        + 'チェックイン: ' + checkInStr + '\n'
        + 'チェックアウト: ' + checkOutStr + '\n'
        + 'プラットフォーム: ' + (platformName || '不明') + '\n'
        + '残り日数: ' + daysLeft + '日\n\n'
        + '清掃詳細: ' + detailLink + '\n\n'
        + '早急に清掃スタッフの手配をお願いします。';
    GmailApp.sendEmail(ownerEmail, subject, body);
    addNotification_('即時リマインド', '直前予約（' + checkInStr + '〜' + checkOutStr + '）のリマインドメールを送信しました');
  } catch (e) {
    Logger.log('sendImmediateReminderIfNeeded_: ' + e.toString());
  }
}

/**********************************************
 * 清掃チェックリスト（別アプリ連携）
 * Script Properties に CHECKLIST_APP_URL を設定して使用
 **********************************************/
function getChecklistAppUrl() {
  try {
    var props = PropertiesService.getScriptProperties();
    var url = props.getProperty('CHECKLIST_APP_URL') || '';
    if (!url) {
      return JSON.stringify({ success: false, error: 'CHECKLIST_APP_URL が Script Properties に設定されていません' });
    }
    return JSON.stringify({ success: true, url: url });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * 清掃詳細モーダルに必要なデータをまとめて取得（3回のAPI呼び出しを1回に統合）
 * @param {string} checkoutDate yyyy-MM-dd
 * @param {number} rowNumber フォームシートの行番号
 * @return {string} JSON { success, data: { checklistUrl, laundry, recruitment } }
 */
function getCleaningModalData(checkoutDate, rowNumber) {
  try {
    var result = {};

    // 1. チェックリストURL（Script Propertiesから）
    result.checklistUrl = PropertiesService.getScriptProperties().getProperty('CHECKLIST_APP_URL') || '';

    // 2. クリーニング状況
    try {
      result.laundry = JSON.parse(getCleaningLaundryStatus(checkoutDate));
    } catch (e) {
      result.laundry = { success: false };
    }

    // 3. 募集・回答データ
    try {
      result.recruitment = JSON.parse(getRecruitmentForBooking(rowNumber));
    } catch (e) {
      result.recruitment = { success: false };
    }

    return JSON.stringify({ success: true, data: result });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/* --- 以下、統合型チェックリストのコード（別アプリに移行済み、後方互換のため残置） --- */

/**********************************************
 * [非推奨] 統合型チェックリスト機能（別アプリ版を使用してください）
 **********************************************/

function getOrCreateChecklistSpreadsheet_() {
  var props = PropertiesService.getDocumentProperties();
  var ssId = props.getProperty('CHECKLIST_SS_ID');
  if (ssId) {
    try { return SpreadsheetApp.openById(ssId); } catch (e) { /* deleted or inaccessible */ }
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
  s4.getRange(1, 1, 1, 5).setValues([['チェックアウト日', '撮影箇所ID', 'ファイルID', 'アップロード者', 'タイムスタンプ']]);
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
    else if (name === SHEET_CL_PHOTOS) sheet.getRange(1, 1, 1, 5).setValues([['チェックアウト日', '撮影箇所ID', 'ファイルID', 'アップロード者', 'タイムスタンプ']]);
    else if (name === SHEET_CL_MEMOS) sheet.getRange(1, 1, 1, 4).setValues([['チェックアウト日', 'メモ内容', '記入者', 'タイムスタンプ']]);
    else if (name === SHEET_CL_SUPPLIES) sheet.getRange(1, 1, 1, 5).setValues([['チェックアウト日', '項目ID', '項目名', '記入者', 'タイムスタンプ']]);
  }
  return sheet;
}

// --- チェックリストマスタ CRUD ---

function getChecklistMaster() {
  try {
    var sheet = clSheet_(SHEET_CL_MASTER);
    if (sheet.getLastRow() < 2) return JSON.stringify({ success: true, items: [] });
    var cols = Math.max(sheet.getLastColumn(), 6);
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, cols).getValues();
    var items = rows.map(function(row, i) {
      return { rowIndex: i + 2, id: String(row[0] || ''), category: String(row[1] || ''), name: String(row[2] || ''), sortOrder: parseInt(row[3], 10) || 0, active: String(row[4] || 'Y'), supplyItem: String(row[5] || 'N') };
    }).filter(function(item) { return item.id && item.name; });
    items.sort(function(a, b) { return a.sortOrder - b.sortOrder; });
    return JSON.stringify({ success: true, items: items });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), items: [] });
  }
}

function saveChecklistMasterItem(rowIndex, data) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    var sheet = clSheet_(SHEET_CL_MASTER);
    var lastRow = sheet.getLastRow();
    if (rowIndex && rowIndex >= 2 && rowIndex <= lastRow) {
      var existingId = String(sheet.getRange(rowIndex, 1).getValue() || '');
      sheet.getRange(rowIndex, 1, 1, 6).setValues([[existingId, data.category || '', data.name || '', parseInt(data.sortOrder, 10) || 0, data.active !== 'N' ? 'Y' : 'N', data.supplyItem === 'Y' ? 'Y' : 'N']]);
      return JSON.stringify({ success: true, rowIndex: rowIndex });
    }
    var id = 'CL' + new Date().getTime();
    var nextRow = lastRow + 1;
    sheet.getRange(nextRow, 1, 1, 6).setValues([[id, data.category || '', data.name || '', parseInt(data.sortOrder, 10) || 0, 'Y', data.supplyItem === 'Y' ? 'Y' : 'N']]);
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function deleteChecklistMasterItem(rowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ削除できます。' });
    var sheet = clSheet_(SHEET_CL_MASTER);
    if (rowIndex < 2) return JSON.stringify({ success: false, error: '無効な行' });
    sheet.deleteRow(rowIndex);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

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

// --- 撮影箇所マスタ CRUD ---

function getPhotoSpotMaster() {
  try {
    var sheet = clSheet_(SHEET_CL_PHOTO_SPOTS);
    if (sheet.getLastRow() < 2) return JSON.stringify({ success: true, items: [] });
    var cols = Math.max(sheet.getLastColumn(), 7);
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, cols).getValues();
    var items = rows.map(function(row, i) {
      return { rowIndex: i + 2, id: String(row[0] || ''), name: String(row[1] || ''), timing: String(row[2] || 'チェックアウト直後'), exampleFileId: String(row[3] || ''), sortOrder: parseInt(row[4], 10) || 0, active: String(row[5] || 'Y'), category: String(row[6] || '') };
    }).filter(function(item) { return item.id && item.name; });
    items.sort(function(a, b) { return a.sortOrder - b.sortOrder; });
    return JSON.stringify({ success: true, items: items });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString(), items: [] });
  }
}

function savePhotoSpotMasterItem(rowIndex, data) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    var sheet = clSheet_(SHEET_CL_PHOTO_SPOTS);
    var lastRow = sheet.getLastRow();
    if (rowIndex && rowIndex >= 2 && rowIndex <= lastRow) {
      var existingId = String(sheet.getRange(rowIndex, 1).getValue() || '');
      sheet.getRange(rowIndex, 1, 1, 6).setValues([[existingId, data.name || '', data.timing || 'チェックアウト直後', data.exampleFileId || '', parseInt(data.sortOrder, 10) || 0, data.active !== 'N' ? 'Y' : 'N']]);
      return JSON.stringify({ success: true, rowIndex: rowIndex });
    }
    var id = 'PS' + new Date().getTime();
    var nextRow = lastRow + 1;
    sheet.getRange(nextRow, 1, 1, 6).setValues([[id, data.name || '', data.timing || 'チェックアウト直後', '', parseInt(data.sortOrder, 10) || 0, 'Y']]);
    return JSON.stringify({ success: true, rowIndex: nextRow });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function deletePhotoSpotMasterItem(rowIndex) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ削除できます。' });
    var sheet = clSheet_(SHEET_CL_PHOTO_SPOTS);
    if (rowIndex < 2) return JSON.stringify({ success: false, error: '無効な行' });
    sheet.deleteRow(rowIndex);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// --- 日次チェックリスト取得 ---

function getChecklistForDate(checkoutDate) {
  try {
    var dateKey = normDateStr_(checkoutDate);
    if (!dateKey) return JSON.stringify({ success: false, error: 'チェックアウト日が指定されていません。' });

    var masterRes = JSON.parse(getChecklistMaster());
    var items = masterRes.items || [];
    var spotsRes = JSON.parse(getPhotoSpotMaster());
    var spots = spotsRes.items || [];

    var records = [];
    var recSheet = clSheet_(SHEET_CL_RECORDS);
    if (recSheet.getLastRow() >= 2) {
      var recRows = recSheet.getRange(2, 1, recSheet.getLastRow() - 1, 5).getValues();
      records = recRows.filter(function(r) { return normDateStr_(r[0]) === dateKey; })
        .map(function(r) { return { itemId: String(r[1] || ''), checked: String(r[2] || '') === 'Y', checkedBy: String(r[3] || ''), timestamp: String(r[4] || '') }; });
    }

    var photos = [];
    var photoSheet = clSheet_(SHEET_CL_PHOTOS);
    if (photoSheet.getLastRow() >= 2) {
      var photoRows = photoSheet.getRange(2, 1, photoSheet.getLastRow() - 1, 5).getValues();
      photos = photoRows.filter(function(r) { return normDateStr_(r[0]) === dateKey; })
        .map(function(r) {
          var fid = String(r[2] || '');
          return { spotId: String(r[1] || ''), fileId: fid, thumbnailUrl: fid ? 'https://drive.google.com/thumbnail?id=' + fid + '&sz=w400' : '', uploadedBy: String(r[3] || ''), timestamp: String(r[4] || '') };
        });
    }

    var memos = [];
    var memoSheet = clSheet_(SHEET_CL_MEMOS);
    if (memoSheet.getLastRow() >= 2) {
      var memoRows = memoSheet.getRange(2, 1, memoSheet.getLastRow() - 1, 4).getValues();
      memos = memoRows.filter(function(r) { return normDateStr_(r[0]) === dateKey; })
        .map(function(r) { return { text: String(r[1] || ''), author: String(r[2] || ''), timestamp: String(r[3] || '') }; });
    }

    var activeItems = items.filter(function(i) { return i.active === 'Y'; });
    var checkedCount = 0;
    activeItems.forEach(function(item) { var rec = records.find(function(r) { return r.itemId === item.id; }); if (rec && rec.checked) checkedCount++; });
    var activeSpots = spots.filter(function(s) { return s.active === 'Y'; });
    var photoSpotsDone = 0;
    activeSpots.forEach(function(spot) { if (photos.some(function(p) { return p.spotId === spot.id; })) photoSpotsDone++; });
    var isComplete = activeItems.length > 0 && checkedCount === activeItems.length;

    return JSON.stringify({ success: true, checkoutDate: dateKey, items: items, spots: spots, records: records, photos: photos, memos: memos, checkedCount: checkedCount, totalItems: activeItems.length, photoSpotsDone: photoSpotsDone, totalPhotoSpots: activeSpots.length, isComplete: isComplete });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// --- チェック項目ON/OFF ---

function toggleChecklistItem(checkoutDate, itemId, checked, staffName) {
  try {
    var dateKey = String(checkoutDate || '').trim();
    var iid = String(itemId || '').trim();
    if (!dateKey || !iid) return JSON.stringify({ success: false, error: 'パラメータが不足しています。' });

    var sheet = clSheet_(SHEET_CL_RECORDS);
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');

    if (sheet.getLastRow() >= 2) {
      var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0] || '') === dateKey && String(rows[i][1] || '') === iid) {
          sheet.getRange(i + 2, 3, 1, 3).setValues([[checked ? 'Y' : 'N', String(staffName || ''), now]]);
          return JSON.stringify({ success: true });
        }
      }
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 5).setValues([[dateKey, iid, checked ? 'Y' : 'N', String(staffName || ''), now]]);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// --- 写真アップロード ---

function getOrCreateChecklistPhotoFolder_() {
  var folderId = PropertiesService.getDocumentProperties().getProperty('CHECKLIST_PHOTO_FOLDER_ID');
  if (folderId) { try { return DriveApp.getFolderById(folderId); } catch (e) {} }
  var folder = DriveApp.createFolder('清掃チェックリスト写真');
  PropertiesService.getDocumentProperties().setProperty('CHECKLIST_PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function setChecklistPhotoFolderId(folderId) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ設定できます。' });
    var id = String(folderId || '').trim();
    if (!id) return JSON.stringify({ success: false, error: 'フォルダIDが空です。' });
    // フォルダの存在確認
    try { DriveApp.getFolderById(id); } catch (e) {
      return JSON.stringify({ success: false, error: 'フォルダにアクセスできません。URLまたはIDを確認してください。' });
    }
    PropertiesService.getDocumentProperties().setProperty('CHECKLIST_PHOTO_FOLDER_ID', id);
    return JSON.stringify({ success: true });
  } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
}

function getChecklistPhotoFolderId() {
  try {
    var folderId = PropertiesService.getDocumentProperties().getProperty('CHECKLIST_PHOTO_FOLDER_ID');
    return JSON.stringify({ success: true, folderId: folderId || '' });
  } catch (e) { return JSON.stringify({ success: false, folderId: '', error: e.toString() }); }
}

function uploadChecklistPhoto(checkoutDate, spotId, base64Data, staffName) {
  try {
    var dateKey = String(checkoutDate || '').trim();
    var sid = String(spotId || '').trim();
    if (!dateKey || !sid || !base64Data) return JSON.stringify({ success: false, error: 'パラメータが不足しています。' });

    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, 'image/jpeg', dateKey + '_' + sid + '_' + Date.now() + '.jpg');
    var parentFolder = getOrCreateChecklistPhotoFolder_();
    var dateFolder;
    var dateFolders = parentFolder.getFoldersByName(dateKey);
    if (dateFolders.hasNext()) { dateFolder = dateFolders.next(); } else { dateFolder = parentFolder.createFolder(dateKey); }
    var file = dateFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fileId = file.getId();

    var sheet = clSheet_(SHEET_CL_PHOTOS);
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 5).setValues([[dateKey, sid, fileId, String(staffName || ''), now]]);

    return JSON.stringify({ success: true, fileId: fileId, thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function deleteChecklistPhoto(checkoutDate, spotId, fileId) {
  try {
    var fid = String(fileId || '').trim();
    var dateKey = String(checkoutDate || '').trim();
    if (!dateKey || !fid) return JSON.stringify({ success: false, error: 'パラメータが不足しています。' });
    try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) {}
    var sheet = clSheet_(SHEET_CL_PHOTOS);
    if (sheet.getLastRow() >= 2) {
      var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
      for (var i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i][0] || '') === dateKey && String(rows[i][2] || '') === fid) { sheet.deleteRow(i + 2); break; }
      }
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// --- 撮影例写真アップロード ---

function uploadExamplePhoto(spotRowIndex, base64Data) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ編集できます。' });
    if (!base64Data) return JSON.stringify({ success: false, error: '写真データがありません。' });
    var decoded = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(decoded, 'image/jpeg', 'example_' + Date.now() + '.jpg');
    var parentFolder = getOrCreateChecklistPhotoFolder_();
    var exampleFolder;
    var ef = parentFolder.getFoldersByName('撮影例');
    if (ef.hasNext()) { exampleFolder = ef.next(); } else { exampleFolder = parentFolder.createFolder('撮影例'); }
    var file = exampleFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fileId = file.getId();

    var sheet = clSheet_(SHEET_CL_PHOTO_SPOTS);
    if (spotRowIndex >= 2) {
      var oldFileId = String(sheet.getRange(spotRowIndex, 4).getValue() || '');
      if (oldFileId) { try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (e) {} }
      sheet.getRange(spotRowIndex, 4).setValue(fileId);
    }
    return JSON.stringify({ success: true, fileId: fileId, thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// --- メモ ---

function addChecklistMemo(checkoutDate, text, staffName) {
  try {
    var dateKey = String(checkoutDate || '').trim();
    var memoText = String(text || '').trim();
    if (!dateKey || !memoText) return JSON.stringify({ success: false, error: 'パラメータが不足しています。' });
    var sheet = clSheet_(SHEET_CL_MEMOS);
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 4).setValues([[dateKey, memoText, String(staffName || ''), now]]);
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// --- 清掃完了通知（予約管理スプシの通知シート + メールに送信） ---

function notifyCleaningComplete(checkoutDate) {
  try {
    var dateKey = String(checkoutDate || '').trim();
    if (!dateKey) return JSON.stringify({ success: false, error: 'チェックアウト日が指定されていません。' });

    // 重複送信防止: 同じチェックアウト日の完了通知を本日送信済みならスキップ
    var ccTodayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    var ccPropKey = 'cleanComplete_' + dateKey + '_' + ccTodayStr;
    var ccProps = PropertiesService.getScriptProperties();
    if (ccProps.getProperty(ccPropKey)) return JSON.stringify({ success: true, message: '既に清掃完了通知を送信済みです。' });
    ccProps.setProperty(ccPropKey, '1');

    var clRes = JSON.parse(getChecklistForDate(dateKey));
    if (!clRes.success) return JSON.stringify({ success: false, error: clRes.error });
    if (!clRes.isComplete) return JSON.stringify({ success: false, error: 'まだ未完了の項目があります。' });

    var ownerRes = JSON.parse(getOwnerEmail());
    var ownerEmail = (ownerRes.email || '').trim();

    var fmtDate = dateKey;
    var dm = dateKey.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (dm) fmtDate = dm[1] + '年' + ('0' + dm[2]).slice(-2) + '月' + ('0' + dm[3]).slice(-2) + '日';

    addNotification_('清掃完了', fmtDate + ' の清掃が完了しました（' + clRes.checkedCount + '/' + clRes.totalItems + '項目）');

    if (ownerEmail) {
      var subject = '【民泊】清掃完了: ' + fmtDate;
      var body = fmtDate + ' の清掃が完了しました。\n\n'
        + 'チェックリスト: ' + clRes.checkedCount + '/' + clRes.totalItems + ' 項目完了\n'
        + '写真: ' + clRes.photoSpotsDone + '/' + clRes.totalPhotoSpots + ' 箇所撮影済み\n';
      if (clRes.memos && clRes.memos.length > 0) {
        body += '\n--- 特記事項 ---\n';
        clRes.memos.forEach(function(m) { body += '・' + m.text + '（' + m.author + ' ' + m.timestamp + '）\n'; });
      }
      if (isEmailNotifyEnabled_('清掃完了通知有効')) {
        GmailApp.sendEmail(ownerEmail, subject, body);
      }
    }
    return JSON.stringify({ success: true, message: '清掃完了通知を送信しました。' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * デフォルトチェックリスト項目を一括登録（設定タブから実行可能）
 * 部屋ベース三階層構成
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
 * 次回予約デバッグ用（行番号を変更して実行）
 * 実行: 関数で myFunction を選択 → 実行
 */
function myFunction() {
  Logger.log(getNextReservationDebug(5));
}

/**********************************************
 * クリーニング連絡機能
 * シート「クリーニング連絡」に出し/受取/施設戻しを記録
 **********************************************/

/**
 * クリーニング連絡の現在ステータスを取得
 * @param {string} checkoutDate yyyy-MM-dd
 * @return {string} JSON { success, data: { sentBy, sentAt, receivedBy, receivedAt, returnedBy, returnedAt } }
 */
function getCleaningLaundryStatus(checkoutDate) {
  try {
    ensureSheetsExist();
    var dateKey = normDateStr_(checkoutDate);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_LAUNDRY);
    if (!sheet) return JSON.stringify({ success: true, data: null });
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true, data: null });
    var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    for (var i = 0; i < data.length; i++) {
      if (normDateStr_(data[i][0]) === dateKey) {
        // getValues()がDate型を返す場合があるのでフォーマット
        var fmtDt_ = function(v) {
          if (!v) return '';
          if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
          return String(v);
        };
        return JSON.stringify({ success: true, data: {
          sentBy: String(data[i][1] || ''),
          sentAt: fmtDt_(data[i][2]),
          receivedBy: String(data[i][3] || ''),
          receivedAt: fmtDt_(data[i][4]),
          returnedBy: String(data[i][5] || ''),
          returnedAt: fmtDt_(data[i][6])
        }});
      }
    }
    return JSON.stringify({ success: true, data: null });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * クリーニング連絡のステップを記録
 * @param {string} checkoutDate yyyy-MM-dd
 * @param {string} step 'sent' | 'received' | 'returned'
 * @param {string} staffName スタッフ名
 * @return {string} JSON { success }
 */
function recordCleaningLaundryStep(checkoutDate, step, staffName) {
  try {
    ensureSheetsExist();
    var dateKey = normDateStr_(checkoutDate);
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_LAUNDRY);
    if (!sheet) return JSON.stringify({ success: false, error: 'シートが見つかりません' });

    // その日の担当スタッフを取得（通知data用）
    var assignedStaff = '';
    try {
      var recruitSheet = ss.getSheetByName(SHEET_RECRUIT);
      if (recruitSheet && recruitSheet.getLastRow() >= 2) {
        var rData = recruitSheet.getRange(2, 1, recruitSheet.getLastRow() - 1, 5).getValues();
        for (var ri = 0; ri < rData.length; ri++) {
          if (normDateStr_(rData[ri][0]) === dateKey) { assignedStaff = String(rData[ri][4] || '').trim(); break; }
        }
      }
    } catch (e2) {}

    // 既存行を検索
    var lastRow = sheet.getLastRow();
    var rowIndex = -1;
    if (lastRow >= 2) {
      var dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < dates.length; i++) {
        if (normDateStr_(dates[i][0]) === dateKey) { rowIndex = i + 2; break; }
      }
    }

    // 行がなければ新規作成
    if (rowIndex < 0) {
      rowIndex = lastRow + 1;
      sheet.getRange(rowIndex, 1).setValue(dateKey);
    }

    // ステップに応じて列を更新
    if (step === 'sent') {
      sheet.getRange(rowIndex, 2).setValue(staffName);
      sheet.getRange(rowIndex, 3).setValue(now);
      addNotification_('クリーニング出し', staffName + ' がクリーニングに出しました（' + dateKey + '）', { checkoutDate: dateKey, assignedStaff: assignedStaff, actionBy: staffName });
    } else if (step === 'received') {
      sheet.getRange(rowIndex, 4).setValue(staffName);
      sheet.getRange(rowIndex, 5).setValue(now);
      addNotification_('クリーニング受取', staffName + ' がクリーニングを受け取りました（' + dateKey + '）', { checkoutDate: dateKey, assignedStaff: assignedStaff, actionBy: staffName });
    } else if (step === 'returned') {
      sheet.getRange(rowIndex, 6).setValue(staffName);
      sheet.getRange(rowIndex, 7).setValue(now);
      addNotification_('クリーニング戻し', staffName + ' がクリーニングを施設に戻しました（' + dateKey + '）', { checkoutDate: dateKey, assignedStaff: assignedStaff, actionBy: staffName });
    } else {
      return JSON.stringify({ success: false, error: '不明なステップ: ' + step });
    }

    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * クリーニングステップを個別キャンセル
 * 該当ステップ以降のデータをクリアする（例: sentキャンセル→received,returnedもクリア）
 */
function cancelCleaningLaundryStep(checkoutDate, step) {
  try {
    ensureSheetsExist();
    var dateKey = normDateStr_(checkoutDate);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_LAUNDRY);
    if (!sheet) return JSON.stringify({ success: false, error: 'シートが見つかりません' });
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: false, error: '記録がありません' });
    var dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < dates.length; i++) {
      if (normDateStr_(dates[i][0]) === dateKey) {
        var row = i + 2;
        if (step === 'sent') {
          sheet.getRange(row, 2, 1, 6).clearContent();
        } else if (step === 'received') {
          sheet.getRange(row, 4, 1, 4).clearContent();
        } else if (step === 'returned') {
          sheet.getRange(row, 6, 1, 2).clearContent();
        }
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: '記録がありません' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * クリーニング連絡をリセット（オーナーのみ）
 * @param {string} checkoutDate yyyy-MM-dd
 * @return {string} JSON { success }
 */
function resetCleaningLaundry(checkoutDate) {
  try {
    if (!requireOwner()) return JSON.stringify({ success: false, error: 'オーナーのみ操作できます' });
    ensureSheetsExist();
    var dateKey = normDateStr_(checkoutDate);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_LAUNDRY);
    if (!sheet) return JSON.stringify({ success: true });
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true });
    var dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < dates.length; i++) {
      if (normDateStr_(dates[i][0]) === dateKey) {
        sheet.getRange(i + 2, 2, 1, 6).clearContent();
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}
