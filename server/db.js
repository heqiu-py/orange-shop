/* ============================================================
   脐橙庄园 · 数据持久层（双后端）
   - 部署时设置环境变量 DATABASE_URL → 使用 PostgreSQL（永久保存）
   - 本地未设置时 → 回退到 JSON 文件（预览用）
   读：内存缓存同步返回（server.js 读取逻辑无需改动）
   写：异步落库 + 同步刷新缓存
   ============================================================ */
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");
const DATABASE_URL = process.env.DATABASE_URL;

/* ---------- 商品/常量（静态） ---------- */
const PRODUCTS = [
  { id: "P01", name: "特级脐橙·果王", grade: "特级果", price: 88, unit: "箱", img: "assets/images/p-grade1.jpg", desc: "果径80mm以上，单果约280g，糖度14°+，皮薄多汁，送礼自留两相宜。", specs: ["10斤装", "20斤装"], tags: ["当季鲜果", "送礼推荐"] },
  { id: "P02", name: "一级脐橙·精选", grade: "一级果", price: 58, unit: "箱", img: "assets/images/p-grade2.jpg", desc: "果径70-80mm，手工筛选，酸甜均衡，家庭日常口粮首选。", specs: ["10斤装", "20斤装"], tags: ["高性价比", "家庭装"] },
  { id: "P03", name: "精品礼盒·心意装", grade: "礼盒装", price: 128, unit: "盒", img: "assets/images/p-giftbox.jpg", desc: "12枚精装礼盒，烫金提袋，附手写卡片，节日送礼体面之选。", specs: ["12枚装", "24枚装"], tags: ["节日礼品", "含卡片"] },
  { id: "P04", name: "脐橙鲜榨·整箱果", grade: "大果装", price: 46, unit: "箱", img: "assets/images/p-grade2.jpg", desc: "果径65mm以上，出汁率高，适合鲜榨果汁、果切，量大从优。", specs: ["20斤装", "40斤装"], tags: ["鲜榨专用", "量大从优"] }
];
const PROVINCES = ["北京市", "上海市", "广东省", "浙江省", "江苏省", "福建省", "山东省", "四川省", "湖北省", "湖南省", "河南省", "安徽省", "江西省", "重庆市", "陕西省", "辽宁省", "云南省", "广西壮族自治区", "其他"];
const SOURCES = ["微信私聊", "朋友圈", "朋友推荐", "公众号", "抖音", "老客复购", "搜索"];
const LOGISTICS = ["顺丰速运", "京东物流", "中通快递", "圆通速递", "邮政EMS", "德邦快递"];

/* ---------- 种子数据生成 ---------- */
const SURNAMES = ["李", "王", "张", "刘", "陈", "杨", "黄", "赵", "吴", "周", "徐", "孙", "马", "朱", "胡", "林", "郭", "何", "高", "罗"];
const GIVENS = ["伟", "芳", "娜", "敏", "静", "丽", "强", "磊", "军", "洋", "勇", "艳", "杰", "娟", "涛", "明", "霞", "平", "刚", "桂英"];
const CITIES = [
  { p: "广东省", c: ["广州市", "深圳市", "东莞市", "佛山市"], d: ["天河区", "南山区", "长安镇", "禅城区"], a: ["体育西路", "科技园路", "锦绣路", "季华路"] },
  { p: "浙江省", c: ["杭州市", "宁波市", "温州市"], d: ["西湖区", "鄞州区", "鹿城区"], a: ["文三路", "四明中路", "车站大道"] },
  { p: "江苏省", c: ["南京市", "苏州市", "无锡市"], d: ["鼓楼区", "姑苏区", "梁溪区"], a: ["中山路", "干将路", "人民路"] },
  { p: "北京市", c: ["北京市"], d: ["朝阳区", "海淀区", "丰台区"], a: ["建国路", "中关村大街", "南三环"] },
  { p: "四川省", c: ["成都市", "绵阳市"], d: ["锦江区", "涪城区"], a: ["春熙路", "临园路"] },
  { p: "湖北省", c: ["武汉市"], d: ["武昌区", "洪山区"], a: ["中南路", "珞狮路"] },
  { p: "福建省", c: ["福州市", "厦门市"], d: ["鼓楼区", "思明区"], a: ["八一七路", "鹭江道"] },
  { p: "山东省", c: ["济南市", "青岛市"], d: ["历下区", "市南区"], a: ["泉城路", "香港中路"] }
];
const rnd = a => a[Math.floor(Math.random() * a.length)];
const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pad = (n, w) => String(n).padStart(w, "0");
const genName = () => rnd(SURNAMES) + rnd(GIVENS);
const genPhone = () => "1" + rnd(["3", "5", "7", "8", "9"]) + String(rndInt(100000000, 999999999)).slice(0, 9);
function genAddr() { const ci = rnd(CITIES); return { province: ci.p, city: rnd(ci.c), district: rnd(ci.d), address: rnd(ci.a) + rndInt(1, 220) + "号" + rndInt(1, 30) + "栋" + rndInt(101, 2099) + "室" }; }
function dayOffset(days, h, m) { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(h || rndInt(8, 21), m || rndInt(0, 59), 0, 0); return d.getTime(); }

function buildOrder(seq, daysAgo, forceStatus) {
  const p = rnd(PRODUCTS), spec = rnd(p.specs), qty = rndInt(1, 4), addr = genAddr();
  const statusPool = forceStatus || rnd(["paid", "paid", "paid", "shipped", "pending", "done"]);
  const ts = dayOffset(daysAgo), d = new Date(ts);
  const no = "NC" + d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) + pad(seq, 4);
  const unitMul = spec.indexOf("40") > -1 ? 4 : spec.indexOf("20") > -1 ? 2 : 1;
  const subtotal = p.price * qty * unitMul;
  const o = {
    id: no, createdAt: ts,
    customer: { name: genName(), phone: genPhone(), ...addr },
    items: [{ productId: p.id, name: p.name, spec, price: p.price * unitMul, qty, subtotal }],
    totalAmount: subtotal, freight: 0,
    payStatus: statusPool === "pending" ? "pending" : "paid",
    shipStatus: statusPool === "pending" ? "pending" : statusPool === "shipped" ? "shipped" : statusPool === "done" ? "done" : "pending",
    shippingNo: (statusPool === "shipped" || statusPool === "done") ? rnd(LOGISTICS).slice(0, 1) + "T" + rndInt(100000000, 999999999) : "",
    logisticsCompany: (statusPool === "shipped" || statusPool === "done") ? rnd(LOGISTICS) : "",
    source: rnd(SOURCES),
    remark: rnd(["", "", "请尽快发货", "送人，包装好一点", "周末送达", "不要放快递柜", "打电话提前联系"]),
    internalNote: rnd(["", "", "老客户", "团购", "加急处理"])
  };
  if (Math.random() < 0.25) {
    const p2 = rnd(PRODUCTS), sp2 = rnd(p2.specs), q2 = rndInt(1, 2);
    const mul2 = sp2.indexOf("40") > -1 ? 4 : sp2.indexOf("20") > -1 ? 2 : 1;
    o.items.push({ productId: p2.id, name: p2.name, spec: sp2, price: p2.price * mul2, qty: q2, subtotal: p2.price * mul2 * q2 });
    o.totalAmount += p2.price * mul2 * q2;
  }
  return o;
}
function seedOrders() {
  const arr = []; let seq = 1;
  for (let i = 0; i < 6; i++) arr.push(buildOrder(seq++, 0, i < 2 ? "pending" : i === 2 ? "shipped" : "paid"));
  for (let i = 0; i < 9; i++) arr.push(buildOrder(seq++, 1, i < 4 ? "shipped" : i > 7 ? "done" : "paid"));
  for (let i = 0; i < 7; i++) arr.push(buildOrder(seq++, 2, i < 3 ? "shipped" : i > 5 ? "done" : "paid"));
  for (let d = 3; d <= 8; d++) { const n = rndInt(2, 6); for (let i = 0; i < n; i++) arr.push(buildOrder(seq++, d)); }
  return arr;
}
function seedInventory() {
  return PRODUCTS.map(p => ({ productId: p.id, name: p.name, img: p.img, total: p.id === "P03" ? 500 : 2000, sold: p.id === "P03" ? 312 : p.id === "P02" ? 1680 : 420, threshold: p.id === "P03" ? 80 : 200 }));
}

/* ============================================================
   存储：双后端统一接口
   ============================================================ */
const cache = { products: PRODUCTS, orders: [], inventory: [], seq: 1 };

let pool = null; // PG 连接池（仅 DATABASE_URL 时）

async function pg() {
  if (pool) return pool;
  const { Pool } = require("pg");
  // 去掉 channel_binding 参数（Neon 追加的，pg 驱动不需要，可能报错）
  const connStr = DATABASE_URL.replace(/&?channel_binding=require/, "");
  pool = new Pool({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false } // Neon / Render PG 均需 SSL
  });
  return pool;
}

async function ensureSchema() {
  const p = await pg();
  await p.query(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at BIGINT NOT NULL)`);
  await p.query(`CREATE TABLE IF NOT EXISTS inventory (product_id TEXT PRIMARY KEY, data JSONB NOT NULL)`);
  await p.query(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, val TEXT NOT NULL)`);
}

/* ---------- 初始化（启动时调用一次） ---------- */
async function init() {
  if (DATABASE_URL) {
    await ensureSchema();
    const p = await pg();
    // 加载订单
    const { rows: oRows } = await p.query("SELECT data FROM orders ORDER BY (data->>'createdAt')::bigint DESC");
    cache.orders = oRows.map(r => r.data);
    // 加载库存，空则种子化
    const { rows: iRows } = await p.query("SELECT data FROM inventory");
    if (!iRows.length) {
      const seeds = seedInventory();
      for (const inv of seeds) await p.query("INSERT INTO inventory (product_id, data) VALUES ($1, $2) ON CONFLICT DO NOTHING", [inv.productId, JSON.stringify(inv)]);
      cache.inventory = seeds;
    } else {
      cache.inventory = iRows.map(r => r.data);
    }
    // 订单空则种子化
    if (!cache.orders.length) {
      const seeds = seedOrders();
      for (const o of seeds) await p.query("INSERT INTO orders (id, data, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [o.id, JSON.stringify(o), o.createdAt]);
      cache.orders = seeds.sort((a, b) => b.createdAt - a.createdAt);
      await p.query("INSERT INTO meta (key, val) VALUES ('seq', '1') ON CONFLICT DO NOTHING");
    }
    // seq
    const { rows: mRows } = await p.query("SELECT val FROM meta WHERE key='seq'");
    cache.seq = mRows.length ? parseInt(mRows[0].val, 10) : 1;
    console.log(`  [DB] PostgreSQL 已连接：${cache.orders.length} 条订单 / ${cache.inventory.length} 项库存`);
  } else {
    // JSON 文件回退
    if (fs.existsSync(DATA_FILE)) {
      try { const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); cache.orders = d.orders || []; cache.inventory = d.inventory || []; cache.seq = d.seq || 1; }
      catch (e) { cache.orders = seedOrders(); cache.inventory = seedInventory(); cache.seq = 1; saveJSON(); }
    } else {
      cache.orders = seedOrders(); cache.inventory = seedInventory(); cache.seq = 1; saveJSON();
    }
    console.log(`  [DB] JSON 文件模式（预览）：${cache.orders.length} 条订单 / ${cache.inventory.length} 项库存`);
  }
}

function saveJSON() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ products: PRODUCTS, orders: cache.orders, inventory: cache.inventory, seq: cache.seq }, null, 2));
}

/* ---------- 读：同步返回缓存 ---------- */
function all() { return cache; }

/* ---------- 写：异步落库 + 刷新缓存 ---------- */
async function nextSeq() {
  cache.seq = (cache.seq || 0) + 1;
  if (DATABASE_URL) { const p = await pg(); await p.query("INSERT INTO meta (key, val) VALUES ('seq', $1) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val", [String(cache.seq)]); }
  else saveJSON();
  return cache.seq;
}

async function insertOrder(order) {
  cache.orders.unshift(order);
  // 扣库存
  order.items.forEach(it => { const inv = cache.inventory.find(v => v.productId === it.productId); if (inv) inv.sold += it.qty; });
  if (DATABASE_URL) {
    const p = await pg();
    await p.query("INSERT INTO orders (id, data, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [order.id, JSON.stringify(order), order.createdAt]);
    for (const it of order.items) {
      const inv = cache.inventory.find(v => v.productId === it.productId);
      if (inv) await p.query("INSERT INTO inventory (product_id, data) VALUES ($1, $2) ON CONFLICT (product_id) DO UPDATE SET data = EXCLUDED.data", [it.productId, JSON.stringify(inv)]);
    }
  } else saveJSON();
}

async function updateOrder(id, patch) {
  const o = cache.orders.find(x => x.id === id);
  if (!o) return null;
  Object.assign(o, patch);
  if (DATABASE_URL) { const p = await pg(); await p.query("UPDATE orders SET data = $1 WHERE id = $2", [JSON.stringify(o), id]); }
  else saveJSON();
  return o;
}

async function deleteOrder(id) {
  const i = cache.orders.findIndex(x => x.id === id);
  if (i < 0) return false;
  cache.orders.splice(i, 1);
  if (DATABASE_URL) { const p = await pg(); await p.query("DELETE FROM orders WHERE id = $1", [id]); }
  else saveJSON();
  return true;
}

async function updateInventory(productId, total) {
  const inv = cache.inventory.find(v => v.productId === productId);
  if (!inv) return null;
  inv.total = Math.max(0, total | 0);
  if (DATABASE_URL) { const p = await pg(); await p.query("INSERT INTO inventory (product_id, data) VALUES ($1, $2) ON CONFLICT (product_id) DO UPDATE SET data = EXCLUDED.data", [productId, JSON.stringify(inv)]); }
  else saveJSON();
  return inv;
}

async function reset() {
  if (DATABASE_URL) {
    const p = await pg();
    await p.query("DELETE FROM orders");
    await p.query("DELETE FROM inventory");
    await p.query("DELETE FROM meta");
  } else if (fs.existsSync(DATA_FILE)) { fs.unlinkSync(DATA_FILE); }
  cache.orders = []; cache.inventory = []; cache.seq = 1;
  await init(); // 重新种子化
  return true;
}

const DB = {
  PRODUCTS, PROVINCES, SOURCES, LOGISTICS,
  init, all,
  nextSeq, insertOrder, updateOrder, deleteOrder, updateInventory, reset
};

module.exports = { DB };
