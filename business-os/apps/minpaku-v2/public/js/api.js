/**
 * API クライアント（Firestore直接接続版）
 * テストモード中はCloud Functionsを経由せず、直接Firestoreに読み書き
 */
const db = firebase.firestore();

const API = {
  // スタッフ API
  staff: {
    async list(activeOnly = true) {
      // インデックス不要のシンプルクエリ
      const snap = await db.collection("staff").get();
      let staff = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (activeOnly) {
        staff = staff.filter(s => s.active !== false);
      }
      staff.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
      return staff;
    },

    async get(id) {
      const doc = await db.collection("staff").doc(id).get();
      if (!doc.exists) throw new Error("スタッフが見つかりません");
      return { id: doc.id, ...doc.data() };
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
      let query = db.collection("shifts").orderBy("date", "asc");
      if (params.from) query = query.where("date", ">=", new Date(params.from));
      if (params.to) query = query.where("date", "<=", new Date(params.to));
      const snap = await query.get();
      let shifts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (params.staffId) shifts = shifts.filter(s => s.staffId === params.staffId);
      if (params.propertyId) shifts = shifts.filter(s => s.propertyId === params.propertyId);
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
      let query = db.collection("laundry").orderBy("date", "desc");
      if (params.staffId) {
        query = db.collection("laundry").where("staffId", "==", params.staffId).orderBy("date", "desc");
      }
      const snap = await query.get();
      let records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (params.yearMonth) {
        records = records.filter(r => {
          const d = r.date.toDate ? r.date.toDate() : new Date(r.date);
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          return ym === params.yearMonth;
        });
      }
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
      const snap = await db.collection("invoices").orderBy("yearMonth", "desc").get();
      let invoices = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (params.yearMonth) invoices = invoices.filter(i => i.yearMonth === params.yearMonth);
      if (params.staffId) invoices = invoices.filter(i => i.staffId === params.staffId);
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
