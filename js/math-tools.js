// =============================================================================
// Maths & science tools.
//  * Equation editor — MathLive (<math-field>) for input, MathJax for
//    rasterising the LaTeX to a scalable SVG that can be drawn on the canvas.
//    Both are lazy-loaded from a CDN, so the initial bundle stays tiny.
//  * Graph plotting — a lightweight canvas plotter driven by a safe expression
//    evaluator (no eval). A documented stand-in for JSXGraph that keeps the
//    app fast on low-end devices; swap in JSXGraph if you prefer.
//  * A small Class 11 PCM formula reference.
// =============================================================================
import { openModal, toast } from "./ui.js";
import { escapeHtml } from "./util.js";
import { safeEval } from "./whiteboard.js";

// --------------------------------------------------------------- lazy loaders
let mathjaxPromise = null;
let mathlivePromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

export async function ensureMathJax() {
  if (window.MathJax?.tex2svg) return window.MathJax;
  if (mathjaxPromise) return mathjaxPromise;
  mathjaxPromise = (async () => {
    window.MathJax = {
      tex: {
        inlineMath: [["$", "$"], ["\\(", "\\)"]],
        displayMath: [["$$", "$$"], ["\\[", "\\]"]],
      },
      svg: { fontCache: "none" },
      startup: { typeset: false },
    };
    await loadScript("https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js");
    await window.MathJax.startup.promise;
    return window.MathJax;
  })();
  return mathjaxPromise;
}

async function ensureMathLive() {
  if (window.customElements?.get("math-field")) return true;
  if (mathlivePromise) return mathlivePromise;
  mathlivePromise = (async () => {
    await loadScript("https://cdn.jsdelivr.net/npm/mathlive@latest/dist/mathlive.min.js");
    return !!window.customElements?.get("math-field");
  })().catch(() => false);
  return mathlivePromise;
}

// Typeset any $…$ / $$…$$ inside an element (used for chat).
export async function renderMathIn(el) {
  try {
    const MJ = await ensureMathJax();
    await MJ.typesetPromise([el]);
  } catch { /* leave raw text if the CDN is unreachable */ }
}

// ------------------------------------------------------------------- LaTeX→SVG
export async function texToSvg(latex, { display = true } = {}) {
  try {
    const MJ = await ensureMathJax();
    const node = MJ.tex2svg(latex, { display });
    const svg = node.querySelector("svg");
    if (!svg) throw new Error("no svg");

    // Measure in the DOM so we can pin an explicit pixel size + viewBox.
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-9999px;top:0;visibility:hidden";
    holder.appendChild(svg);
    document.body.appendChild(holder);
    const rect = svg.getBoundingClientRect();
    holder.remove();

    const w = Math.max(24, Math.round(rect.width) || 120);
    const h = Math.max(18, Math.round(rect.height) || 40);
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const svgStr = new XMLSerializer().serializeToString(svg);
    return { svg: svgStr, src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr), w, h };
  } catch {
    // Offline fallback: a plain text SVG so the object still renders.
    const w = Math.max(40, latex.length * 9), h = 30;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="4" y="20" font-family="serif" font-size="20">${escapeHtml(latex)}</text></svg>`;
    return { svg, src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), w, h };
  }
}

// --------------------------------------------------------------- equation UI
export function openEquationEditor({ initial = "" } = {}) {
  return new Promise((resolve) => {
    openModal({
      title: "Equation",
      html: `
        <p class="small muted">Write with the visual editor (fractions, powers, roots, symbols) or type LaTeX directly.</p>
        <div id="eqHost" style="min-height:64px;border:1px solid var(--border);border-radius:10px;padding:.6rem;background:var(--panel)"></div>
        <textarea id="eqFallback" class="input hidden" rows="2" placeholder="\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"></textarea>
        <label>Preview</label>
        <div id="eqPreview" class="center" style="min-height:56px;padding:.5rem;border:1px dashed var(--border);border-radius:10px;overflow:auto"></div>
        <label>Size on board</label>
        <input id="eqSize" type="range" min="120" max="900" value="360" />
        <div class="row" style="justify-content:flex-end;margin-top:1rem">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn primary" data-act="ok">Place on board</button>
        </div>`,
      wire: async (root, close) => {
        const host = root.querySelector("#eqHost");
        const fallback = root.querySelector("#eqFallback");
        const preview = root.querySelector("#eqPreview");
        const sizeEl = root.querySelector("#eqSize");

        const ok = await ensureMathLive();
        let mf = null;
        if (ok) {
          mf = document.createElement("math-field");
          mf.style.cssText = "width:100%;font-size:1.4rem;border:none;background:transparent";
          mf.value = initial || "";
          host.appendChild(mf);
          mf.addEventListener("input", () => updatePreview(mf.value));
        } else {
          fallback.classList.remove("hidden");
          fallback.value = initial || "";
          fallback.addEventListener("input", () => updatePreview(fallback.value));
        }

        const getLatex = () => (mf ? mf.value : fallback.value).trim();

        async function updatePreview(latex) {
          if (!latex) { preview.innerHTML = ""; return; }
          try {
            const MJ = await ensureMathJax();
            const node = MJ.tex2svg(latex, { display: true });
            preview.innerHTML = "";
            preview.appendChild(node);
          } catch { preview.textContent = latex; }
        }
        updatePreview(getLatex());

        root.querySelector('[data-act="cancel"]').onclick = () => close(null);
        root.querySelector('[data-act="ok"]').onclick = async () => {
          const latex = getLatex();
          if (!latex) { toast("Enter an equation first.", "error"); return; }
          const scaled = await texToSvg(latex, { display: true });
          const targetW = Number(sizeEl.value);
          const ratio = scaled.h / scaled.w;
          const data = {
            latex,
            svg: scaled.svg,
            src: scaled.src,
            w: targetW,
            h: Math.round(targetW * ratio),
            size: targetW,
          };
          close(data);
        };
      },
      onClose: (v) => resolve(v && v.latex ? v : null),
    });
  });
}

// ----------------------------------------------------------------- graph UI
export function openGraphEditor({ initial = "sin(x)" } = {}) {
  return new Promise((resolve) => {
    openModal({
      title: "Plot a function",
      html: `
        <label>f(x) =</label>
        <input id="gExpr" class="input" value="${escapeHtml(initial)}" placeholder="sin(x)  ·  x^2 - 3  ·  sqrt(x)" />
        <p class="small muted">Supported: + − × ÷ ^, parentheses, sin cos tan asin acos atan sqrt abs log ln exp floor ceil, and pi, e.</p>
        <div class="grid-2">
          <div><label>x min</label><input id="gxmin" class="input" type="number" value="-10" /></div>
          <div><label>x max</label><input id="gxmax" class="input" type="number" value="10" /></div>
          <div><label>y min</label><input id="gymin" class="input" type="number" value="-10" /></div>
          <div><label>y max</label><input id="gymax" class="input" type="number" value="10" /></div>
        </div>
        <label>Preview</label>
        <canvas id="gPreview" width="600" height="360" style="width:100%;border:1px solid var(--border);border-radius:10px;background:var(--panel)"></canvas>
        <div class="row" style="justify-content:flex-end;margin-top:1rem">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn primary" data-act="ok">Place on board</button>
        </div>`,
      wire: (root, close) => {
        const cv = root.querySelector("#gPreview");
        const read = () => ({
          expr: root.querySelector("#gExpr").value.trim() || "x",
          xmin: Number(root.querySelector("#gxmin").value),
          xmax: Number(root.querySelector("#gxmax").value),
          ymin: Number(root.querySelector("#gymin").value),
          ymax: Number(root.querySelector("#gymax").value),
        });
        const draw = () => drawPlot(cv, read());
        ["gExpr", "gxmin", "gxmax", "gymin", "gymax"].forEach(id =>
          root.querySelector("#" + id).addEventListener("input", draw));
        draw();

        root.querySelector('[data-act="cancel"]').onclick = () => close(null);
        root.querySelector('[data-act="ok"]').onclick = () => {
          const p = read();
          if (!(p.xmax > p.xmin) || !(p.ymax > p.ymin)) { toast("Check the axis ranges.", "error"); return; }
          close({ ...p, x: 0, y: 0, w: 460, h: 320 });
        };
      },
      onClose: (v) => resolve(v),
    });
  });
}

function drawPlot(cv, { expr, xmin, xmax, ymin, ymax }) {
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const X = (x) => ((x - xmin) / (xmax - xmin)) * W;
  const Y = (y) => H - ((y - ymin) / (ymax - ymin)) * H;

  ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1;
  ctx.beginPath();
  if (ymin < 0 && ymax > 0) { ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); }
  if (xmin < 0 && xmax > 0) { ctx.moveTo(X(0), 0); ctx.lineTo(X(0), H); }
  ctx.stroke();

  ctx.strokeStyle = "#0ea5a4"; ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= W; i++) {
    const x = xmin + (i / W) * (xmax - xmin);
    const y = safeEval(expr, x);
    if (!isFinite(y)) { started = false; continue; }
    const sy = Y(y);
    if (sy < -H || sy > 2 * H) { started = false; continue; }
    if (!started) { ctx.moveTo(i, sy); started = true; } else ctx.lineTo(i, sy);
  }
  ctx.stroke();
}

// --------------------------------------------------- Class 11 PCM reference
export const FORMULA_REFERENCE = [
  { subject: "Physics", items: [
    ["Kinematics", "v = u + at"],
    ["Displacement", "s = ut + ½at²"],
    ["Third equation", "v² = u² + 2as"],
    ["Projectile range", "R = u² sin 2θ / g"],
    ["Newton's second law", "F = ma"],
    ["Centripetal force", "F = mv² / r"],
    ["Work–energy", "W = ΔKE = ½mv² − ½mu²"],
    ["Momentum", "p = mv"],
    ["Gravitation", "F = G m₁m₂ / r²"],
    ["Simple pendulum", "T = 2π √(l / g)"],
  ]},
  { subject: "Chemistry", items: [
    ["Ideal gas", "PV = nRT"],
    ["Moles", "n = m / M"],
    ["Molarity", "M = n / V(L)"],
    ["Dilution", "M₁V₁ = M₂V₂"],
    ["pH", "pH = −log[H⁺]"],
    ["First law", "ΔU = q + w"],
    ["Enthalpy", "ΔH = ΔU + ΔnRT"],
    ["Boyle", "P₁V₁ = P₂V₂"],
  ]},
  { subject: "Maths", items: [
    ["Quadratic roots", "x = (−b ± √(b²−4ac)) / 2a"],
    ["Derivative of power", "d/dx xⁿ = n xⁿ⁻¹"],
    ["Product rule", "(uv)′ = u′v + uv′"],
    ["Chain rule", "dy/dx = dy/du · du/dx"],
    ["Sum of AP", "Sₙ = n/2 [2a + (n−1)d]"],
    ["Sum of GP", "Sₙ = a(rⁿ−1)/(r−1)"],
    ["sin² + cos²", "sin²θ + cos²θ = 1"],
    ["Distance", "√((x₂−x₁)² + (y₂−y₁)²)"],
  ]},
];

export function openFormulaReference(onPick) {
  const html = FORMULA_REFERENCE.map(g => `
    <h3 style="margin-top:1rem">${escapeHtml(g.subject)}</h3>
    <div class="row wrap">
      ${g.items.map(([label, tex]) => `
        <button class="btn sm" data-tex="${escapeHtml(tex)}" title="Place on board">
          ${escapeHtml(label)}
        </button>`).join("")}
    </div>`).join("");
  openModal({
    title: "Formula reference (Class 11 PCM)",
    html,
    wire(root, close) {
      root.querySelectorAll("[data-tex]").forEach(b => {
        b.onclick = () => { onPick?.(b.dataset.tex); close(null); };
      });
    },
  });
}
