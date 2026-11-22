import { describe, expect, it } from 'vitest'
import { describeRedactions, redact, stripLinkDetails } from './redact'
import { decideRoute } from './route'
import { buildInstructions, buildUserPrompt, locateQuotes, parseResult } from './verdict'

describe('redact', () => {
  it('replaces phone numbers in common formats', () => {
    const r = redact('Call +62 812-3456-7890 or 081234567890 now')
    expect(r.text).toBe('Call [phone] or [phone] now')
    expect(r.redactions).toEqual([{ kind: 'phone', count: 2 }])
  })
  it('replaces emails and long numbers such as codes and account numbers', () => {
    const r = redact('Mail a.b@example.com, code 482913, account 1234567890123456')
    expect(r.text).toBe('Mail [email], code [number], account [number]')
  })
  it('keeps the host and path of a link but drops the query string', () => {
    const r = redact('Verify at http://secure-login.example.co/verify?id=88213377 today')
    expect(r.text).toBe('Verify at http://secure-login.example.co/verify?[removed] today')
    expect(r.redactions).toEqual([{ kind: 'link-details', count: 1 }])
  })
  it('does not treat digits inside a link path as a phone number', () => {
    expect(redact('see https://example.com/track/081234567890').text).toBe('see https://example.com/track/081234567890')
  })
  it('leaves short numbers, prices and times alone', () => {
    const text = 'Pay $15 by 3 pm on 12/05, earn 300 daily'
    expect(redact(text).text).toBe(text)
  })
  it('describes what was removed, and says so when nothing was', () => {
    expect(describeRedactions([])).toMatch(/No phone numbers/)
    expect(describeRedactions([{ kind: 'phone', count: 1 }, { kind: 'number', count: 2 }])).toBe(
      'Removed before sending: 1 phone number, 2 long numbers.',
    )
  })
  it('stripLinkDetails also drops fragments', () => {
    expect(stripLinkDetails('https://a.b/c#token=1')).toBe('https://a.b/c?[removed]')
    expect(stripLinkDetails('https://a.b/c')).toBe('https://a.b/c')
  })
})

describe('decideRoute', () => {
  const base = { chars: 200, hasImage: false, maxDeviceChars: 6000 }
  it('runs on the device when the model is available', () => {
    expect(decideRoute({ ...base, status: 'available' })).toEqual({ where: 'device' })
  })
  it('never picks the cloud by itself: it asks', () => {
    for (const status of ['unsupported', 'unavailable'] as const) {
      expect(decideRoute({ ...base, status }).where).toBe('ask-cloud')
    }
  })
  it('offers the download, or waits for it', () => {
    expect(decideRoute({ ...base, status: 'downloadable' }).where).toBe('offer-download')
    expect(decideRoute({ ...base, status: 'downloading' }).where).toBe('wait-download')
  })
  it('asks about the cloud for a message that is too long for the device', () => {
    expect(decideRoute({ ...base, status: 'available', chars: 6001 }).where).toBe('ask-cloud')
    expect(decideRoute({ ...base, status: 'available', chars: 6000 }).where).toBe('device')
  })
})

describe('verdict', () => {
  const good = JSON.stringify({
    verdict: 'scam',
    scam_type: 'fake delivery',
    summary: 'It asks you to install a file.',
    red_flags: [{ quote: 'Lihat_Foto_Paket.apk', reason: 'An app file, not a photo.' }],
    actions: ['Do not open the file.', 'Block the sender.'],
    safe_reply: '',
  })
  it('parses a well-formed result', () => {
    const r = parseResult(good)
    expect(r.verdict).toBe('scam')
    expect(r.scamType).toBe('fake delivery')
    expect(r.redFlags).toHaveLength(1)
    expect(r.actions).toHaveLength(2)
  })
  it('accepts a result wrapped in a code fence', () => {
    expect(parseResult('```json\n' + good + '\n```').verdict).toBe('scam')
  })
  it('rejects text that is not JSON, unknown verdicts and missing summaries', () => {
    expect(() => parseResult('It looks like a scam.')).toThrow(/readable/)
    expect(() => parseResult(JSON.stringify({ verdict: 'maybe', summary: 'x' }))).toThrow(/verdict/)
    expect(() => parseResult(JSON.stringify({ verdict: 'scam', summary: '' }))).toThrow(/summary/)
  })
  it('caps lists and drops flags without a reason', () => {
    const many = JSON.parse(good)
    many.red_flags = [...Array(8)].map((_, i) => ({ quote: `q${i}`, reason: i === 0 ? '' : 'r' }))
    many.actions = ['a', 'b', 'c', 'd', 'e', 'f']
    const r = parseResult(JSON.stringify(many))
    expect(r.redFlags).toHaveLength(5)
    expect(r.redFlags[0].quote).toBe('q1')
    expect(r.actions).toHaveLength(4)
  })
  it('locates quotes ignoring case and spacing, and skips quotes that are not in the message', () => {
    const msg = 'URGENT: Your account   has been locked. Reply with the code.'
    const spans = locateQuotes(msg, [
      { quote: 'your account has been locked', reason: 'threat' },
      { quote: 'send bitcoin', reason: 'made up' },
      { quote: '"Reply with the code."', reason: 'asks for a code' },
    ])
    expect(spans.map((s) => s.flag)).toEqual([0, 2])
    expect(msg.slice(spans[0].start, spans[0].end)).toBe('Your account   has been locked')
  })
  it('does not return overlapping spans', () => {
    const spans = locateQuotes('pay the deposit now', [
      { quote: 'pay the deposit', reason: 'a' },
      { quote: 'the deposit now', reason: 'b' },
    ])
    expect(spans).toHaveLength(1)
  })
  it('adds trend hints to the instructions only when there are some', () => {
    expect(buildInstructions('')).not.toMatch(/reported recently/)
    expect(buildInstructions('fake toll fines')).toMatch(/reported recently:\nfake toll fines/)
  })
  it('words the prompt for text, screenshot, or both', () => {
    expect(buildUserPrompt('hello', false)).toMatch(/MESSAGE:\nhello$/)
    expect(buildUserPrompt('', true)).toMatch(/attached screenshot/)
    expect(buildUserPrompt('hello', true)).toMatch(/screenshot of it is attached/)
  })
})
