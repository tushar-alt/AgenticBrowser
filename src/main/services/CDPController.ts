import { WebContents } from 'electron'
import { CDPAction } from '@shared/types'

export class CDPController {
  private attachedTabs: Map<string, WebContents> = new Map()

  attach(tabId: string, webContents: WebContents): void {
    this.attachedTabs.set(tabId, webContents)
    webContents.debugger.attach('1.3')
    // Enable Page domain so navigation events are properly emitted
    webContents.debugger.sendCommand('Page.enable').catch(() => { /* ignore */ })
  }

  detach(tabId: string): void {
    const webContents = this.attachedTabs.get(tabId)
    if (webContents && webContents.debugger.isAttached()) {
      webContents.debugger.detach()
    }
    this.attachedTabs.delete(tabId)
  }

  isAttached(tabId: string): boolean {
    const webContents = this.attachedTabs.get(tabId)
    return !!webContents && webContents.debugger.isAttached()
  }

  private async sendCommand(tabId: string, method: string, params?: Record<string, unknown>, timeoutMs: number = 15000): Promise<unknown> {
    const webContents = this.attachedTabs.get(tabId)
    if (!webContents || !webContents.debugger.isAttached()) {
      throw new Error(`Tab ${tabId} does not have debugger attached`)
    }
    return Promise.race([
      webContents.debugger.sendCommand(method, params),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`)), timeoutMs))
    ])
  }

  async navigate(tabId: string, url: string): Promise<void> {
    // Security: block local/sensitive schemes (agent + MCP reach this path)
    if (/^(\s)*(file|chrome|chrome-extension|devtools|view-source|javascript|vbscript|blob):/i.test(url)) {
      throw new Error('Blocked: navigation to ' + url.split(':')[0] + ': URLs is not allowed')
    }
    await this.sendCommand(tabId, 'Page.navigate', { url }, 30000)
  }

  async click(tabId: string, selector: string): Promise<void> {
    const escapedSelector = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const result = (await this.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('${escapedSelector}');
          if (!el) {
            // Try partial match fallback
            const all = document.querySelectorAll('*');
            for (const e of all) {
              if (e.matches && (e.getAttribute('aria-label') || '').toLowerCase().includes('${escapedSelector.replace(/[^a-z0-9]/gi, '').substring(0, 20)}'.toLowerCase())) {
                e.scrollIntoView({ behavior: 'instant', block: 'center' });
                e.click();
                return true;
              }
            }
            throw new Error('Element not found: ${escapedSelector}');
          }
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          // Simulate proper mouse events for better compatibility
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy }));
          return true;
        })()
      `,
      returnByValue: true
    })) as { result?: { value?: boolean; description?: string }; exceptionDetails?: { text: string } }

    if (result.exceptionDetails) {
      throw new Error(`Click failed: ${result.exceptionDetails.text}`)
    }
  }

  async type(tabId: string, selector: string, value: string): Promise<void> {
    const escapedSelector = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const escapedValue = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')

    const result = (await this.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('${escapedSelector}');
          if (!el) throw new Error('Element not found: ${escapedSelector}');
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          el.focus();
          // Clear existing value first
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          // Set new value
          el.value = '${escapedValue}';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          // Also dispatch keyboard events for frameworks that listen to them
          el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          return true;
        })()
      `,
      returnByValue: true
    })) as { result?: { value?: boolean }; exceptionDetails?: { text: string; exception?: { description?: string } } };
    if (result.exceptionDetails) {
      // ISSUE 7: typing failed on the page — report it, never claim success
      throw new Error('Type failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
    }
  }

  async scroll(tabId: string, direction: 'up' | 'down', amount: number = 300): Promise<void> {
    const delta = direction === 'up' ? -amount : amount
    await this.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `window.scrollBy(0, ${delta})`,
      returnByValue: true
    })
  }

  async getText(tabId: string, selector?: string): Promise<string> {
    const expression = selector
      ? `document.querySelector('${selector.replace(/'/g, "\\'")}')?.innerText || ''`
      : 'document.body.innerText'

    const result = (await this.sendCommand(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true
    })) as { result?: { value?: string } }

    return result?.result?.value || ''
  }

  async getHTML(tabId: string, selector?: string): Promise<string> {
    const expression = selector
      ? `document.querySelector('${selector.replace(/'/g, "\\'")}')?.innerHTML || ''`
      : 'document.documentElement.outerHTML'

    const result = (await this.sendCommand(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true
    })) as { result?: { value?: string } }

    return result?.result?.value || ''
  }

  async screenshot(tabId: string): Promise<string> {
    const result = (await this.sendCommand(tabId, 'Page.captureScreenshot', {
      format: 'png',
      quality: 80
    })) as { data?: string }

    return result?.data || ''
  }

  async executeJS(tabId: string, code: string): Promise<unknown> {
    const result = (await this.sendCommand(tabId, 'Runtime.evaluate', {
      expression: code,
      returnByValue: true,
      awaitPromise: true
    })) as { result?: { value?: unknown; type?: string }; exceptionDetails?: { text: string } }

    if (result.exceptionDetails) {
      throw new Error(`JS execution failed: ${result.exceptionDetails.text}`)
    }

    return result?.result?.value
  }

  async getPageInfo(tabId: string): Promise<{ url: string; title: string }> {
    const result = (await this.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `JSON.stringify({ url: location.href, title: document.title })`,
      returnByValue: true
    })) as { result?: { value?: string } }

    try {
      return JSON.parse(result?.result?.value || '{}')
    } catch {
      return { url: '', title: '' }
    }
  }

  async getDOMSnapshot(tabId: string): Promise<string> {
    const result = (await this.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          function summarize(node, depth = 0) {
            if (depth > 5) return '';
            if (node.nodeType === 3) {
              const text = node.textContent.trim();
              return text ? '  '.repeat(depth) + text + '\\n' : '';
            }
            if (node.nodeType !== 1) return '';
            if (node.id && String(node.id).indexOf('__agent_') === 0) return '';
            const tag = node.tagName.toLowerCase();
            if (['script', 'style', 'noscript', 'svg'].includes(tag)) return '';
            const attrs = [];
            if (node.id) attrs.push('id=' + node.id);
            if (node.className && typeof node.className === 'string') attrs.push('class=' + node.className.split(' ').slice(0, 3).join('.'));
            const interactive = ['a', 'button', 'input', 'select', 'textarea', 'form'].includes(tag);
            if (node.href) attrs.push('href=' + node.href.substring(0, 100));
            if (node.type) attrs.push('type=' + node.type);
            if (node.placeholder) attrs.push('placeholder=' + node.placeholder);
            const role = node.getAttribute('role');
            if (role) attrs.push('role=' + role);
            const ariaLabel = node.getAttribute('aria-label');
            if (ariaLabel) attrs.push('aria-label=' + ariaLabel);
            let result = '  '.repeat(depth) + '<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + '>';
            if (interactive) result += ' [INTERACTIVE]';
            result += '\\n';
            for (const child of node.childNodes) {
              result += summarize(child, depth + 1);
            }
            return result;
          }
          return summarize(document.body);
        })()
      `,
      returnByValue: true
    })) as { result?: { value?: string } }

    return result?.result?.value || ''
  }

  async findInteractiveElements(tabId: string): Promise<Array<{ tag: string; selector: string; text: string; type: string }>> {
    const result = (await this.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const elements = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [onclick], [tabindex]');
          return Array.from(elements).slice(0, 100).map((el, i) => {
            const tag = el.tagName.toLowerCase();
            // Generate the most specific selector possible
            let selector = '';
            // Prefer data attributes (most stable)
            const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy');
            if (testId) {
              selector = tag + '[data-testid="' + testId + '"]';
            }
            // Then try unique ID
            else if (el.id && !el.id.match(/^[0-9]/) && !el.id.includes('__')) {
              selector = '#' + el.id;
            }
            // Then try aria-label
            else if (el.getAttribute('aria-label')) {
              selector = tag + '[aria-label="' + el.getAttribute('aria-label').replace(/"/g, '\\\\"') + '"]';
            }
            // Then try name attribute
            else if (el.name) {
              selector = tag + '[name="' + el.name + '"]';
            }
            // Then try placeholder
            else if (el.placeholder) {
              selector = tag + '[placeholder="' + el.placeholder.replace(/"/g, '\\\\"').substring(0, 30) + '"]';
            }
            // Then try role
            else if (el.getAttribute('role')) {
              selector = tag + '[role="' + el.getAttribute('role') + '"]';
            }
            // Fallback to tag + classes
            else {
              const cls = el.className && typeof el.className === 'string'
                ? '.' + el.className.split(' ').filter((c) => Boolean(c) && !c.startsWith('__')).slice(0, 2).join('.')
                : '';
              selector = tag + cls;
            }

            const text = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').trim().substring(0, 80);
            return {
              tag,
              selector,
              text,
              type: el.type || el.getAttribute('role') || tag
            };
          });
        })()
      `,
      returnByValue: true
    })) as { result?: { value?: Array<{ tag: string; selector: string; text: string; type: string }> } }

    return result?.result?.value || []
  }

  async executeAction(tabId: string, action: CDPAction): Promise<string> {
    switch (action.type) {
      case 'navigate':
        if (!action.url) throw new Error('URL required for navigate')
        await this.navigate(tabId, action.url)
        return `Navigated to ${action.url}`

      case 'click':
        if (!action.selector) throw new Error('Selector required for click')
        await this.click(tabId, action.selector)
        return `Clicked ${action.selector}`

      case 'type':
        if (!action.selector || !action.value) throw new Error('Selector and value required for type')
        await this.type(tabId, action.selector, action.value)
        return `Typed "${action.value}" into ${action.selector}`

      case 'scroll':
        await this.scroll(tabId, (action.options?.direction as 'up' | 'down') || 'down', (action.options?.amount as number) || 300)
        return `Scrolled ${action.options?.direction || 'down'}`

      case 'screenshot': {
        const data = await this.screenshot(tabId)
        return `Screenshot captured (${Math.round(data.length / 1024)}KB base64)`
      }

      case 'extract':
        return await this.getText(tabId, action.selector)

      case 'js_execute':
        if (!action.code) throw new Error('Code required for js_execute')
        return String(await this.executeJS(tabId, action.code))

      case 'wait':
        await new Promise((resolve) => setTimeout(resolve, (action.options?.ms as number) || 1000))
        return `Waited ${action.options?.ms || 1000}ms`

      default:
        throw new Error(`Unknown action type: ${action.type}`)
    }
  }

  destroy(): void {
    for (const [tabId] of this.attachedTabs) {
      this.detach(tabId)
    }
  }
}
