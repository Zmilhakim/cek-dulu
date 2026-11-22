import { describeRedactions, redact } from './core/redact'
import { decideRoute, type DeviceStatus } from './core/route'
import { SAMPLES } from './core/samples'
import { type CheckResult, locateQuotes, VERDICT_LABEL } from './core/verdict'
import { checkInCloud, checkOnDevice, deviceStatus, downloadDeviceModel, explainScamType, type Outcome, type Screenshot } from './engine'
import { appCheckReady, loadTuning, type Tuning } from './firebase'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const message = $<HTMLTextAreaElement>('message')
const checkBtn = $<HTMLButtonElement>('check')
const chip = $('device-chip')

let tuning: Tuning = { cloudModel: 'gemini-3.5-flash-lite', trendHints: '', maxDeviceChars: 6000 }
let status: DeviceStatus = 'unsupported'
let shot: (Screenshot & { name: string; url: string }) | null = null
/** The text that was checked last, kept so quotes can be marked in it. */
let lastChecked = ''
let lastResult: CheckResult | null = null

// ------------------------------------------------------------------ helpers

function show(id: string, on: boolean): void {
  $(id).hidden = !on
}

function hidePanels(): void {
  for (const id of ['setup', 'consent', 'busy', 'error', 'result']) show(id, false)
}

function busy(text: string): void {
  hidePanels()
  $('busy-text').textContent = text
  show('busy', true)
}

function fail(text: string): void {
  hidePanels()
  $('error').textContent = text
  show('error', true)
}

/** Turns an error from the SDK or the browser into one sentence a person can act on. */
function explainError(e: unknown, where: 'device' | 'cloud'): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (where === 'cloud') {
    if (/app.?check|appCheck|401|403/i.test(raw)) {
      return 'The cloud model refused the request because this copy of the app is not verified (App Check). Nothing was checked.'
    }
    if (/429|quota|rate/i.test(raw)) return 'The cloud model is busy right now (rate limit). Please try again in a minute.'
    if (/fetch|network|Failed to/i.test(raw)) return 'The cloud model could not be reached. Check your connection and try again.'
    return `The cloud check failed: ${raw}`
  }
  if (/readable result|verdict|summary/i.test(raw)) return `${raw} Please try again.`
  return `The on-device check failed: ${raw}`
}

async function refreshStatus(): Promise<void> {
  status = await deviceStatus(Boolean(shot))
  const text: Record<DeviceStatus, [string, string]> = {
    available: ['Private mode ready: on-device model', 'chip-ok'],
    downloadable: ['On-device model not downloaded yet', 'chip-off'],
    downloading: ['On-device model downloading…', 'chip-wait'],
    unavailable: ['On-device model not available on this device', 'chip-off'],
    unsupported: ['This browser has no on-device model', 'chip-off'],
  }
  chip.textContent = text[status][0]
  chip.className = `chip ${text[status][1]}`
  const local = status === 'available'
  checkBtn.textContent = local ? 'Check privately' : 'Check this message'
  $('go-note').textContent = local
    ? 'Read by an AI model inside this browser. Nothing is sent anywhere.'
    : 'Nothing is sent without showing you first.'
  // With a local model the cloud is never needed, but it stays a deliberate choice behind the same consent screen.
  show('cloud-instead', local)
}

// ------------------------------------------------------------------- input

function setShot(file: File): void {
  if (!/^image\/(png|jpeg)$/.test(file.type)) {
    fail('Only PNG and JPEG screenshots can be read.')
    return
  }
  if (file.size > 4 * 1024 * 1024) {
    fail('That image is larger than 4 MB. Please crop it to the message.')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const url = String(reader.result)
    shot = { mimeType: file.type, data: url.slice(url.indexOf(',') + 1), name: file.name || 'Pasted image', url }
    $<HTMLImageElement>('shot-preview').src = url
    $('shot-name').textContent = shot.name
    show('shot-row', true)
    void refreshStatus()
  }
  reader.readAsDataURL(file)
}

$<HTMLInputElement>('shot-input').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) setShot(file)
})
$('shot-remove').addEventListener('click', () => {
  shot = null
  $<HTMLInputElement>('shot-input').value = ''
  show('shot-row', false)
  void refreshStatus()
})
document.addEventListener('paste', (e) => {
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
  if (file) {
    e.preventDefault()
    setShot(file)
  }
})

SAMPLES.forEach((sample) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'btn ghost'
  b.textContent = sample.label
  b.addEventListener('click', () => {
    message.value = sample.text
    hidePanels()
    message.focus()
  })
  $('samples').append(b)
})

// ------------------------------------------------------------------ routing

checkBtn.addEventListener('click', () => void start())

async function start(): Promise<void> {
  const text = message.value.trim()
  if (!text && !shot) {
    fail('Paste a message or add a screenshot first.')
    return
  }
  await refreshStatus()
  const route = decideRoute({ status, chars: text.length, hasImage: Boolean(shot), maxDeviceChars: tuning.maxDeviceChars })
  if (route.where === 'device') return runDevice()
  if (route.where === 'ask-cloud') return askCloud(route.reason)
  offerDownload(route.reason, route.where === 'wait-download')
}

function offerDownload(reason: string, alreadyDownloading: boolean): void {
  hidePanels()
  $('setup-title').textContent = 'Set up private mode (one time)'
  $('setup-text').textContent =
    `${reason} Chrome can download it once, and after that every check stays on this device, even offline. ` +
    'It is a large download, so use Wi-Fi.'
  const primary = $<HTMLButtonElement>('setup-primary')
  primary.textContent = alreadyDownloading ? 'Show download progress' : 'Download the on-device model'
  primary.disabled = false
  show('progress', false)
  show('setup', true)
}

$('setup-primary').addEventListener('click', async () => {
  const primary = $<HTMLButtonElement>('setup-primary')
  primary.disabled = true
  primary.textContent = 'Downloading…'
  show('progress', true)
  try {
    await downloadDeviceModel(tuning, (share) => {
      $('progress-bar').style.width = `${Math.round(share * 100)}%`
      primary.textContent = `Downloading… ${Math.round(share * 100)}%`
    })
    await refreshStatus()
    if (status === 'available') await runDevice()
    else fail('The download finished but the model is not ready yet. Please try again in a moment.')
  } catch (e) {
    fail(explainError(e, 'device'))
  }
})

$('cloud-instead').addEventListener('click', () => {
  if (!message.value.trim() && !shot) return fail('Paste a message or add a screenshot first.')
  askCloud('You chose the larger cloud model for this check.')
})
$('setup-cloud').addEventListener('click', () => askCloud('You chose the cloud model instead of downloading the on-device model.'))

async function runDevice(): Promise<void> {
  const text = message.value.trim()
  busy('Checking on this device. Nothing is being sent…')
  try {
    render(await checkOnDevice(text, shot, tuning), text)
  } catch (e) {
    fail(explainError(e, 'device'))
  }
}

/** Shows the exact text that would leave the device and waits for a decision. */
function askCloud(reason: string): void {
  hidePanels()
  const cleaned = redact(message.value.trim())
  $('consent-why').textContent = reason
  const preview = $('consent-preview')
  preview.replaceChildren()
  if (!cleaned.text) {
    preview.textContent = '(no text, screenshot only)'
  } else {
    // Placeholders are highlighted so it is obvious what was taken out.
    cleaned.text.split(/(\[(?:phone|email|number|removed)\])/g).forEach((piece) => {
      if (/^\[(phone|email|number|removed)\]$/.test(piece)) {
        const m = document.createElement('mark')
        m.textContent = piece
        preview.append(m)
      } else preview.append(piece)
    })
  }
  $('consent-redactions').textContent = describeRedactions(cleaned.redactions)
  show('consent-shot', Boolean(shot))
  const send = $<HTMLButtonElement>('consent-send')
  send.disabled = !appCheckReady
  if (!appCheckReady) $('consent-redactions').textContent += ' The cloud model is not set up for this copy of the app.'
  send.onclick = async () => {
    busy('Sending the cleaned copy to the cloud model…')
    try {
      render(await checkInCloud(cleaned.text, shot, tuning), cleaned.text)
    } catch (e) {
      fail(explainError(e, 'cloud'))
    }
  }
  show('consent', true)
}

$('consent-cancel').addEventListener('click', () => {
  hidePanels()
  message.focus()
})

// ------------------------------------------------------------------- result

function render(outcome: Outcome, checkedText: string): void {
  hidePanels()
  const { result, source, ms } = outcome
  lastChecked = checkedText
  lastResult = result

  const verdict = $('verdict')
  verdict.textContent = VERDICT_LABEL[result.verdict]
  verdict.className = `verdict v-${result.verdict}`
  $('scam-type').textContent = result.scamType === 'none' ? '' : result.scamType
  const src = $('source')
  const seconds = (ms / 1000).toFixed(1)
  src.textContent = source === 'on_device' ? `ON DEVICE · nothing left this browser · ${seconds}s` : `CLOUD · cleaned copy sent · ${seconds}s`
  src.className = `chip ${source === 'on_device' ? 'chip-device' : 'chip-cloud'}`
  $('summary').textContent = result.summary

  // The message with each quoted warning sign underlined and numbered.
  const marked = $('marked')
  marked.replaceChildren()
  const spans = locateQuotes(lastChecked, result.redFlags)
  let at = 0
  for (const s of spans) {
    marked.append(lastChecked.slice(at, s.start))
    const m = document.createElement('mark')
    m.textContent = lastChecked.slice(s.start, s.end)
    const n = document.createElement('sup')
    n.textContent = String(s.flag + 1)
    marked.append(m, n)
    at = s.end
  }
  marked.append(lastChecked.slice(at))
  marked.hidden = !lastChecked

  const flags = $('flags')
  flags.replaceChildren()
  const located = new Set(spans.map((s) => s.flag))
  result.redFlags.forEach((f, i) => {
    const li = document.createElement('li')
    // A quote is shown only when it really occurs in the message (or the message was an image).
    if (f.quote && (located.has(i) || !lastChecked)) {
      const q = document.createElement('q')
      q.textContent = f.quote
      li.append(q, ' ')
    }
    li.append(f.reason)
    flags.append(li)
  })
  show('flag-block', result.redFlags.length > 0)

  const actions = $('actions')
  actions.replaceChildren()
  result.actions.forEach((a) => {
    const li = document.createElement('li')
    li.textContent = a
    actions.append(li)
  })

  $('reply').textContent = result.safeReply
  show('reply-block', Boolean(result.safeReply))
  $('copy').textContent = 'Copy'

  show('explain', result.scamType !== 'none')
  // An unsure answer from the small on-device model is the one case where a larger model may help.
  show('second', source === 'on_device' && result.verdict === 'suspicious')
  show('explainer', false)
  show('result', true)
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('reply').textContent ?? '')
    $('copy').textContent = 'Copied'
  } catch {
    $('copy').textContent = 'Select and copy by hand'
  }
})

$('second').addEventListener('click', () =>
  askCloud('The on-device model was not sure. A larger cloud model can give a second opinion, if you agree to send a cleaned copy.'),
)

$('explain').addEventListener('click', async () => {
  if (!lastResult) return
  const box = $('explainer')
  box.textContent = 'Writing a short explainer…'
  show('explainer', true)
  try {
    const { text, source } = await explainScamType(lastResult.scamType, tuning)
    box.replaceChildren()
    const tag = document.createElement('span')
    tag.className = `chip ${source === 'on_device' ? 'chip-device' : 'chip-cloud'}`
    tag.textContent =
      source === 'on_device' ? 'GENERAL INFO · written on device' : 'GENERAL INFO · written in the cloud (your message was not sent)'
    box.append(tag, document.createElement('br'))
    // Models like to mark headings with **asterisks**; show those as bold instead of raw symbols.
    text.split(/\*\*(.+?)\*\*/g).forEach((piece, i) => {
      if (i % 2 === 1) {
        const strong = document.createElement('strong')
        strong.textContent = piece
        box.append(strong)
      } else box.append(piece.replace(/^#+\s*/gm, ''))
    })
  } catch (e) {
    box.textContent = explainError(e, 'cloud')
  }
})

// --------------------------------------------------------------------- boot

void refreshStatus()
void loadTuning().then((t) => {
  tuning = t
})
