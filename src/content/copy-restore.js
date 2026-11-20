// Copy with real details (classic content script, loaded before content.js and
// exposed as globalThis.__anonymizerCopyRestore). When the user copies part of
// an AI reply with Ctrl/Cmd+C, the clipboard gets the reply with the real
// values filled in, so it can go straight into an email or document.
//
// The page must never see those values. The listener sits on window in the
// capture phase, registered at document_start before any page script, and
// stops the copy event before the page's own listeners run: the page sees no
// copy event at all. The clipboard first gets the placeholder text (what the
// browser would have copied); the real values are written afterwards with the
// async Clipboard API, which pages cannot read without a permission prompt.
// Text boxes keep the browser's own copy (that is the user's draft, not a reply).
// The page controls the reply's markup, so the HTML copy is rebuilt in an inert
// document: real values go into visible text only, every attribute is dropped
// and elements that load or embed anything are removed. Otherwise a hostile page
// could hide "[PERSON_1]" in an image URL that a mail client loads on paste.

(() => {
  if (globalThis.__anonymizerCopyRestore) return;

  const PLACEHOLDER = /\[[A-Z][A-Z_]*?_\d+\]/g;
  const DROPPED = 'img, picture, source, video, audio, track, iframe, frame, object, embed, svg, math, canvas, link, style, script, '
    + 'noscript, template, meta, base, form, input, button, select, textarea';
  const KEPT_ATTRIBUTES = new Set(['colspan', 'rowspan']);

  const placeholdersIn = (text) => [...new Set(text.match(PLACEHOLDER) ?? [])];
  const fill = (text, originals) => text.replace(PLACEHOLDER, (p) => (Object.hasOwn(originals, p) ? originals[p] : p));

  // The selection as safe formatting (headings, lists, bold, tables), copied
  // at copy time into a document that never loads anything.
  function safeSnapshot(selection) {
    const doc = document.implementation.createHTMLDocument('');
    const box = doc.createElement('div');
    for (let i = 0; i < selection.rangeCount; i += 1) box.append(doc.importNode(selection.getRangeAt(i).cloneContents(), true));
    box.querySelectorAll(DROPPED).forEach((el) => el.remove());
    box.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((a) => { if (!KEPT_ATTRIBUTES.has(a.name)) el.removeAttribute(a.name); });
    });
    return box;
  }

  // Serialized snapshot; `originals` fill visible text only, never markup.
  function snapshotHtml(snapshot, originals = {}) {
    const box = snapshot.cloneNode(true);
    const walker = box.ownerDocument.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) node.data = fill(node.data, originals);
    return box.innerHTML;
  }

  async function writeClipboard(plain, html) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
    } catch {
      await navigator.clipboard.writeText(plain);
    }
  }

  // `deps` are content.js helpers: send, ui, settings, editableRoot.
  function createCopyRestorer({ send, ui, settings, editableRoot }) {
    async function fillClipboard(plain, snapshot) {
      try {
        const originals = await send('copyOriginals', { placeholders: placeholdersIn(plain) });
        const count = Object.keys(originals ?? {}).length;
        if (!count) return;
        await writeClipboard(fill(plain, originals), snapshotHtml(snapshot, originals));
        // The panel shows a count only: real values are never drawn in the page.
        ui?.show({ status: 'done', title: 'Copied with real details', summary: `${count} detail${count === 1 ? '' : 's'} filled in` });
      } catch (err) {
        ui?.show({
          status: 'warn',
          title: 'Copied with labels only',
          body: `Right-click the selection and choose "Restore originals in selection" instead. (${err.message})`,
        });
      }
    }

    function onCopy(event) {
      const state = settings();
      if (!event.isTrusted || !state.active || !state.restoreOnCopy || !event.clipboardData) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      if (editableRoot(event.target) || editableRoot(selection.anchorNode)) return;
      const plain = selection.toString();
      if (!placeholdersIn(plain).length) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const snapshot = safeSnapshot(selection);
      event.clipboardData.setData('text/plain', plain);
      event.clipboardData.setData('text/html', snapshotHtml(snapshot));
      fillClipboard(plain, snapshot);
    }

    return {
      watch: () => window.addEventListener('copy', onCopy, true),
    };
  }

  globalThis.__anonymizerCopyRestore = Object.freeze({ createCopyRestorer });
})();
