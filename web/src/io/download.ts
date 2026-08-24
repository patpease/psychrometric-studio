/**
 * Handing a file to the user.
 *
 * One place, because the object-URL lifecycle is easy to get subtly wrong: a
 * URL revoked too early gives an empty download on some browsers, and one never
 * revoked pins the whole blob in memory for the life of the page. Revoking on
 * the next frame is the behaviour that works everywhere.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

export function downloadText(text: string, filename: string, type: string): void {
  // The BOM-less UTF-8 declaration matters for the CSV: without the charset,
  // Excel on Windows reads the degree sign as two characters.
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}
