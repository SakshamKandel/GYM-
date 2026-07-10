import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';
import { colors } from '@gym/ui-tokens';

/**
 * Web-only HTML shell (expo-router). Native builds never touch this file.
 * Exists to keep the dark theme intact on web: browser autofill paints
 * inputs white/pale-blue unless overridden, and the body flashes white
 * before the JS bundle paints.
 */
const globalCss = `
  /* Full-height/width chain — Expo's default shell provides this; a custom
     +html.tsx must restore it exactly or flex:1 app roots collapse (black
     void below) and, without flex-direction column, the app renders as a
     narrow flex-row column beside the dev overlay (black void beside). */
  html, body { height: 100%; min-height: 100%; }
  body { margin: 0; overflow: hidden; background-color: ${colors.bg}; }
  /* Expo Router inserts a wrapper inside #root on web. It must take the full
     height too, otherwise a flex:1 React Native screen can stop at its content
     height and expose the body's black background below it. */
  #root, #root > div {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 100%;
    width: 100%;
  }
  input:-webkit-autofill,
  input:-webkit-autofill:hover,
  input:-webkit-autofill:focus,
  input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 1000px ${colors.surface} inset !important;
    -webkit-text-fill-color: ${colors.text} !important;
    caret-color: ${colors.text} !important;
    transition: background-color 9999999s ease-out 0s !important;
  }
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: globalCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
