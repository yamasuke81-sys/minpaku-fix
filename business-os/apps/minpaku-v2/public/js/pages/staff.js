/**
 * スタッフ管理ページ
 * 一覧・登録・編集・無効化
 */
const StaffPage = {
  staffList: [],
  modal: null,

  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h2><i class="bi bi-people"></i> スタッフ管理</h2>
        <div>
          <button class="btn btn-outline-secondary me-2" id="btnToggleInactive">
            <i class="bi bi-eye"></i> 無効スタッフ表示
          </button>
          <button class="btn btn-primary" id="btnAddStaff">
            <i class="bi bi-plus-lg"></i> スタッフ登録
          </button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-hover align-middle">
          <thead class="table-light">
            <tr>
              <th>名前</th>
              <th class="d-none d-md-table-cell">メール</th>
              <th class="d-none d-md-table-cell">電話</th>
              <th>稼働曜日</th>
              <th class="text-end">報酬単価</th>
              <th>ステータス</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="staffTableBody">
            <tr><td colspan="7" class="text-center py-4">読み込み中...</td></tr>
          </tbody>
        </table>
      </div>
    `;

    this.modal = new bootstrap.Modal(document.getElementById("staffModal"));
    this.bindEvents();
    await this.loadStaff(true);
  },

  bindEvents() {
    // 新規登録ボタン
    document.getElementById("btnAddStaff").addEventListener("click", () => {
      this.openModal();
    });

    // 無効スタッフ表示切替
    let showInactive = false;
    document.getElementById("btnToggleInactive").addEventListener("click", (e) => {
      showInactive = !showInactive;
      e.currentTarget.innerHTML = showInactive
        ? '<i class="bi bi-eye-slash"></i> 無効スタッフ非表示'
        : '<i class="bi bi-eye"></i> 無効スタッフ表示';
      this.loadStaff(!showInactive);
    });

    // 保存ボタン
    document.getElementById("btnSaveStaff").addEventListener("click", () => {
      this.saveStaff();
    });
  },

  async loadStaff(activeOnly) {
    try {
      this.staffList = await API.staff.list(activeOnly);
      this.renderTable();
    } catch (e) {
      showToast("エラー", `スタッフ読み込み失敗: ${e.message}`, "error");
    }
  },

  renderTable() {
    const tbody = document.getElementById("staffTableBody");
    if (!this.staffList.length) {
      tbody.innerHTML = `
        <tr><td colspan="7">
          <div class="empty-state">
            <i class="bi bi-people"></i>
            <p>スタッフが登録されていません</p>
          </div>
        </td></tr>
      `;
      return;
    }

    tbody.innerHTML = this.staffList.map((s) => `
      <tr data-id="${s.id}">
        <td>
          <strong>${this.escapeHtml(s.name)}</strong>
          ${s.skills && s.skills.length ? `<br><small class="text-muted">${s.skills.join(", ")}</small>` : ""}
        </td>
        <td class="d-none d-md-table-cell">${this.escapeHtml(s.email || "-")}</td>
        <td class="d-none d-md-table-cell">${this.escapeHtml(s.phone || "-")}</td>
        <td>${this.renderDayChips(s.availableDays || [])}</td>
        <td class="text-end">${formatCurrency(s.ratePerJob)}</td>
        <td>
          <span class="badge ${s.active ? "bg-success" : "bg-secondary"} staff-status-badge">
            ${s.active ? "有効" : "無効"}
          </span>
        </td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary btn-edit" title="編集">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-outline-danger btn-delete" title="無効化">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join("");

    // 行クリックイベント
    tbody.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.currentTarget.closest("tr").dataset.id;
        const staff = this.staffList.find((s) => s.id === id);
        if (staff) this.openModal(staff);
      });
    });

    tbody.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.currentTarget.closest("tr").dataset.id;
        const staff = this.staffList.find((s) => s.id === id);
        if (staff) this.deleteStaff(staff);
      });
    });
  },

  renderDayChips(days) {
    const allDays = ["月", "火", "水", "木", "金", "土", "日"];
    return allDays.map((d) =>
      `<span class="day-chip ${days.includes(d) ? "active" : ""}">${d}</span>`
    ).join("");
  },

  openModal(staff = null) {
    const isEdit = !!staff;
    document.getElementById("staffModalTitle").textContent = isEdit ? "スタッフ編集" : "スタッフ登録";
    document.getElementById("staffEditId").value = isEdit ? staff.id : "";

    // フォームリセット
    document.getElementById("staffName").value = staff?.name || "";
    document.getElementById("staffEmail").value = staff?.email || "";
    document.getElementById("staffPhone").value = staff?.phone || "";
    document.getElementById("staffRate").value = staff?.ratePerJob || 0;
    document.getElementById("staffTransport").value = staff?.transportationFee || 0;
    document.getElementById("staffContractDate").value = staff?.contractStartDate
      ? new Date(staff.contractStartDate.seconds ? staff.contractStartDate.seconds * 1000 : staff.contractStartDate).toISOString().split("T")[0]
      : "";
    document.getElementById("staffSkills").value = (staff?.skills || []).join(",");
    document.getElementById("staffBankName").value = staff?.bankName || "";
    document.getElementById("staffBranchName").value = staff?.branchName || "";
    document.getElementById("staffAccountType").value = staff?.accountType || "普通";
    document.getElementById("staffAccountNumber").value = staff?.accountNumber || "";
    document.getElementById("staffAccountHolder").value = staff?.accountHolder || "";
    document.getElementById("staffMemo").value = staff?.memo || "";

    // 曜日チェックボックス
    const days = staff?.availableDays || [];
    document.querySelectorAll("#staffDays input[type=checkbox]").forEach((cb) => {
      cb.checked = days.includes(cb.value);
    });

    this.modal.show();
  },

  async saveStaff() {
    const id = document.getElementById("staffEditId").value;
    const name = document.getElementById("staffName").value.trim();

    if (!name) {
      showToast("入力エラー", "名前は必須です", "error");
      return;
    }

    const availableDays = [];
    document.querySelectorAll("#staffDays input[type=checkbox]:checked").forEach((cb) => {
      availableDays.push(cb.value);
    });

    const skills = document.getElementById("staffSkills").value
      .split(",").map((s) => s.trim()).filter(Boolean);

    const data = {
      name,
      email: document.getElementById("staffEmail").value.trim(),
      phone: document.getElementById("staffPhone").value.trim(),
      ratePerJob: Number(document.getElementById("staffRate").value) || 0,
      transportationFee: Number(document.getElementById("staffTransport").value) || 0,
      contractStartDate: document.getElementById("staffContractDate").value || null,
      availableDays,
      skills,
      bankName: document.getElementById("staffBankName").value.trim(),
      branchName: document.getElementById("staffBranchName").value.trim(),
      accountType: document.getElementById("staffAccountType").value,
      accountNumber: document.getElementById("staffAccountNumber").value.trim(),
      accountHolder: document.getElementById("staffAccountHolder").value.trim(),
      memo: document.getElementById("staffMemo").value.trim(),
    };

    try {
      if (id) {
        await API.staff.update(id, data);
        showToast("完了", "スタッフ情報を更新しました", "success");
      } else {
        await API.staff.create(data);
        showToast("完了", "スタッフを登録しました", "success");
      }
      this.modal.hide();
      await this.loadStaff(true);
    } catch (e) {
      showToast("エラー", `保存に失敗しました: ${e.message}`, "error");
    }
  },

  async deleteStaff(staff) {
    if (!confirm(`${staff.name} を無効化しますか？`)) return;

    try {
      await API.staff.delete(staff.id);
      showToast("完了", `${staff.name} を無効化しました`, "success");
      await this.loadStaff(true);
    } catch (e) {
      showToast("エラー", `無効化に失敗しました: ${e.message}`, "error");
    }
  },

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  },
};
