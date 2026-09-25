/**
 * Hands a JSON document to the browser as a file. Nothing is sent
 * anywhere; the document is the API's own answer, serialised as received.
 */
export function downloadJson(filename: string, document: unknown): boolean {
  if (typeof window === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}
