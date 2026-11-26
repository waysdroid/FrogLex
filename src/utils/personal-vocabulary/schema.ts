import { z } from "zod"
import { VOCABULARY_AI_FIELDS } from "./ai-fields"

export const MAX_TERM_LENGTH = 240
export const MAX_VOCABULARY_TEXT_LENGTH = 3000
// The editor can merge two previously independent definitions of the same language.
export const MAX_VOCABULARY_DEFINITION_LENGTH = 2 * MAX_VOCABULARY_TEXT_LENGTH + 2

function normalizeSpacing(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\u200B\uFEFF]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
}

export function normalizeVocabularyTerm(value: string) {
  return normalizeSpacing(value)
    .replace(/[‘’]/gu, "'")
    .replace(/[‐‑]/gu, "-")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}\p{M}]+$/gu, "")
    .trim()
}

export function vocabularyTermKey(value: string) {
  return normalizeVocabularyTerm(value).toLowerCase()
}

export function isVocabularyTerm(value: string) {
  if (value.length > MAX_TERM_LENGTH) return false
  const term = normalizeVocabularyTerm(value)
  // Keep punctuation inside phrases, including contractions and hyphenated words.
  return /\p{Script=Latin}/u.test(term) && !/[^\p{Script=Latin}\p{M}\p{N}\p{P} ]/u.test(term)
}

export function sanitizeVocabularyUrl(value: string) {
  try {
    const url = new URL(value)
    // Query strings and fragments can carry credentials or document selection text.
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.href
  } catch {
    return undefined
  }
}

export const vocabularySourceSchema = z.object({
  url: z
    .string()
    .max(2048)
    .transform((value, ctx) => {
      const url = sanitizeVocabularyUrl(value)
      if (url) return url
      ctx.addIssue({ code: "custom", message: "Invalid source URL" })
      return z.NEVER
    }),
  title: z.string().trim().max(500).optional(),
})

export type VocabularySource = z.output<typeof vocabularySourceSchema>

export const termSchema = z.string().trim().refine(isVocabularyTerm)
export const localizedTextSchema = z.object({
  text: z.string().trim().min(1).max(MAX_VOCABULARY_TEXT_LENGTH),
  language: z
    .string()
    .regex(/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i)
    .max(35),
})
export const contextSchema = z
  .object({
    sentence: z.string().trim().min(1).max(MAX_VOCABULARY_TEXT_LENGTH).optional(),
    translation: localizedTextSchema.optional(),
    meaning: localizedTextSchema.optional(),
    source: vocabularySourceSchema.optional(),
  })
  .refine(({ sentence, translation }) => !translation || !!sentence)

export const vocabularyLookupSchema = z.object({
  term: termSchema,
  originalTerm: termSchema,
  lemmaSource: z.enum(["selection", "dictionary", "user"]),
})

export const vocabularyDifficultySchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"])

export const vocabularyFieldsSchema = z.object({
  phonetic: z.string().trim().min(1).max(240).optional(),
  partOfSpeech: z.string().trim().min(1).max(240).optional(),
  definition: localizedTextSchema.optional(),
  memoryTips: z.string().trim().min(1).max(MAX_VOCABULARY_TEXT_LENGTH).optional(),
  difficulty: vocabularyDifficultySchema.optional(),
})

const languageDefinitionSchema = z.string().trim().min(1).max(MAX_VOCABULARY_DEFINITION_LENGTH)
const vocabularyAiUndoValueSchema = z.object({
  before: z.string().max(MAX_VOCABULARY_DEFINITION_LENGTH),
  after: languageDefinitionSchema,
})

export type VocabularyAiUndoValue = z.output<typeof vocabularyAiUndoValueSchema>

export const vocabularyDetailsSchema = z.object({
  phoneticUk: z.string().trim().min(1).max(240).optional(),
  phoneticUs: z.string().trim().min(1).max(240).optional(),
  meaningsZh: languageDefinitionSchema.optional(),
  meaningsEn: languageDefinitionSchema.optional(),
  examples: z.string().trim().min(1).max(MAX_VOCABULARY_TEXT_LENGTH).optional(),
  collocations: z.string().trim().min(1).max(MAX_VOCABULARY_TEXT_LENGTH).optional(),
  synonyms: z.string().trim().min(1).max(MAX_VOCABULARY_TEXT_LENGTH).optional(),
  antonyms: z.string().trim().min(1).max(MAX_VOCABULARY_TEXT_LENGTH).optional(),
  derivatives: z.string().trim().min(1).max(MAX_VOCABULARY_TEXT_LENGTH).optional(),
  note: z.string().trim().min(1).max(12000).optional(),
  favorite: z.boolean().optional(),
  important: z.boolean().optional(),
  aiUndo: z.partialRecord(z.enum(VOCABULARY_AI_FIELDS), vocabularyAiUndoValueSchema).optional(),
})

export const vocabularySaveSchema = vocabularyLookupSchema.extend({
  ...vocabularyFieldsSchema.shape,
  operationId: z.uuid(),
  context: contextSchema.optional(),
})

export const vocabularyEditSchema = z.object({
  ...vocabularyLookupSchema.shape,
  ...vocabularyFieldsSchema.shape,
  ...vocabularyDetailsSchema.shape,
  collectionIds: z.array(z.string()),
  tagIds: z.array(z.string()),
})

export const vocabularyImportSchema = z.object({
  term: termSchema,
  originalTerm: termSchema.optional(),
  ...vocabularyFieldsSchema.shape,
  ...vocabularyDetailsSchema.shape,
  context: contextSchema.optional(),
})

export type VocabularyImportItem = z.input<typeof vocabularyImportSchema>

export const vocabularyGroupNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((name) => comparableVocabularyText(name).length > 0)
export type VocabularyEdit = z.input<typeof vocabularyEditSchema>

export type VocabularyLookup = z.input<typeof vocabularyLookupSchema>
export type VocabularyDraft = Omit<z.input<typeof vocabularySaveSchema>, "operationId">
export type VocabularySaveInput = z.input<typeof vocabularySaveSchema>

export function comparableVocabularyText(value: string) {
  return normalizeSpacing(value).replace(/[‘’]/gu, "'").replace(/[‐‑]/gu, "-")
}
