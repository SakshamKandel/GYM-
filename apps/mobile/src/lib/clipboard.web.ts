/**
 * Web half of the clipboard split (see clipboard.ts).
 *
 * Browsers only allow a clipboard write from a user gesture and only on a
 * secure origin, so this can legitimately fail; it reports false instead of
 * throwing, and the caller keeps the value on screen to copy by hand.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
