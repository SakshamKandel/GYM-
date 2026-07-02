/**
 * Web repo implementation — expo-sqlite's web support is alpha (wasm + COOP
 * headers), so the browser build uses the AsyncStorage-backed store. This file
 * keeps expo-sqlite entirely OUT of the web bundle via Metro platform resolution.
 */
export { createMemoryRepo as createRepoImpl } from './memory';
