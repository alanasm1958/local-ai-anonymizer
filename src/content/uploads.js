// File protection on AI sites (classic content script, loaded before
// content.js and exposed as globalThis.__anonymizerUploads). Files picked,
// dropped or pasted are sent to the extension to be cleaned, then handed to
// the page in place of the originals. Files that can't be checked (PDF,
// images, archives) are held until the user decides.

(() => {
  if (globalThis.__anonymizerUploads) return;

  const MAX_FILE_BYTES = 25 * 1024 * 1024; // same limit as src/core/files.js
  const CHUNK = 0x8000;

  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return btoa(binary);
  }

  function fromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function createUploadGuard({ send, ui, settings }) {
    let dispatching = false;
    const busyInputs = new WeakSet();

    async function checkFile(file) {
      if (file.size > MAX_FILE_BYTES) {
        return { file, result: { status: 'unsupported', reason: 'the file is larger than 25 MB', name: file.name, notes: [] } };
      }
      const data = toBase64(new Uint8Array(await file.arrayBuffer()));
      const result = await send('anonymizeFile', { name: file.name, mime: file.type, data });
      // A file that can't be checked still travels under its cleaned name.
      if (result.status === 'unsupported' && result.name !== file.name) {
        return { file: new File([file], result.name, { type: file.type, lastModified: file.lastModified }), result };
      }
      if (result.status !== 'cleaned') return { file, result };
      const cleaned = new File([fromBase64(result.data)], result.name, { type: file.type, lastModified: Date.now() });
      return { file: cleaned, result };
    }

    function describeOne({ file, result }) {
      if (result.status === 'cleaned') return { label: file.name, detail: result.summary?.breakdown || 'details removed' };
      if (result.status === 'unchanged') return { label: file.name, detail: 'nothing sensitive found' };
      const reason = result.reason ?? 'this file can\'t be checked';
      return { label: file.name, detail: reason.charAt(0).toUpperCase() + reason.slice(1) };
    }

    function report(checked, passedUnchecked) {
      const cleaned = checked.filter((c) => c.result.status === 'cleaned');
      const items = cleaned.reduce((n, c) => n + (c.result.summary?.items ?? 0), 0);
      const notes = [...new Set(checked.flatMap((c) => c.result.notes ?? []))];
      return {
        status: passedUnchecked ? 'warn' : 'done',
        title: cleaned.length ? `Cleaned ${plural(cleaned.length, 'file')}` : `Checked ${plural(checked.length, 'file')}: nothing sensitive found`,
        summary: cleaned.length === 1 ? cleaned[0].result.summary?.breakdown : (items ? `${plural(items, 'item')} in ${plural(cleaned.length, 'file')}` : ''),
        items: checked.map(describeOne),
        body: notes.join('\n'),
        sticky: passedUnchecked || notes.length > 0,
      };
    }

    // Cleans `files`, then calls deliver(filesForThePage). Unsupported files
    // are held for a decision when the setting says so.
    async function guard(files, deliver) {
      const toast = ui.show({ status: 'busy', title: `Checking ${plural(files.length, 'file')}...` });
      let checked;
      try {
        checked = [];
        for (const file of files) checked.push(await checkFile(file));
      } catch (err) {
        ui.update(toast, {
          status: 'error',
          title: 'Files were not uploaded',
          body: err.message,
          actions: [{ label: 'Upload originals anyway', onClick: () => deliver(files) }],
        });
        return;
      }
      const held = checked.filter((c) => c.result.status === 'unsupported');
      const ready = checked.filter((c) => c.result.status !== 'unsupported');
      if (held.length && settings().holdUncheckedFiles) {
        ui.update(toast, {
          status: 'warn',
          title: held.length === 1 ? '1 file can\'t be checked' : `${held.length} files can't be checked`,
          items: checked.map(describeOne),
          body: `Upload ${held.length === 1 ? 'it' : 'them'} only if ${held.length === 1 ? 'it contains' : 'they contain'} nothing sensitive.`,
          sticky: true,
          actions: [
            ...(ready.length ? [{
              label: ready.length === 1 ? `Upload ${ready[0].file.name} only` : `Upload the other ${ready.length} files`,
              onClick: () => deliver(ready.map((c) => c.file)),
            }] : []),
            { label: 'Upload anyway', onClick: () => deliver(checked.map((c) => c.file)) },
            { label: 'Cancel', onClick: () => undefined },
          ],
        });
        return;
      }
      const delivered = deliver(checked.map((c) => c.file));
      if (delivered === false) {
        ui.update(toast, { status: 'warn', title: 'The upload box closed before cleaning finished', body: 'Attach the file again.', sticky: true });
        return;
      }
      ui.update(toast, report(checked, held.length > 0));
    }

    function withFlag(fn) {
      dispatching = true;
      try {
        return fn();
      } finally {
        dispatching = false;
      }
    }

    // Returns false when the page removed the input while files were cleaned.
    function setInputFiles(input, files) {
      if (!files.length) return true;
      if (!input.isConnected) return false;
      const data = new DataTransfer();
      files.forEach((f) => data.items.add(f));
      input.files = data.files;
      withFlag(() => {
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return true;
    }

    // Hands cleaned files back as a synthetic paste or drop on the same element.
    function dispatchFiles(el, files, kind, point = {}) {
      if (!files.length) return true;
      const data = new DataTransfer();
      files.forEach((f) => data.items.add(f));
      const init = { bubbles: true, cancelable: true, composed: true };
      const event = kind === 'drop'
        ? new DragEvent('drop', { ...init, dataTransfer: data, clientX: point.x ?? 0, clientY: point.y ?? 0 })
        : new ClipboardEvent('paste', { ...init, clipboardData: data });
      withFlag(() => (el.isConnected ? el : document.body).dispatchEvent(event));
      return true;
    }

    // The file picker fires "input" then "change"; both are stopped before
    // the page sees them, and the input is emptied at once so the page can't
    // read the originals while they are cleaned. A new selection made while
    // an earlier one is still being cleaned is guarded the same way.
    function onFileInput(event) {
      if (dispatching) return;
      const input = event.composedPath()[0];
      if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
      const s = settings();
      if (!s.active || !s.checkFiles) return;
      const files = [...(input.files ?? [])];
      if (!files.length) {
        if (busyInputs.has(input)) event.stopImmediatePropagation(); // the "change" after our clear
        return;
      }
      event.stopImmediatePropagation();
      busyInputs.add(input);
      input.value = '';
      guard(files, (out) => setInputFiles(input, out)).finally(() => busyInputs.delete(input));
    }

    function watchFileInputs() {
      window.addEventListener('input', onFileInput, true);
      window.addEventListener('change', onFileInput, true);
    }

    // Files carried by a paste or drop, if this event is about files at all.
    // Copying from Word or Excel also puts an image on the clipboard next to
    // real text; those pastes are text (handled by content.js).
    function filesOf(transfer, kind, htmlHasText) {
      const files = [...(transfer?.files ?? [])];
      if (!files.length) return [];
      if (kind === 'paste' && htmlHasText) return [];
      return files;
    }

    return { guard, dispatchFiles, filesOf, watchFileInputs, isDispatching: () => dispatching };
  }

  globalThis.__anonymizerUploads = Object.freeze({ createUploadGuard });
})();
