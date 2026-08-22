/* ============================================================
   脐橙庄园 · 后端服务
   Express 单进程：提供 API + 托管前端静态页
   部署：node server/server.js  (默认 8000 端口)
   ============================================================ */
const express = require("express");
const path = require("path");
const QRCode = require("qrcode");
const { DB } = require("./db");

const app = express();
const PORT = process.env.PORT || 8000;
const STATIC_ROOT = path.join(__dirname, ".."); // /workspace

app.use(express.json());

/* 简单访问日志 */
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

/* ============================================================
   工具
   ============================================================ */
const pad = (n, w) => String(n).padStart(w, "0");
const fmtTime = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`; };
const fmtDate = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`; };
const money = n => "¥" + Number(n).toLocaleString("zh-CN");
const payLabel = s => ({ paid: "已支付", pending: "待付款" }[s] || s);
const shipLabel = s => ({ pending: "待发货", shipped: "已发货", done: "已完成", cancel: "已取消" }[s] || s);

function dayStartEnd(dateStr) {
  const d = new Date(dateStr);
  return [new Date(d).setHours(0, 0, 0, 0), new Date(d).setHours(23, 59, 59, 999)];
}

function filterOrders(orders, f) {
  let list = orders.slice();
  if (f.date) { const [s, e] = dayStartEnd(f.date); list = list.filter(o => o.createdAt >= s && o.createdAt <= e); }
  if (f.pay) list = list.filter(o => o.payStatus === f.pay);
  if (f.ship) list = list.filter(o => o.shipStatus === f.ship);
  if (f.q) { const q = f.q.trim().toLowerCase(); list = list.filter(o => o.id.toLowerCase().includes(q) || o.customer.name.includes(q) || o.customer.phone.includes(q) || o.customer.address.includes(q)); }
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

/* ============================================================
   顾客端 API
   ============================================================ */

/* 商品列表 */
app.get("/api/products", (req, res) => {
  res.json({ products: DB.PRODUCTS });
});

/* 商品详情 */
app.get("/api/products/:id", (req, res) => {
  const p = DB.PRODUCTS.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "商品不存在" });
  res.json({ product: p });
});

/* 常量（省市/来源/物流公司） */
app.get("/api/constants", (req, res) => {
  res.json({ provinces: DB.PROVINCES, sources: DB.SOURCES, logistics: DB.LOGISTICS });
});

/* 下单 */
app.post("/api/orders", async (req, res) => {
  const { items, customer, source, remark } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "购物车为空" });
  if (!customer || !customer.name || !customer.phone || !customer.province || !customer.address)
    return res.status(400).json({ error: "收货信息不完整" });
  if (!/^1\d{10}$/.test(customer.phone)) return res.status(400).json({ error: "手机号格式不正确" });

  const orderItems = items.map(i => ({ productId: i.productId, name: i.name, spec: i.spec, price: i.price, qty: i.qty, subtotal: i.price * i.qty }));
  const total = orderItems.reduce((s, i) => s + i.subtotal, 0);
  const now = Date.now();
  const d = new Date(now);
  const seq = await DB.nextSeq();
  const no = "NC" + d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) + pad(seq, 4);

  const order = {
    id: no, createdAt: now,
    customer: { name: customer.name, phone: customer.phone, province: customer.province, city: customer.city || "", district: customer.district || "", address: customer.address },
    items: orderItems, totalAmount: total, freight: 0,
    payStatus: "pending", shipStatus: "pending",
    shippingNo: "", logisticsCompany: "",
    source: source || "微信私聊", remark: remark || "", internalNote: ""
  };
  await DB.insertOrder(order);
  res.json({ order });
});

/* ============================================================
   管理端 API
   ============================================================ */

/* 订单列表（带筛选） */
app.get("/api/orders", (req, res) => {
  const db = DB.all();
  const f = { date: req.query.date || "", pay: req.query.pay || "", ship: req.query.ship || "", q: req.query.q || "" };
  const list = filterOrders(db.orders, f.ship === "all" ? { ...f, ship: "" } : f);
  res.json({ orders: list, total: list.length });
});

/* 导出 CSV（须在 :id 路由之前，避免 "export" 被当作订单号） */
app.get("/api/orders/export", (req, res) => {
  const db = DB.all();
  const f = { date: req.query.date || "", pay: req.query.pay || "", ship: req.query.ship === "all" ? "" : (req.query.ship || ""), q: req.query.q || "" };
  const orders = filterOrders(db.orders, f);
  const head = ["订单号", "下单时间", "客户姓名", "联系电话", "省份", "城市", "区县", "详细地址", "商品", "规格", "单价", "数量", "金额", "支付状态", "发货状态", "物流公司", "物流单号", "订单来源", "客户备注", "内部备注"];
  const rows = orders.map(o => [
    o.id, fmtTime(o.createdAt), o.customer.name, o.customer.phone, o.customer.province, o.customer.city, o.customer.district, o.customer.address,
    o.items.map(i => i.name).join(" + "), o.items.map(i => i.spec).join(" + "), o.items.map(i => i.price).join(" + "), o.items.map(i => i.qty).join(" + "), o.totalAmount,
    payLabel(o.payStatus), shipLabel(o.shipStatus), o.logisticsCompany, o.shippingNo, o.source, o.remark, o.internalNote
  ]);
  const all = [head, ...rows];
  const csv = all.map(r => r.map(c => { const s = String(c == null ? "" : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
  const tag = f.date || "全部";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent("订单统计_" + tag + ".csv")}`);
  res.send("\uFEFF" + csv);
});

/* 订单详情 */
app.get("/api/orders/:id", (req, res) => {
  const db = DB.all();
  const o = db.orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: "订单不存在" });
  res.json({ order: o });
});

/* 更新订单 */
app.patch("/api/orders/:id", async (req, res) => {
  const allow = ["payStatus", "shipStatus", "shippingNo", "logisticsCompany", "remark", "internalNote"];
  const patch = {};
  allow.forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const o = await DB.updateOrder(req.params.id, patch);
  if (!o) return res.status(404).json({ error: "订单不存在" });
  res.json({ order: o });
});

/* 删除订单 */
app.delete("/api/orders/:id", async (req, res) => {
  const ok = await DB.deleteOrder(req.params.id);
  if (!ok) return res.status(404).json({ error: "订单不存在" });
  res.json({ ok: true });
});

/* 库存列表 */
app.get("/api/inventory", (req, res) => {
  res.json({ inventory: DB.all().inventory });
});

/* 更新库存 */
app.patch("/api/inventory/:productId", async (req, res) => {
  const cur = DB.all().inventory.find(v => v.productId === req.params.productId);
  if (!cur) return res.status(404).json({ error: "商品不存在" });
  if (req.body.total === undefined) return res.json({ inventory: cur });
  const inv = await DB.updateInventory(req.params.productId, req.body.total);
  res.json({ inventory: inv });
});

/* 客户列表（按手机号归集） */
app.get("/api/customers", (req, res) => {
  const db = DB.all();
  const map = new Map();
  db.orders.forEach(o => {
    const k = o.customer.phone;
    if (!map.has(k)) map.set(k, { phone: k, name: o.customer.name, address: `${o.customer.province}${o.customer.city}${o.customer.district}${o.customer.address}`, orders: 0, total: 0, lastAt: 0, source: o.source });
    const c = map.get(k);
    c.orders++; c.total += o.totalAmount; c.lastAt = Math.max(c.lastAt, o.createdAt);
  });
  const list = Array.from(map.values()).sort((a, b) => b.total - a.total);
  res.json({ customers: list, total: list.length });
});

/* 概览统计 */
app.get("/api/stats/overview", (req, res) => {
  const db = DB.all();
  const date = req.query.date || fmtDate(Date.now());
  const [s, e] = dayStartEnd(date);
  const todays = db.orders.filter(o => o.createdAt >= s && o.createdAt <= e);
  const orderCount = todays.length;
  const revenue = todays.reduce((sum, o) => sum + (o.payStatus === "paid" ? o.totalAmount : 0), 0);
  const pendingShip = todays.filter(o => o.payStatus === "paid" && o.shipStatus === "pending").length;
  const totalKg = todays.reduce((sum, o) => sum + o.items.reduce((x, i) => x + (i.spec.indexOf("40") > -1 ? 40 : i.spec.indexOf("20") > -1 ? 20 : 10) * i.qty, 0), 0);
  const prodMap = {};
  todays.forEach(o => o.items.forEach(i => { prodMap[i.name] = (prodMap[i.name] || 0) + i.qty; }));
  const hot = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, qty]) => ({ name, qty }));

  // 昨日订单数
  const yd = new Date(date); yd.setDate(yd.getDate() - 1);
  const [ys, ye] = dayStartEnd(fmtDate(yd.getTime()));
  const yesterdayCount = db.orders.filter(o => o.createdAt >= ys && o.createdAt <= ye).length;

  res.json({ date, orderCount, revenue, pendingShip, totalKg, hot, yesterdayCount, lowStock: db.inventory.filter(i => (i.total - i.sold) < i.threshold) });
});

/* 导出客户 CSV */
app.get("/api/customers/export", (req, res) => {
  const db = DB.all();
  const map = new Map();
  db.orders.forEach(o => {
    const k = o.customer.phone;
    if (!map.has(k)) map.set(k, { phone: k, name: o.customer.name, address: `${o.customer.province}${o.customer.city}${o.customer.district}${o.customer.address}`, orders: 0, total: 0, lastAt: 0, source: o.source });
    const c = map.get(k); c.orders++; c.total += o.totalAmount; c.lastAt = Math.max(c.lastAt, o.createdAt);
  });
  const custs = Array.from(map.values()).sort((a, b) => b.total - a.total);
  const head = ["姓名", "电话", "地址", "下单次数", "累计金额", "来源", "最近下单"];
  const rows = custs.map(c => [c.name, c.phone, c.address, c.orders, c.total, c.source, fmtDate(c.lastAt)]);
  const csv = [head, ...rows].map(r => r.map(x => { const s = String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent("客户列表.csv")}`);
  res.send("\uFEFF" + csv);
});

/* 重置示例数据（调试用） */
app.post("/api/admin/reset", async (req, res) => {
  await DB.reset();
  res.json({ ok: true, msg: "已重置为示例数据" });
});

/* ---------- QR 码生成 ---------- */
app.get("/api/qrcode", async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).json({ error: "缺少 text 参数" });
  try {
    const png = await QRCode.toBuffer(text, { width: 300, margin: 1, color: { dark: "#1F4A2E", light: "#FFFFFF" } });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(png);
  } catch (e) { res.status(500).json({ error: "QR生成失败" }); }
});

/* ---------- 站点配置（可后续扩展为数据库存储） ---------- */
const SITE_CONFIG = {
  shopName: "橙园直供",
  wechatId: "",        // 店主微信号（用户后续填入）
  customerService: "", // 客服微信二维码图片URL（用户后续上传）
  announcement: "当季鲜橙 · 现摘现发 · 48小时内产地直发 · 满3箱包邮",
  freeShippingThreshold: 3, // 满3箱包邮
};
app.get("/api/config", (req, res) => res.json(SITE_CONFIG));

/* ---------- 健康检查 ---------- */
app.get("/api/health", (req, res) => res.json({ ok: true, time: Date.now() }));

/* ============================================================
   静态托管前端
   ============================================================ */
app.use(express.static(STATIC_ROOT, { extensions: ["html"], index: "index.html" }));
// SPA 回退：非 /api 且非文件 → 回首页
app.get(/^\/(?!api).*/, (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(STATIC_ROOT, "index.html"));
});

// 启动：先初始化数据库（PG 或 JSON），再监听端口
DB.init().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  🍊 橙园直供服务已启动`);
    console.log(`     店铺首页:  http://localhost:${PORT}/`);
    console.log(`     管理后台:  http://localhost:${PORT}/admin.html`);
    console.log(`     API 健康检查: http://localhost:${PORT}/api/health\n`);
  });
}).catch(err => {
  console.error("\n  [启动失败] 数据库初始化出错：", err.message, "\n");
  process.exit(1);
});
