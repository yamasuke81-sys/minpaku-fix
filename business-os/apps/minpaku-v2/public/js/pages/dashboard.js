/**
 * ダッシュボードページ
 * 今日の概要 + カレンダー
 */
const DashboardPage = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h2><i class="bi bi-speedometer2"></i> ダッシュボード</h2>
      </div>

      <!-- 統計カード -->
      <div class="row g-3 mb-4">
        <div class="col-6 col-md-3">
          <div class="card card-stat primary">
            <div class="card-body">
              <div class="text-muted small">今日の清掃</div>
              <div class="fs-3 fw-bold" id="statTodayShifts">-</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="card card-stat success">
            <div class="card-body">
              <div class="text-muted small">今月の予約</div>
              <div class="fs-3 fw-bold" id="statMonthBookings">-</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="card card-stat warning">
            <div class="card-body">
              <div class="text-muted small">未割当シフト</div>
              <div class="fs-3 fw-bold" id="statUnassigned">-</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="card card-stat danger">
            <div class="card-body">
              <div class="text-muted small">稼働スタッフ</div>
              <div class="fs-3 fw-bold" id="statActiveStaff">-</div>
            </div>
          </div>
        </div>
      </div>

      <!-- カレンダー -->
      <div class="card">
        <div class="card-body">
          <div id="dashboardCalendar"></div>
        </div>
      </div>
    `;

    this.loadStats();
    this.initCalendar();
  },

  async loadStats() {
    try {
      const [staff] = await Promise.all([
        API.staff.list(true),
      ]);
      document.getElementById("statActiveStaff").textContent = staff.length;

      // シフト・予約はBEDS24連携後に実装
      document.getElementById("statTodayShifts").textContent = "0";
      document.getElementById("statMonthBookings").textContent = "0";
      document.getElementById("statUnassigned").textContent = "0";
    } catch (e) {
      console.error("統計読み込みエラー:", e);
    }
  },

  initCalendar() {
    const calendarEl = document.getElementById("dashboardCalendar");
    if (!calendarEl) return;

    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "dayGridMonth",
      locale: "ja",
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,listWeek",
      },
      height: "auto",
      events: [],
      // BEDS24連携後にイベントを動的読み込み
    });
    calendar.render();
  },
};
