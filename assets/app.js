/* XRP Shield site: shared logic. Data comes from data/snapshot.js (window.SNAPSHOT). */
(function () {
  "use strict";
  const S = window.SNAPSHOT;
  const $ = (q, el = document) => el.querySelector(q);
  const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

  /* ---------- theme ---------- */
  const root = document.documentElement;
  function storedTheme() { try { return localStorage.getItem("xs-theme"); } catch (e) { return null; } }
  function saveTheme(t) { try { localStorage.setItem("xs-theme", t); } catch (e) { /* private mode */ } }
  const st = storedTheme();
  if (st === "light" || st === "dark") root.setAttribute("data-theme", st);
  function isDark() {
    const t = root.getAttribute("data-theme");
    if (t) return t === "dark";
    return !window.matchMedia("(prefers-color-scheme: light)").matches;
  }
  function paintThemeBtn() { $$(".theme-btn").forEach(b => { b.textContent = isDark() ? "☀" : "☾"; b.title = isDark() ? "Light theme" : "Dark theme"; }); }
  document.addEventListener("click", e => {
    const b = e.target.closest(".theme-btn");
    if (!b) return;
    const next = isDark() ? "light" : "dark";
    root.setAttribute("data-theme", next);
    saveTheme(next);
    paintThemeBtn();
    rerender();
  });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { paintThemeBtn(); rerender(); });

  /* ---------- formatting ---------- */
  const cssv = n => getComputedStyle(root).getPropertyValue(n).trim();
  const usd = (v, d = 0) => (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const px = v => "$" + v.toFixed(v < 10 ? 2 : 0);
  const pct = (v, d = 1) => v.toFixed(d) + "%";
  window.XS = { S, usd, px, pct };

  /* ---------- option maths (same as tools/build_data.py) ---------- */
  const R = S.models.params.rate;
  function ncdf(x) { // Abramowitz-Stegun 7.1.26
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return 0.5 * (1 + (x >= 0 ? y : -y));
  }
  function bsPut(Sp, K, T, s) {
    const d1 = (Math.log(Sp / K) + (R + s * s / 2) * T) / (s * Math.sqrt(T)), d2 = d1 - s * Math.sqrt(T);
    return K * Math.exp(-R * T) * ncdf(-d2) - Sp * ncdf(-d1);
  }
  function smile(pts) {
    return m => {
      if (m <= pts[0].m) return pts[0].iv / 100;
      if (m >= pts[pts.length - 1].m) return pts[pts.length - 1].iv / 100;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (m <= b.m) return (a.iv + (b.iv - a.iv) * (m - a.m) / (b.m - a.m)) / 100;
      }
    };
  }
  const ivMonth = smile(S.deribit.smile_month);
  const P = S.models.params;
  const tickFrac = S.deribit.tick_pct_spot / 100;
  /* first-month Crash Shield premium as % of loan, scale-free (depends on LTV only) */
  function firstMonthPct(ltv) {
    const Sp = 1, K = ltv / P.protect_ltv;
    if (K < Sp * (1 - P.max_below) - 1e-9) return 0;
    const prem = Math.max(bsPut(Sp, K, 1 / 12, ivMonth(K / Sp)) * P.spread_markup, tickFrac * Sp);
    return prem / ltv * 100;
  }
  /* linear interpolation of a model metric over the LTV grid */
  function byLtv(key, field, ltvPct) {
    const xs = S.models.ltv, ys = S.models[key].map(o => (field ? o[field] : o));
    if (ltvPct <= xs[0]) return ys[0];
    if (ltvPct >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (let i = 1; i < xs.length; i++) if (ltvPct <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (ltvPct - xs[i - 1]) / (xs[i] - xs[i - 1]);
  }
  window.XS.firstMonthPct = firstMonthPct;
  window.XS.byLtv = byLtv;

  /* ---------- charts ---------- */
  const charts = {};
  const builders = {};
  function palette() {
    return {
      shield: cssv("--series-shield"), plain: cssv("--series-plain"), s3: cssv("--series-3"), neutral: cssv("--neutral"),
      critical: cssv("--critical"), warning: cssv("--warning"), grid: cssv("--grid"), text: cssv("--text-2"), muted: cssv("--muted"),
      surface: cssv("--surface"),
    };
  }
  /* reference lines with labels: [{axis:'y'|'x', value, label, color, dash}] */
  const refLines = {
    id: "refLines",
    afterDatasetsDraw(chart, args, opts) {
      const lines = opts.lines || [];
      const { ctx, chartArea: a, scales } = chart;
      ctx.save();
      lines.forEach(l => {
        const sc = l.axis === "x" ? scales.x : scales.y;
        if (!sc) return;
        const p = sc.getPixelForValue(l.value);
        if (!isFinite(p)) return;
        if (l.axis === "x" && (p < a.left || p > a.right)) return;
        if (l.axis !== "x" && (p < a.top || p > a.bottom)) return;
        ctx.strokeStyle = l.color; ctx.lineWidth = l.width || 1.5; ctx.setLineDash(l.dash || [5, 4]);
        ctx.beginPath();
        if (l.axis === "x") { ctx.moveTo(p, a.top); ctx.lineTo(p, a.bottom); } else { ctx.moveTo(a.left, p); ctx.lineTo(a.right, p); }
        ctx.stroke(); ctx.setLineDash([]);
        if (l.label) {
          ctx.font = "600 11px Inter, system-ui, sans-serif"; ctx.fillStyle = l.color;
          if (l.axis === "x") { ctx.textAlign = l.align || "left"; ctx.fillText(l.label, p + (l.align === "right" ? -6 : 6), a.top + 12); }
          else { ctx.textAlign = l.align || "right"; ctx.fillText(l.label, l.align === "left" ? a.left + 6 : a.right - 6, p - 5); }
        }
      });
      ctx.restore();
    },
  };
  function baseOptions(o = {}) {
    const c = palette();
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: o.mode || "index", intersect: false },
      layout: { padding: { top: 6, right: 6 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c.surface, titleColor: cssv("--text"), bodyColor: c.text, borderColor: cssv("--line"), borderWidth: 1,
          padding: 10, boxPadding: 4, usePointStyle: true, callbacks: o.tooltip || {},
        },
        refLines: { lines: o.lines || [] },
      },
      scales: {
        x: Object.assign({ grid: { color: c.grid, drawTicks: false }, border: { color: c.grid }, ticks: { color: c.muted, maxRotation: 0, autoSkipPadding: 14, font: { size: 11 } } }, o.x || {}),
        y: Object.assign({ grid: { color: c.grid, drawTicks: false }, border: { display: false }, ticks: { color: c.muted, padding: 8, font: { size: 11 } } }, o.y || {}),
      },
    };
  }
  function make(id, cfgFn) {
    builders[id] = cfgFn;
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    if (charts[id]) charts[id].destroy();
    const cfg = cfgFn(palette());
    cfg.plugins = (cfg.plugins || []).concat([refLines]);
    charts[id] = new Chart(el, cfg);
    return charts[id];
  }
  function rerender() { Object.keys(builders).forEach(id => make(id, builders[id])); }
  window.XS.make = make;
  window.XS.charts = charts;
  window.XS.baseOptions = baseOptions;
  window.XS.palette = palette;

  /* fill snapshot stamps */
  document.addEventListener("DOMContentLoaded", () => {
    paintThemeBtn();
    $$("[data-snap]").forEach(el => {
      const path = el.getAttribute("data-snap").split(".");
      let v = S; path.forEach(k => { v = v == null ? v : v[k]; });
      const f = el.getAttribute("data-fmt");
      if (v == null) return;
      if (f === "usd2") el.textContent = "$" + Number(v).toFixed(2);
      else if (f === "usdM") el.textContent = "$" + (v / 1e6).toFixed(1) + "M";
      else if (f === "pct") el.textContent = Number(v).toFixed(1) + "%";
      else if (f === "pctabs") el.textContent = Math.abs(Number(v)).toFixed(1) + "%";
      else if (f === "int") el.textContent = Math.round(v).toLocaleString("en-US");
      else el.textContent = v;
    });
  });
})();
