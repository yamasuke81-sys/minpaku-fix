/**
 * API クライアント（Firestore直接接続版）
 * テストモード中はCloud Functionsを経由せず、直接Firestoreに読み書き
 */
const db = firebase.firestore();

const API = {
  // フィールド正規化（日本語ヘッダー→英語フィールド名）
  _normalizeStaff(s) {
    return {
      ...s,
      name: s.name || s["名前"] || "",
      email: s.email || s["メール"] || "",
      phone: s.phone || s["電話"] || "",
      bankName: s.bankName || s["金融機関名"] || "",
      branchName: s.branchName || s["支店名"] || "",
      accountType: s.accountType || s["口座種類"] || "普通",
      accountNumber: s.accountNumber || s["口座番号"] || "",
      accountHolder: s.accountHolder || s["口座名義"] || "",
      memo: s.memo || s["住所"] || "",
      active: s.active !== undefined ? s.active !== false && s.active !== "N" : (s["有効"] || "Y") !== "N",
      skills: s.skills || [],
      availableDays: s.availableDays || [],
      ratePerJob: s.ratePerJob || 0,
      transportationFee: s.transportationFee || 0,
      displayOrder: s.displayOrder || 0,
    };
  },

  // スタッフ API
  staff: {
    async list(activeOnly = true) {
      const snap = await db.collection("staff").get();
      let staff = snap.docs.map(doc => API._normalizeStaff({ id: doc.id, ...doc.data() }));
      // 名前が空のエントリを除外
      staff = staff.filter(s => s.name && s.name.trim());
      if (activeOnly) {
        staff = staff.filter(s => s.active !== false);
      }
      staff.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
      return staff;
    },

    async get(id) {
      const doc = await db.collection("staff").doc(id).get();
      if (!doc.exists) throw new Error("スタッフが見つかりません");
      return API._normalizeStaff({ id: doc.id, ...doc.data() });
    },

    async create(data) {
      data.active = data.active !== false;
      data.displayOrder = data.displayOrder || 0;
      data.skills = data.skills || [];
      data.availableDays = data.availableDays || [];
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await db.collection("staff").add(data);
      return { id: ref.id, ...data };
    },

    async update(id, data) {
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("staff").doc(id).update(data);
      return { id, ...data };
    },

    async delete(id) {
      await db.collection("staff").doc(id).update({
        active: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    },
  },

  // 物件 API
  properties: {
    async list(activeOnly = true) {
      const snap = await db.collection("properties").get();
      let properties = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (activeOnly) {
        properties = properties.filter(p => p.active !== false);
      }
      properties.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      return properties;
    },

    async get(id) {
      const doc = await db.collection("properties").doc(id).get();
      if (!doc.exists) throw new Error("物件が見つかりません");
      return { id: doc.id, ...doc.data() };
    },

    async create(data) {
      data.active = data.active !== false;
      data.type = data.type || "minpaku";
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await db.collection("properties").add(data);
      return { id: ref.id, ...data };
    },

    async update(id, data) {
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("properties").doc(id).update(data);
      return { id, ...data };
    },

    async delete(id) {
      await db.collection("properties").doc(id).update({
        active: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    },
  },

  // シフト API
  shifts: {
    async list(params = {}) {
      const snap = await db.collection("shifts").get();
      let shifts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (params.from) {
        const fromDate = new Date(params.from);
        shifts = shifts.filter(s => {
          const d = s.date && s.date.toDate ? s.date.toDate() : new Date(s.date);
          return d >= fromDate;
        });
      }
      if (params.to) {
        const toDate = new Date(params.to);
        shifts = shifts.filter(s => {
          const d = s.date && s.date.toDate ? s.date.toDate() : new Date(s.date);
          return d <= toDate;
        });
      }
      if (params.staffId) shifts = shifts.filter(s => s.staffId === params.staffId);
      if (params.propertyId) shifts = shifts.filter(s => s.propertyId === params.propertyId);
      shifts.sort((a, b) => {
        const da = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date || 0);
        const db2 = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date || 0);
        return da - db2;
      });
      return shifts;
    },

    async create(data) {
      data.date = new Date(data.date);
      data.status = data.staffId ? "assigned" : "unassigned";
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await db.collection("shifts").add(data);
      return { id: ref.id, ...data };
    },

    async update(id, data) {
      if (data.date) data.date = new Date(data.date);
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("shifts").doc(id).update(data);
      return { id, ...data };
    },

    async delete(id) {
      await db.collection("shifts").doc(id).delete();
    },
  },

  // ランドリー API
  laundry: {
    async list(params = {}) {
      const snap = await db.collection("laundry").get();
      let records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (params.staffId) {
        records = records.filter(r => r.staffId === params.staffId);
      }
      if (params.yearMonth) {
        records = records.filter(r => {
          const d = r.date && r.date.toDate ? r.date.toDate() : new Date(r.date);
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          return ym === params.yearMonth;
        });
      }
      records.sort((a, b) => {
        const da = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date || 0);
        const db2 = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date || 0);
        return db2 - da;
      });
      return records;
    },

    async create(data) {
      data.date = new Date(data.date);
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await db.collection("laundry").add(data);
      return { id: ref.id, ...data };
    },

    async delete(id) {
      await db.collection("laundry").doc(id).delete();
    },
  },

  // 請求書 API
  invoices: {
    async list(params = {}) {
      const snap = await db.collection("invoices").get();
      let invoices = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (params.yearMonth) invoices = invoices.filter(i => i.yearMonth === params.yearMonth);
      if (params.staffId) invoices = invoices.filter(i => i.staffId === params.staffId);
      invoices.sort((a, b) => (b.yearMonth || "").localeCompare(a.yearMonth || ""));
      return invoices;
    },

    async get(id) {
      const doc = await db.collection("invoices").doc(id).get();
      if (!doc.exists) throw new Error("請求書が見つかりません");
      return { id: doc.id, ...doc.data() };
    },

    async confirm(id) {
      await db.collection("invoices").doc(id).update({
        status: "confirmed",
        confirmedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    },
  },

  // チェックリスト API
  checklist: {
    async templates() {
      const snap = await db.collection("checklistTemplates").get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    async saveTemplate(data) {
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      if (data.id) {
        await db.collection("checklistTemplates").doc(data.id).update(data);
        return data;
      }
      const ref = await db.collection("checklistTemplates").add(data);
      return { id: ref.id, ...data };
    },

    async records(params = {}) {
      let query = db.collection("checklists");
      if (params.shiftId) query = query.where("shiftId", "==", params.shiftId);
      if (params.staffId) query = query.where("staffId", "==", params.staffId);
      const snap = await query.get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    async update(id, data) {
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("checklists").doc(id).update(data);
      return { id, ...data };
    },
  },
};
