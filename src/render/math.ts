// Renders TeX to sanitized SVG markup, caching results so live-preview widgets
// can redraw synchronously after the first render.
import DOMPurify from "dompurify";

type MathDocument = { convertPromise(tex: string, options: { display: boolean }): Promise<HTMLElement> };
let mathDocument: Promise<MathDocument> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, string>();
const failures = new Map<string, string>();

const key = (tex: string, display: boolean) => (display ? "D" : "I") + tex;

export function cachedMath(tex: string, display: boolean) {
  return cache.get(key(tex, display));
}

function sanitize(html: string) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ["mjx-container"],
    ADD_ATTR: ["display", "jax", "justify"],
  });
}

export function renderMath(tex: string, display: boolean): Promise<string> {
  const k = key(tex, display);
  const hit = cache.get(k);
  if (hit !== undefined) return Promise.resolve(hit);
  const failed = failures.get(k);
  if (failed) return Promise.reject(new Error(failed));
  const task = queue.catch(() => {}).then(async () => {
    const again = cache.get(k);
    if (again !== undefined) return again;
    mathDocument ??= import("./mathEngine").then(engine => engine.createMathDocument() as unknown as MathDocument);
    const doc = await mathDocument;
    try {
      const node = await doc.convertPromise(tex, { display });
      const html = sanitize(node.outerHTML);
      if (cache.size > 2000) cache.clear();
      cache.set(k, html);
      return html;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.set(k, message);
      throw error;
    }
  });
  queue = task;
  return task;
}

/** Fill an element with rendered math, synchronously when cached. */
export function fillMath(element: HTMLElement, tex: string, display: boolean) {
  const hit = cachedMath(tex, display);
  if (hit !== undefined) { element.innerHTML = hit; return; }
  element.textContent = tex;
  element.classList.add("md-math-pending");
  renderMath(tex, display).then(html => {
    element.classList.remove("md-math-pending");
    element.innerHTML = html;
  }, error => {
    element.classList.remove("md-math-pending");
    element.classList.add("md-math-error");
    element.title = error instanceof Error ? error.message : String(error);
  });
}

/** Render every [data-math] element inside a container (used for export/preview). */
export async function renderMathIn(container: ParentNode) {
  const targets = [...container.querySelectorAll<HTMLElement>("[data-math]")];
  await Promise.all(targets.map(async target => {
    const tex = target.dataset.math || "";
    const display = target.dataset.display === "true";
    try { target.innerHTML = await renderMath(tex, display); }
    catch { target.textContent = tex; target.classList.add("md-math-error"); }
  }));
}
