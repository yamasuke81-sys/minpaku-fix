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
            <strong>ボタン1つで全データ取込!</strong><br>
            スプレッドシートのデータを自動で読み取り、Firestoreにインポートします。
          </div>

          <div class="alert alert-warning small">
            <strong>事前準備（1回だけ）:</strong> 各スプレッドシートの共有設定を「リンクを知っている全員 → 閲覧者」にしてください。<br>
            インポート完了後に共有を戻してOKです。
          </div>

          <!-- プリセットURL表示 -->
          <table class="table table-sm mb-3">
            <thead><tr><th>アプリ</th><th>スプレッドシート</th><th>状態</th></tr></thead>
            <tbody>
              <tr>
                <td><i class="bi bi-house-door"></i> 民泊メイン<br><small class="text-muted">予約・スタッフ・募集・報酬・チェックリスト</small></td>
                <td><small class="font-monospace">1Kk8VZ...HnHgCs</small></td>
                <td><span class="badge bg-secondary" id="statusMain">待機中</span></td>
              </tr>
              <tr>
                <td><i class="bi bi-file-earmark-pdf"></i> PDFリネーム<br><small class="text-muted">リネームルール・処理履歴</small></td>
                <td><small class="font-monospace">17oV_2...liAy0</small></td>
                <td><span class="badge bg-secondary" id="statusPdf">待機中</span></td>
              </tr>
            </tbody>
          </table>

          <button class="btn btn-warning btn-lg w-100" id="btnAutoImport">
            <i class="bi bi-cloud-download"></i> 全データ一括取込
          </button>

          <div class="mt-3 d-none" id="migrationResult">
            <div class="alert" id="migrationAlert"></div>
          </div>

          <hr>
          <details>
            <summary class="text-muted small">手動インポート（JSON貼り付け）</summary>
            <div class="mt-2">
              <textarea class="form-control font-monospace mb-2" id="migrationJson" rows="4" placeholder="JSON"></textarea>
              <button class="btn btn-outline-warning btn-sm" id="btnMigrate"><i class="bi bi-upload"></i> JSONインポート</button>
            </div>
          </details>
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

  SHEETS_API_KEY: firebaseConfig.apiKey, // Firebase APIキーでSheets APIも使える

  // プリセットのスプレッドシートID
  presetSheets: [
    { id: "1Kk8VZrMQoJwmNk4OZKVQ9riufiCEcVPi_xmYHHnHgCs", label: "民泊メイン", statusId: "statusMain" },
    { id: "17oV_2vPj33aZf7fl8A-NDgS0l4aYvsRrSJBw2JliAy0", label: "PDFリネーム", statusId: "statusPdf" },
  ],

  bindEvents() {
    // 自動取込ボタン
    document.getElementById("btnAutoImport").addEventListener("click", () => this.autoImportAll());

    // 手動JSONインポート
    document.getElementById("btnMigrate").addEventListener("click", () => this.importJson());

    // TSVインポート
    document.getElementById("btnImportTsv").addEventListener("click", () => this.importTsv());
  },

  /**
   * スプレッドシートURLからIDを抽出
   */
  extractSheetId(url) {
    if (!url) return null;
    const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : url.trim(); // URLじゃなければIDそのままとして扱う
  },

  /**
   * Google Sheets API v4 でスプレッドシートの全データを取得
   */
  async fetchSpreadsheet(sheetId) {
    // まずシート名一覧を取得
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${this.SHEETS_API_KEY}`;
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) {
      const err = await metaRes.json();
      throw new Error(`Sheets API: ${err.error?.message || metaRes.statusText}`);
    }
    const meta = await metaRes.json();
    const sheetNames = meta.sheets.map(s => s.properties.title);

    // 全シートのデータを一括取得（batchGet）
    const ranges = sheetNames.map(n => encodeURIComponent(n));
    const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?key=${this.SHEETS_API_KEY}&${ranges.map(r => `ranges=${r}`).join("&")}`;
    const dataRes = await fetch(dataUrl);
    if (!dataRes.ok) {
      const err = await dataRes.json();
      throw new Error(`Sheets API batchGet: ${err.error?.message || dataRes.statusText}`);
    }
    const batchData = await dataRes.json();

    // シートごとにヘッダー+データ行に変換
    const result = {};
    for (let i = 0; i < sheetNames.length; i++) {
      const sheetName = sheetNames[i];
      const values = batchData.valueRanges?.[i]?.values || [];
      if (values.length === 0) {
        result[sheetName] = [];
        continue;
      }

      const headers = values[0];
      const rows = [];
      for (let r = 1; r < values.length; r++) {
        const row = values[r];
        // 全空行スキップ
        if (!row || row.every(v => v === "" || v === undefined || v === null)) continue;
        const obj = {};
        for (let c = 0; c < headers.length; c++) {
          obj[headers[c] || `col_${c + 1}`] = (row[c] !== undefined ? row[c] : "");
        }
        rows.push(obj);
      }
      result[sheetName] = rows;
    }

    return { title: meta.properties.title, sheets: result };
  },

  /**
   * 全アプリの一括自動取込
   * スプレッドシートURLからGoogle Sheets APIで直接データ取得→Firestoreに投入
   */
  async autoImportAll() {
    const resultEl = document.getElementById("migrationResult");
    const alertEl = document.getElementById("migrationAlert");
    resultEl.classList.remove("d-none");
    alertEl.className = "alert alert-info";
    alertEl.innerHTML = '<div class="spinner-border spinner-border-sm me-2"></div>取込中...';

    const ts = firebase.firestore.FieldValue.serverTimestamp();
    const totalCounts = {};
    let appsDone = 0;

    try {
      for (const preset of this.presetSheets) {
        const statusEl = document.getElementById(preset.statusId);
        if (statusEl) { statusEl.className = "badge bg-info"; statusEl.textContent = "取得中..."; }

        alertEl.innerHTML = `<div class="spinner-border spinner-border-sm me-2"></div>${preset.label}を取得中...`;

        let data;
        try {
          data = await this.fetchSpreadsheet(preset.id);
        } catch (e) {
          if (statusEl) { statusEl.className = "badge bg-danger"; statusEl.textContent = "エラー"; }
          console.error(`${preset.label} fetch error:`, e);
          totalCounts[`${preset.label} (エラー)`] = e.message;
          continue;
        }

        if (statusEl) { statusEl.className = "badge bg-primary"; statusEl.textContent = "保存中..."; }
        alertEl.innerHTML = `<div class="spinner-border spinner-border-sm me-2"></div>${preset.label}をFirestoreに保存中...`;

        let sheetsDone = 0;
        for (const [sheetName, rows] of Object.entries(data.sheets)) {
          if (!rows || rows.length === 0) continue;

          const collectionName = this.resolveCollectionName(preset.label, sheetName);
          let count = 0;

          // バッチ書き込み（高速化）
          const batchSize = 500;
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = db.batch();
            const chunk = rows.slice(i, i + batchSize);
            for (const row of chunk) {
              const ref = db.collection(collectionName).doc();
              batch.set(ref, {
                ...row,
                _appSource: preset.label,
                _sheetSource: sheetName,
                _migratedAt: ts,
              });
              count++;
            }
            await batch.commit();
          }

          if (count > 0) {
            totalCounts[`${preset.label} / ${sheetName}`] = count;
            sheetsDone++;
          }
        }

        if (statusEl) { statusEl.className = "badge bg-success"; statusEl.textContent = `完了 (${sheetsDone}シート)`; }
        appsDone++;
      }

      const lines = Object.entries(totalCounts)
        .map(([k, v]) => typeof v === "number" ? `<li>${k}: <strong>${v}件</strong></li>` : `<li class="text-danger">${k}: ${v}</li>`);

      alertEl.className = "alert alert-success";
      alertEl.innerHTML = `<strong>${appsDone}アプリのインポート完了!</strong><ul class="mb-0 mt-2">${lines.join("")}</ul>`;
      showToast("完了", `${appsDone}アプリのデータをインポートしました`, "success");
    } catch (e) {
      alertEl.className = "alert alert-danger";
      alertEl.textContent = `エラー: ${e.message}`;
      console.error("Auto import error:", e);
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
