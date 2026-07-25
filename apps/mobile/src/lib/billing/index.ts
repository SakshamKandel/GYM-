/**
 * Store billing (Apple App Store / Google Play through RevenueCat).
 *
 * `./purchases` resolves to the web no-op on the web build and to the real
 * adapter on a phone, so callers import from here and never branch on platform.
 */
export * from './config';
export * from './purchases';
export * from './tierPackages';
export * from './types';
