import { type GenerativeModel, getGenerativeModel, InferenceMode, type Part, Schema } from 'firebase/ai'
import type { DeviceStatus } from './core/route'
import { buildInstructions, buildUserPrompt, type CheckResult, parseResult, RESULT_JSON_SCHEMA, VERDICTS } from './core/verdict'
import { ai, type Tuning } from './firebase'

export type Source = 'on_device' | 'in_cloud'

export interface Outcome {
  result: CheckResult
  /** Where the model actually ran, as reported by Firebase AI Logic. */
  source: Source
  ms: number
}

export interface Screenshot {
  mimeType: string
  /** Base64 without the data URL prefix. */
  data: string
}

/** What the built-in model has to accept and produce. Used both to ask about availability and to create it. */
function deviceOptions(withImage: boolean) {
  return {
    expectedInputs: [
      { type: 'text' as const, languages: ['en'] },
      ...(withImage ? [{ type: 'image' as const }] : []),
    ],
    expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
  }
}

interface BuiltInModel {
  availability(options?: object): Promise<string>
}

/** Asks Chrome directly whether its built-in model can be used, without starting a download. */
export async function deviceStatus(withImage = false): Promise<DeviceStatus> {
  const api = (self as unknown as { LanguageModel?: BuiltInModel }).LanguageModel
  if (!api) return 'unsupported'
  try {
    const state = await api.availability(deviceOptions(withImage))
    if (state === 'available' || state === 'downloadable' || state === 'downloading') return state
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}

const cloudSchema = Schema.object({
  properties: {
    verdict: Schema.enumString({ enum: VERDICTS }),
    scam_type: Schema.string(),
    summary: Schema.string(),
    red_flags: Schema.array({
      items: Schema.object({ properties: { quote: Schema.string(), reason: Schema.string() } }),
    }),
    actions: Schema.array({ items: Schema.string() }),
    safe_reply: Schema.string(),
  },
})

/**
 * One model object per mode. The message check uses the two strict modes, because where a private
 * message is read is the person's decision and must never be made silently by a fallback.
 */
function checkModel(mode: 'only_on_device' | 'only_in_cloud', tuning: Tuning, withImage: boolean): GenerativeModel {
  const systemInstruction = buildInstructions(tuning.trendHints)
  return getGenerativeModel(ai, {
    mode: mode === 'only_on_device' ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.ONLY_IN_CLOUD,
    onDeviceParams: {
      createOptions: {
        ...deviceOptions(withImage),
        initialPrompts: [{ role: 'system', content: [{ type: 'text', value: systemInstruction }] }],
      },
      promptOptions: { responseConstraint: RESULT_JSON_SCHEMA },
    },
    inCloudParams: {
      model: tuning.cloudModel,
      systemInstruction,
      generationConfig: { responseMimeType: 'application/json', responseSchema: cloudSchema, temperature: 0.2 },
    },
  })
}

/** Downloads the on-device model. Must be called from a click, as Chrome requires. */
export async function downloadDeviceModel(tuning: Tuning, onProgress: (share: number) => void): Promise<void> {
  await checkModel('only_on_device', tuning, false).initializeDeviceModel(onProgress)
}

async function run(model: GenerativeModel, message: string, shot: Screenshot | null): Promise<Outcome> {
  const parts: Part[] = [{ type: 'text', text: buildUserPrompt(message, Boolean(shot)) }]
  if (shot) parts.push({ type: 'inlineData', inlineData: { mimeType: shot.mimeType, data: shot.data } })
  const started = performance.now()
  const response = (await model.generateContent({ contents: [{ role: 'user', parts }] })).response
  return {
    result: parseResult(response.text()),
    source: response.inferenceSource === 'on_device' ? 'on_device' : 'in_cloud',
    ms: Math.round(performance.now() - started),
  }
}

/** Private check: the message is read by the model inside this browser and goes nowhere. */
export function checkOnDevice(message: string, shot: Screenshot | null, tuning: Tuning): Promise<Outcome> {
  return run(checkModel('only_on_device', tuning, Boolean(shot)), message, shot)
}

/** Cloud check. Callers pass the redacted text the person has already seen and approved. */
export function checkInCloud(approvedText: string, shot: Screenshot | null, tuning: Tuning): Promise<Outcome> {
  return run(checkModel('only_in_cloud', tuning, Boolean(shot)), approvedText, shot)
}

/**
 * General explainer about a kind of scam. It contains nothing from the person's message, so here the
 * automatic mode is the right one: on the device when the model is there, in the cloud when it is not.
 */
export async function explainScamType(scamType: string, tuning: Tuning): Promise<{ text: string; source: Source }> {
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: { createOptions: deviceOptions(false) },
    inCloudParams: { model: tuning.cloudModel, generationConfig: { temperature: 0.3 } },
  })
  const prompt =
    `In plain English for a non-technical reader, explain how the "${scamType}" kind of message scam works. ` +
    'Use three short numbered steps (how they hook you, what they ask for, how the money or account is taken), ' +
    'then one line starting with "Remember:" with the single most useful habit. No preamble. Under 110 words.'
  const response = (await model.generateContent(prompt)).response
  return { text: response.text().trim(), source: response.inferenceSource === 'on_device' ? 'on_device' : 'in_cloud' }
}
