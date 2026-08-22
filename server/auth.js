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

module.exports = {
  hashPassword, verifyPassword,
  genToken, genReferralCode, genUserId,
  createSession, getSessionUser,
  requireAuth, requireAdmin, requireAgent,
  setAuthCookie, cookieParser, getToken,
  SESSION_TTL,
};
