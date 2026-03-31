/**
 * Firebase 初期化設定
 * Firebase Console → プロジェクト設定 → マイアプリ から値を取得して設定
 */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// エミュレータ使用時の設定
const USE_EMULATOR = location.hostname === "localhost" || location.hostname === "127.0.0.1";

firebase.initializeApp(firebaseConfig);

if (USE_EMULATOR) {
  firebase.auth().useEmulator("http://localhost:9099");
  firebase.firestore().useEmulator("localhost", 8080);
  console.log("🔧 Firebase Emulator に接続中");
}
