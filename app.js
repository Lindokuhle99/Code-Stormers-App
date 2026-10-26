(function () {
"use strict";
var app = document.getElementById("app");
var S = { me: null, tab: "dash", range: "30", d: null };
function el(t, a, k) {
  var e = document.createElement(t);
  if (a) for (var x in a) { if (x === "text") e.textContent = a[x]; else if (x === "on") { for (var ev in a.on) e.addEventListener(ev, a.on[ev]); } else e.setAttribute(x, a[x]); }
  (k || []).forEach(function (c) { e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
  return e;
}
function rand(n) { return "R" + Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
async function api(m, u, b) {
  var o = { method: m, headers: {}, credentials: "same-origin" };
  if (b !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(b); }
  var r = await fetch(u, o), j = {};
  try { j = await r.json(); } catch (e) { /* no body */ }
  if (!r.ok) { var er = new Error(j.error || "Something went wrong"); er.status = r.status; throw er; }
  return j;
}
async function refresh() { try { S.d = await api("GET", "/api/data"); } catch (e) { if (e.status === 401) { S.me = null; } else throw e; } }
async function rerender() { await refresh(); render(); }
function guard(errEl, fn) { return async function () { try { errEl.textContent = ""; await fn(); } catch (e) { errEl.textContent = e.message; } }; }

function render() { app.textContent = ""; if (S.me) home(); else login(); }

function login() {
  var em = el("input", { type: "email", placeholder: "Email", autocomplete: "username", maxlength: "80" });
  var pw = el("input", { type: "password", placeholder: "Password (8+ characters)", autocomplete: "current-password", maxlength: "64" });
  var cons = el("input", { type: "checkbox", class: "cb" });
  var err = el("div", { class: "err" });
  function go(create) {
    return guard(err, async function () {
      var r = await api("POST", create ? "/api/register" : "/api/login", { email: em.value, password: pw.value, consent: cons.checked });
      S.me = r.email; S.tab = "dash"; await rerender();
    });
  }
  app.appendChild(el("div", { class: "card" }, [
    el("h1", { text: "Sisonke" }), el("p", { class: "mut", text: "Know your profit. Grow your business. Safely." }),
    el("label", { text: "Email" }), em, el("label", { text: "Password" }), pw,
    el("label", {}, [cons, "  I agree that Sisonke stores my business records only to run my own account, and I can export or delete them any time (POPIA)."]),
    err,
    el("div", { class: "row" }, [el("button", { text: "Log in", on: { click: go(false) } }), el("button", { class: "ghost", text: "Create account", on: { click: go(true) } })]),
    el("p", { class: "mut", text: "Demo account: demo@sisonke.app · Demo@2026" })
  ]));
}

function totals() {
  var from = S.range === "all" ? 0 : Date.now() - Number(S.range) * 864e5, i = 0, e = 0;
  S.d.items.forEach(function (x) { if (x.t >= from) { if (x.type === "sale") i += x.amount; else e += x.amount; } });
  return { i: i, e: e, p: i - e };
}

function home() {
  app.appendChild(el("div", { class: "top" }, [el("h1", { text: "Sisonke" }), el("button", { class: "ghost", text: "Log out", on: { click: async function () { try { await api("POST", "/api/logout", {}); } catch (e) { /* ignore */ } S.me = null; S.d = null; render(); } } })]));
  var tabs = el("div", { class: "tabs" });
  [["dash", "Dashboard"], ["add", "Sales & expenses"], ["quote", "Quotes"]].forEach(function (x) {
    tabs.appendChild(el("button", { class: S.tab === x[0] ? "on" : "", text: x[1], on: { click: function () { S.tab = x[0]; render(); } } }));
  });
  app.appendChild(tabs);
  if (!S.d) { app.appendChild(el("p", { class: "mut", text: "Loading…" })); return; }
  if (S.tab === "dash") dash(); else if (S.tab === "add") addView(); else quoteView();
}

function dash() {
  var t = totals(), seg = el("div", { class: "seg" });
  [["7", "7 days"], ["30", "30 days"], ["all", "All time"]].forEach(function (r) {
    seg.appendChild(el("button", { class: S.range === r[0] ? "" : "ghost", text: r[1], on: { click: function () { S.range = r[0]; render(); } } }));
  });
  app.appendChild(seg);
  var margin = t.i > 0 ? Math.round(t.p / t.i * 100) : 0;
  app.appendChild(el("div", { class: "card" }, [el("div", { class: "mut", text: "Profit" }), el("div", { class: "big " + (t.p >= 0 ? "in" : "out"), text: rand(t.p) }),
    el("div", { class: "mut", text: "Profit margin: " + margin + "%" }), el("div", { class: "gap" }),
    el("div", { class: "row" }, [el("div", {}, [el("div", { class: "mut", text: "Income" }), el("b", { class: "in", text: rand(t.i) })]), el("div", {}, [el("div", { class: "mut", text: "Expenses" }), el("b", { class: "out", text: rand(t.e) })])])]));
  var fl = S.d.items.filter(function (x) { return x.flags.length; }).length;
  app.appendChild(el("div", { class: "card" }, [el("b", { text: "Fraud and duplicate check" }), el("div", { class: "mut", text: fl ? fl + " entr" + (fl > 1 ? "ies need" : "y needs") + " your review in Sales & expenses." : "No suspicious entries found." })]));
  var n = S.d.items.length;
  app.appendChild(el("div", { class: "card" }, [el("b", { text: "Funding readiness" }), el("div", { class: "mut", text: n >= 10 ? "You have " + n + " records. Funders can see a clear money trail." : "Log at least 10 records to build a track record funders can trust (" + n + "/10)." })]));
  app.appendChild(el("div", { class: "card" }, [el("b", { text: "Free plan" }), el("div", { class: "mut", text: S.d.used + " of " + S.d.limit + " entries used in the last 30 days." })]));
  var au = el("div", { class: "card" }, [el("b", { text: "Activity log" })]);
  S.d.audit.slice(0, 8).forEach(function (a) { au.appendChild(el("div", { class: "mut", text: new Date(a.t).toLocaleString("en-ZA") + " · " + a.a })); });
  app.appendChild(au);
  var err = el("div", { class: "err" });
  app.appendChild(el("div", { class: "card" }, [el("b", { text: "Your data (POPIA)" }), el("div", { class: "gap" }), err,
    el("button", { class: "ghost", text: "Export my data (JSON)", on: { click: function () { window.location.href = "/api/export"; setTimeout(rerender, 800); } } }), el("div", { class: "gap" }),
    el("button", { class: "danger", text: "Delete all my records", on: { click: guard(err, async function () { if (confirm("Delete all your records? This cannot be undone.")) { await api("DELETE", "/api/data"); await rerender(); } }) } }), el("div", { class: "gap" }),
    el("button", { class: "danger", text: "Delete my account", on: { click: guard(err, async function () { if (confirm("Delete your account and all data permanently?")) { await api("DELETE", "/api/account"); S.me = null; S.d = null; render(); } }) } })]));
}

function addView() {
  var ty = el("select", {}, [el("option", { value: "sale", text: "Sale (income)" }), el("option", { value: "expense", text: "Expense" })]);
  var am = el("input", { type: "number", inputmode: "decimal", min: "0.01", max: "10000000", step: "0.01", placeholder: "Amount in rand" });
  var no = el("input", { type: "text", maxlength: "60", placeholder: "What was it for?" }), err = el("div", { class: "err" });
  app.appendChild(el("div", { class: "card" }, [el("label", { text: "Type" }), ty, el("label", { text: "Amount (R)" }), am, el("label", { text: "Note" }), no, err,
    el("button", { text: "Save entry", on: { click: guard(err, async function () { await api("POST", "/api/items", { type: ty.value, amount: am.value, note: no.value }); S.tab = "add"; await rerender(); }) } })]));
  app.appendChild(el("h2", { text: "Recent entries" }));
  if (!S.d.items.length) app.appendChild(el("div", { class: "mut", text: "Nothing yet. Add your first sale above." }));
  var rerr = el("div", { class: "err" }); app.appendChild(rerr);
  S.d.items.slice(0, 30).forEach(function (x) {
    var left = el("div", {}, [el("div", { text: x.note }), el("div", { class: "mut", text: new Date(x.t).toLocaleString("en-ZA") })]);
    x.flags.forEach(function (f) { left.firstChild.appendChild(el("span", { class: "flag", text: f })); });
    app.appendChild(el("div", { class: "item" }, [left, el("div", {}, [el("b", { class: x.type === "sale" ? "in" : "out", text: (x.type === "sale" ? "+" : "−") + rand(x.amount) }),
      el("div", {}, [el("button", { class: "ghost sm", text: "Remove", on: { click: guard(rerr, async function () { await api("DELETE", "/api/items/" + x.id); await rerender(); }) } })])])]));
  });
}

function quoteView() {
  var cu = el("input", { type: "text", maxlength: "50", placeholder: "Customer name" }), de = el("input", { type: "text", maxlength: "60", placeholder: "Service or product" });
  var qt = el("input", { type: "number", min: "1", max: "10000", value: "1" }), pr = el("input", { type: "number", min: "0.01", max: "1000000", step: "0.01", placeholder: "Price each (R)" }), err = el("div", { class: "err" });
  app.appendChild(el("div", { class: "card" }, [el("label", { text: "Customer" }), cu, el("label", { text: "Item" }), de,
    el("div", { class: "row" }, [el("div", {}, [el("label", { text: "Quantity" }), qt]), el("div", {}, [el("label", { text: "Price each" }), pr])]), err,
    el("button", { text: "Create quote", on: { click: guard(err, async function () { await api("POST", "/api/quotes", { customer: cu.value, item: de.value, qty: qt.value, price: pr.value }); S.tab = "quote"; await rerender(); }) } })]));
  app.appendChild(el("h2", { text: "Your quotes" }));
  var qerr = el("div", { class: "err" }); app.appendChild(qerr);
  if (!S.d.quotes.length) app.appendChild(el("div", { class: "mut", text: "No quotes yet." }));
  S.d.quotes.slice(0, 20).forEach(function (x) {
    var tot = x.q * x.p, vat = tot * 0.15, linkBox = el("div", { class: "mut" });
    function showLink(u) { var full = location.origin + u; linkBox.textContent = ""; linkBox.appendChild(el("a", { href: u, target: "_blank", rel: "noopener", text: full })); }
    var card = el("div", { class: "card" }, [el("b", { text: "Quote for " + x.c }), el("div", { text: x.q + " × " + x.d + " at " + rand(x.p) }),
      el("div", { class: "mut", text: "Subtotal " + rand(tot) + " · VAT 15% " + rand(vat) + " · Total " + rand(tot + vat) }),
      el("div", { class: "row" }, [
        el("button", { class: "ghost", text: "Get share link / PDF", on: { click: guard(qerr, async function () { var r = await api("POST", "/api/quotes/" + x.id + "/share", {}); showLink(r.url); }) } }),
        el("button", { class: "ghost", text: "Record as sale", on: { click: guard(qerr, async function () { await api("POST", "/api/quotes/" + x.id + "/sale", {}); S.tab = "dash"; await rerender(); }) } })]), linkBox]);
    app.appendChild(card);
  });
}

(async function boot() {
  try { var r = await api("GET", "/api/me"); S.me = r.email; await refresh(); } catch (e) { S.me = null; }
  render();
})();
})();
