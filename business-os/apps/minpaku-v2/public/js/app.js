/**
 * メインアプリ — SPAルーター + 初期化
 */
const App = {
  currentPage: null,

  // ページ定義
  pages: {
    dashboard: DashboardPage,
    staff: StaffPage,
    properties: PropertiesPage,
    recruitment: RecruitmentPage,
    settings: SettingsPage,
    // shifts: ShiftsPage,       // 次フェーズで実装
    // invoices: InvoicesPage,   // 次フェーズで実装
  },

  init() {
    Auth.init();
    window.addEventListener("hashchange", () => this.route());
  },

  // 認証完了後に呼ばれる
  onAuthReady() {
    this.route();
  },

  // ルーティング
  route() {
    if (!Auth.currentUser) return;

    const hash = location.hash.replace("#", "") || "/";
    const path = hash.split("/").filter(Boolean);
    const pageName = path[0] || "dashboard";

    // ナビのアクティブ状態更新
    document.querySelectorAll("#ownerNav .nav-link").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-page") === pageName);
    });

    const page = this.pages[pageName];
    if (page) {
      this.currentPage = pageName;
      page.render(document.getElementById("pageContainer"), path.slice(1));
    } else {
      document.getElementById("pageContainer").innerHTML = `
        <div class="empty-state">
          <i class="bi bi-tools"></i>
          <p>このページは準備中です</p>
          <a href="#/" class="btn btn-primary">ダッシュボードに戻る</a>
        </div>
      `;
    }
  },
};

// トースト通知ユーティリティ
function showToast(title, message, type = "info") {
  const toast = document.getElementById("appToast");
  const header = toast.querySelector(".toast-header");
  header.className = `toast-header ${type === "error" ? "bg-danger text-white" : type === "success" ? "bg-success text-white" : ""}`;
  document.getElementById("toastTitle").textContent = title;
  document.getElementById("toastBody").textContent = message;
  bootstrap.Toast.getOrCreateInstance(toast).show();
}

// 日付フォーマット
function formatDate(date) {
  if (!date) return "-";
  const d = date.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString("ja-JP");
}

// 金額フォーマット
function formatCurrency(amount) {
  return `¥${(amount || 0).toLocaleString()}`;
}

// アプリ開始
document.addEventListener("DOMContentLoaded", () => App.init());
