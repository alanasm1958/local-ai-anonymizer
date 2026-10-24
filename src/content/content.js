// Content script (classic script: MV3 content scripts cannot be modules).
// Intercepts paste on AI sites, sends the text to the service worker for
// local anonymization, then inserts the anonymized version.

(() => {
  if (window.__localAnonymizerLoaded) return;
  window.__localAnonymizerLoaded = true;

  const MIN_PASTE_LENGTH = 2;
  const SUCCESS_TOAST_MS = 7000;
  const MAX_LISTED = 6;

  const state = { active: false, interceptPaste: false };
  let dispatchingSyntheticPaste = false;

  // ---------- messaging ----------

  async function send(type, payload = {}) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type, ...payload });
    } catch (err) {
      if (!chrome.runtime?.id) throw new Error('The extension was reloaded. Refresh this page to keep protection on.');
      throw new Error(`The extension stopped responding (${err.message}). The text may be too large or the model too slow.`);
    }
    if (!response?.ok) throw new Error(response?.error ?? 'Unknown error');
    return response.data;
  }

  async function refreshStatus() {
    try {
      const status = await send('siteStatus', { hostname: location.hostname });
      state.active = status.active;
      state.interceptPaste = status.interceptPaste;
    } catch {
      state.active = false;
    }
  }

  // ---------- editable targets ----------

  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', '']);

  const isTextControl = (el) =>
    el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type));

  function editableRoot(node) {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!el) return null;
    if (isTextControl(el)) return el;
    return el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');
  }

  function captureSelection(el) {
    if (isTextControl(el)) return { el, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
    const sel = window.getSelection();
    const range = sel.rangeCount > 0 && el.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    return { el, range };
  }

  function selectAll(el) {
    if (isTextControl(el)) return { el, start: 0, end: el.value.length };
    const range = document.createRange();
    range.selectNodeContents(el);
    return { el, range };
  }

  function restoreSelection(snapshot) {
    const { el } = snapshot;
    el.focus();
    if (isTextControl(el)) {
      el.setSelectionRange(snapshot.start, snapshot.end);
      return;
    }
    if (snapshot.range) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(snapshot.range);
    }
  }

  function selectedText(snapshot) {
    if (isTextControl(snapshot.el)) return snapshot.el.value.slice(snapshot.start, snapshot.end);
    restoreSelection(snapshot);
    return window.getSelection().toString();
  }

  function insertIntoControl(el, text) {
    if (document.execCommand('insertText', false, text)) return;
    el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
  }

  // Rich editors (ProseMirror, Lexical, Quill) handle a synthetic paste event,
  // which keeps line breaks and undo history. Fall back to insertText.
  function insertIntoRichEditor(el, text) {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    dispatchingSyntheticPaste = true;
    try {
      el.dispatchEvent(event);
    } finally {
      dispatchingSyntheticPaste = false;
    }
    if (!event.defaultPrevented) document.execCommand('insertText', false, text);
  }

  function insertText(snapshot, text) {
    restoreSelection(snapshot);
    if (isTextControl(snapshot.el)) insertIntoControl(snapshot.el, text);
    else insertIntoRichEditor(snapshot.el, text);
  }

  // ---------- core flows ----------

  async function anonymizeInto(snapshot, text) {
    const toast = ui.show({ status: 'busy', title: 'Anonymizing with your local model...', body: `${text.length.toLocaleString()} characters` });
    try {
      const result = await send('anonymize', { text });
      insertText(snapshot, result.text);
      ui.update(toast, describeResult(result));
    } catch (err) {
      ui.update(toast, {
        status: 'error',
        title: 'Nothing was inserted',
        body: err.message,
        actions: [{ label: 'Insert original anyway', onClick: () => insertText(snapshot, text) }],
      });
    }
  }

  function onPaste(event) {
    if (dispatchingSyntheticPaste || !state.active || !state.interceptPaste) return;
    // composedPath()[0] is the real target even inside open shadow roots,
    // where event.target is retargeted to the shadow host.
    const target = editableRoot(event.composedPath()[0] ?? event.target);
    if (!target) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text.trim().length < MIN_PASTE_LENGTH) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    anonymizeInto(captureSelection(target), text);
  }

  function hasSelection(snapshot) {
    if (isTextControl(snapshot.el)) return snapshot.end > snapshot.start;
    return Boolean(snapshot.range && !snapshot.range.collapsed);
  }

  // Follows focus into open shadow roots (web-component based editors).
  function deepActiveElement() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function fieldSnapshot() {
    const el = editableRoot(deepActiveElement());
    if (!el) return null;
    const current = captureSelection(el);
    return hasSelection(current) ? current : selectAll(el);
  }

  function selectionSnapshot() {
    const active = document.activeElement;
    if (isTextControl(active)) {
      const snap = captureSelection(active);
      return hasSelection(snap) ? snap : null;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const el = editableRoot(sel.anchorNode);
    return el ? captureSelection(el) : { el: null, text: sel.toString() };
  }

  async function runAction({ action, scope }) {
    const snapshot = scope === 'field' ? fieldSnapshot() : selectionSnapshot();
    if (!snapshot) {
      ui.show({ status: 'warn', title: scope === 'field' ? 'Click into a text box first' : 'Select some text first' });
      return;
    }
    const text = snapshot.el ? selectedText(snapshot) : snapshot.text;
    if (!text.trim()) return;

    if (snapshot.el && action === 'anonymize') {
      anonymizeInto(snapshot, text);
      return;
    }
    await runReadOnlyAction(action, text, snapshot);
  }

  async function runReadOnlyAction(action, text, snapshot) {
    const toast = ui.show({ status: 'busy', title: action === 'restore' ? 'Restoring originals...' : 'Anonymizing...' });
    try {
      const result = await send(action, { text });
      const output = result.text;
      const actions = [{ label: 'Copy', onClick: () => navigator.clipboard.writeText(output), keepOpen: true }];
      if (snapshot.el) actions.push({ label: 'Replace selection', onClick: () => insertText(snapshot, output) });
      const title = action === 'restore'
        ? `Restored ${result.restoredCount} placeholder${result.restoredCount === 1 ? '' : 's'}`
        : describeResult(result).title;
      ui.update(toast, { status: 'done', title, preview: output, actions, sticky: true });
    } catch (err) {
      ui.update(toast, { status: 'error', title: 'Something went wrong', body: err.message });
    }
  }

  function describeResult({ replacements, warnings }) {
    const unique = [...new Map(replacements.map((r) => [r.placeholder, r])).values()];
    const count = unique.length;
    const lines = unique.slice(0, MAX_LISTED).map((r) => ({ from: r.original, to: r.placeholder }));
    const extra = count > MAX_LISTED ? `and ${count - MAX_LISTED} more` : '';
    return {
      status: warnings.length ? 'warn' : 'done',
      title: count ? `Protected ${count} item${count === 1 ? '' : 's'}` : 'No sensitive data found',
      lines,
      body: [extra, ...warnings].filter(Boolean).join('\n'),
      sticky: warnings.length > 0,
    };
  }

  // ---------- toast UI (closed shadow root, isolated from page CSS) ----------

  const ui = (() => {
    let stack = null;

    const STYLE = `
      :host { all: initial; }
      .stack { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; flex-direction: column; gap: 8px; width: min(360px, calc(100vw - 32px)); font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .toast { background: #0b1f1d; color: #e7f5f2; border-radius: 12px; padding: 12px 14px; box-shadow: 0 10px 30px rgba(0,0,0,.28); border-left: 4px solid #2dd4bf; animation: in .18s ease-out; }
      .toast[data-status="warn"] { border-left-color: #fbbf24; }
      .toast[data-status="error"] { border-left-color: #f87171; }
      .head { display: flex; align-items: center; gap: 8px; }
      .title { font-weight: 600; flex: 1; }
      .close { background: none; border: 0; color: inherit; opacity: .6; cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; }
      .close:hover { opacity: 1; }
      .spinner { width: 12px; height: 12px; border: 2px solid #2dd4bf55; border-top-color: #2dd4bf; border-radius: 50%; animation: spin .8s linear infinite; flex: none; }
      .body { margin-top: 4px; opacity: .85; white-space: pre-wrap; word-break: break-word; }
      ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 3px; }
      li { display: flex; gap: 6px; align-items: baseline; font-size: 12px; }
      .from { opacity: .7; text-decoration: line-through; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55%; }
      .to { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #5eead4; }
      .preview { margin-top: 8px; max-height: 140px; overflow: auto; background: #ffffff10; border-radius: 8px; padding: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
      .actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
      .actions button { background: #2dd4bf; color: #04201c; border: 0; border-radius: 7px; padding: 5px 10px; font: inherit; font-weight: 600; cursor: pointer; }
      .actions button.secondary { background: #ffffff1a; color: inherit; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes in { from { transform: translateY(8px); opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .toast, .spinner { animation: none; } }
    `;

    function ensureStack() {
      if (stack?.isConnected) return stack;
      const host = document.createElement('local-anonymizer-ui');
      const root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = STYLE;
      stack = document.createElement('div');
      stack.className = 'stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      root.append(style, stack);
      document.documentElement.append(host);
      return stack;
    }

    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    function render(toast, opts) {
      toast.replaceChildren();
      toast.dataset.status = opts.status;
      const head = el('div', 'head');
      if (opts.status === 'busy') head.append(el('span', 'spinner'));
      head.append(el('span', 'title', opts.title));
      const close = el('button', 'close', '×');
      close.setAttribute('aria-label', 'Dismiss');
      close.addEventListener('click', () => toast.remove());
      head.append(close);
      toast.append(head);

      if (opts.lines?.length) {
        const list = el('ul');
        opts.lines.forEach(({ from, to }) => {
          const li = el('li');
          li.append(el('span', 'from', from), el('span', null, '→'), el('span', 'to', to));
          list.append(li);
        });
        toast.append(list);
      }
      if (opts.body) toast.append(el('div', 'body', opts.body));
      if (opts.preview) toast.append(el('div', 'preview', opts.preview));
      if (opts.actions?.length) toast.append(renderActions(toast, opts.actions));
      scheduleDismiss(toast, opts);
    }

    function renderActions(toast, actions) {
      const row = el('div', 'actions');
      actions.forEach((action, i) => {
        const button = el('button', i === 0 ? '' : 'secondary', action.label);
        button.addEventListener('click', async () => {
          try {
            await action.onClick();
            if (action.keepOpen) button.textContent = 'Copied';
            else toast.remove();
          } catch (err) {
            button.textContent = `Failed: ${err.message}`;
          }
        });
        row.append(button);
      });
      return row;
    }

    function scheduleDismiss(toast, opts) {
      clearTimeout(toast.timer);
      if (opts.status !== 'done' || opts.sticky) return;
      const arm = () => { toast.timer = setTimeout(() => toast.remove(), SUCCESS_TOAST_MS); };
      toast.onmouseenter = () => clearTimeout(toast.timer);
      toast.onmouseleave = arm;
      arm();
    }

    return {
      show(opts) {
        const toast = el('div', 'toast');
        ensureStack().append(toast);
        render(toast, opts);
        return toast;
      },
      update(toast, opts) {
        if (!toast.isConnected) ensureStack().append(toast);
        render(toast, opts);
      },
    };
  })();

  // ---------- wiring ----------

  window.addEventListener('paste', onPaste, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'ping') {
      sendResponse(true);
      return false;
    }
    if (message?.type === 'runAction') runAction(message);
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) refreshStatus();
  });

  refreshStatus();
})();
