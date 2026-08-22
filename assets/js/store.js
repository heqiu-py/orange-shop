/* ============================================================
   脂橙庄园 · 数据层 (后端 API)
   读取：启动时加载到内存缓存，渲染层同步调用
   写入：异步请求后端，完成后刷新缓存
   购物车仍存 localStorage（客户端购物车）
   ============================================================ */
(function (global) {
  "use strict";

  /* API 根地址：与前端同源，部署后自动跟随域名 */
  const API = (function () {
    // 允许通过 ?api= 指定独立后端地址，便于分离部署
    const p = new URLSearchParams(location.search).get("api");
    return p ? p.replace(/\/$/, "") : "";
  })();

  async function http(path, opts) {
    opts = opts || {};
    const res = await fetch(API + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) }
    });
    if (!res.ok) {
      let msg = "请求失败 (" + res.status + ")";
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
  }

  /* ---------- 内存缓存 ---------- */
  const cache = { products: [], orders: [], inventory: [], customers: [], provinces: [], sources: [], logistics: [] };

  async function refresh(what) {
    if (what === "products" || !cache.products.length) { const d = await http("/api/products"); cache.products = d.products; }
    if (what === "orders" || what === "all") { const d = await http("/api/orders"); cache.orders = d.orders; }
    if (what === "inventory" || what === "all") { const d = await http("/api/inventory"); cache.inventory = d.inventory; }
    if (what === "customers" || what === "all") { const d = await http("/api/customers"); cache.customers = d.customers; }
  }

  /* ---------- 启动加载 ---------- */
  async function init() {
    const [p, inv, ord, cust, cs] = await Promise.all([
      http("/api/products"),
      http("/api/inventory"),
      http("/api/orders"),
      http("/api/customers"),
      http("/api/constants").catch(() => ({ provinces: [], sources: [], logistics: [] }))
    ]);
    cache.products = p.products;
    cache.inventory = inv.inventory;
    cache.orders = ord.orders;
    cache.customers = cust.customers;
    cache.provinces = cs.provinces || [];
    cache.sources = cs.sources || [];
    cache.logistics = cs.logistics || [];
  }

  /* ---------- 工具 ---------- */
  const pad = (n, w) => String(n).padStart(w, "0");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 顾客端 API ---------- */
  const api = {
    init, cache,
    get PROVINCES() { return cache.provinces; },
    get SOURCES() { return cache.sources; },
    get LOGISTICS() { return cache.logistics; },

    getProducts() { return cache.products; },
    getProduct(id) { return cache.products.find(p => p.id === id); },

    /* 购物车（localStorage） */
    getCart() {
      try { return JSON.parse(localStorage.getItem("orange_cart") || "[]"); } catch (e) { return []; }
    },
    saveCart(cart) { localStorage.setItem("orange_cart", JSON.stringify(cart)); },
    addToCart(productId, spec, qty) {
      const p = this.getProduct(productId); if (!p) return;
      const cart = this.getCart();
      const mul = spec.indexOf("40") > -1 ? 4 : spec.indexOf("20") > -1 ? 2 : 1;
      const exist = cart.find(i => i.productId === productId && i.spec === spec);
      if (exist) exist.qty += qty; else cart.push({ productId, name: p.name, spec, price: p.price * mul, img: p.img, qty });
      this.saveCart(cart);
    },
    setQty(index, qty) {
      const cart = this.getCart();
      if (index < 0 || index >= cart.length) return;
      if (qty <= 0) cart.splice(index, 1); else cart[index].qty = qty;
      this.saveCart(cart);
    },
    clearCart() { localStorage.setItem("orange_cart", "[]"); },

    /* 下单（异步） */
    async placeOrder(form) {
      const cart = this.getCart();
      if (!cart.length) return null;
      const items = cart.map(i => ({ productId: i.productId, name: i.name, spec: i.spec, price: i.price, qty: i.qty }));
      const data = await http("/api/orders", {
        method: "POST",
        body: JSON.stringify({ items, customer: form, source: form.source, remark: form.remark })
      });
      // 下单后刷新缓存
      await refresh("orders"); await refresh("inventory"); await refresh("customers");
      this.clearCart();
      return data.order;
    },

    /* ---------- 管理端 API（读：同步从缓存；写：异步+刷新） ---------- */
    getOrders(filter) {
      let list = cache.orders.slice();
      if (filter) {
        if (filter.date) {
          const d = new Date(filter.date);
          const s = new Date(d).setHours(0, 0, 0, 0), e = new Date(d).setHours(23, 59, 59, 999);
          list = list.filter(o => o.createdAt >= s && o.createdAt <= e);
        }
        if (filter.pay) list = list.filter(o => o.payStatus === filter.pay);
        if (filter.ship && filter.ship !== "all") list = list.filter(o => o.shipStatus === filter.ship);
        if (filter.q) {
          const q = filter.q.trim().toLowerCase();
          list = list.filter(o => o.id.toLowerCase().includes(q) || o.customer.name.includes(q) || o.customer.phone.includes(q) || o.customer.address.includes(q));
        }
      }
      return list.sort((a, b) => b.createdAt - a.createdAt);
    },
    getOrder(id) { return cache.orders.find(o => o.id === id); },

    async updateOrder(id, patch) {
      await http("/api/orders/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(patch) });
      await refresh("orders");
    },
    async deleteOrder(id) {
      await http("/api/orders/" + encodeURIComponent(id), { method: "DELETE" });
      await refresh("orders"); await refresh("customers");
    },

    getCustomers() { return cache.customers; },

    getInventory() { return cache.inventory; },
    async updateStock(productId, total) {
      await http("/api/inventory/" + encodeURIComponent(productId), { method: "PATCH", body: JSON.stringify({ total }) });
      await refresh("inventory");
    },

    /* 概览（客户端从缓存计算） */
    getOverview(date) {
      const ds = date ? new Date(date).setHours(0, 0, 0, 0) : new Date().setHours(0, 0, 0, 0);
      const de = date ? new Date(date).setHours(23, 59, 59, 999) : new Date().setHours(23, 59, 59, 999);
      const todays = cache.orders.filter(o => o.createdAt >= ds && o.createdAt <= de);
      const orderCount = todays.length;
      const revenue = todays.reduce((s, o) => s + (o.payStatus === "paid" ? o.totalAmount : 0), 0);
      const pendingShip = todays.filter(o => o.payStatus === "paid" && o.shipStatus === "pending").length;
      const totalKg = todays.reduce((s, o) => s + o.items.reduce((x, i) => x + (i.spec.indexOf("40") > -1 ? 40 : i.spec.indexOf("20") > -1 ? 20 : 10) * i.qty, 0), 0);
      const prodMap = {};
      todays.forEach(o => o.items.forEach(i => { prodMap[i.name] = (prodMap[i.name] || 0) + i.qty; }));
      const hot = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
      return { orderCount, revenue, pendingShip, totalKg, hot };
    },

    /* 导出 CSV（客户端从缓存生成，带 BOM） */
    exportCSV(orders) {
      const head = ["订单号", "下单时间", "客户姓名", "联系电话", "省份", "城市", "区县", "详细地址", "商品", "规格", "单价", "数量", "金额", "支付状态", "发货状态", "物流公司", "物流单号", "订单来源", "客户备注", "内部备注"];
      const rows = orders.map(o => {
        const t = new Date(o.createdAt);
        const tstr = `${t.getFullYear()}-${pad(t.getMonth() + 1, 2)}-${pad(t.getDate(), 2)} ${pad(t.getHours(), 2)}:${pad(t.getMinutes(), 2)}`;
        return [o.id, tstr, o.customer.name, o.customer.phone, o.customer.province, o.customer.city, o.customer.district, o.customer.address,
          o.items.map(i => i.name).join(" + "), o.items.map(i => i.spec).join(" + "), o.items.map(i => i.price).join(" + "), o.items.map(i => i.qty).join(" + "), o.totalAmount,
          this.payLabel(o.payStatus), this.shipLabel(o.shipStatus), o.logisticsCompany, o.shippingNo, o.source, o.remark, o.internalNote];
      });
      const all = [head, ...rows];
      const csv = all.map(r => r.map(c => { const s = String(c == null ? "" : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
      return "\uFEFF" + csv;
    },

    download(filename, content, mime) {
      const blob = new Blob([content], { type: (mime || "text/plain") + ";charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    },

    /* 标签 */
    payLabel(s) { return { paid: "已支付", pending: "待付款" }[s] || s; },
    shipLabel(s) { return { pending: "待发货", shipped: "已发货", done: "已完成", cancel: "已取消" }[s] || s; },

    fmtTime(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`; },
    fmtDate(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`; },
    money(n) { return "¥" + Number(n).toLocaleString("zh-CN"); },
    todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`; }
  };

  global.Store = api;
})(window);
