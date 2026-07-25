import { Clipboard } from 'react-native';

/**
 * Copy a short string (a wallet id, an account number) to the device clipboard.
 *
 * Native half of a platform split (see clipboard.web.ts). This app has no
 * clipboard dependency of its own, so it uses the one still shipped inside
 * react-native rather than adding a package: the values copied here are a
 * dozen characters of payment detail, which is exactly what that API was for.
 *
 * Returns whether the copy happened, so a caller can stay quiet instead of
 * claiming "Copied" when nothing was.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;
  try {
    Clipboard.setString(value);
    return true;
  } catch {
    return false;
  }
}
