import type { VocabularyDraft, VocabularySource } from "./schema"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import {
  comparableVocabularyText,
  isVocabularyTerm,
  MAX_TERM_LENGTH,
  MAX_VOCABULARY_TEXT_LENGTH,
  normalizeVocabularyTerm,
  vocabularyDifficultySchema,
} from "./schema"

const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" })

function findSelectedSentence(passage: string, selection: string) {
  const term = normalizeVocabularyTerm(selection).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const containsTerm = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${term}(?![\\p{L}\\p{N}\\p{M}])`, "iu")
  let match: string | undefined

  for (const paragraph of passage.split(/\n\s*\n/u)) {
    for (const { segment } of sentenceSegmenter.segment(paragraph)) {
      const sentence = segment.trim()
      if (!containsTerm.test(comparableVocabularyText(sentence))) continue
      // The snapshot lacks offsets into the extracted paragraphs. When more
      // than one sentence matches, leave the original sentence out.
      if (match) return undefined
      match = sentence
    }
  }

  return match &&
    match.length <= MAX_VOCABULARY_TEXT_LENGTH &&
    comparableVocabularyText(match) !== comparableVocabularyText(selection)
    ? match
    : undefined
}

export function createVocabularyDraft({
  action,
  originalTerm,
  passage,
  result,
  targetLanguage,
  source,
}: {
  action: SelectionToolbarCustomAction
  originalTerm: string
  passage: string
  result: Record<string, unknown> | null
  targetLanguage: string
  source: VocabularySource
}): VocabularyDraft | null {
  if (!isVocabularyTerm(originalTerm)) return null

  function field(id: string, maxLength = MAX_VOCABULARY_TEXT_LENGTH) {
    const name = action.outputSchema.find(
      (candidate) => candidate.id === `default-dictionary-${id}`,
    )?.name
    const value = name && result?.[name]
    return typeof value === "string" && value.trim() && value.trim().length <= maxLength
      ? value.trim()
      : undefined
  }

  const lemma = field("term", MAX_TERM_LENGTH)
  const validLemma = lemma && isVocabularyTerm(lemma) ? lemma : undefined
  const definition = field("definition")
  const difficulty = vocabularyDifficultySchema.safeParse(field("difficulty")).data
  const sentence = findSelectedSentence(passage, originalTerm)
  const modelSentence = field("context")
  const sentenceTranslation = field("context-translation")
  const translation =
    sentenceTranslation &&
    sentence &&
    modelSentence &&
    comparableVocabularyText(modelSentence) === comparableVocabularyText(sentence)
      ? { text: sentenceTranslation, language: targetLanguage }
      : undefined

  return {
    term: normalizeVocabularyTerm(validLemma ?? originalTerm),
    originalTerm,
    lemmaSource: validLemma ? "dictionary" : "selection",
    phonetic: field("phonetic", 240),
    partOfSpeech: field("part-of-speech", 240),
    definition: definition ? { text: definition, language: targetLanguage } : undefined,
    difficulty,
    context: {
      sentence,
      translation,
      source,
    },
  }
}
