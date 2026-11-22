/** The shape of a check result, the instructions given to the model, and strict parsing of its answer. */

export type Verdict = 'scam' | 'suspicious' | 'likely_safe'

export interface RedFlag {
  /** A short fragment copied from the message. */
  quote: string
  reason: string
}

export interface CheckResult {
  verdict: Verdict
  scamType: string
  summary: string
  redFlags: RedFlag[]
  actions: string[]
  safeReply: string
}

export const VERDICTS: Verdict[] = ['scam', 'suspicious', 'likely_safe']

/** JSON Schema used to constrain the on-device model, and mirrored for the cloud model. */
export const RESULT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: VERDICTS },
    scam_type: { type: 'string' },
    summary: { type: 'string' },
    red_flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: { quote: { type: 'string' }, reason: { type: 'string' } },
        required: ['quote', 'reason'],
      },
    },
    actions: { type: 'array', items: { type: 'string' } },
    safe_reply: { type: 'string' },
  },
  required: ['verdict', 'scam_type', 'summary', 'red_flags', 'actions', 'safe_reply'],
} as const

export function buildInstructions(trendHints: string): string {
  const hints = trendHints.trim()
  return [
    'You check one message that a person received (SMS, chat, email or a screenshot of one) and judge whether it is a scam.',
    'The message may be in any language. Always answer in English.',
    'Judge only from what the message says and asks for. Do not invent facts about the sender.',
    'Typical signs: urgency or threats, a prize or refund nobody asked for, a request for a one-time code, PIN, password or card number, a link or file to open (especially an .apk file), a request to move the chat to another app, payment up front, a sender name that does not match the link, and spelling tricks in brand names.',
    hints ? `Patterns reported recently:\n${hints}` : '',
    'Reply with JSON only, with these fields:',
    '- verdict: "scam" when the message clearly tries to steal money, codes or account access; "suspicious" when there are warning signs but it could be genuine; "likely_safe" when you see no warning signs.',
    '- scam_type: two to four words naming the kind of scam, or "none".',
    '- summary: one plain sentence a non-technical person understands.',
    '- red_flags: up to five items. "quote" is a short fragment copied exactly from the message (at most 12 words). "reason" says why it is a warning sign. Use an empty list when there are none.',
    '- actions: two to four short, concrete things to do next.',
    '- safe_reply: one short reply the person could send that gives nothing away, or an empty string when the best move is not to reply.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildUserPrompt(message: string, hasImage: boolean): string {
  const text = message.trim()
  if (hasImage && !text) return 'The message is in the attached screenshot. Read it and check it.'
  if (hasImage) return `Check this message. A screenshot of it is attached as well.\n\nMESSAGE:\n${text}`
  return `Check this message.\n\nMESSAGE:\n${text}`
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/**
 * Turns the model's raw text into a CheckResult, or throws with a plain reason.
 * Models sometimes wrap JSON in a code fence, so that is tolerated; anything else is rejected.
 */
export function parseResult(raw: string): CheckResult {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    throw new Error('The model did not return a readable result.')
  }
  if (typeof data !== 'object' || data === null) throw new Error('The model did not return a readable result.')
  const o = data as Record<string, unknown>
  const verdict = clean(o.verdict, 20) as Verdict
  if (!VERDICTS.includes(verdict)) throw new Error('The model returned a verdict the app does not know.')

  const redFlags: RedFlag[] = Array.isArray(o.red_flags)
    ? o.red_flags
        .map((f) => {
          const flag = (typeof f === 'object' && f !== null ? f : {}) as Record<string, unknown>
          return { quote: clean(flag.quote, 200), reason: clean(flag.reason, 300) }
        })
        .filter((f) => f.reason)
        .slice(0, 5)
    : []
  const actions = Array.isArray(o.actions) ? o.actions.map((a) => clean(a, 240)).filter(Boolean).slice(0, 4) : []
  const summary = clean(o.summary, 400)
  if (!summary) throw new Error('The model returned a result with no summary.')

  return {
    verdict,
    scamType: clean(o.scam_type, 60) || 'none',
    summary,
    redFlags,
    actions,
    safeReply: clean(o.safe_reply, 300),
  }
}

export interface Span {
  start: number
  end: number
  /** Index into the red flag list. */
  flag: number
}

/**
 * Finds where each quoted fragment sits in the message, so the app can underline it.
 * Matching ignores case and runs of whitespace. Quotes that are not really in the message are skipped,
 * which also guards against a model that made a quote up.
 */
export function locateQuotes(message: string, flags: RedFlag[]): Span[] {
  const spans: Span[] = []
  const lower = message.toLowerCase()
  flags.forEach((flag, index) => {
    const quote = flag.quote.trim().replace(/^["'“”]+|["'“”.…]+$/g, '')
    if (quote.length < 3) return
    const pattern = quote
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+')
    const match = new RegExp(pattern).exec(lower)
    if (!match) return
    const start = match.index
    const end = start + match[0].length
    if (spans.some((s) => start < s.end && end > s.start)) return
    spans.push({ start, end, flag: index })
  })
  return spans.sort((a, b) => a.start - b.start)
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  scam: 'Scam',
  suspicious: 'Suspicious',
  likely_safe: 'No warning signs',
}
