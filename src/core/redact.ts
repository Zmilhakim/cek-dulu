/**
 * Removes personal details from a message before it may leave the device.
 * Everything here runs locally and is pure, so it can be tested and shown to the user as a preview.
 */

export type RedactionKind = 'phone' | 'email' | 'number' | 'link-details'

export interface Redaction {
  kind: RedactionKind
  /** How many times this kind was replaced. */
  count: number
}

export interface RedactedText {
  text: string
  redactions: Redaction[]
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
/** Phone numbers: optional +, then 9 to 15 digits that may be split by spaces, dots or dashes. */
const PHONE = /(?<![\w/.=-])\+?\d(?:[\s.-]?\d){8,14}(?![\w/])/g
/** Any other run of 6 or more digits: account numbers, ID numbers, one-time codes, order numbers. */
const LONG_NUMBER = /(?<![\w/.=-])\d{6,}(?![\w/])/g
const URL = /\bhttps?:\/\/[^\s<>"')]+/gi

/**
 * Links are evidence, so the host and path stay. The query string and fragment are dropped,
 * because that is where tracking ids and personal tokens usually sit.
 */
export function stripLinkDetails(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : `${url.slice(0, cut)}?[removed]`
}

export function redact(input: string): RedactedText {
  const counts: Record<RedactionKind, number> = { phone: 0, email: 0, number: 0, 'link-details': 0 }

  // Links are set aside first so that digits inside a URL are not mistaken for phone numbers.
  const links: string[] = []
  let text = input.replace(URL, (url) => {
    const cleaned = stripLinkDetails(url)
    if (cleaned !== url) counts['link-details']++
    links.push(cleaned)
    return `\u0000${links.length - 1}\u0000`
  })

  text = text.replace(EMAIL, () => {
    counts.email++
    return '[email]'
  })
  text = text.replace(PHONE, () => {
    counts.phone++
    return '[phone]'
  })
  text = text.replace(LONG_NUMBER, () => {
    counts.number++
    return '[number]'
  })
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i: string) => links[Number(i)])

  const redactions = (Object.keys(counts) as RedactionKind[])
    .filter((kind) => counts[kind] > 0)
    .map((kind) => ({ kind, count: counts[kind] }))
  return { text, redactions }
}

export function describeRedactions(redactions: Redaction[]): string {
  if (!redactions.length) return 'No phone numbers, emails or long numbers were found to remove.'
  const names: Record<RedactionKind, [string, string]> = {
    phone: ['phone number', 'phone numbers'],
    email: ['email address', 'email addresses'],
    number: ['long number', 'long numbers'],
    'link-details': ['link tracking part', 'link tracking parts'],
  }
  const parts = redactions.map((r) => `${r.count} ${names[r.kind][r.count === 1 ? 0 : 1]}`)
  return `Removed before sending: ${parts.join(', ')}.`
}
