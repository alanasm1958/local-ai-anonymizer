// Content script (classic script: MV3 content scripts cannot be modules).
// Intercepts paste on AI sites, sends the text to the service worker for
// local anonymization, then inserts the anonymized version.

(() => {
  if (window.__localAnonymizerLoaded) return;
  window.__localAnonymizerLoaded = true;

  const MIN_PASTE_LENGTH = 2;
  const MAX_LISTED = 6;

  // Fail closed: protection is on from the first moment, before the worker
  // has confirmed this site's settings.
  const PROTECTED = Object.freeze({ active: true, interceptPaste: true, checkFiles: true, holdUncheckedFiles: true });
  const state = { ...PROTECTED, restoreReplies: false };
  let dispatchingSynthetic = false;

  // toast.js, reveal.js and uploads.js are injected first into the same isolated world.
  const ui = globalThis.__anonymizerToast;
  const revealer = globalThis.__anonymizerReveal?.createRevealer({
    lookup: (placeholders) => send('lookup', { placeholders }),
  });
  const uploads = globalThis.__anonymizerUploads?.createUploadGuard({
    send: (type, payload) => send(type, payload),
    ui,
    settings: () => state,
  });

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
      state.restoreReplies = status.restoreReplies;
      state.checkFiles = status.checkFiles;
      state.holdUncheckedFiles = status.holdUncheckedFiles;
    } catch {
      // Extension removed or reloaded: get out of the way. Worker unreachable:
      // stay protected; pastes and uploads then stop with an error instead
      // of passing through.
      if (!chrome.runtime?.id) state.active = false;
      else Object.assign(state, PROTECTED);
    }
    if (state.active && state.restoreReplies) revealer?.start();
    else revealer?.stop();
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
    // Quill 1.x (Gemini) answers paste by moving focus to a hidden clipboard
    // box and reading it later, which would swallow our insertion and flatten
    // line breaks. Type into it directly instead.
    if (el.closest('.ql-editor')) {
      insertLines(text);
      return;
    }
    const event = dispatchSynthetic(el, text);
    if (!event.defaultPrevented) insertLines(text);
  }

  // Editors that ignore synthetic paste (Gemini's Quill) drop "\n" from
  // insertText, so insert line by line with real paragraph breaks.
  function insertLines(text) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (i > 0) document.execCommand('insertParagraph');
      if (line) document.execCommand('insertText', false, line);
    });
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

  // Re-dispatches a paste or drop carrying already-anonymized text. Our own
  // listeners skip it while the flag is set.
  function dispatchSynthetic(el, text, kind = 'paste', point = {}) {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const init = { bubbles: true, cancelable: true, composed: true };
    const event = kind === 'drop'
      ? new DragEvent('drop', { ...init, dataTransfer: data, clientX: point.x ?? 0, clientY: point.y ?? 0 })
      : new ClipboardEvent('paste', { ...init, clipboardData: data });
    dispatchingSynthetic = true;
    try {
      el.dispatchEvent(event);
    } finally {
      dispatchingSynthetic = false;
    }
    return event;
  }

  // Paste or drop aimed at no text box (focus on a button or the page
  // background). Sites with "paste anywhere" route these into their composer,
  // so they are anonymized too, then handed back to the same element. If the
  // site ignores synthetic events nothing is inserted, which fails safe.
  async function anonymizeAndRedispatch(origin, text, kind = 'paste', point = {}) {
    const toast = ui.show({ status: 'busy', title: 'Anonymizing with your local model...', body: `${text.length.toLocaleString()} characters` });
    try {
      const result = await send('anonymize', { text });
      dispatchSynthetic(origin.isConnected ? origin : document.body, result.text, kind, point);
      const summary = describeResult(result);
      ui.update(toast, { ...summary, body: [summary.body, 'If nothing appeared, click into the message box and paste again.'].filter(Boolean).join('\n') });
    } catch (err) {
      ui.update(toast, { status: 'error', title: 'Nothing was pasted', body: err.message });
    }
  }

  // Password, number, date and other non-text fields are left to the browser;
  // their contents never go to the model.
  const isNonTextField = (el) =>
    el instanceof Element && el.matches('input, select, textarea') && !isTextControl(el);

  const BLOCK_TAGS = 'p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, section, article';

  // Parsed into an inert document: scripts never run, nothing is rendered.
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, template').forEach((n) => n.remove());
    doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    doc.querySelectorAll(BLOCK_TAGS).forEach((n) => n.append('\n'));
    return (doc.body?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Text carried by a paste or drop. Rich-text-only data (no text/plain) is
  // converted rather than let through unanonymized.
  function transferText(data) {
    if (!data) return '';
    return data.getData('text/plain')
      || (data.getData('text/html') ? htmlToText(data.getData('text/html')) : '')
      || data.getData('text/uri-list');
  }

  const isOwnEvent = () => dispatchingSynthetic || Boolean(uploads?.isDispatching());

  // Files in a paste or drop go to the upload guard instead of the text path.
  function guardFiles(event, kind, origin) {
    const transfer = kind === 'drop' ? event.dataTransfer : event.clipboardData;
    // "Copy image" puts the image plus HTML with no text on the clipboard;
    // that is a file paste. Copying from Word or Excel carries real text.
    const htmlHasText = Boolean(htmlToText(transfer?.getData('text/html') ?? '').trim());
    const files = uploads?.filesOf(transfer, kind, htmlHasText) ?? [];
    if (!files.length || !state.checkFiles) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = { x: event.clientX, y: event.clientY };
    uploads.guard(files, (out) => uploads.dispatchFiles(origin, out, kind, point));
    return true;
  }

  function onPaste(event) {
    if (isOwnEvent() || !state.active) return;
    // composedPath()[0] is the real target even inside open shadow roots,
    // where event.target is retargeted to the shadow host.
    const origin = event.composedPath()[0] ?? event.target;
    // Files first: they may be dropped or pasted onto a file input itself.
    if (guardFiles(event, 'paste', origin) || isNonTextField(origin) || !state.interceptPaste) return;
    const text = transferText(event.clipboardData);
    if (text.trim().length < MIN_PASTE_LENGTH) return;
    const target = editableRoot(origin);
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target) anonymizeInto(captureSelection(target), text);
    else anonymizeAndRedispatch(origin, text);
  }

  // Moving text around inside a text box on this page is left alone: that
  // text is already on the page, and intercepting would turn a move into a
  // copy. Only trusted drags count (a page can't fake one to switch this
  // off), and the drop must carry exactly the dragged text. Drags from
  // anywhere else, including revealed names in a reply, are anonymized.
  let pageDrag = null;
  const sameText = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

  function selectedTextIn(field) {
    if (isTextControl(field)) return field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
    return window.getSelection()?.toString() ?? '';
  }

  function onDragStart(event) {
    if (!event.isTrusted) return;
    const field = editableRoot(event.composedPath()[0] ?? event.target);
    pageDrag = field ? { text: selectedTextIn(field) } : null;
  }

  function onDragEnd(event) {
    if (event.isTrusted) pageDrag = null;
  }

  // Caret position under the drop point, or the field's current selection.
  function dropSnapshot(el, x, y) {
    const caret = document.caretPositionFromPoint?.(x, y);
    if (isTextControl(el)) {
      const offset = caret?.offsetNode === el ? caret.offset : el.selectionEnd ?? el.value.length;
      return { el, start: offset, end: offset };
    }
    if (caret && el.contains(caret.offsetNode)) {
      const range = document.createRange();
      range.setStart(caret.offsetNode, caret.offset);
      return { el, range };
    }
    return captureSelection(el);
  }

  function onDrop(event) {
    const drag = pageDrag;
    pageDrag = null;
    if (isOwnEvent() || !state.active) return;
    const origin = event.composedPath()[0] ?? event.target;
    if (guardFiles(event, 'drop', origin) || isNonTextField(origin) || !state.interceptPaste) return;
    const text = transferText(event.dataTransfer);
    if (text.trim().length < MIN_PASTE_LENGTH) return;
    if (drag && sameText(drag.text, text)) return;
    const target = editableRoot(origin);
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target) anonymizeInto(dropSnapshot(target, event.clientX, event.clientY), text);
    else anonymizeAndRedispatch(origin, text, 'drop', { x: event.clientX, y: event.clientY });
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

  function describeResult({ replacements, warnings, summary }) {
    const unique = [...new Map(replacements.map((r) => [r.placeholder, r])).values()];
    const count = summary?.items ?? unique.length;
    const lines = unique.slice(0, MAX_LISTED).map((r) => ({ from: r.original, to: r.placeholder }));
    const extra = unique.length > MAX_LISTED ? `and ${unique.length - MAX_LISTED} more` : '';
    return {
      status: warnings.length ? 'warn' : 'done',
      title: count ? `Protected ${count} item${count === 1 ? '' : 's'}` : 'No sensitive data found',
      summary: summary?.breakdown ?? '',
      lines,
      body: [extra, ...warnings].filter(Boolean).join('\n'),
      sticky: warnings.length > 0,
    };
  }


  // ---------- wiring ----------

  uploads?.watchFileInputs();
  window.addEventListener('paste', onPaste, true);
  window.addEventListener('drop', onDrop, true);
  window.addEventListener('dragstart', onDragStart, true);
  window.addEventListener('dragend', onDragEnd, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'ping') {
      sendResponse(true);
      return false;
    }
    if (message?.type === 'runAction') runAction(message);
    if (message?.type === 'vaultCleared') revealer?.reset();
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) refreshStatus();
  });

  refreshStatus();
})();
