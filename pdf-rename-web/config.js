/**
 * PDF リネームツール - 設定ファイル
 * スプレッドシートID、フォルダURL、カラム定義等
 */

const CONFIG = {
  // スプレッドシートID
  SPREADSHEET_ID: '17oV_2vPj33aZf7fl8A-NDgS0l4aYvsRrSJBw2JliAy0',

  // データシート名
  SHEET_NAME: 'データ',

  // 設定シート名
  SETTINGS_SHEET: '設定',

  // 学習データシート名
  LEARNING_SHEET: '学習データ',

  // Google OAuth クライアントID（後で差し替え）
  CLIENT_ID: 'YOUR_CLIENT_ID',

  // Google API スコープ
  SCOPES: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
  ].join(' '),

  // API エンドポイント
  DRIVE_API: 'https://www.googleapis.com/drive/v3',
  SHEETS_API: 'https://sheets.googleapis.com/v4/spreadsheets',
  GEMINI_API: 'https://generativelanguage.googleapis.com/v1beta/models',

  // Gemini モデル名
  GEMINI_MODEL: 'gemini-2.0-flash',

  // カラム定義（1始まりインデックス）
  COL: {
    CHECK: 1,        // チェックボックス
    SCAN_NAME: 2,    // スキャンファイル名
    SUMMARY: 3,      // AI要約
    RENAME_TO: 4,    // リネーム先ファイル名
    SCAN_LINK: 5,    // スキャンファイルリンク
    REF_NAME: 6,     // 参照ファイル名
    REF_LINK: 7,     // 参照ファイルリンク
    REF_FOLDER_ID: 8,  // 参照フォルダID
    DEST_FOLDER: 9,    // 移動先フォルダ名
    DEST_FOLDER_ID: 10, // 移動先フォルダID
    DEST_FOLDER2: 11,   // 移動先フォルダ2名
    DEST_FOLDER2_ID: 12, // 移動先フォルダ2 ID
    STATUS: 13,       // ステータス
    SCAN_FILE_ID: 14, // スキャンファイルID
    REF_FILE_ID: 15,  // 参照ファイルID
    FEEDBACK: 16,     // フィードバック
    TAX_SHARE: 17,    // 税理士共有
    DOC_DATE: 18,     // 書類日付
    ENTITY_TYPE: 19,  // エンティティタイプ
    TIMESTAMP: 20,    // タイムスタンプ
  },

  // カラム数
  TOTAL_COLUMNS: 20,

  // ステータス値
  STATUS: {
    PENDING: '承認待ち',
    APPROVED: '承認済み',
    DONE: '実行済み',
    ERROR: 'エラー',
    SKIPPED: 'スキップ',
    UNDONE: '取消済み',
  },

  // フィードバック値
  FEEDBACK: {
    GOOD: '◎',
    OK: '○',
    BAD: '×',
    CORRECTED: '修正',
  },

  // localStorage キー
  LS_KEYS: {
    GEMINI_API_KEY: 'pdfRename_geminiApiKey',
    COLUMN_WIDTHS: 'pdfRename_columnWidths',
    INPUT_FOLDER_ID: 'pdfRename_inputFolderId',
    OUTPUT_FOLDER_ID: 'pdfRename_outputFolderId',
    TAX_FOLDER_ID: 'pdfRename_taxFolderId',
    ACCESS_TOKEN: 'pdfRename_accessToken',
    TOKEN_EXPIRY: 'pdfRename_tokenExpiry',
  },

  // デフォルトカラム幅（px）
  DEFAULT_COLUMN_WIDTHS: {
    check: 40,
    scanName: 200,
    summary: 250,
    renameTo: 220,
    refName: 180,
    destFolder: 150,
    destFolder2: 150,
    status: 80,
    feedback: 60,
    taxShare: 60,
    docDate: 90,
    entityType: 80,
  },
};

// Object.freeze で変更防止
Object.freeze(CONFIG.COL);
Object.freeze(CONFIG.STATUS);
Object.freeze(CONFIG.FEEDBACK);
Object.freeze(CONFIG.LS_KEYS);
