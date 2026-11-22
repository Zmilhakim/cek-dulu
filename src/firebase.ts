import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getAI, GoogleAIBackend } from 'firebase/ai'
import { fetchAndActivate, getNumber, getRemoteConfig, getString } from 'firebase/remote-config'
import { DEFAULT_MAX_DEVICE_CHARS } from './core/route'

/** Web app config. These values identify the project; they are not secrets. */
const firebaseConfig = {
  apiKey: 'AIzaSyBsfywj2cUkwJa1VwhEP9sP7QPIsDQumMA',
  authDomain: 'cek-dulu-26f35.firebaseapp.com',
  projectId: 'cek-dulu-26f35',
  storageBucket: 'cek-dulu-26f35.firebasestorage.app',
  messagingSenderId: '345293436596',
  appId: '1:345293436596:web:29fbbe2a71b849f00309e1',
}

export const app = initializeApp(firebaseConfig)

/**
 * App Check protects the cloud model from being called by anything other than this app.
 * On localhost a debug token is used (it is printed in the browser console once and has to be
 * registered in the Firebase console).
 */
const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY as string | undefined
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname)
if (isLocal) {
  ;(self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined) || true
}
export const appCheckReady = Boolean(siteKey) || isLocal
if (appCheckReady) {
  initializeAppCheck(app, {
    // On localhost the debug token takes over, so the placeholder key is never sent to reCAPTCHA.
    provider: new ReCaptchaEnterpriseProvider(siteKey || 'debug-only'),
    isTokenAutoRefreshEnabled: true,
  })
}

export const ai = getAI(app, { backend: new GoogleAIBackend() })

/** Settings that can change without a new release. Defaults apply when Remote Config cannot be reached. */
export interface Tuning {
  cloudModel: string
  trendHints: string
  maxDeviceChars: number
}

const DEFAULTS = {
  cloud_model: 'gemini-3.5-flash-lite',
  trend_hints: '',
  max_device_chars: DEFAULT_MAX_DEVICE_CHARS,
}

export async function loadTuning(): Promise<Tuning> {
  const rc = getRemoteConfig(app)
  rc.defaultConfig = DEFAULTS
  rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000
  try {
    await fetchAndActivate(rc)
  } catch {
    // Offline or blocked: the on-device path must keep working, so fall through to defaults.
  }
  return {
    cloudModel: getString(rc, 'cloud_model') || DEFAULTS.cloud_model,
    trendHints: getString(rc, 'trend_hints'),
    maxDeviceChars: getNumber(rc, 'max_device_chars') || DEFAULTS.max_device_chars,
  }
}
