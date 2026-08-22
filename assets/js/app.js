/* ============================================================
   顾客端逻辑：商品渲染 / 购物车 / 加购
   ============================================================ */
(function (global) {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const selectedSpec = {}; // productId -> spec

  function toast(msg, type) {
    const wrap = $("#toastWrap");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "toast " + (type || "ok");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 1800);
    setTimeout(() => el.remove(), 2200);
  }

  function renderProducts() {
    const grid = $("#productGrid");
    if (!grid) return;
    const products = Store.getProducts();
    grid.innerHTML = products.map(p => {
      selectedSpec[p.id] = selectedSpec[p.id] || p.specs[0];
      return `
      <article class="pcard">
        <div class="ph-img" style="background-image:url('${p.img}')">
          <span class="tag tag-orange grade">${p.grade}</span>
        </div>
        <div class="ph-body">
          <h3>${p.name}</h3>
          <p class="desc">${p.desc}</p>
          <div class="specs">
            ${p.specs.map(s => `<button class="spec-chip ${selectedSpec[p.id] === s ? "on" : ""}" data-pid="${p.id}" data-spec="${s}">${s}</button>`).join("")}
          </div>
          <div class="tags" style="display:flex;gap:6px;margin-top:8px">
            ${(p.tags || []).map(t => `<span class="tag tag-green">${t}</span>`).join("")}
          </div>
          <div class="foot">
            <div>
              <div class="price">${Store.money(p.price)}<small> / ${p.unit}</small></div>
              <div class="unit">规格价以选择为准</div>
            </div>
            <button class="btn btn-accent btn-sm" data-add="${p.id}">加入购物车</button>
          </div>
        </div>
      </article>`;
    }).join("");

    // 规格切换
    $$(".spec-chip", grid).forEach(chip => {
      chip.addEventListener("click", () => {
        selectedSpec[chip.dataset.pid] = chip.dataset.spec;
        renderProducts();
      });
    });
    // 加购
    $$("[data-add]", grid).forEach(btn => {
      btn.addEventListener("click", () => {
        const pid = btn.dataset.add;
        const p = Store.getProduct(pid);
        Store.addToCart(pid, selectedSpec[pid], 1);
        updateCount();
        renderCart();
        toast(`已加入购物车：${p.name}（${selectedSpec[pid]}）`);
        openCart();
      });
    });
  }

  function updateCount() {
    const cart = Store.getCart();
    const el = $("#cartCount");
    const count = cart.reduce((s, i) => s + i.qty, 0);
    if (el) { el.textContent = count; el.classList.toggle("hide", count === 0); }
    // 同步移动端底部栏
    if (App.onCartUpdate) {
      const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
      App.onCartUpdate(count, Store.money(total));
    }
  }

  function renderCart() {
    const body = $("#cartBody");
    const foot = $("#cartFoot");
    if (!body) return;
    const cart = Store.getCart();
    if (!cart.length) {
      body.innerHTML = `<div class="empty-cart">购物车还是空的<br>去挑些鲜橙吧 🍊</div>`;
      foot.innerHTML = "";
      return;
    }
    const total = cart.reduce((s, i) => s + i.subtotal || s + i.price * i.qty, 0);
    body.innerHTML = cart.map((i, idx) => `
      <div class="cart-item">
        <div class="ci-img" style="background-image:url('${i.img}')"></div>
        <div class="ci-main">
          <div class="ci-name">${i.name}</div>
          <div class="ci-spec">${i.spec} · ${Store.money(i.price)}</div>
          <div class="between" style="margin-top:8px">
            <div class="qty">
              <button data-dec="${idx}">−</button>
              <span>${i.qty}</span>
              <button data-inc="${idx}">+</button>
            </div>
            <span class="ci-price">${Store.money(i.price * i.qty)}</span>
          </div>
        </div>
      </div>`).join("");

    $$("[data-inc]", body).forEach(b => b.addEventListener("click", () => { Store.setQty(+b.dataset.inc, Store.getCart()[+b.dataset.inc].qty + 1); renderCart(); updateCount(); }));
    $$("[data-dec]", body).forEach(b => b.addEventListener("click", () => { Store.setQty(+b.dataset.dec, Store.getCart()[+b.dataset.dec].qty - 1); renderCart(); updateCount(); }));

    const t = cart.reduce((s, i) => s + i.price * i.qty, 0);
    foot.innerHTML = `
      <div class="cart-sum">
        <span>合计</span>
        <span class="total">${Store.money(t)}</span>
      </div>
      <button class="btn btn-primary btn-block" onclick="App.goCheckout()">去结算</button>`;
  }

  function openCart() {
    $("#overlay").classList.add("show");
    $("#cartDrawer").classList.add("show");
    renderCart();
  }
  function closeCart() {
    $("#overlay").classList.remove("show");
    $("#cartDrawer").classList.remove("show");
  }

  function goCheckout() {
    const cart = Store.getCart();
    if (!cart.length) { toast("购物车是空的，先挑些鲜橙吧 🍊", "warn"); return; }
    location.href = "order.html";
  }

  async function init() {
    const grid = $("#productGrid");
    if (grid) grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="e-ic">🍊</div>正在加载鲜橙…</div>`;
    try { await Store.init(); } catch (e) {
      if (grid) grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="e-ic">⚠</div>加载失败，请稍后刷新</div>`;
      return;
    }
    renderProducts();
    updateCount();
    renderCart();
  }

  global.App = { init, openCart, closeCart, renderCart, goCheckout, toast, onCartUpdate: null };
})(window);
