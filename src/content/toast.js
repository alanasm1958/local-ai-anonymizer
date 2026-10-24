// On-page notification panel (classic content script). Lives in a closed
// shadow root so page CSS can't restyle it and page scripts can't read it.
// Loaded before content.js and exposed as globalThis.__anonymizerToast.

(() => {
  if (globalThis.__anonymizerToast) return;

  const SUCCESS_TOAST_MS = 7000;

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

  globalThis.__anonymizerToast = ui;
})();
