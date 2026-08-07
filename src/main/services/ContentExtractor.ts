import { WebContents } from 'electron'
import { PageContext } from '@shared/types'

export class ContentExtractor {
  async extractPageContext(webContents: WebContents): Promise<PageContext> {
    const url = webContents.getURL()
    const title = webContents.getTitle()

    // Try Readability first for better article extraction, fall back to raw extraction
    const textContent = await webContents.executeJavaScript(`
      (() => {
        // Try article/main first
        const article = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]');
        if (article && article.innerText.length > 200) {
          return article.innerText.substring(0, 10000);
        }
        // Fallback: extract meaningful text blocks
        const candidates = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, th, figcaption');
        if (candidates.length > 3) {
          return Array.from(candidates)
            .map(el => el.innerText.trim())
            .filter(t => t.length > 10)
            .join('\\n\\n')
            .substring(0, 10000);
        }
        return document.body ? document.body.innerText.substring(0, 10000) : '';
      })()
    `)

    const htmlContent = await webContents.executeJavaScript(`
      (() => {
        const article = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]');
        if (article && article.innerHTML.length > 200) {
          return article.innerHTML.substring(0, 50000);
        }
        // Extract structured content
        const main = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
        return main ? main.innerHTML.substring(0, 50000) : '';
      })()
    `)

    const selectedText = await webContents.executeJavaScript(`
      (() => {
        const sel = window.getSelection();
        return sel ? sel.toString().trim() : '';
      })()
    `)

    return {
      url,
      title,
      textContent: textContent || '',
      htmlContent: htmlContent || '',
      selectedText: selectedText || undefined
    }
  }

  async extractReadableContent(webContents: WebContents): Promise<string> {
    return webContents.executeJavaScript(`
      (() => {
        function extractArticle() {
          const article = document.querySelector('article');
          if (article && article.innerText.length > 200) return article.innerText;

          const main = document.querySelector('main') || document.querySelector('[role="main"]');
          if (main && main.innerText.length > 200) return main.innerText;

          const candidates = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, figcaption');
          if (candidates.length > 3) {
            return Array.from(candidates)
              .map(el => el.innerText.trim())
              .filter(t => t.length > 10)
              .join('\\n\\n');
          }

          return document.body.innerText;
        }
        return extractArticle().substring(0, 15000);
      })()
    `)
  }

  /**
   * Extract a structured summary of the page for the AI agent, including
   * headings, forms, and key interactive areas.
   */
  async extractStructuredPageInfo(webContents: WebContents): Promise<{
    headings: string[]
    forms: Array<{ action: string; fields: string[] }>
    links: Array<{ text: string; href: string }>
    landmarks: string[]
  }> {
    return webContents.executeJavaScript(`
      (() => {
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
          .map(h => h.innerText.trim())
          .filter(Boolean)
          .slice(0, 20);

        const forms = Array.from(document.querySelectorAll('form')).slice(0, 5).map(f => ({
          action: f.action || '',
          fields: Array.from(f.querySelectorAll('input, select, textarea'))
            .map(el => el.name || el.id || el.placeholder || el.type)
            .filter(Boolean)
            .slice(0, 10)
        }));

        const links = Array.from(document.querySelectorAll('a[href]'))
          .filter(a => a.href && !a.href.startsWith('javascript:'))
          .slice(0, 30)
          .map(a => ({
            text: a.innerText.trim().substring(0, 60),
            href: a.href
          }))
          .filter(l => l.text.length > 0);

        const landmarks = Array.from(document.querySelectorAll('[role="navigation"], [role="search"], [role="banner"], [role="contentinfo"], [role="main"], nav, header, footer, main'))
          .map(el => (el.getAttribute('role') || el.tagName.toLowerCase()) + ': ' + (el.getAttribute('aria-label') || el.id || ''))
          .slice(0, 10);

        return { headings, forms, links, landmarks };
      })()
    `)
  }

  async extractLinks(webContents: WebContents): Promise<Array<{ text: string; href: string }>> {
    return webContents.executeJavaScript(`
      (() => {
        const links = document.querySelectorAll('a[href]');
        return Array.from(links)
          .filter(a => a.href && !a.href.startsWith('javascript:'))
          .slice(0, 200)
          .map(a => ({
            text: a.innerText.trim().substring(0, 100),
            href: a.href
          }))
          .filter(l => l.text.length > 0);
      })()
    `)
  }

  async extractMetadata(webContents: WebContents): Promise<Record<string, string>> {
    return webContents.executeJavaScript(`
      (() => {
        const meta: Record<string, string> = {};
        document.querySelectorAll('meta').forEach(el => {
          const name = el.getAttribute('name') || el.getAttribute('property') || '';
          const content = el.getAttribute('content') || '';
          if (name && content) meta[name] = content;
        });
        return meta;
      })()
    `)
  }

  async extractTableData(webContents: WebContents, selector?: string): Promise<string[][]> {
    const expr = selector
      ? `document.querySelector('${selector.replace(/'/g, "\\'")}')`
      : `document.querySelector('table')`

    return webContents.executeJavaScript(`
      (() => {
        const table = ${expr};
        if (!table) return [];
        const rows = table.querySelectorAll('tr');
        return Array.from(rows).map(row =>
          Array.from(row.querySelectorAll('th, td')).map(cell => cell.innerText.trim())
        );
      })()
    `)
  }

  async highlightElement(webContents: WebContents, selector: string): Promise<void> {
    const safe = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    await webContents.executeJavaScript(`
      (() => {
        document.querySelectorAll('.agent-highlight, .agent-highlight-tag').forEach(el => el.remove());
        const el = document.querySelector('${safe}');
        if (!el) return;
        try { el.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
        const rect = el.getBoundingClientRect();
        const ring = document.createElement('div');
        ring.className = 'agent-highlight';
        ring.style.cssText = 'position:fixed;top:' + rect.top + 'px;left:' + rect.left + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;border:2px solid #f26522;border-radius:8px;box-shadow:0 0 0 4px rgba(242,101,34,0.25),0 0 24px rgba(242,101,34,0.45);z-index:2147483646;pointer-events:none;animation:agentPulse 2.4s ease-out forwards;';
        const tag = document.createElement('div');
        tag.className = 'agent-highlight-tag';
        tag.textContent = 'AGENT';
        tag.style.cssText = 'position:fixed;top:' + Math.max(4, rect.top - 22) + 'px;left:' + rect.left + 'px;background:#f26522;color:#0e0e10;font:700 10px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:0.14em;padding:4px 7px;border-radius:5px;z-index:2147483647;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,0.5);';
        document.body.appendChild(ring);
        document.body.appendChild(tag);
        setTimeout(() => { ring.remove(); tag.remove(); }, 2600);
      })()
    `)
  }

  /**
   * Persistent banner pinned to the top of the controlled page so the user can
   * literally watch the agent work. Inline-styled and idempotent; pointer-events
   * are disabled so it never blocks the page underneath.
   */
  async showAgentBanner(webContents: WebContents, text: string): Promise<void> {
    const safe = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')
    await webContents.executeJavaScript(`
      (() => {
        if (!document.getElementById('__agent_banner_style')) {
          const st = document.createElement('style');
          st.id = '__agent_banner_style';
          st.textContent = '@keyframes __agent_shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}} @keyframes __agent_dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}} #__agent_banner{position:fixed;top:0;left:0;right:0;height:34px;z-index:2147483647;display:flex;align-items:center;gap:9px;padding:0 14px;background:linear-gradient(90deg,rgba(14,14,16,0.97),rgba(29,29,33,0.95));border-bottom:1px solid rgba(242,101,34,0.5);backdrop-filter:blur(8px);font:500 12px/1 ui-monospace,Menlo,Consolas,monospace;color:#f2efe6;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,0.45)} #__agent_banner::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,transparent,rgba(242,101,34,0.9),transparent);background-size:200% 100%;animation:__agent_shimmer 1.6s linear infinite} #__agent_banner .d{width:8px;height:8px;border-radius:50%;background:#3ecf8e;box-shadow:0 0 0 0 rgba(62,207,142,0.6);animation:__agent_dot 1.2s ease-in-out infinite;flex-shrink:0} #__agent_banner .lbl{color:#f26522;font-weight:700;letter-spacing:0.16em;font-size:10px;flex-shrink:0} #__agent_banner .txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.92}';
          (document.head || document.documentElement).appendChild(st);
        }
        let b = document.getElementById('__agent_banner');
        if (!b) {
          b = document.createElement('div');
          b.id = '__agent_banner';
          b.innerHTML = '<span class="d"></span><span class="lbl">AGENT</span><span class="txt"></span>';
          (document.body || document.documentElement).appendChild(b);
        }
        b.querySelector('.txt').textContent = ${JSON.stringify(safe)};
      })()
    `)
  }

  async hideAgentBanner(webContents: WebContents): Promise<void> {
    await webContents
      .executeJavaScript(`
      (() => {
        const b = document.getElementById('__agent_banner');
        const st = document.getElementById('__agent_banner_style');
        if (b) b.remove();
        if (st) st.remove();
        document.querySelectorAll('.agent-highlight, .agent-highlight-tag').forEach(el => el.remove());
      })()
    `)
      .catch(() => {
        /* page may be gone */
      })
  }
}
