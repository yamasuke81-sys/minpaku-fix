/**
 * 民泊管理v2 — Cloud Functions エントリポイント
 * Express APIをFirebase Functionsとしてエクスポート
 */
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

admin.initializeApp();
const db = admin.firestore();

// Express アプリ
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// 認証ミドルウェア
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "認証が必要です" });
  }
  try {
    const token = authHeader.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "無効なトークンです" });
  }
}

// オーナー権限チェック
function requireOwner(req, res, next) {
  if (req.user.role !== "owner") {
    return res.status(403).json({ error: "オーナー権限が必要です" });
  }
  next();
}

app.use(authenticate);

// ========== スタッフ API ==========
const staffApi = require("./api/staff");
app.use("/staff", staffApi(db));

// ========== 物件 API ==========
const propertiesApi = require("./api/properties");
app.use("/properties", propertiesApi(db));

// ========== シフト API ==========
const shiftsApi = require("./api/shifts");
app.use("/shifts", shiftsApi(db));

// ========== コインランドリー API ==========
const laundryApi = require("./api/laundry");
app.use("/laundry", laundryApi(db));

// ========== 請求書 API ==========
const invoicesApi = require("./api/invoices");
app.use("/invoices", invoicesApi(db));

// ========== チェックリスト API ==========
const checklistApi = require("./api/checklist");
app.use("/checklist", checklistApi(db));

// API エクスポート
exports.api = onRequest({ region: "asia-northeast1" }, app);

// ========== 定期実行ジョブ ==========

// BEDS24同期（5分おき）— BEDS24登録後に有効化
// exports.syncBeds24 = onSchedule({
//   schedule: "every 5 minutes",
//   region: "asia-northeast1",
//   timeZone: "Asia/Tokyo",
// }, require("./scheduled/syncBeds24"));

// シフト自動割当（毎日21:00）
// exports.autoAssignShifts = onSchedule({
//   schedule: "0 21 * * *",
//   region: "asia-northeast1",
//   timeZone: "Asia/Tokyo",
// }, require("./scheduled/autoAssignShifts"));

// 請求書自動生成（毎月末）
// exports.generateInvoices = onSchedule({
//   schedule: "0 0 28-31 * *",
//   region: "asia-northeast1",
//   timeZone: "Asia/Tokyo",
// }, require("./scheduled/generateInvoices"));

// ========== Firestoreトリガー ==========

// 予約変更時→清掃スケジュール自動生成
// exports.onBookingChange = onDocumentWritten(
//   "bookings/{bookingId}",
//   require("./triggers/onBookingChange")
// );
