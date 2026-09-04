/**
 * AI-ready page extraction. Injected via Runtime.evaluate, returns a single
 * structured JSON object describing the page. Every interactive element gets a
 * stable `ref` (data-ab-ref attribute) so AI agents can act on elements with
 * `agentic click <ref>` / `agentic type <ref> <text>` without needing CSS.
 *
 * Extraction is truncated at sane limits so the JSON stays small enough to
 * feed directly into an LLM context window.
 */

export interface PageJSON {
  url: string
  title: string
  lang: string
  meta: Record<string, string>
  viewport: { width: number; height: number }
  wordCount: number
  extractedAt: string
  headings: Array<{ level: number; text: string }>
  links: Array<{ ref: string; text: string; href: string }>
  images: Array<{ src: string; alt: string }>
  forms: Array<{ ref: string; action: string; method: string; fields: Array<{ name: string; type: string; placeholder: string; required: boolean; value: string }> }>
  tables: Array<{ headers: string[]; rows: string[][] }>
  interactive: Array<{ ref: string; tag: string; type: string; text: string; placeholder: string }>
  text: string
}

export interface ExtractOptions {
  /** Cap on the plain-text field (chars). 0 omits text. */
  textLimit?: number
  maxLinks?: number
  maxImages?: number
}

const DEFAULTS: Required<ExtractOptions> = {
  textLimit: 6000,
  maxLinks: 80,
  maxImages: 20
}

export function extractionScript(opts: ExtractOptions = {}): string {
  const { textLimit, maxLinks, maxImages } = { ...DEFAULTS, ...opts }
  return `
(() => {
  const TEXT_LIMIT = ${textLimit};
  const MAX_LINKS = ${maxLinks};
  const MAX_IMAGES = ${maxImages};

  let refCounter = 0;
  function nextRef(el) {
    const ref = 'e' + (refCounter++);
    try { el.setAttribute('data-ab-ref', ref); } catch (e) {}
    return ref;
  }

  function clean(s) {
    return (s || '').replace(/\\s+/g, ' ').trim();
  }

  const meta = {};
  document.querySelectorAll('meta[name], meta[property]').forEach((m) => {
    const key = m.getAttribute('name') || m.getAttribute('property') || '';
    const val = m.getAttribute('content') || '';
    if (key && val) meta[key] = val.substring(0, 300);
  });
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) meta.canonical = canonical.href;

  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .map((h) => ({ level: Number(h.tagName.substring(1)), text: clean(h.innerText) }))
    .filter((h) => h.text.length > 0 && h.text.length < 300)
    .slice(0, 60);

  const links = [];
  document.querySelectorAll('a[href]').forEach((a) => {
    if (links.length >= MAX_LINKS) return;
    const href = a.href || '';
    if (!href || href.startsWith('javascript:')) return;
    const text = clean(a.innerText || a.getAttribute('aria-label') || '');
    if (!text) return;
    links.push({ ref: nextRef(a), text: text.substring(0, 120), href });
  });

  const images = [];
  document.querySelectorAll('img').forEach((img) => {
    if (images.length >= MAX_IMAGES) return;
    const src = img.currentSrc || img.src || '';
    if (!src) return;
    images.push({ src, alt: clean(img.alt).substring(0, 150) });
  });

  const forms = Array.from(document.querySelectorAll('form')).slice(0, 8).map((f) => ({
    ref: nextRef(f),
    action: f.action || '',
    method: (f.method || 'get').toUpperCase(),
    fields: Array.from(f.querySelectorAll('input, select, textarea, button')).slice(0, 15).map((el) => ({
      name: el.name || el.id || '',
      type: el.type || el.tagName.toLowerCase(),
      placeholder: clean(el.placeholder || '').substring(0, 80),
      required: !!el.required,
      value: el.type === 'password' ? '' : (el.value || '').substring(0, 80)
    }))
  }));

  const tables = Array.from(document.querySelectorAll('table')).slice(0, 5).map((t) => {
    const rows = Array.from(t.querySelectorAll('tr')).slice(0, 40);
    let headers = [];
    const firstHead = t.querySelector('thead th, thead td') || t.querySelector('tr th');
    if (firstHead) {
      const headerRow = firstHead.closest('tr');
      headers = Array.from(headerRow.querySelectorAll('th, td')).map((c) => clean(c.innerText).substring(0, 60));
    }
    return {
      headers,
      rows: rows.slice(headers.length ? 1 : 0).map((row) =>
        Array.from(row.querySelectorAll('td, th')).slice(0, 12).map((c) => clean(c.innerText).substring(0, 200))
      ).filter((cells) => cells.length > 0).slice(0, 40)
    };
  }).filter((t) => t.rows.length > 0);

  const interactive = [];
  const sel = 'button, input, select, textarea, [role="button"], [role="tab"], [role="checkbox"], [role="combobox"], [contenteditable="true"], [onclick]';
  document.querySelectorAll(sel).forEach((el) => {
    if (interactive.length >= 50) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && (el.type === 'hidden')) return;
    interactive.push({
      ref: nextRef(el),
      tag,
      type: el.type || el.getAttribute('role') || '',
      text: clean(el.innerText || el.value || '').substring(0, 80),
      placeholder: clean(el.placeholder || '').substring(0, 80)
    });
  });

  function readableText() {
    const main =
      document.querySelector('article') ||
      document.querySelector('main') ||
      document.querySelector('[role="main"]');
    const source = main && main.innerText.length > 200 ? main : document.body;
    if (!source) return '';
    const blocks = Array.from(source.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption, td'))
      .filter((el) => el.offsetParent !== null || el.tagName.match(/^H[1-6]$/))
      .map((el) => clean(el.innerText))
      .filter((t) => t.length > 15);
    const joined = (blocks.length > 3 ? Array.from(new Set(blocks)).join('\\n\\n') : clean(source.innerText));
    return joined.substring(0, TEXT_LIMIT);
  }

  const text = readableText();
  const bodyText = clean(document.body ? document.body.innerText : '');

  return {
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang || '',
    meta,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    wordCount: bodyText ? bodyText.split(/\\s+/).length : 0,
    extractedAt: new Date().toISOString(),
    headings,
    links,
    images,
    forms,
    tables,
    interactive,
    text
  };
})()
`
}

/** Human-ish labels for the agent loop's step results. */
export function summarizePageJson(p: PageJSON): string {
  return JSON.stringify(
    {
      url: p.url,
      title: p.title,
      headings: p.headings.slice(0, 8).map((h) => 'h' + h.level + ': ' + h.text),
      links: p.links.slice(0, 20),
      forms: p.forms,
      interactive: p.interactive.slice(0, 25),
      textPreview: p.text.substring(0, 1500)
    },
    null,
    2
  )
}
