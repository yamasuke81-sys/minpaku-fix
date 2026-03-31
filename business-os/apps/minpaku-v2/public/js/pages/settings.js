/**
 * 設定ページ（全GASアプリからの一括データ移行機能付き）
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
          <h5 class="mb-0"><i class="bi bi-arrow-repeat"></i> データ移行（全GASアプリ → 新アプリ）</h5>
        </div>
        <div class="card-body">
          <p class="text-muted">
            各GASアプリのスプレッドシートからデータを一括インポートします。
          </p>

          <div class="alert alert-info">
            <strong>手順:</strong>
            <ol class="mb-0">
              <li>各GASプロジェクトのエディタを開く</li>
              <li>新規スクリプト「migration」を作成、<strong>汎用エクスポートスクリプト</strong>を貼り付け</li>
              <li><code>exportAll</code> を実行 → ログのJSONをコピー</li>
              <li>下の対応アプリ欄に貼り付け → 「一括インポート」</li>
            </ol>
          </div>

          <!-- 各アプリのJSON入力欄 -->
          <div class="accordion mb-3" id="migrationAccordion">
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#app1">
                  <i class="bi bi-house-door me-2"></i> 民泊メイン
                  <span class="badge bg-secondary ms-2" id="badge-main">未入力</span>
                </button>
              </h2>
              <div id="app1" class="accordion-collapse collapse show" data-bs-parent="#migrationAccordion">
                <div class="accordion-body">
                  <small class="text-muted">予約、スタッフ、募集、報酬、設定データ</small>
                  <textarea class="form-control font-monospace mt-2" id="jsonMain" rows="4" placeholder="民泊メインのJSON"></textarea>
                </div>
              </div>
            </div>
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#app2">
                  <i class="bi bi-check2-square me-2"></i> 清掃チェックリスト
                  <span class="badge bg-secondary ms-2" id="badge-checklist">未入力</span>
                </button>
              </h2>
              <div id="app2" class="accordion-collapse collapse" data-bs-parent="#migrationAccordion">
                <div class="accordion-body">
                  <small class="text-muted">チェックリストマスタ、記録、写真、補充記録</small>
                  <textarea class="form-control font-monospace mt-2" id="jsonChecklist" rows="4" placeholder="チェックリストのJSON"></textarea>
                </div>
              </div>
            </div>
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#app3">
                  <i class="bi bi-door-open me-2"></i> チェックイン
                  <span class="badge bg-secondary ms-2" id="badge-checkin">未入力</span>
                </button>
              </h2>
              <div id="app3" class="accordion-collapse collapse" data-bs-parent="#migrationAccordion">
                <div class="accordion-body">
                  <small class="text-muted">チェックイン情報、ゲスト案内データ</small>
                  <textarea class="form-control font-monospace mt-2" id="jsonCheckin" rows="4" placeholder="チェックインのJSON"></textarea>
                </div>
              </div>
            </div>
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#app4">
                  <i class="bi bi-bell me-2"></i> アラーム
                  <span class="badge bg-secondary ms-2" id="badge-alarm">未入力</span>
                </button>
              </h2>
              <div id="app4" class="accordion-collapse collapse" data-bs-parent="#migrationAccordion">
                <div class="accordion-body">
                  <small class="text-muted">アラーム設定、通知履歴</small>
                  <textarea class="form-control font-monospace mt-2" id="jsonAlarm" rows="4" placeholder="アラームのJSON"></textarea>
                </div>
              </div>
            </div>
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#app5">
                  <i class="bi bi-file-earmark-pdf me-2"></i> PDFリネーム
                  <span class="badge bg-secondary ms-2" id="badge-pdf">未入力</span>
                </button>
              </h2>
              <div id="app5" class="accordion-collapse collapse" data-bs-parent="#migrationAccordion">
                <div class="accordion-body">
                  <small class="text-muted">リネームルール、処理履歴</small>
                  <textarea class="form-control font-monospace mt-2" id="jsonPdf" rows="4" placeholder="PDFリネームのJSON"></textarea>
                </div>
              </div>
            </div>
          </div>

          <div class="form-check mb-3">
            <input class="form-check-input" type="checkbox" id="migrationConfirm">
            <label class="form-check-label" for="migrationConfirm">
              インポートすることを確認しました（既存データがあっても追加されます）
            </label>
          </div>

          <button class="btn btn-warning btn-lg w-100" id="btnMigrate" disabled>
            <i class="bi bi-upload"></i> 一括インポート実行
          </button>

          <div class="mt-3 d-none" id="migrationResult">
            <div class="alert" id="migrationAlert"></div>
          </div>

          <hr>

          <!-- 簡易入力 -->
          <h6><i class="bi bi-lightning"></i> 簡易入力（スプレッドシートからコピペ）</h6>
          <p class="text-muted small">
            スタッフデータをタブ区切りでコピペ。列順: 名前, 住所, メール, 銀行名, 支店名, 口座種別, 口座番号, 口座名義, 有効(Y/N)
          </p>
          <textarea class="form-control font-monospace mb-2" id="tsvStaffData" rows="4"
            placeholder="田中太郎&#9;東京都...&#9;tanaka@example.com&#9;三菱UFJ&#9;渋谷支店&#9;普通&#9;1234567&#9;タナカタロウ&#9;Y"></textarea>
          <button class="btn btn-outline-primary" id="btnImportTsv">
            <i class="bi bi-table"></i> スタッフをインポート
          </button>
          <div class="mt-3 d-none" id="tsvResult"><div class="alert" id="tsvAlert"></div></div>
        </div>
      </div>

      <!-- BEDS24設定 -->
      <div class="card mb-4">
        <div class="card-header">
          <h5 class="mb-0"><i class="bi bi-link-45deg"></i> BEDS24連携</h5>
        </div>
        <div class="card-body">
          <p class="text-muted">BEDS24のアカウント登録後に設定します。</p>
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label">API Token</label>
              <input type="password" class="form-control" placeholder="BEDS24管理画面から取得" disabled>
            </div>
            <div class="col-md-6">
              <label class="form-label">同期間隔（分）</label>
              <input type="number" class="form-control" value="5" disabled>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  },

  appFields: [
    { id: "jsonMain", badge: "badge-main", label: "民泊メイン" },
    { id: "jsonChecklist", badge: "badge-checklist", label: "チェックリスト" },
    { id: "jsonCheckin", badge: "badge-checkin", label: "チェックイン" },
    { id: "jsonAlarm", badge: "badge-alarm", label: "アラーム" },
    { id: "jsonPdf", badge: "badge-pdf", label: "PDFリネーム" },
  ],

  bindEvents() {
    // 各テキストエリアの入力検知→バッジ更新
    for (const field of this.appFields) {
      const el = document.getElementById(field.id);
      const badge = document.getElementById(field.badge);
      if (el && badge) {
        el.addEventListener("input", () => {
          const val = el.value.trim();
          if (val) {
            try {
              const data = JSON.parse(val);
              const sheetCount = data.sheets ? Object.keys(data.sheets).length : 0;
              badge.className = "badge bg-success ms-2";
              badge.textContent = `${data.appName || "不明"} (${sheetCount}シート)`;
            } catch {
              badge.className = "badge bg-danger ms-2";
              badge.textContent = "JSON不正";
            }
          } else {
            badge.className = "badge bg-secondary ms-2";
            badge.textContent = "未入力";
          }
        });
      }
    }

    // チェックボックスで移行ボタン有効化
    document.getElementById("migrationConfirm").addEventListener("change", (e) => {
      document.getElementById("btnMigrate").disabled = !e.target.checked;
    });

    // 一括インポート
    document.getElementById("btnMigrate").addEventListener("click", () => this.importAllApps());

    // TSVインポート
    document.getElementById("btnImportTsv").addEventListener("click", () => this.importTsv());
  },

  /**
   * 全アプリの一括インポート
   * 各テキストエリアのJSONを順番にFirestoreへ投入
   */
  async importAllApps() {
    const resultEl = document.getElementById("migrationResult");
    const alertEl = document.getElementById("migrationAlert");
    resultEl.classList.remove("d-none");
    alertEl.className = "alert alert-info";
    alertEl.textContent = "一括インポート中...";

    const ts = firebase.firestore.FieldValue.serverTimestamp();
    const totalCounts = {};
    let appsDone = 0;

    try {
      for (const field of this.appFields) {
        const json = document.getElementById(field.id).value.trim();
        if (!json) continue;

        const data = JSON.parse(json);
        const appName = data.appName || field.label;
        alertEl.textContent = `インポート中: ${appName}...`;

        // 汎用エクスポート形式: data.sheets にシートごとのデータ
        if (data.sheets) {
          for (const [sheetName, sheetData] of Object.entries(data.sheets)) {
            if (!sheetData.rows || sheetData.rows.length === 0) continue;

            // コレクション名を決定
            const collectionName = this.resolveCollectionName(appName, sheetName);

            let count = 0;
            for (const row of sheetData.rows) {
              await db.collection(collectionName).add({
                ...row,
                _appSource: appName,
                _sheetSource: sheetName,
                _migratedAt: ts,
              });
              count++;
            }

            const key = `${appName}/${sheetName}`;
            totalCounts[key] = count;
          }
        }

        // 旧形式（exportDataForMigration形式）にも対応
        if (data.staff) {
          await this.importJson();
          totalCounts["staff(legacy)"] = data.staff.length;
        }

        appsDone++;
      }

      // 結果表示
      if (appsDone === 0) {
        alertEl.className = "alert alert-warning";
        alertEl.textContent = "JSONが入力されていません。少なくとも1つのアプリのJSONを貼り付けてください。";
        return;
      }

      const lines = Object.entries(totalCounts)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}: ${v}件`);

      alertEl.className = "alert alert-success";
      alertEl.innerHTML = `<strong>${appsDone}アプリのインポート完了!</strong><br><br>${lines.join("<br>")}`;
      showToast("完了", `${appsDone}アプリのデータをインポートしました`, "success");
    } catch (e) {
      alertEl.className = "alert alert-danger";
      alertEl.textContent = `エラー: ${e.message}`;
      console.error("Migration error:", e);
    }
  },

  /**
   * アプリ名+シート名からFirestoreのコレクション名を決定
   */
  resolveCollectionName(appName, sheetName) {
    // 民泊メインの主要シート → 専用コレクションにマッピング
    const mainMapping = {
      "清掃スタッフ": "staff",
      "フォームの回答 1": "bookings",
      "募集": "recruitments",
      "募集_立候補": "volunteers",
      "スタッフ報酬": "rewards",
      "仕事内容マスタ": "jobTypes",
      "特別料金": "specialRates",
      "募集設定": "settings_recruit",
      "設定_オーナー": "settings_owner",
      "設定_連携": "syncSettings",
      "通知履歴": "notifications",
      "キャンセル申請": "cancelRequests",
      "スタッフ共有用": "staffShare",
      "ベッド数マスタ": "bedCounts",
      "サブオーナー": "subOwners",
    };

    // チェックリストの主要シート
    const checklistMapping = {
      "チェックリストマスタ": "checklistTemplates",
      "撮影箇所マスタ": "photoSpots",
      "チェックリスト記録": "checklistRecords",
      "チェックリスト写真": "checklistPhotos",
      "要補充記録": "supplyRecords",
    };

    if (appName === "minpaku-main" && mainMapping[sheetName]) {
      return mainMapping[sheetName];
    }
    if (appName === "checklist" && checklistMapping[sheetName]) {
      return checklistMapping[sheetName];
    }

    // その他: appName_sheetName形式でコレクションを作成
    const safeName = sheetName.replace(/[\/\s]/g, "_").replace(/[^a-zA-Z0-9_\u3000-\u9FFF]/g, "");
    return `migrated_${appName}_${safeName}`;
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
