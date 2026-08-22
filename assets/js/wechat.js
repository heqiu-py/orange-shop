/* ============================================================
   微信内嵌 / 移动端增强工具
   - 检测微信浏览器环境
   - 移动端底部固定栏（购物车/结算）
   - 客服浮窗
   - 复制到剪贴板
   - 分享辅助
   ============================================================ */
(function (global) {
  "use strict";

  /* ---------- 微信环境检测 ---------- */
  var ua = navigator.userAgent.toLowerCase();
  var isWechat = ua.indexOf("micromessenger") > -1;
  var isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
  var isIOS = /iphone|ipad|ipod/.test(ua);

  if (isWechat) document.body.classList.add("in-wechat");
  if (isMobile) document.body.classList.add("is-mobile");

  /* ---------- 复制到剪贴板 ---------- */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // 降级方案
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  /* ---------- Toast 提示 ---------- */
  function toast(msg, type) {
    var wrap = document.querySelector(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toast-wrap";
      document.body.appendChild(wrap);
    }
    var t = document.createElement("div");
    t.className = "toast " + (type || "ok");
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.opacity = "0";
      t.style.transform = "translateX(20px)";
      t.style.transition = "all .3s";
      setTimeout(function () { t.remove(); }, 300);
    }, 2500);
  }

  /* ---------- 移动端底部固定栏 ---------- */
  function initMobileBottomBar() {
    if (!isMobile) return;
    var bar = document.querySelector(".mobile-bottom-bar");
    if (!bar) return;

    // 页面滚动时显示/隐藏底部栏
    var lastScroll = 0;
    window.addEventListener("scroll", function () {
      var cur = window.scrollY;
      if (cur > 200 && cur < lastScroll) {
        // 向上滚 → 显示
        bar.classList.add("show");
        document.body.classList.add("has-bottom-bar");
      } else if (cur > lastScroll && cur > 300) {
        // 向下滚 → 隐藏
        bar.classList.remove("show");
        document.body.classList.remove("has-bottom-bar");
      }
      lastScroll = cur;
    });

    // 在页面顶部也显示
    if (window.scrollY < 200) {
      bar.classList.add("show");
      document.body.classList.add("has-bottom-bar");
    }
  }

  /* ---------- 客服浮窗 ---------- */
  function initServiceFab() {
    var fab = document.querySelector(".service-fab");
    if (!fab) return;
    fab.addEventListener("click", function () {
      var modal = document.createElement("div");
      modal.style.cssText = "position:fixed;inset:0;z-index:200;background:rgba(34,30,24,.5);display:flex;align-items:center;justify-content:center;padding:24px";
      modal.innerHTML =
        '<div style="background:#fff;border-radius:16px;padding:28px;max-width:320px;width:100%;text-align:center">' +
        '<h3 style="color:var(--green);font-family:var(--font-serif);font-size:20px;margin-bottom:12px">联系客服</h3>' +
        '<p style="color:var(--muted);font-size:14px;margin-bottom:16px">长按识别二维码，添加微信咨询</p>' +
        '<div style="width:180px;height:180px;margin:0 auto 16px;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:var(--cream-2);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px">' +
        '客服二维码（店主上传后显示）</div>' +
        '<button class="btn" style="width:100%;margin-top:8px">关闭</button></div>';
      document.body.appendChild(modal);
      modal.addEventListener("click", function (e) {
        if (e.target === modal || e.target.classList.contains("btn")) modal.remove();
      });
    });
  }

  /* ---------- 微信分享 Meta 设置 ---------- */
  function setupShareMeta() {
    if (!isWechat) return;
    // 微信内置浏览器分享依赖微信 JS-SDK
    // 此处仅设置基础 meta，完整分享需后端配置 jsapi
    var title = document.querySelector("meta[name='share-title']");
    var desc = document.querySelector("meta[name='share-desc']");
    if (title && desc) {
      document.title = title.content || document.title;
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    initMobileBottomBar();
    initServiceFab();
    setupShareMeta();

    // 绑定所有 copy-btn
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".copy-btn");
      if (!btn) return;
      var text = btn.getAttribute("data-copy");
      if (!text) return;
      copyText(text).then(function () {
        toast("已复制：" + text, "ok");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ---------- 导出 ---------- */
  global.WeChatUtil = {
    isWechat: isWechat,
    isMobile: isMobile,
    isIOS: isIOS,
    copyText: copyText,
    toast: toast,
  };
})(window);
