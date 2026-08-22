/* ============================================================
   管理端逻辑：概览 / 订单统计 / 库存 / 客户
   ============================================================ */
(function (global) {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const PAGE = 8;
  const state = { view: "overview", filter: { date: Store.todayStr(), ship: "all", q: "" }, page: 1 };

  function toast(m, type) {
    const w = $("#toastWrap"); if (!w) return;
    const e = document.createElement("div"); e.className = "toast " + (type || "ok"); e.textContent = m;
    w.appendChild(e); setTimeout(() => { e.style.opacity = "0"; e.style.transition = "opacity .3s"; }, 1800); setTimeout(() => e.remove(), 2200);
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function switchView(v) {
    state.view = v;
    $$(".aside-nav a").forEach(a => a.classList.toggle("active", a.dataset.view === v));
    render();
  }

  function render() {
    if (state.view === "overview") renderOverview();
    else if (state.view === "orders") renderOrders();
    else if (state.view === "inventory") renderInventory();
    else if (state.view === "customers") renderCustomers();
    else if (state.view === "agents") renderAgents();
  }

  /* ---------- 概览 ---------- */
  function renderOverview() {
    const o = Store.getOverview();
    const recent = Store.getOrders().slice(0, 6);
    const inv = Store.getInventory();
    const lowStock = inv.filter(i => (i.total - i.sold) < i.threshold);

    $("#viewRoot").innerHTML = `
      <div class="main-head">
        <div><h1>数据概览</h1><div class="sub">今日 ${Store.fmtDate(Date.now())} 的经营概况</div></div>
      </div>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="s-top"><div class="s-ic green">▤</div><span class="s-lbl">今日订单</span></div>
          <div class="s-num">${o.orderCount}</div>
          <div class="s-foot">较昨日 ${yesterdayCount()} 单</div>
        </div>
        <div class="stat-card">
          <div class="s-top"><div class="s-ic orange">¥</div><span class="s-lbl">今日已收金额</span></div>
          <div class="s-num">${Store.money(o.revenue)}</div>
          <div class="s-foot">仅统计已支付订单</div>
        </div>
        <div class="stat-card">
          <div class="s-top"><div class="s-ic blue">⤳</div><span class="s-lbl">待发货</span></div>
          <div class="s-num">${o.pendingShip}</div>
          <div class="s-foot">已支付 · 待发货</div>
        </div>
        <div class="stat-card">
          <div class="s-top"><div class="s-ic grey">⚖</div><span class="s-lbl">今日发件量</span></div>
          <div class="s-num">${o.totalKg}<span style="font-size:16px;color:var(--muted);font-family:var(--font-sans)"> 斤</span></div>
          <div class="s-foot">按规格估算</div>
        </div>
      </div>

      <div class="checkout-grid" style="align-items:start">
        <div class="panel">
          <h3>热销商品</h3>
          <p class="p-sub">今日销量排行</p>
          ${o.hot.length ? o.hot.map((h, i) => `
            <div class="detail-row"><div class="d-k">第${i + 1}名</div><div class="d-v">${esc(h[0])} <span class="muted" style="font-weight:400">${h[1]} 箱</span></div></div>
          `).join("") : `<div class="empty-state" style="padding:30px"><div class="e-ic">📦</div>今日暂无订单</div>`}
        </div>
        <div class="panel">
          <h3>库存预警</h3>
          <p class="p-sub">低于阈值的商品</p>
          ${lowStock.length ? lowStock.map(i => {
            const left = i.total - i.sold; const pct = Math.max(0, Math.round(left / i.total * 100));
            return `<div class="detail-row"><div class="d-k">${esc(i.name)}</div><div class="d-v" style="color:#B0413E">剩余 ${left}（${pct}%）</div></div>`;
          }).join("") : `<div class="empty-state" style="padding:30px"><div class="e-ic">✓</div>库存充足</div>`}
        </div>
      </div>

      <div class="panel" style="margin-top:24px">
        <h3>最近订单</h3>
        <p class="p-sub">最新 6 条订单</p>
        <div class="tbl-scroll">
        <table class="tbl">
          <thead><tr><th>订单号</th><th>客户</th><th>商品</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
          ${recent.length ? recent.map(o => `
            <tr>
              <td>${o.id}</td>
              <td class="t-name">${esc(o.customer.name)}<br><span class="muted" style="font-size:12px">${o.customer.phone}</span></td>
              <td>${o.items.map(i => esc(i.name)).join(" + ")}</td>
              <td class="t-amt">${Store.money(o.totalAmount)}</td>
              <td><span class="status status-${o.shipStatus}">${Store.shipLabel(o.shipStatus)}</span></td>
              <td><button class="icon-btn" data-view-order="${o.id}">▶</button></td>
            </tr>`).join("") : `<tr><td colspan="6"><div class="empty-state">暂无订单</div></td></tr>`}
          </tbody>
        </table>
        </div>
        <div style="margin-top:14px"><button class="btn btn-ghost btn-sm" data-jump="orders">查看全部订单 →</button></div>
      </div>
    `;

    $$("[data-view-order]").forEach(b => b.addEventListener("click", () => { switchView("orders"); openOrderDetail(b.dataset.viewOrder); }));
    $$("[data-jump]").forEach(b => b.addEventListener("click", () => switchView(b.dataset.jump)));
  }

  function yesterdayCount() {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const ys = new Date(y).setHours(0, 0, 0, 0), ye = new Date(y).setHours(23, 59, 59, 999);
    return Store.getOrders().filter(o => o.createdAt >= ys && o.createdAt <= ye).length;
  }

  /* ---------- 订单统计 ---------- */
  function renderOrders() {
    const orders = Store.getOrders(state.filter);
    const total = orders.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * PAGE;
    const pageItems = orders.slice(start, start + PAGE);

    const sumAmount = orders.reduce((s, o) => s + (o.payStatus === "paid" ? o.totalAmount : 0), 0);
    const sumKg = orders.reduce((s, o) => s + o.items.reduce((x, i) => x + (i.spec.indexOf("40") > -1 ? 40 : i.spec.indexOf("20") > -1 ? 20 : 10) * i.qty, 0), 0);
    const sumQty = orders.reduce((s, o) => s + o.items.reduce((x, i) => x + i.qty, 0), 0);

    $("#viewRoot").innerHTML = `
      <div class="main-head">
        <div><h1>订单统计</h1><div class="sub">全字段订单信息，可直接导出发给物流发货</div></div>
        <div class="acts" style="display:flex;gap:10px">
          <button class="btn btn-light btn-sm" id="printBtn">🖨 打印</button>
          <button class="btn btn-accent btn-sm" id="exportBtn">⤓ 导出 Excel/CSV</button>
        </div>
      </div>

      <div class="toolbar">
        <div class="date-pill">
          <span>📅</span>
          <input type="date" id="dateFilter" value="${state.filter.date}" style="border:none;background:transparent;font-weight:600;outline:none" />
        </div>
        <div class="tab-pills" id="shipTabs">
          <button data-ship="all" class="${state.filter.ship === "all" ? "on" : ""}">全部 ${total}</button>
          <button data-ship="pending" class="${state.filter.ship === "pending" ? "on" : ""}">待发货 ${countShip("pending")}</button>
          <button data-ship="shipped" class="${state.filter.ship === "shipped" ? "on" : ""}">已发货 ${countShip("shipped")}</button>
          <button data-ship="done" class="${state.filter.ship === "done" ? "on" : ""}">已完成 ${countShip("done")}</button>
        </div>
        <div class="grow"></div>
        <div class="search-box">
          <span class="s-ic2">🔍</span>
          <input type="text" id="searchBox" placeholder="搜订单号 / 姓名 / 电话 / 地址" value="${esc(state.filter.q)}" />
        </div>
      </div>

      <div class="table-card">
        <div class="tbl-scroll">
          <table class="tbl">
            <thead>
              <tr>
                <th>订单号</th><th>下单时间</th><th>客户</th><th>电话</th><th>收货地址</th>
                <th>商品明细</th><th>数量</th><th>金额</th><th>支付</th><th>发货</th><th>物流</th><th>来源</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
            ${pageItems.length ? pageItems.map(o => `
              <tr>
                <td><strong>${o.id}</strong></td>
                <td class="nowrap">${Store.fmtTime(o.createdAt)}</td>
                <td class="t-name">${esc(o.customer.name)}</td>
                <td class="nowrap">${o.customer.phone}</td>
                <td><div class="t-addr">${o.customer.province}${o.customer.city}${o.customer.district}${o.customer.address}</div></td>
                <td>${o.items.map(i => `${esc(i.name)}<span class="muted">(${i.spec})</span>`).join("<br>")}</td>
                <td>${o.items.reduce((s, i) => s + i.qty, 0)}</td>
                <td class="t-amt">${Store.money(o.totalAmount)}</td>
                <td><span class="status status-${o.payStatus}">${Store.payLabel(o.payStatus)}</span></td>
                <td><span class="status status-${o.shipStatus}">${Store.shipLabel(o.shipStatus)}</span></td>
                <td class="nowrap">${o.shippingNo ? `${o.logisticsCompany}<br><span class="muted" style="font-size:12px">${o.shippingNo}</span>` : "—"}</td>
                <td class="nowrap">${o.source}</td>
                <td><div class="row-act">
                  <button class="icon-btn" title="详情" data-view="${o.id}">▶</button>
                  ${o.shipStatus === "pending" && o.payStatus === "paid" ? `<button class="icon-btn" title="发货" data-ship="${o.id}">⤳</button>` : ""}
                  ${o.shipStatus !== "done" ? `<button class="icon-btn" title="完成" data-done="${o.id}">✓</button>` : ""}
                  <button class="icon-btn danger" title="删除" data-del="${o.id}">×</button>
                </div></td>
              </tr>`).join("") : `<tr><td colspan="13"><div class="empty-state"><div class="e-ic">📭</div>该条件下暂无订单</div></td></tr>`}
            </tbody>
            ${orders.length ? `<tfoot><tr class="tbl-summary"><td colspan="6">合计（${total} 单）</td><td>${sumQty}</td><td class="t-amt">${Store.money(sumAmount)}</td><td colspan="5">约 ${sumKg} 斤 · 已收款 ${Store.money(sumAmount)}</td></tr></tfoot>` : ""}
          </table>
        </div>
        <div class="tbl-foot">
          <div class="info">共 ${total} 条 · 第 ${state.page}/${totalPages} 页</div>
          <div class="pager">
            <button ${state.page <= 1 ? "disabled" : ""} data-page="prev">‹</button>
            ${pageBtns(totalPages).map(p => `<button class="${p === state.page ? "on" : ""}" data-page="${p}">${p}</button>`).join("")}
            <button ${state.page >= totalPages ? "disabled" : ""} data-page="next">›</button>
          </div>
        </div>
      </div>`;

    // 事件
    $("#dateFilter").addEventListener("change", e => { state.filter.date = e.target.value; state.page = 1; renderOrders(); });
    $("#searchBox").addEventListener("input", e => { state.filter.q = e.target.value; state.page = 1; });
    $("#searchBox").addEventListener("change", () => renderOrders());
    $$("#shipTabs button").forEach(b => b.addEventListener("click", () => { state.filter.ship = b.dataset.ship; state.page = 1; renderOrders(); }));
    $$("[data-page]").forEach(b => b.addEventListener("click", () => {
      const p = b.dataset.page; if (p === "prev") state.page--; else if (p === "next") state.page++; else state.page = +p;
      renderOrders();
    }));
    $$("[data-view]").forEach(b => b.addEventListener("click", () => openOrderDetail(b.dataset.view)));
    $$("[data-ship]").forEach(b => b.addEventListener("click", () => openShipModal(b.dataset.ship)));
    $$("[data-done]").forEach(b => b.addEventListener("click", async () => { await Store.updateOrder(b.dataset.done, { shipStatus: "done" }); toast("已标记完成"); renderOrders(); }));
    $$("[data-del]").forEach(b => b.addEventListener("click", async () => {
      if (confirm("确认删除该订单？此操作不可撤销")) { await Store.deleteOrder(b.dataset.del); toast("已删除", "warn"); renderOrders(); }
    }));
    $("#exportBtn").addEventListener("click", () => {
      const csv = Store.exportCSV(orders);
      const tag = state.filter.date ? state.filter.date : "全部";
      Store.download(`订单统计_${tag}.csv`, csv, "text/csv");
      toast("已导出 " + orders.length + " 条订单");
    });
    $("#printBtn").addEventListener("click", () => window.print());
  }

  function pageBtns(total) {
    const arr = []; for (let i = 1; i <= total; i++) arr.push(i); return arr.slice(0, 7);
  }
  function countShip(s) {
    const f = { ...state.filter, ship: s };
    return Store.getOrders(f).length;
  }

  /* ---------- 订单详情弹窗 ---------- */
  function openOrderDetail(id) {
    const o = Store.getOrder(id); if (!o) return;
    const kg = o.items.reduce((x, i) => x + (i.spec.indexOf("40") > -1 ? 40 : i.spec.indexOf("20") > -1 ? 20 : 10) * i.qty, 0);
    $("#modalBox").innerHTML = `
      <div class="modal-head">
        <h3>订单详情</h3>
        <button class="close-x" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="detail-row"><div class="d-k">订单号</div><div class="d-v">${o.id}</div></div>
        <div class="detail-row"><div class="d-k">下单时间</div><div class="d-v">${Store.fmtTime(o.createdAt)}</div></div>
        <div class="detail-row"><div class="d-k">来源</div><div class="d-v">${o.source}</div></div>
        <div class="detail-grid-2">
          <div>
            <div class="detail-row"><div class="d-k">收货人</div><div class="d-v">${esc(o.customer.name)}</div></div>
            <div class="detail-row"><div class="d-k">电话</div><div class="d-v">${o.customer.phone}</div></div>
          </div>
          <div>
            <div class="detail-row"><div class="d-k">省份/城市</div><div class="d-v">${o.customer.province} ${o.customer.city}</div></div>
            <div class="detail-row"><div class="d-k">区/县</div><div class="d-v">${o.customer.district || "—"}</div></div>
          </div>
        </div>
        <div class="detail-row"><div class="d-k">详细地址</div><div class="d-v">${o.customer.address}</div></div>
        <div class="detail-row" style="align-items:flex-start"><div class="d-k">商品明细</div>
          <div class="d-v" style="font-weight:400">
            <div class="detail-products">
              ${o.items.map(i => `<div class="dp-row"><span>${esc(i.name)}（${i.spec}）×${i.qty}</span><span class="t-amt">${Store.money(i.subtotal)}</span></div>`).join("")}
              <div class="dp-row" style="margin-top:6px;border-top:1px dashed var(--line);padding-top:6px"><span>合计（约 ${kg} 斤）</span><span class="t-amt">${Store.money(o.totalAmount)}</span></div>
            </div>
          </div>
        </div>
        <div class="detail-grid-2">
          <div><div class="detail-row"><div class="d-k">支付状态</div><div class="d-v"><span class="status status-${o.payStatus}">${Store.payLabel(o.payStatus)}</span></div></div></div>
          <div><div class="detail-row"><div class="d-k">发货状态</div><div class="d-v"><span class="status status-${o.shipStatus}">${Store.shipLabel(o.shipStatus)}</span></div></div></div>
        </div>
        <div class="detail-row"><div class="d-k">物流公司</div><div class="d-v">${o.logisticsCompany || "—"}</div></div>
        <div class="detail-row"><div class="d-k">物流单号</div><div class="d-v">${o.shippingNo || "—"}</div></div>
        <div class="detail-row"><div class="d-k">客户备注</div><div class="d-v">${esc(o.remark) || "—"}</div></div>
        <div class="detail-row"><div class="d-k">内部备注</div><div class="d-v">${esc(o.internalNote) || "—"}</div></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost btn-sm" data-edit-note="${o.id}">编辑备注</button>
        ${o.shipStatus === "pending" && o.payStatus === "paid" ? `<button class="btn btn-accent btn-sm" data-ship="${o.id}">录入物流发货</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-close>关闭</button>
      </div>`;
    showModal();
    $$("[data-close]").forEach(b => b.addEventListener("click", closeModal));
    $$("[data-ship]").forEach(b => b.addEventListener("click", () => openShipModal(b.dataset.ship)));
    $$("[data-edit-note]").forEach(b => b.addEventListener("click", () => openNoteModal(b.dataset.editNote)));
  }

  /* ---------- 发货弹窗 ---------- */
  function openShipModal(id) {
    const o = Store.getOrder(id); if (!o) return;
    $("#modalBox").innerHTML = `
      <div class="modal-head"><h3>录入物流发货</h3><button class="close-x" data-close>×</button></div>
      <div class="modal-body">
        <div class="detail-row"><div class="d-k">订单号</div><div class="d-v">${o.id}</div></div>
        <div class="detail-row"><div class="d-k">收货人</div><div class="d-v">${esc(o.customer.name)} ${o.customer.phone}</div></div>
        <div class="detail-row"><div class="d-k">地址</div><div class="d-v">${o.customer.province}${o.customer.city}${o.customer.district}${o.customer.address}</div></div>
        <div class="field" style="margin-top:8px"><label>物流公司 <span class="req">*</span></label>
          <select id="shipCompany">${Store.LOGISTICS.map(l => `<option>${l}</option>`).join("")}</select></div>
        <div class="field"><label>物流单号 <span class="req">*</span></label><input id="shipNo" placeholder="请输入物流单号" /></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost btn-sm" data-close>取消</button>
        <button class="btn btn-accent btn-sm" id="saveShip">确认发货</button>
      </div>`;
    showModal();
    $$("[data-close]").forEach(b => b.addEventListener("click", closeModal));
    $("#saveShip").addEventListener("click", async () => {
      const company = $("#shipCompany").value, no = $("#shipNo").value.trim();
      if (!no) { toast("请输入物流单号", "warn"); return; }
      await Store.updateOrder(id, { shipStatus: "shipped", logisticsCompany: company, shippingNo: no });
      toast("已发货，物流信息已录入");
      closeModal(); renderOrders();
    });
  }

  /* ---------- 备注弹窗 ---------- */
  function openNoteModal(id) {
    const o = Store.getOrder(id); if (!o) return;
    $("#modalBox").innerHTML = `
      <div class="modal-head"><h3>编辑内部备注</h3><button class="close-x" data-close>×</button></div>
      <div class="modal-body">
        <div class="detail-row"><div class="d-k">订单号</div><div class="d-v">${o.id}</div></div>
        <div class="field" style="margin-top:8px"><label>内部备注（仅自己可见）</label>
          <textarea id="noteInput" rows="3">${esc(o.internalNote)}</textarea></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost btn-sm" data-close>取消</button>
        <button class="btn btn-primary btn-sm" id="saveNote">保存</button>
      </div>`;
    showModal();
    $$("[data-close]").forEach(b => b.addEventListener("click", closeModal));
    $("#saveNote").addEventListener("click", async () => {
      await Store.updateOrder(id, { internalNote: $("#noteInput").value.trim() });
      toast("备注已保存"); closeModal(); renderOrders();
    });
  }

  /* ---------- 库存管理 ---------- */
  function renderInventory() {
    const inv = Store.getInventory();
    $("#viewRoot").innerHTML = `
      <div class="main-head"><div><h1>库存管理</h1><div class="sub">各商品库存与销量，低于阈值时预警</div></div></div>
      <div class="stock-grid">
        ${inv.map(i => {
          const left = i.total - i.sold; const pct = Math.max(0, Math.round(left / i.total * 100));
          const cls = left < i.threshold ? (left < i.threshold / 2 ? "crit" : "low") : "";
          return `<div class="stock-card">
            <div class="sc-img" style="background-image:url('${i.img}')"></div>
            <div class="sc-body">
              <div class="sc-top"><h3>${esc(i.name)}</h3><span class="tag ${left < i.threshold ? "tag-orange" : "tag-green"}">${left < i.threshold ? "库存偏低" : "库存正常"}</span></div>
              <div class="stock-meta"><span>总库存 ${i.total}</span><span>已售 ${i.sold}</span></div>
              <div class="stock-bar ${cls}"><i style="width:${pct}%"></i></div>
              <div class="stock-meta"><span>剩余 ${left}（${pct}%）</span><span class="${cls ? "" : "muted"}">${cls === "crit" ? "紧急补货" : cls === "low" ? "建议补货" : "充足"}</span></div>
              <div class="stock-edit">
                <input type="number" id="stk-${i.productId}" value="${i.total}" /><button class="btn btn-ghost btn-sm" data-stk="${i.productId}">更新库存</button>
              </div>
            </div>
          </div>`;
        }).join("")}
      </div>`;
    $$("[data-stk]").forEach(b => b.addEventListener("click", async () => {
      const v = +$("#stk-" + b.dataset.stk).value;
      await Store.updateStock(b.dataset.stk, v); toast("库存已更新"); renderInventory();
    }));
  }

  /* ---------- 客户管理 ---------- */
  function renderCustomers() {
    const custs = Store.getCustomers();
    const totalRev = custs.reduce((s, c) => s + c.total, 0);
    $("#viewRoot").innerHTML = `
      <div class="main-head"><div><h1>客户管理</h1><div class="sub">按手机号归集，共 ${custs.length} 位客户</div></div>
        <div style="display:flex;gap:10px">
        <button class="btn btn-light btn-sm" id="exportCust">⤓ 导出客户</button>
      </div></div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card"><div class="s-top"><div class="s-ic green">☺</div><span class="s-lbl">客户总数</span></div><div class="s-num">${custs.length}</div></div>
        <div class="stat-card"><div class="s-top"><div class="s-ic orange">¥</div><span class="s-lbl">累计成交额</span></div><div class="s-num">${Store.money(totalRev)}</div></div>
        <div class="stat-card"><div class="s-top"><div class="s-ic blue">↻</div><span class="s-lbl">复购客户</span></div><div class="s-num">${custs.filter(c => c.orders > 1).length}</div></div>
      </div>
      <div class="cust-grid" style="margin-top:24px">
        ${custs.length ? custs.map(c => `
          <div class="cust-card">
            <div class="cc-top">
              <div class="cust-avatar">${esc(c.name.charAt(0))}</div>
              <div><h3>${esc(c.name)}</h3><div class="cc-phone">${c.phone}</div></div>
            </div>
            <div class="cust-stats">
              <div><div class="cs-num">${c.orders}</div><div class="cs-lbl">下单次数</div></div>
              <div><div class="cs-num">${Store.money(c.total)}</div><div class="cs-lbl">累计金额</div></div>
              <div><div class="cs-num">${c.source}</div><div class="cs-lbl">来源</div></div>
            </div>
            <div style="margin-top:14px;font-size:13px;color:var(--ink-soft)">📍 ${esc(c.address)}</div>
            <div style="margin-top:6px;font-size:12px;color:var(--muted)">最近下单：${Store.fmtDate(c.lastAt)}</div>
          </div>`).join("") : `<div class="empty-state"><div class="e-ic">👤</div>暂无客户</div>`}
      </div>`;

    $("#exportCust") && $("#exportCust").addEventListener("click", () => {
      const head = ["姓名", "电话", "地址", "下单次数", "累计金额", "来源", "最近下单"];
      const rows = custs.map(c => [c.name, c.phone, c.address, c.orders, c.total, c.source, Store.fmtDate(c.lastAt)]);
      const csv = [head, ...rows].map(r => r.map(x => { const s = String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
      Store.download("客户列表.csv", "\uFEFF" + csv, "text/csv");
      toast("已导出 " + custs.length + " 位客户");
    });
  }

  /* ---------- 代理管理 ---------- */
  async function renderAgents() {
    $("#viewRoot").innerHTML = `<div class="empty-state" style="padding:80px"><div class="e-ic">★</div>正在加载代理列表…</div>`;
    let agents = [];
    try {
      agents = await Store.AgentAdmin.list();
    } catch (e) {
      $("#viewRoot").innerHTML = `<div class="empty-state" style="padding:80px"><div class="e-ic">⚠</div>${esc(e.message)}</div>`;
      return;
    }

    const totalRevenue = agents.reduce((s, a) => s + (a.revenue || 0), 0);
    const totalOrders = agents.reduce((s, a) => s + (a.orderCount || 0), 0);

    $("#viewRoot").innerHTML = `
      <div class="main-head">
        <div><h1>代理管理</h1><div class="sub">管理合作伙伴账号与推荐链接，共 ${agents.length} 位代理</div></div>
        <div class="acts"><button class="btn btn-primary btn-sm" id="addAgentBtn">+ 新增代理</button></div>
      </div>

      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card"><div class="s-top"><div class="s-ic green">★</div><span class="s-lbl">代理总数</span></div><div class="s-num">${agents.length}</div></div>
        <div class="stat-card"><div class="s-top"><div class="s-ic orange">¥</div><span class="s-lbl">代理总成交额</span></div><div class="s-num">${Store.money(totalRevenue)}</div></div>
        <div class="stat-card"><div class="s-top"><div class="s-ic blue">▤</div><span class="s-lbl">代理总订单</span></div><div class="s-num">${totalOrders}</div></div>
      </div>

      <div class="table-card" style="margin-top:24px">
        <div class="tbl-scroll">
          <table class="tbl">
            <thead><tr>
              <th>代理姓名</th><th>手机号</th><th>推荐码</th><th>推荐链接</th>
              <th>订单数</th><th>成交额</th><th>状态</th><th>操作</th>
            </tr></thead>
            <tbody>
            ${agents.length ? agents.map(a => `
              <tr>
                <td class="t-name">${esc(a.name)}</td>
                <td class="nowrap">${a.phone}</td>
                <td><span class="tag tag-green">${a.referralCode}</span></td>
                <td><a href="${a.referralLink}" target="_blank" style="color:var(--green);font-size:12px">${esc(a.referralLink)}</a></td>
                <td>${a.orderCount || 0}</td>
                <td class="t-amt">${Store.money(a.revenue || 0)}</td>
                <td><span class="status status-${a.status === "active" ? "paid" : "cancel"}">${a.status === "active" ? "正常" : "已停用"}</span></td>
                <td><div class="row-act">
                  <button class="icon-btn" title="详情" data-agent-detail="${a.id}">▶</button>
                  <button class="icon-btn" title="编辑" data-agent-edit="${a.id}">✎</button>
                  ${a.status === "active" ? `<button class="icon-btn" title="停用" data-agent-toggle="${a.id}" data-status="disabled">⏸</button>` : `<button class="icon-btn" title="启用" data-agent-toggle="${a.id}" data-status="active">▶</button>`}
                </div></td>
              </tr>`).join("") : `<tr><td colspan="8"><div class="empty-state"><div class="e-ic">★</div>暂无代理，点击右上角新增</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;

    $("#addAgentBtn").addEventListener("click", () => openAgentModal());
    $$("[data-agent-detail]").forEach(b => b.addEventListener("click", () => openAgentDetail(b.dataset.agentDetail)));
    $$("[data-agent-edit]").forEach(b => b.addEventListener("click", () => openAgentModal(b.dataset.agentEdit)));
    $$("[data-agent-toggle]").forEach(b => b.addEventListener("click", async () => {
      const status = b.dataset.status;
      if (status === "disabled" && !confirm("确认停用该代理？停用后其推荐链接将失效")) return;
      await Store.AgentAdmin.update(b.dataset.agentToggle, { status });
      toast(status === "active" ? "已启用" : "已停用");
      renderAgents();
    }));
  }

  /* ---------- 新增/编辑代理弹窗 ---------- */
  function openAgentModal(agentId) {
    const isEdit = !!agentId;
    const agent = isEdit ? Store.cache.agents.find(a => a.id === agentId) : null;
    $("#modalBox").innerHTML = `
      <div class="modal-head"><h3>${isEdit ? "编辑代理" : "新增代理"}</h3><button class="close-x" data-close>×</button></div>
      <div class="modal-body">
        ${isEdit ? `<div class="detail-row"><div class="d-k">推荐码</div><div class="d-v"><span class="tag tag-green">${agent.referralCode}</span></div></div>` : ""}
        <div class="field" style="margin-top:8px"><label>代理姓名 <span class="req">*</span></label><input id="agentName" placeholder="请输入姓名" value="${isEdit ? esc(agent.name) : ""}" /></div>
        <div class="field"><label>手机号 <span class="req">*</span></label><input id="agentPhone" type="tel" maxlength="11" placeholder="请输入手机号" value="${isEdit ? agent.phone : ""}" ${isEdit ? "" : ""} /></div>
        <div class="field"><label>${isEdit ? "新密码（留空不改）" : "密码"} ${isEdit ? "" : '<span class="req">*</span>'}</label><input id="agentPassword" type="password" placeholder="${isEdit ? "留空不修改密码" : "至少6位"}" /></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost btn-sm" data-close>取消</button>
        <button class="btn btn-primary btn-sm" id="saveAgent">${isEdit ? "保存修改" : "创建代理"}</button>
      </div>`;
    showModal();
    $$("[data-close]").forEach(b => b.addEventListener("click", closeModal));
    $("#saveAgent").addEventListener("click", async () => {
      const name = $("#agentName").value.trim();
      const phone = $("#agentPhone").value.trim();
      const password = $("#agentPassword").value;
      if (!name || !phone) { toast("请填写姓名和手机号", "warn"); return; }
      if (!/^1\d{10}$/.test(phone)) { toast("手机号格式不正确", "warn"); return; }
      if (!isEdit && password.length < 6) { toast("密码至少6位", "warn"); return; }
      try {
        if (isEdit) {
          const patch = { name, phone };
          if (password) patch.password = password;
          await Store.AgentAdmin.update(agentId, patch);
          toast("代理信息已更新");
        } else {
          await Store.AgentAdmin.create(name, phone, password);
          toast("代理创建成功");
        }
        closeModal(); renderAgents();
      } catch (e) { toast(e.message, "warn"); }
    });
  }

  /* ---------- 代理详情弹窗 ---------- */
  async function openAgentDetail(id) {
    $("#modalBox").innerHTML = `<div class="modal-head"><h3>代理详情</h3></div><div class="modal-body"><div class="empty-state" style="padding:40px">加载中…</div></div>`;
    showModal();
    let data;
    try {
      data = await Store.AgentAdmin.detail(id);
    } catch (e) {
      $("#modalBox").innerHTML = `<div class="modal-head"><h3>代理详情</h3><button class="close-x" data-close>×</button></div><div class="modal-body">${esc(e.message)}</div>`;
      $$("[data-close]").forEach(b => b.addEventListener("click", closeModal));
      return;
    }
    const { agent, stats, orders } = data;
    const fullLink = location.origin + agent.referralLink;
    $("#modalBox").innerHTML = `
      <div class="modal-head"><h3>代理详情</h3><button class="close-x" data-close>×</button></div>
      <div class="modal-body">
        <div class="detail-row"><div class="d-k">姓名</div><div class="d-v">${esc(agent.name)}</div></div>
        <div class="detail-row"><div class="d-k">手机号</div><div class="d-v">${agent.phone}</div></div>
        <div class="detail-row"><div class="d-k">推荐码</div><div class="d-v"><span class="tag tag-green">${agent.referralCode}</span></div></div>
        <div class="detail-row"><div class="d-k">推荐链接</div><div class="d-v"><a href="${agent.referralLink}" target="_blank" style="color:var(--green);font-size:13px;word-break:break-all">${esc(fullLink)}</a></div></div>
        <div class="detail-row"><div class="d-k">状态</div><div class="d-v"><span class="status status-${agent.status === "active" ? "paid" : "cancel"}">${agent.status === "active" ? "正常" : "已停用"}</span></div></div>
        <div class="detail-row"><div class="d-k">创建时间</div><div class="d-v">${Store.fmtTime(agent.createdAt)}</div></div>
        <div class="detail-row" style="align-items:flex-start"><div class="d-k">业绩</div>
          <div class="d-v" style="font-weight:400">
            <div class="detail-row"><span>总订单</span><span>${stats.orderCount} 单</span></div>
            <div class="detail-row"><span>已支付</span><span>${stats.paidOrders} 单</span></div>
            <div class="detail-row"><span>成交额</span><span class="t-amt">${Store.money(stats.revenue)}</span></div>
          </div>
        </div>
        ${orders.length ? `
        <div style="margin-top:16px">
          <h4 style="font-size:14px;margin:0 0 10px;color:var(--ink-soft)">最近订单</h4>
          <div class="tbl-scroll" style="max-height:300px;overflow-y:auto">
            <table class="tbl">
              <thead><tr><th>订单号</th><th>客户</th><th>金额</th><th>状态</th></tr></thead>
              <tbody>
                ${orders.map(o => `<tr>
                  <td><strong>${o.id}</strong></td>
                  <td class="t-name">${esc(o.customer.name)}<br><span class="muted" style="font-size:12px">${o.customer.phone}</span></td>
                  <td class="t-amt">${Store.money(o.totalAmount)}</td>
                  <td><span class="status status-${o.shipStatus}">${Store.shipLabel(o.shipStatus)}</span></td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>` : ""}
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost btn-sm" data-close>关闭</button>
      </div>`;
    showModal();
    $$("[data-close]").forEach(b => b.addEventListener("click", closeModal));
  }

  /* ---------- 模态控制 ---------- */
  function showModal() { $("#modalBg").classList.add("show"); }
  function closeModal() { $("#modalBg").classList.remove("show"); }

  function init() {
    $$(".aside-nav a[data-view]").forEach(a => a.addEventListener("click", () => switchView(a.dataset.view)));
    $("#modalBg").addEventListener("click", e => { if (e.target.id === "modalBg") closeModal(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
    // 先显示加载态，再异步拉取数据（init 会检查登录状态）
    $("#viewRoot").innerHTML = `<div class="empty-state" style="padding:80px"><div class="e-ic">🍊</div>正在加载后台数据…</div>`;
    Store.init().then(() => {
      // 显示用户信息
      const user = Store.Auth.getUser();
      if (user) {
        $("#adminUserInfo").innerHTML = `${esc(user.name)} · ${user.role === "admin" ? "超级管理员" : user.role === "agent" ? "代理" : "顾客"}<br><a href="javascript:void(0)" id="adminLogout" style="color:var(--orange-700);font-size:13px">退出登录</a>`;
        const logoutBtn = $("#adminLogout");
        if (logoutBtn) logoutBtn.addEventListener("click", async () => {
          await Store.Auth.logout();
          location.href = "login.html";
        });
      }
      render();
    }).catch(() => {
      $("#viewRoot").innerHTML = `<div class="empty-state" style="padding:80px"><div class="e-ic">⚠</div>数据加载失败，请稍后刷新</div>`;
    });
  }

  global.Admin = { init };
})(window);
