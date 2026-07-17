// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
    // React 19's new compiler-oriented rules flag established React Native
    // patterns (Reanimated shared-value writes, close-animation refs, and
    // effect-driven native data loading). Keep them visible during the gradual
    // compiler migration without making the release lint command unusable.
    rules: {
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  }
]);
