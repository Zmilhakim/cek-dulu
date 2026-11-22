/**
 * Decides where a check may run. The rule of the app: a private message is read on the device
 * unless the person has looked at exactly what would be sent and agreed to send it.
 */

/** Mirrors the states of Chrome's built-in model, plus "unsupported" for browsers without it. */
export type DeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported'

export type Route =
  | { where: 'device' }
  | { where: 'offer-download'; reason: string }
  | { where: 'wait-download'; reason: string }
  | { where: 'ask-cloud'; reason: string }

export interface RouteInput {
  status: DeviceStatus
  /** Length of the message text. */
  chars: number
  hasImage: boolean
  /** Longest text the on-device model is asked to handle. Tuned through Remote Config. */
  maxDeviceChars: number
}

export const DEFAULT_MAX_DEVICE_CHARS = 6000

export function decideRoute(input: RouteInput): Route {
  const { status, chars, maxDeviceChars } = input
  if (status === 'unsupported' || status === 'unavailable') {
    return {
      where: 'ask-cloud',
      reason: 'This browser has no on-device model, so a private check is not possible here.',
    }
  }
  if (chars > maxDeviceChars) {
    return {
      where: 'ask-cloud',
      reason: `This message is ${chars.toLocaleString('en-US')} characters long, more than the on-device model handles well.`,
    }
  }
  if (status === 'downloadable') {
    return { where: 'offer-download', reason: 'The on-device model has not been downloaded yet.' }
  }
  if (status === 'downloading') {
    return { where: 'wait-download', reason: 'The on-device model is still downloading.' }
  }
  return { where: 'device' }
}
