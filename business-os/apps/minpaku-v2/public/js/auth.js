/**
 * 認証管理
 */
const Auth = {
  currentUser: null,
  loginModal: null,

  init() {
    this.loginModal = new bootstrap.Modal(document.getElementById("loginModal"));

    // ログインボタン
    document.getElementById("btnLogin").addEventListener("click", () => this.login());
    document.getElementById("loginPassword").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.login();
    });

    // ログアウトボタン
    document.getElementById("btnLogout").addEventListener("click", () => this.logout());

    // 認証状態監視
    firebase.auth().onAuthStateChanged((user) => {
      if (user) {
        this.currentUser = user;
        this.loginModal.hide();
        document.getElementById("userName").textContent = user.email;
        // IDトークンからロール取得
        user.getIdTokenResult().then((result) => {
          this.currentUser.role = result.claims.role || "staff";
          this.updateNavVisibility();
          App.onAuthReady();
        });
      } else {
        this.currentUser = null;
        this.loginModal.show();
      }
    });
  },

  async login() {
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const errorEl = document.getElementById("loginError");
    errorEl.classList.add("d-none");

    if (!email || !password) {
      errorEl.textContent = "メールアドレスとパスワードを入力してください";
      errorEl.classList.remove("d-none");
      return;
    }

    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
    } catch (e) {
      const messages = {
        "auth/user-not-found": "ユーザーが見つかりません",
        "auth/wrong-password": "パスワードが正しくありません",
        "auth/invalid-email": "メールアドレスの形式が正しくありません",
        "auth/too-many-requests": "ログイン試行回数が多すぎます。しばらく待ってください",
      };
      errorEl.textContent = messages[e.code] || `ログインに失敗しました: ${e.message}`;
      errorEl.classList.remove("d-none");
    }
  },

  async logout() {
    await firebase.auth().signOut();
  },

  async getIdToken() {
    if (!this.currentUser) return null;
    return await this.currentUser.getIdToken();
  },

  isOwner() {
    return this.currentUser && this.currentUser.role === "owner";
  },

  updateNavVisibility() {
    const ownerNav = document.getElementById("ownerNav");
    if (!this.isOwner()) {
      // スタッフの場合、オーナー専用メニューを非表示
      ownerNav.querySelectorAll("[data-page]").forEach((el) => {
        const page = el.getAttribute("data-page");
        if (["settings"].includes(page)) {
          el.parentElement.style.display = "none";
        }
      });
    }
  },
};
