/**
 * 認証管理
 * テストモード: ログインなしで全機能使える
 * 本番モード: Firebase Authenticationで認証
 */
const Auth = {
  currentUser: null,
  loginModal: null,
  testMode: true, // テストモード（Firestoreルールが allow: true の間）

  init() {
    this.loginModal = new bootstrap.Modal(document.getElementById("loginModal"));

    if (this.testMode) {
      // テストモード: ログインスキップ
      this.currentUser = { email: "owner@test.com", role: "owner", uid: "test-owner" };
      document.getElementById("userName").textContent = "オーナー（テスト）";
      App.onAuthReady();
      return;
    }

    // 本番モード: Firebase Auth
    document.getElementById("btnLogin").addEventListener("click", () => this.login());
    document.getElementById("loginPassword").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.login();
    });
    document.getElementById("btnLogout").addEventListener("click", () => this.logout());

    firebase.auth().onAuthStateChanged((user) => {
      if (user) {
        this.currentUser = user;
        this.loginModal.hide();
        document.getElementById("userName").textContent = user.email;
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
        "auth/too-many-requests": "ログイン試行回数が多すぎます",
      };
      errorEl.textContent = messages[e.code] || `ログイン失敗: ${e.message}`;
      errorEl.classList.remove("d-none");
    }
  },

  async logout() {
    if (this.testMode) {
      this.currentUser = null;
      location.reload();
      return;
    }
    await firebase.auth().signOut();
  },

  isOwner() {
    return this.currentUser && this.currentUser.role === "owner";
  },

  updateNavVisibility() {
    // テストモードでは全メニュー表示
  },
};
