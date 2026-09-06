/**
 * Shared agent utilities used by both CLI and Electron main process.
 * Eliminates duplication of refToSelector, clickScript, typeScript, and formatSnapshot.
 */

export interface StructuredPage {
  url: string
  title: string
  links: Array<{ ref: string; text: string; href: string }>
  forms: Array<{ ref: string; action: string; method: string; fields: Array<{ name: string; type: string; placeholder: string; required: boolean; value: string }> }>
  interactive: Array<{ ref: string; tag: string; type: string; text: string; placeholder: string }>
  text: string
}

/** Normalize a ref like "e12" to the attribute selector used by the extractor. */
export function refToSelector(ref: string): string {
  const m = ref.match(/^[eE](\d+)$/)
  if (!m) return ref
  return `[data-ab-ref="e${m[1]}"]`
}

/** Generate JS to click an element by CSS selector with proper mouse events. */
export function clickScript(selector: string): string {
  return `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy }));
      return true;
    })()
  `
}

/** Generate JS to clear + type into an input, firing proper events. */
export function typeScript(selector: string, value: string): string {
  const val = JSON.stringify(value)
  return `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.focus();
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.value = ${val};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `
}

/** Flat BrowserOS-style snapshot: one line per interactive element with its ref. */
export function formatSnapshot(page: StructuredPage | null): string {
  if (!page) return '(page could not be read)'
  const lines: string[] = []
  lines.push(`URL: ${page.url} | Title: ${page.title}`)
  if (page.forms.length > 0) {
    for (const f of page.forms.slice(0, 5)) {
      lines.push(
        `form [${f.ref}] method=${f.method} fields: ` +
          f.fields.map((fl) => `${fl.type}${fl.name ? ` name=${fl.name}` : ''}${fl.required ? ' (required)' : ''}`).join(', ')
      )
    }
  }
  for (const el of page.interactive.slice(0, 40)) {
    lines.push(`[${el.ref}] ${el.tag}${el.type ? ` type=${el.type}` : ''} "${el.text || el.placeholder || ''}"`)
  }
  for (const l of page.links.slice(0, 40)) {
    lines.push(`[${l.ref}] link "${l.text}" href=${l.href}`)
  }
  if (page.text) {
    lines.push('')
    lines.push('Page text (truncated):')
    lines.push(page.text.substring(0, 800))
  }
  return lines.join('\n')
}
