/* ============================================================
   脐橙庄园 · 认证模块
   - 密码哈希（crypto.scrypt，无需外部依赖）
   - 会话管理（token → userId）
   - 权限中间件（requireAuth / requireAdmin / requireAgent）
   - 推荐码生成
   ============================================================ */
const crypto = require("crypto");
const { DB } = require("./db");

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7天

/* ---------- 密码哈希 ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}

/* ---------- Token 生成 ---------- */
function genToken() {
  return crypto.randomBytes(32).toString("hex");
}

/* ---------- 推荐码生成 ---------- */
function genReferralCode(name) {
  const prefix = (name || "AG").slice(0, 2).toUpperCase().replace(/[^A-Z\u4e00-\u9fa5]/g, "");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return (prefix || "AG") + suffix;
}

/* ---------- 用户 ID 生成 ---------- */
function genUserId(role) {
  const prefix = role === "admin" ? "AD" : role === "agent" ? "AG" : "CU";
  return prefix + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase();
}

/* ---------- 会话管理 ---------- */
async function createSession(userId) {
  const token = genToken();
  await DB.createSession(token, userId, Date.now() + SESSION_TTL);
  return token;
}

async function getSessionUser(token) {
  if (!token) return null;
  const session = await DB.getSession(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) { await DB.deleteSession(token); return null; }
  const user = await DB.findUserById(session.userId);
  return user ? { ...user, _token: token } : null;
}

/* ---------- 权限中间件 ---------- */
function getToken(req) {
  // 优先从 Cookie 取
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)auth_token=([^;]+)/);
  if (m) return m[1];
  // 其次从 Authorization header
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  // 最后从 query
  return req.query.token || "";
}

async function requireAuth(req, res, next) {
  const token = getToken(req);
  const user = await getSessionUser(token);
  if (!user) return res.status(401).json({ error: "请先登录" });
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  const token = getToken(req);
  const user = await getSessionUser(token);
  if (!user) return res.status(401).json({ error: "请先登录" });
  if (user.role !== "admin") return res.status(403).json({ error: "无权限" });
  req.user = user;
  next();
}

async function requireAgent(req, res, next) {
  const token = getToken(req);
  const user = await getSessionUser(token);
  if (!user) return res.status(401).json({ error: "请先登录" });
  if (user.role !== "agent" && user.role !== "admin") return res.status(403).json({ error: "无权限" });
  req.user = user;
  next();
}

/* ---------- Cookie 设置 ---------- */
function setAuthCookie(res, token) {
  res.cookie("auth_token", token, {
    httpOnly: true,
    maxAge: SESSION_TTL,
    sameSite: "lax",
    path: "/",
  });
}

/* Express 5 cookie 解析（简单实现） */
function cookieParser(req, res, next) {
  const cookie = req.headers.cookie || "";
  req.cookies = {};
  cookie.split(";").forEach(c => {
    const [k, ...v] = c.trim().split("=");
    if (k) req.cookies[k] = decodeURIComponent(v.join("="));
  });
  next();
}

/* ============================================================
   图形验证码（纯本地实现，零依赖）
   - 生成 SVG 图片 + 随机干扰线
   - 内存存储，5 分钟过期
   ============================================================ */
const CAPTCHA_TTL = 5 * 60 * 1000; // 5 分钟
const captchaStore = new Map(); // captchaId -> { code, expiresAt, used }
// 频率限制：IP -> { count, resetAt }
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 小时窗口
const RATE_LIMIT_MAX = 10; // 每小时最多 10 次注册尝试

// 排除易混淆字符
const CAPTCHA_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
const CAPTCHA_COLORS = ["#1F4A2E", "#B0521E", "#2C5F8A", "#8B2C5F", "#4A6B1F"];

function genCaptchaCode(len) {
  len = len || 4;
  let code = "";
  for (let i = 0; i < len; i++) code += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
  return code;
}

function genCaptchaId() {
  return crypto.randomBytes(12).toString("hex");
}

/* 生成 SVG 验证码图片 */
function createCaptchaSVG(code) {
  const width = 130, height = 48;
  const chars = code.split("");
  // 随机干扰线
  let lines = "";
  for (let i = 0; i < 4; i++) {
    const x1 = Math.random() * width, y1 = Math.random() * height;
    const x2 = Math.random() * width, y2 = Math.random() * height;
    const color = CAPTCHA_COLORS[Math.floor(Math.random() * CAPTCHA_COLORS.length)];
    lines += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="1" opacity="0.3"/>`;
  }
  // 随机干扰点
  let dots = "";
  for (let i = 0; i < 30; i++) {
    const cx = Math.random() * width, cy = Math.random() * height;
    const color = CAPTCHA_COLORS[Math.floor(Math.random() * CAPTCHA_COLORS.length)];
    dots += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="1" fill="${color}" opacity="0.4"/>`;
  }
  // 每个字符随机颜色、旋转、位置
  const charW = width / (chars.length + 1);
  let charEls = "";
  chars.forEach((ch, i) => {
    const x = charW * (i + 0.7) + charW * 0.15;
    const y = height / 2 + (Math.random() * 8 - 4);
    const rot = Math.random() * 30 - 15; // -15~15度
    const color = CAPTCHA_COLORS[Math.floor(Math.random() * CAPTCHA_COLORS.length)];
    const size = 22 + Math.random() * 6;
    charEls += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size.toFixed(1)}" font-family="Arial, sans-serif" font-weight="bold" fill="${color}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${ch}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#F8F9F5" rx="8"/>
    ${lines}
    ${dots}
    ${charEls}
  </svg>`;
}

/* 生成验证码（返回 captchaId + SVG 图片） */
function generateCaptcha() {
  // 清理过期条目
  const now = Date.now();
  for (const [key, val] of captchaStore) {
    if (val.expiresAt < now) captchaStore.delete(key);
  }
  const captchaId = genCaptchaId();
  const code = genCaptchaCode(4);
  captchaStore.set(captchaId, { code, expiresAt: now + CAPTCHA_TTL, used: false });
  const svg = createCaptchaSVG(code);
  return { captchaId, svg };
}

/* 验证验证码（验证后立即作废，一次性使用） */
function verifyCaptcha(captchaId, code) {
  if (!captchaId || !code) return false;
  const entry = captchaStore.get(captchaId);
  if (!entry) return false;
  // 已使用过
  if (entry.used) return false;
  // 已过期
  if (Date.now() > entry.expiresAt) { captchaStore.delete(captchaId); return false; }
  // 标记已使用
  entry.used = true;
  // 验证（忽略大小写）
  const ok = entry.code.toLowerCase() === String(code).trim().toLowerCase();
  // 无论对错都删除（防止暴力枚举）
  captchaStore.delete(captchaId);
  return ok;
}

/* 频率限制检查（按 IP） */
function checkRateLimit(ip) {
  const now = Date.now();
  // 清理过期窗口
  for (const [key, val] of rateLimitStore) {
    if (val.resetAt < now) rateLimitStore.delete(key);
  }
  let entry = rateLimitStore.get(ip);
  if (!entry) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimitStore.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    const remaining = Math.ceil((entry.resetAt - now) / 60000);
    return { allowed: false, remaining };
  }
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

/* 获取客户端 IP */
function getClientIP(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket && req.socket.remoteAddress || "unknown";
}

module.exports = {
  hashPassword, verifyPassword,
  genToken, genReferralCode, genUserId,
  createSession, getSessionUser,
  requireAuth, requireAdmin, requireAgent,
  setAuthCookie, cookieParser, getToken,
  generateCaptcha, verifyCaptcha, checkRateLimit, getClientIP,
  SESSION_TTL, CAPTCHA_TTL,
};
