/**
 * データ変換モジュール
 * インポート済みの生データ（migrated_*）を新アプリの正式コレクションに変換
 */
const DataTransformer = {
  /**
   * 全変換を実行
   */
  async transformAll() {
    const results = {};
    const ts = firebase.firestore.FieldValue.serverTimestamp();

    // 1. スタッフ変換
    results.staff = await this.transformStaff(ts);

    // 2. 予約変換
    results.bookings = await this.transformBookings(ts);

    // 3. 物件（予約データから物件名を抽出して自動生成）
    results.properties = await this.createPropertiesFromBookings(ts);

    // 4. シフト（募集データから清掃スケジュールを生成）
    results.shifts = await this.transformShifts(ts);

    // 5. ランドリー
    results.laundry = await this.transformLaundry(ts);

    // 6. 報酬 → 請求書データ
    results.rewards = await this.transformRewards(ts);

    // 7. チェックリストテンプレート
    results.checklistTemplates = await this.transformChecklistTemplates(ts);

    return results;
  },

  /**
   * スタッフ: 清掃スタッフ → staff/
   */
  async transformStaff(ts) {
    const snap = await db.collection("清掃スタッフ").get();
    if (snap.empty) return 0;

    let count = 0;
    const batch = db.batch();

    for (const doc of snap.docs) {
      const d = doc.data();
      const name = (d["名前"] || d["name"] || "").trim();
      if (!name) continue;

      // 既に同名スタッフが存在するか確認
      const existing = await db.collection("staff").where("name", "==", name).limit(1).get();
      if (!existing.empty) continue;

      const ref = db.collection("staff").doc();
      batch.set(ref, {
        name,
        email: (d["メール"] || d["email"] || "").trim(),
        phone: (d["電話"] || d["phone"] || "").trim(),
        skills: [],
        availableDays: [],
        ratePerJob: 0,
        transportationFee: 0,
        bankName: (d["金融機関名"] || d["bankName"] || "").trim(),
        branchName: (d["支店名"] || d["branchName"] || "").trim(),
        accountType: (d["口座種類"] || d["accountType"] || "普通").trim(),
        accountNumber: (d["口座番号"] || d["accountNumber"] || "").toString().trim(),
        accountHolder: (d["口座名義"] || d["accountHolder"] || "").trim(),
        memo: (d["住所"] || d["address"] || "").trim(),
        active: (d["有効"] || d["active"] || "Y") !== "N",
        displayOrder: count,
        createdAt: ts,
        updatedAt: ts,
      });
      count++;
    }

    if (count > 0) await batch.commit();
    return count;
  },

  /**
   * 予約: フォームの回答 1 → bookings/
   */
  async transformBookings(ts) {
    const collections = ["フォームの回答 1", "migrated_民泊メイン_フォームの回答_1"];
    let count = 0;

    for (const colName of collections) {
      const snap = await db.collection(colName).get();
      if (snap.empty) continue;

      for (const doc of snap.docs) {
        const d = doc.data();
        const checkIn = d["チェックイン"] || d["checkIn"];
        const checkOut = d["チェックアウト"] || d["checkOut"];
        if (!checkIn && !checkOut) continue;

        await db.collection("bookings").add({
          propertyId: "",
          beds24BookingId: "",
          guestName: (d["氏名"] || d["お名前"] || d["guestName"] || "").trim(),
          guestCount: Number(d["宿泊人数"] || d["人数"] || d["guestCount"]) || 0,
          checkIn: this.parseDate(checkIn),
          checkOut: this.parseDate(checkOut),
          source: "migrated",
          status: "completed",
          bbq: this.parseBool(d["BBQ"]),
          parking: this.parseBool(d["駐車場"]),
          notes: (d["メモ"] || d["notes"] || "").trim(),
          cleaningStaff: (d["清掃担当"] || "").trim(),
          nationality: (d["国籍"] || "").trim(),
          createdAt: ts,
        });
        count++;
      }
    }

    return count;
  },

  /**
   * 予約データから物件を自動抽出して properties/ に登録
   */
  async createPropertiesFromBookings(ts) {
    // 既存の物件がなければデフォルト物件を1つ作成
    const existingProps = await db.collection("properties").get();
    if (!existingProps.empty) return 0;

    await db.collection("properties").add({
      name: "メイン物件",
      type: "minpaku",
      beds24PropertyId: "",
      address: "",
      area: "",
      capacity: 0,
      cleaningDuration: 90,
      cleaningFee: 0,
      requiredSkills: [],
      monthlyFixedCost: 0,
      purchasePrice: 0,
      purchaseDate: null,
      notes: "自動生成（移行データから）",
      active: true,
      createdAt: ts,
      updatedAt: ts,
    });
    return 1;
  },

  /**
   * 募集 → shifts/（清掃スケジュール）
   */
  async transformShifts(ts) {
    const snap = await db.collection("募集").get();
    if (snap.empty) return 0;

    // 物件IDを取得
    const propSnap = await db.collection("properties").limit(1).get();
    const propertyId = propSnap.empty ? "" : propSnap.docs[0].id;

    let count = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      const coDate = d["チェックアウト日"] || d["checkOutDate"];
      if (!coDate) continue;

      const status = (d["ステータス"] || d["status"] || "").trim();
      const selectedStaff = (d["選定スタッフ"] || d["selectedStaff"] || "").trim();

      await db.collection("shifts").add({
        date: this.parseDate(coDate),
        propertyId,
        bookingId: "",
        staffId: null,
        staffName: selectedStaff || null,
        startTime: null,
        endTime: null,
        status: selectedStaff ? "completed" : "unassigned",
        assignMethod: "manual",
        checklistId: null,
        _originalStatus: status,
        createdAt: ts,
      });
      count++;
    }
    return count;
  },

  /**
   * コインランドリー関連の報酬 → laundry/
   */
  async transformLaundry(ts) {
    const snap = await db.collection("スタッフ報酬").get();
    if (snap.empty) return 0;

    let count = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      const jobType = (d["仕事内容名"] || d["jobType"] || "").trim();
      if (!jobType.includes("コインランドリー") && !jobType.includes("ランドリー")) continue;

      await db.collection("laundry").add({
        date: this.parseDate(d["日付"] || d["date"]) || new Date(),
        staffId: "",
        staffName: (d["スタッフ名"] || d["staffName"] || "").trim(),
        propertyId: "",
        amount: Number(d["報酬額"] || d["amount"]) || 0,
        sheets: 0,
        memo: (d["備考"] || d["memo"] || "").trim(),
        createdAt: ts,
      });
      count++;
    }
    return count;
  },

  /**
   * スタッフ報酬 → rewards/（集計用に保持）
   */
  async transformRewards(ts) {
    const snap = await db.collection("スタッフ報酬").get();
    if (snap.empty) return 0;

    let count = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!d["スタッフ名"] && !d["staffName"]) continue;

      await db.collection("rewards").add({
        staffName: (d["スタッフ名"] || d["staffName"] || "").trim(),
        jobType: (d["仕事内容名"] || d["jobType"] || "").trim(),
        amount: Number(d["報酬額"] || d["amount"]) || 0,
        memo: (d["備考"] || d["memo"] || "").trim(),
        createdAt: ts,
      });
      count++;
    }
    return count;
  },

  /**
   * チェックリストマスタ → checklistTemplates/
   */
  async transformChecklistTemplates(ts) {
    const snap = await db.collection("チェックリストマスタ").get();
    if (snap.empty) return 0;

    // 物件IDを取得
    const propSnap = await db.collection("properties").limit(1).get();
    const propertyId = propSnap.empty ? "" : propSnap.docs[0].id;

    const items = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      const name = d["項目名"] || d["チェック項目"] || d["name"] || "";
      if (!name) continue;
      items.push({
        name: String(name).trim(),
        required: true,
        photoRequired: false,
      });
    }

    if (items.length === 0) return 0;

    await db.collection("checklistTemplates").add({
      propertyId,
      items,
      updatedAt: ts,
    });

    return items.length;
  },

  // ===== ユーティリティ =====

  parseDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    // Firestore Timestamp
    if (val.toDate) return val.toDate();
    // ISO文字列 or 日本語日付
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  },

  parseBool(val) {
    if (!val) return false;
    const s = String(val).trim().toLowerCase();
    return s.includes("あり") || s === "true" || s === "yes" || s === "1";
  },
};
