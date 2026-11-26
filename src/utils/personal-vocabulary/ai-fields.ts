import type { VocabularyAiUndoValue } from "./schema"

export const VOCABULARY_AI_FIELDS = [
  "meaningsEn",
  "examples",
  "collocations",
  "synonyms",
  "antonyms",
  "derivatives",
] as const

export type VocabularyAiFieldName = (typeof VOCABULARY_AI_FIELDS)[number]

export function isVocabularyAiField(name: string): name is VocabularyAiFieldName {
  return VOCABULARY_AI_FIELDS.some((field) => field === name)
}
export function undoVocabularyAiAddition(text: string, { before, after }: VocabularyAiUndoValue) {
  const current = text.trim()
  const prefix = before ? `${before}\n\n` : ""
  if (!after.startsWith(prefix) || after.length <= prefix.length) return undefined
  if (current === after) return before
  const added = after.slice(prefix.length)
  const start = current.indexOf(added)
  if (start < 0 || start !== current.lastIndexOf(added)) return undefined

  // Only remove the intact generated block. A partial match could include
  // manual text, and duplicated blocks cannot be attributed unambiguously.
  const left = current.slice(0, start)
  const right = current.slice(start + added.length)
  if ((left && !left.endsWith("\n\n")) || (right && !right.startsWith("\n\n"))) {
    return undefined
  }
  return `${left.slice(0, -2)}${right}`.trim()
}
