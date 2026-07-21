interface BlurCapable {
  blur: () => void;
}

function canBlur(value: unknown): value is BlurCapable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'blur' in value &&
    typeof (value as BlurCapable).blur === 'function'
  );
}

/**
 * React Navigation hides the previous web screen with aria-hidden. Clear the
 * activating control first so focus is never retained inside that hidden tree.
 */
export function blurActiveElement(): void {
  const activeElement = globalThis.document?.activeElement;
  if (canBlur(activeElement)) activeElement.blur();
}
