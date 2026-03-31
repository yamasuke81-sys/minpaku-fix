/**
 * 設定ページ（データ移行機能付き）
 */
const SettingsPage = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h2><i class="bi bi-gear"></i> 設定</h2>
      </div>

      <!-- データ移行セクション -->
      <div class="card mb-4">
        <div class="card-header bg-warning text-dark">
          <h5 class="mb-0"><i class="bi bi-arrow-repeat"></i> データ移行（旧アプリ→新アプリ）</h5>
        </div>
        <div class="card-body">
          <p class="text-muted">
            旧アプリ（GAS版）のスプレッドシートからデータを移行します。<br>
            <strong>手順:</strong>
          </p>
          <ol class="text-muted">
            <li>旧アプリのGASエディタで <code>exportDataForMigration()</code> を実行</li>
            <li>ログに出力されたJSONをコピー</li>
            <li>下のテキストエリアに貼り付け</li>
            <li>「インポート実行」をクリック</li>
          </ol>

          <div class="mb-3">
            <label class="form-label fw-bold">JSONデータを貼り付け</label>
            <textarea class="form-control font-monospace" id="migrationJson" rows="8"
              placeholder='{"staff": [...], "bookings": [...] }'></textarea>
          </div>

          <div class="form-check mb-3">
            <input class="form-check-input" type="checkbox" id="migrationConfirm">
            <label class="form-check-label" for="migrationConfirm">
              既存データを上書きしてインポートすることを確認しました
            </label>
          </div>

          <button class="btn btn-warning" id="btnMigrate" disabled>
            <i class="bi bi-upload"></i> インポート実行
          </button>

          <div class="mt-3 d-none" id="migrationResult">
            <div class="alert" id="migrationAlert"></div>
          </div>

          <hr>

          <!-- スプレッドシートから直接入力（JSON不要の簡易版） -->
          <h6><i class="bi bi-lightning"></i> 簡易入力（スプレッドシートからコピペ）</h6>
          <p class="text-muted small">
            スプレッドシートのスタッフデータをタブ区切りでコピーして貼り付けてください。<br>
            列順: 名前, 住所, メール, 銀行名, 支店名, 口座種別, 口座番号, 口座名義, 有効(Y/N)
          </p>
          <textarea class="form-control font-monospace mb-2" id="tsvStaffData" rows="5"
            placeholder="田中太郎&#9;東京都...&#9;tanaka@example.com&#9;三菱UFJ&#9;渋谷支店&#9;普通&#9;1234567&#9;タナカタロウ&#9;Y"></textarea>
          <button class="btn btn-outline-primary" id="btnImportTsv">
            <i class="bi bi-table"></i> スタッフをインポート
          </button>

          <div class="mt-3 d-none" id="tsvResult">
            <div class="alert" id="tsvAlert"></div>
          </div>
        </div>
      </div>

      <!-- BEDS24設定（将来用） -->
      <div class="card mb-4">
        <div class="card-header">
          <h5 class="mb-0"><i class="bi bi-link-45deg"></i> BEDS24連携</h5>
        </div>
        <div class="card-body">
          <p class="text-muted">BEDS24のアカウント登録後に設定します。</p>
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label">API Token</label>
              <input type="password" class="form-control" id="beds24Token" placeholder="BEDS24管理画面から取得" disabled>
            </div>
            <div class="col-md-6">
              <label class="form-label">同期間隔（分）</label>
              <input type="number" class="form-control" id="beds24Interval" value="5" disabled>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  },

  bindEvents() {
    // チェックボックスで移行ボタン有効化
    document.getElementById("migrationConfirm").addEventListener("change", (e) => {
      document.getElementById("btnMigrate").disabled = !e.target.checked;
    });

    // JSONインポート
    document.getElementById("btnMigrate").addEventListener("click", () => this.importJson());

    // TSVインポート
    document.getElementById("btnImportTsv").addEventListener("click", () => this.importTsv());
  },

  async importJson() {
    const resultEl = document.getElementById("migrationResult");
    const alertEl = document.getElementById("migrationAlert");
    resultEl.classList.remove("d-none");
    alertEl.className = "alert alert-info";
    alertEl.textContent = "インポート中...";

    try {
      const json = document.getElementById("migrationJson").value.trim();
      if (!json) {
        alertEl.className = "alert alert-danger";
        alertEl.textContent = "JSONデータを貼り付けてください";
        return;
      }

      const data = JSON.parse(json);
      const ts = firebase.firestore.FieldValue.serverTimestamp();
      const counts = {};

      // ===== 1. スタッフ =====
      if (data.staff && data.staff.length > 0) {
        counts.staff = 0;
        for (const s of data.staff) {
          if (!s.name) continue;
          await db.collection("staff").add({
            name: s.name || "",
            email: s.email || "",
            phone: "",
            skills: [],
            availableDays: [],
            ratePerJob: 0,
            transportationFee: 0,
            bankName: s.bankName || "",
            branchName: s.branchName || s.bankBranch || "",
            accountType: s.accountType || "普通",
            accountNumber: s.accountNumber || "",
            accountHolder: s.accountHolder || "",
            memo: s.address || "",
            active: s.active === "N" ? false : s.active !== false,
            displayOrder: counts.staff,
            createdAt: ts, updatedAt: ts,
          });
          counts.staff++;
        }
      }

      // ===== 2. 予約 =====
      if (data.bookings && data.bookings.length > 0) {
        counts.bookings = 0;
        for (const b of data.bookings) {
          // 動的ヘッダーの場合のフィールドマッピング
          const checkIn = b.checkIn || b['チェックイン'] || null;
          const checkOut = b.checkOut || b['チェックアウト'] || null;
          if (!checkIn && !checkOut) continue;
          await db.collection("bookings").add({
            propertyId: "",
            beds24BookingId: "",
            guestName: b.guestName || b['氏名'] || b['お名前'] || "",
            guestCount: Number(b.guestCount || b['宿泊人数'] || b['人数']) || 0,
            checkIn: checkIn ? new Date(checkIn) : null,
            checkOut: checkOut ? new Date(checkOut) : null,
            source: "migrated",
            status: "completed",
            bbq: !!(b.bbq || String(b['BBQ'] || '').indexOf('あり') >= 0),
            parking: !!(b.parking || String(b['駐車場'] || '').indexOf('あり') >= 0),
            notes: b.notes || b['メモ'] || "",
            cleaningStaff: b.cleaningStaff || b['清掃担当'] || "",
            nationality: b['国籍'] || "",
            syncedAt: null,
            createdAt: ts,
          });
          counts.bookings++;
        }
      }

      // ===== 3. 募集 =====
      if (data.recruitments && data.recruitments.length > 0) {
        counts.recruitments = 0;
        for (const r of data.recruitments) {
          if (!r.checkOutDate && !r.status) continue;
          await db.collection("recruitments").add({
            checkOutDate: r.checkOutDate ? new Date(r.checkOutDate) : null,
            bookingRowNum: Number(r.bookingRowNum) || 0,
            notifyDate: r.notifyDate ? new Date(r.notifyDate) : null,
            status: String(r.status || ""),
            selectedStaff: String(r.selectedStaff || ""),
            reminderLastDate: r.reminderLastDate ? new Date(r.reminderLastDate) : null,
            createdDate: r.createdDate ? new Date(r.createdDate) : null,
            notifyMethod: String(r.notifyMethod || ""),
            memo: String(r.memo || ""),
            source: "migrated",
            createdAt: ts,
          });
          counts.recruitments++;
        }
      }

      // ===== 4. 立候補 =====
      if (data.volunteers && data.volunteers.length > 0) {
        counts.volunteers = 0;
        for (const v of data.volunteers) {
          if (!v.recruitId && !v.staffName) continue;
          await db.collection("volunteers").add({
            recruitId: String(v.recruitId || ""),
            staffName: String(v.staffName || ""),
            email: String(v.email || ""),
            volunteerDate: v.volunteerDate ? new Date(v.volunteerDate) : null,
            availability: String(v.availability || ""),
            status: String(v.status || ""),
            holdReason: String(v.holdReason || ""),
            source: "migrated",
            createdAt: ts,
          });
          counts.volunteers++;
        }
      }

      // ===== 5. スタッフ報酬 =====
      if (data.rewards && data.rewards.length > 0) {
        counts.rewards = 0;
        for (const r of data.rewards) {
          if (!r.staffName && !r.amount) continue;
          await db.collection("rewards").add({
            staffName: String(r.staffName || ""),
            jobType: String(r.jobType || ""),
            amount: Number(r.amount) || 0,
            memo: String(r.memo || ""),
            source: "migrated",
            createdAt: ts,
          });
          counts.rewards++;
        }
      }

      // ===== 6. 仕事内容マスタ =====
      if (data.jobTypes && data.jobTypes.length > 0) {
        counts.jobTypes = 0;
        for (const j of data.jobTypes) {
          if (!j.jobName) continue;
          await db.collection("jobTypes").add({
            jobName: String(j.jobName || ""),
            displayOrder: Number(j.displayOrder) || 0,
            active: j.active === "N" ? false : j.active !== false,
            createdAt: ts,
          });
          counts.jobTypes++;
        }
      }

      // ===== 7. 特別料金 =====
      if (data.specialRates && data.specialRates.length > 0) {
        counts.specialRates = 0;
        for (const s of data.specialRates) {
          if (!s.jobName && !s.itemName) continue;
          await db.collection("specialRates").add({
            jobName: String(s.jobName || ""),
            startDate: s.startDate ? new Date(s.startDate) : null,
            endDate: s.endDate ? new Date(s.endDate) : null,
            itemName: String(s.itemName || ""),
            additionalAmount: Number(s.additionalAmount) || 0,
            createdAt: ts,
          });
          counts.specialRates++;
        }
      }

      // ===== 8. 設定系 =====
      if (data.recruitSettings && Object.keys(data.recruitSettings).length > 0) {
        await db.collection("settings").doc("recruit").set({
          ...data.recruitSettings, migratedAt: ts,
        });
        counts.recruitSettings = Object.keys(data.recruitSettings).length;
      }
      if (data.ownerSettings && Object.keys(data.ownerSettings).length > 0) {
        await db.collection("settings").doc("owner").set({
          ...data.ownerSettings, migratedAt: ts,
        });
        counts.ownerSettings = Object.keys(data.ownerSettings).length;
      }

      // ===== 9. 連携設定 =====
      if (data.syncSettings && data.syncSettings.length > 0) {
        counts.syncSettings = 0;
        for (const s of data.syncSettings) {
          if (!s.platform) continue;
          await db.collection("syncSettings").add({
            platform: String(s.platform || ""),
            icalUrl: String(s.icalUrl || ""),
            active: s.active === "N" ? false : s.active !== false,
            lastSync: s.lastSync || null,
            createdAt: ts,
          });
          counts.syncSettings++;
        }
      }

      // ===== 10. 通知履歴 =====
      if (data.notifications && data.notifications.length > 0) {
        counts.notifications = 0;
        for (const n of data.notifications) {
          if (!n.datetime && !n.content) continue;
          await db.collection("notifications").add({
            datetime: n.datetime ? new Date(n.datetime) : null,
            type: String(n.type || ""),
            content: String(n.content || ""),
            read: !!n.read,
            source: "migrated",
            createdAt: ts,
          });
          counts.notifications++;
        }
      }

      // ===== 11. キャンセル申請 =====
      if (data.cancelRequests && data.cancelRequests.length > 0) {
        counts.cancelRequests = 0;
        for (const c of data.cancelRequests) {
          if (!c.recruitId && !c.staffName) continue;
          await db.collection("cancelRequests").add({
            recruitId: String(c.recruitId || ""),
            staffName: String(c.staffName || ""),
            email: String(c.email || ""),
            requestDate: c.requestDate ? new Date(c.requestDate) : null,
            source: "migrated",
            createdAt: ts,
          });
          counts.cancelRequests++;
        }
      }

      // ===== 12. チェックリスト関連 =====
      const checklistCollections = [
        { key: "checklistMaster", collection: "checklistTemplates_migrated" },
        { key: "photoSpots", collection: "photoSpots" },
        { key: "checklistRecords", collection: "checklistRecords_migrated" },
        { key: "checklistPhotos", collection: "checklistPhotos_migrated" },
        { key: "supplyRecords", collection: "supplyRecords" },
        { key: "staffShare", collection: "staffShare" },
        { key: "bedCounts", collection: "bedCounts" },
      ];
      for (const { key, collection } of checklistCollections) {
        if (data[key] && data[key].length > 0) {
          counts[key] = 0;
          for (const item of data[key]) {
            await db.collection(collection).add({ ...item, source: "migrated", createdAt: ts });
            counts[key]++;
          }
        }
      }

      // 結果表示
      const lines = Object.entries(counts)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}: ${v}件`);

      alertEl.className = "alert alert-success";
      alertEl.innerHTML = `<strong>インポート完了!</strong><br>${lines.join("<br>")}`;
      showToast("完了", `全${lines.length}カテゴリのデータをインポートしました`, "success");
    } catch (e) {
      alertEl.className = "alert alert-danger";
      alertEl.textContent = `エラー: ${e.message}`;
      console.error("Migration error:", e);
    }
  },

  async importTsv() {
    const resultEl = document.getElementById("tsvResult");
    const alertEl = document.getElementById("tsvAlert");
    resultEl.classList.remove("d-none");

    try {
      const tsv = document.getElementById("tsvStaffData").value.trim();
      if (!tsv) {
        alertEl.className = "alert alert-danger";
        alertEl.textContent = "データを貼り付けてください";
        return;
      }

      const lines = tsv.split("\n").filter(l => l.trim());
      let count = 0;

      for (const line of lines) {
        const cols = line.split("\t");
        const name = (cols[0] || "").trim();
        if (!name) continue;

        await API.staff.create({
          name: name,
          email: (cols[2] || "").trim(),
          phone: "",
          skills: [],
          availableDays: [],
          ratePerJob: 0,
          transportationFee: 0,
          bankName: (cols[3] || "").trim(),
          branchName: (cols[4] || "").trim(),
          accountType: (cols[5] || "普通").trim(),
          accountNumber: (cols[6] || "").trim(),
          accountHolder: (cols[7] || "").trim(),
          memo: (cols[1] || "").trim(), // 住所をメモに
          active: (cols[8] || "Y").trim() !== "N",
          displayOrder: count,
        });
        count++;
      }

      alertEl.className = "alert alert-success";
      alertEl.textContent = `${count}件のスタッフをインポートしました`;

      // スタッフ一覧にデータが反映されたか表示
      showToast("完了", `${count}件のスタッフをインポートしました`, "success");
    } catch (e) {
      alertEl.className = "alert alert-danger";
      alertEl.textContent = `エラー: ${e.message}`;
    }
  },
};
