/**
 * API クライアント
 * Cloud Functions への REST API 呼び出し
 */
const API = {
  baseUrl: "/api",

  async request(method, path, body = null) {
    const token = await Auth.getIdToken();
    if (!token) throw new Error("未認証です");

    const options = {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${path}`, options);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `APIエラー (${res.status})`);
    }

    return data;
  },

  // スタッフ API
  staff: {
    list(activeOnly = true) { return API.request("GET", `/staff?active=${activeOnly}`); },
    get(id) { return API.request("GET", `/staff/${id}`); },
    create(data) { return API.request("POST", "/staff", data); },
    update(id, data) { return API.request("PUT", `/staff/${id}`, data); },
    delete(id) { return API.request("DELETE", `/staff/${id}`); },
  },

  // 物件 API
  properties: {
    list(activeOnly = true) { return API.request("GET", `/properties?active=${activeOnly}`); },
    get(id) { return API.request("GET", `/properties/${id}`); },
    create(data) { return API.request("POST", "/properties", data); },
    update(id, data) { return API.request("PUT", `/properties/${id}`, data); },
    delete(id) { return API.request("DELETE", `/properties/${id}`); },
  },

  // シフト API
  shifts: {
    list(params = {}) {
      const query = new URLSearchParams(params).toString();
      return API.request("GET", `/shifts?${query}`);
    },
    create(data) { return API.request("POST", "/shifts", data); },
    update(id, data) { return API.request("PUT", `/shifts/${id}`, data); },
    delete(id) { return API.request("DELETE", `/shifts/${id}`); },
  },

  // ランドリー API
  laundry: {
    list(params = {}) {
      const query = new URLSearchParams(params).toString();
      return API.request("GET", `/laundry?${query}`);
    },
    create(data) { return API.request("POST", "/laundry", data); },
    delete(id) { return API.request("DELETE", `/laundry/${id}`); },
  },

  // 請求書 API
  invoices: {
    list(params = {}) {
      const query = new URLSearchParams(params).toString();
      return API.request("GET", `/invoices?${query}`);
    },
    get(id) { return API.request("GET", `/invoices/${id}`); },
    generate(yearMonth) { return API.request("POST", "/invoices/generate", { yearMonth }); },
    confirm(id) { return API.request("PUT", `/invoices/${id}/confirm`); },
  },

  // チェックリスト API
  checklist: {
    templates() { return API.request("GET", "/checklist/templates"); },
    saveTemplate(data) { return API.request("POST", "/checklist/templates", data); },
    records(params = {}) {
      const query = new URLSearchParams(params).toString();
      return API.request("GET", `/checklist/records?${query}`);
    },
    start(shiftId, propertyId) { return API.request("POST", "/checklist/records", { shiftId, propertyId }); },
    update(id, data) { return API.request("PUT", `/checklist/records/${id}`, data); },
  },
};
