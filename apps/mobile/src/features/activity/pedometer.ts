import { Platform } from 'react-native';
import { Pedometer } from 'expo-sensors';
import { todayIso } from '../../lib/dates';
import { getRepo } from '../../lib/repo';

/**
 * Platform-safe step service — the ONLY place that talks to expo-sensors or
 * Health Connect.
 *
 * Platform ladder (best available source wins; one source active at a time):
 *
 * 1. iOS — CoreMotion via `Pedometer.getStepCountAsync(startOfToday, now)`.
 *    The chip counts steps in hardware 24/7 (app closed included, ~7-day
 *    history), so every sync is an absolute full-day query written with
 *    `repo.setSteps` (idempotent truth). `watchStepCount` is used purely as a
 *    "something changed" tick while the app is open.
 *
 * 2. Android preferred — Health Connect (`react-native-health-connect`).
 *    The OS/provider (Samsung Health, Google Fit, Pixel sensors…) records
 *    steps continuously in the background; we only READ an aggregate on app
 *    start / foreground / manual refresh via `syncStepsNow`. No subscriptions,
 *    no background tasks, no polling — identical battery profile to iOS
 *    (i.e. zero attributable to this app: the counting happens in hardware /
 *    the provider either way). The module is NOT present in Expo Go, so it is
 *    loaded with a guarded dynamic require and everything degrades cleanly.
 *    While Health Connect is the active source its aggregate is AUTHORITATIVE:
 *    each read overwrites the day via `repo.setSteps`, so manual adds made on
 *    a Health-Connect day are absorbed/replaced by the next read (documented
 *    contract — HC already includes every step the phone saw).
 *
 * 3. Android fallback (Expo Go / HC unavailable / HC permission denied) —
 *    `Pedometer.watchStepCount` reports a CUMULATIVE count since subscription
 *    start. We track the last cumulative value in module state and persist
 *    positive deltas with `repo.addSteps`, guarding day rollovers and sensor
 *    counter resets. Because this path uses ADDITIVE deltas, manual adds
 *    (`repo.addSteps` from the UI) are never clobbered here. Steps walked
 *    while the app is closed are NOT captured on this path — that is exactly
 *    the gap Health Connect closes on a dev build.
 *
 * 4. Web / no sensor — expo-sensors resolves its web stub
 *    (isAvailableAsync → false), Health Connect require throws; everything
 *    degrades to "unsupported" and manual logging carries the day.
 *
 * Battery notes:
 * - NO background services, NO foreground services, NO polling while
 *   backgrounded. All reads are one-shot queries triggered by app start,
 *   app foreground, screen focus or a manual refresh.
 * - The only continuous consumer is the expo-sensors watch on the FALLBACK
 *   path, and that stream only exists while the JS runtime is alive (app in
 *   foreground/recents); the hardware step counter itself is an
 *   always-on ultra-low-power sensor owned by the OS.
 * - Repo writes are absorbed into a ~2s window so a chatty sensor stream
 *   (≈1 event/step) can't hammer SQLite.
 *
 * Permission is NEVER requested at app launch — `subscribeSteps` only starts
 * the sensor watch when permission is already granted; the user-facing CTAs
 * call `requestStepPermission()` / `requestHealthConnectPermission()` lazily.
 */

export type StepPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/**
 * Which source today's automatic steps come from RIGHT NOW:
 * - 'health-connect' — Android dev build, HC installed + read-Steps granted.
 * - 'sensor'         — CoreMotion (iOS) or expo-sensors watch (Android
 *                      fallback) with permission granted.
 * - 'manual-only'    — no automatic source; user logs steps by hand.
 */
export type StepsSource = 'health-connect' | 'sensor' | 'manual-only';

/** Fired after each persisted write with the day's new stored total. */
type StepsListener = (date: string, steps: number) => void;

const WRITE_WINDOW_MS = 2000;

let availableCache: boolean | null = null;
const listeners = new Set<StepsListener>();

// Watch lifecycle (app-lifetime singleton — never torn down once running,
// so Android deltas aren't lost to focus churn). Exception: the watch IS
// stopped if Health Connect becomes the active source mid-session, so the
// two sources can never double-count.
let watching = false;
let starting = false;
let subscription: Pedometer.Subscription | null = null;

// Android cumulative-delta state.
let lastCumulative: number | null = null;
let pendingDelta = 0;
let pendingDate = todayIso();

// Shared write-window timer (iOS: pending day query; Android: pending flush).
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// ────────────────────────────────────────────────────────────────
// Health Connect state (Android only; all values are per-session caches)
// ────────────────────────────────────────────────────────────────

type HealthConnectModule = typeof import('react-native-health-connect');

/** undefined = not loaded yet; null = load failed (Expo Go / not linked). */
let hcModule: HealthConnectModule | null | undefined;
/** SDK available on this device AND initialize() succeeded. */
let hcReady = false;
/** read-Steps permission granted. */
let hcGranted = false;
/** One probe per session — getSdkStatus/initialize are not free. */
let hcProbe: Promise<void> | null = null;

/**
 * Guarded dynamic require. `react-native-health-connect` binds its native
 * TurboModule with `getEnforcing`, which THROWS at require time inside Expo
 * Go (module not compiled in) — the try/catch converts that into a clean
 * "unavailable" so the sensor fallback takes over without crashing.
 */
function loadHealthConnect(): HealthConnectModule | null {
  if (hcModule !== undefined) return hcModule;
  if (Platform.OS !== 'android') {
    hcModule = null;
    return hcModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hcModule = require('react-native-health-connect') as HealthConnectModule;
  } catch {
    hcModule = null;
  }
  return hcModule;
}

/** Both permission unions share this shape — enough for a Steps-read check. */
function hasStepsRead(perms: readonly { accessType: string; recordType: string }[]): boolean {
  return perms.some((p) => p.accessType === 'read' && p.recordType === 'Steps');
}

/** One-time (per session) availability + granted-permission probe. */
async function probeHealthConnect(): Promise<void> {
  const hc = loadHealthConnect();
  if (hc === null) return;
  try {
    if ((await hc.getSdkStatus()) !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return;
    if (!(await hc.initialize())) return;
    hcReady = true;
    hcGranted = hasStepsRead(await hc.getGrantedPermissions());
  } catch {
    // Any native hiccup → treat HC as unavailable for this session.
    hcReady = false;
    hcGranted = false;
  }
}

/** True when Health Connect is the ACTIVE source (ready + granted). */
async function ensureHealthConnect(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (hcProbe === null) hcProbe = probeHealthConnect();
  await hcProbe;
  return hcReady && hcGranted;
}

/**
 * Show Health Connect's permission screen for read-Steps access. Android
 * only; call from a user action (the UI's "connect Health Connect" CTA).
 * Resolves `true` when access is (or already was) granted — in which case the
 * sensor fallback watch is stopped and an immediate authoritative read runs —
 * and `false` on iOS, in Expo Go, when HC is not installed, or on denial.
 */
export async function requestHealthConnectPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (hcProbe === null) hcProbe = probeHealthConnect();
  await hcProbe;
  if (!hcReady) return false;
  const hc = loadHealthConnect();
  if (hc === null) return false;
  if (!hcGranted) {
    try {
      hcGranted = hasStepsRead(
        await hc.requestPermission([{ accessType: 'read', recordType: 'Steps' }]),
      );
    } catch {
      return false;
    }
  }
  if (!hcGranted) return false;
  // HC just became authoritative: kill the sensor watch so the two sources
  // can't double-count, then take the first absolute reading right away.
  stopSensorWatch();
  await syncHealthConnectDay();
  return true;
}

/**
 * Where automatic steps come from right now. Async because the first call
 * may run the one-time Health Connect probe.
 */
export async function getStepsSource(): Promise<StepsSource> {
  if (await ensureHealthConnect()) return 'health-connect';
  if ((await isPedometerAvailable()) && (await getStepPermission()) === 'granted') {
    return 'sensor';
  }
  return 'manual-only';
}

export async function isPedometerAvailable(): Promise<boolean> {
  if (availableCache !== null) return availableCache;
  try {
    availableCache = await Pedometer.isAvailableAsync();
  } catch {
    // Sensor module blew up (some emulators/web) — treat as unsupported.
    availableCache = false;
  }
  return availableCache;
}

function toStepPermission(res: Pedometer.PermissionResponse): StepPermission {
  if (res.granted) return 'granted';
  if (res.status === Pedometer.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

/**
 * Passive SENSOR permission check — never shows a system prompt. Reflects
 * iOS Motion / Android ACTIVITY_RECOGNITION only; Health Connect access is a
 * separate grant surfaced through `getStepsSource()`.
 */
export async function getStepPermission(): Promise<StepPermission> {
  if (!(await isPedometerAvailable())) return 'unavailable';
  try {
    return toStepPermission(await Pedometer.getPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

/**
 * Show the system permission prompt (iOS Motion / Android ACTIVITY_RECOGNITION).
 * Call ONLY from a user action ("Enable step tracking"). Starts the watch on
 * grant — unless Health Connect is already the active source, in which case
 * the sensor watch stays off (HC supersedes it).
 */
export async function requestStepPermission(): Promise<StepPermission> {
  if (!(await isPedometerAvailable())) return 'unavailable';
  let perm: StepPermission;
  try {
    perm = toStepPermission(await Pedometer.requestPermissionsAsync());
  } catch {
    perm = 'unavailable';
  }
  if (perm === 'granted') await ensureWatching();
  return perm;
}

/**
 * Listen for persisted step totals (fired at most every ~2s while walking on
 * the sensor path; once per foreground read on the Health Connect path).
 * Also opportunistically starts the sensor watch when permission is already
 * granted and Health Connect is not the active source.
 * Returns an unsubscribe function.
 */
export function subscribeSteps(listener: StepsListener): () => void {
  listeners.add(listener);
  void ensureWatching();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Bring today's stored count as fresh as possible RIGHT NOW — call on screen
 * focus, app foreground, and manual refresh (these three ARE the entire read
 * schedule; nothing runs in the background).
 * - Android + Health Connect active: one aggregate query midnight→now, stored
 *   as the day's absolute total (picks up everything walked while the app was
 *   closed, courtesy of the OS/provider recording continuously).
 * - iOS: re-queries the full day from CoreMotion (which also picks up steps
 *   walked while backgrounded/closed).
 * - Android sensor fallback: flushes any pending in-session deltas.
 * No-op when unsupported or permission is missing.
 */
export async function syncStepsNow(): Promise<void> {
  if (await ensureHealthConnect()) {
    await syncHealthConnectDay();
    return;
  }
  await ensureWatching();
  if (!watching) return;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (Platform.OS === 'ios') await syncIosDay();
  else await flushAndroid();
}

// ────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────

function notify(date: string, steps: number): void {
  for (const l of listeners) l(date, steps);
}

async function ensureWatching(): Promise<void> {
  if (watching || starting) return;
  starting = true;
  try {
    // Health Connect active → the OS records steps for us; a sensor watch
    // would only double-count and burn cycles. Reads happen in syncStepsNow.
    if (await ensureHealthConnect()) return;
    if (!(await isPedometerAvailable())) return;
    if ((await getStepPermission()) !== 'granted') return;
    if (Platform.OS === 'ios') {
      subscription = Pedometer.watchStepCount(() => scheduleIosSync());
      watching = true;
      // Full-day truth immediately — the watch only ticks on NEW steps.
      await syncIosDay();
    } else {
      lastCumulative = null;
      pendingDelta = 0;
      pendingDate = todayIso();
      subscription = Pedometer.watchStepCount((result) => onAndroidSample(result.steps));
      watching = true;
    }
  } catch {
    // Watch failed to attach — stay unsupported for this session.
    subscription?.remove();
    subscription = null;
    watching = false;
  } finally {
    starting = false;
  }
}

/**
 * Tear down the sensor watch when Health Connect takes over mid-session.
 * Pending unflushed deltas are dropped deliberately: the very next HC
 * aggregate is an absolute overwrite that already includes those steps.
 */
function stopSensorWatch(): void {
  subscription?.remove();
  subscription = null;
  watching = false;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  lastCumulative = null;
  pendingDelta = 0;
  pendingDate = todayIso();
}

/**
 * Health Connect: absolute overwrite from a midnight→now aggregate query.
 * AUTHORITATIVE — replaces whatever is stored for today (including manual
 * adds, which HC has already counted if the phone registered them).
 */
async function syncHealthConnectDay(): Promise<void> {
  const hc = loadHealthConnect();
  if (hc === null) return;
  const date = todayIso();
  const startOfDay = new Date(`${date}T00:00:00`);
  try {
    const result = await hc.aggregateRecord({
      recordType: 'Steps',
      timeRangeFilter: {
        operator: 'between',
        startTime: startOfDay.toISOString(),
        endTime: new Date().toISOString(),
      },
    });
    const total = Math.max(0, Math.round(result.COUNT_TOTAL));
    const repo = await getRepo();
    await repo.setSteps(date, total);
    notify(date, total);
  } catch {
    // HC can reject transiently (provider syncing) — keep last stored value.
  }
}

/** iOS: absolute overwrite from a midnight→now CoreMotion query. */
async function syncIosDay(): Promise<void> {
  const date = todayIso();
  const startOfDay = new Date(`${date}T00:00:00`);
  try {
    const { steps } = await Pedometer.getStepCountAsync(startOfDay, new Date());
    const total = Math.max(0, Math.round(steps));
    const repo = await getRepo();
    await repo.setSteps(date, total);
    notify(date, total);
  } catch {
    // CoreMotion can reject transiently — keep the last stored value.
  }
}

/** Coalesce watch ticks: at most one full-day query per write window. */
function scheduleIosSync(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void syncIosDay();
  }, WRITE_WINDOW_MS);
}

/** Android fallback: one cumulative sample from the watch subscription. */
function onAndroidSample(cumulative: number): void {
  const date = todayIso();
  if (date !== pendingDate) {
    // Day rollover: what accumulated before midnight belongs to the old date.
    // The delta spanning midnight is unattributable — re-anchor and drop it.
    void flushAndroid();
    pendingDate = date;
    lastCumulative = cumulative;
    return;
  }
  if (lastCumulative === null || cumulative < lastCumulative) {
    // First sample, or the sensor counter reset (reboot/service restart):
    // treat the new value as the delta base and add nothing.
    lastCumulative = cumulative;
    return;
  }
  pendingDelta += cumulative - lastCumulative;
  lastCumulative = cumulative;
  if (pendingDelta > 0 && flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushAndroid();
    }, WRITE_WINDOW_MS);
  }
}

/**
 * Persist accumulated Android deltas for the date they were walked on.
 * Additive (`repo.addSteps`), so manual adds coexist safely on this path.
 */
async function flushAndroid(): Promise<void> {
  // Capture synchronously — pendingDate may be re-anchored right after a
  // rollover calls us, and new deltas may accrue while we await.
  const delta = pendingDelta;
  const date = pendingDate;
  pendingDelta = 0;
  if (delta <= 0) return;
  try {
    const repo = await getRepo();
    const total = await repo.addSteps(date, delta);
    notify(date, total);
  } catch {
    // Write failed — restore the delta so the next flush retries it.
    pendingDelta += delta;
  }
}
