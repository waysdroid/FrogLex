import type { VocabularyEntry } from "./records"
import type { VocabularyEdit } from "./schema"
import { comparableVocabularyText } from "./schema"

export function definitionField(language?: string) {
  switch (language?.toLowerCase().split("-")[0]) {
    case "zh":
      return "meaningsZh"
    case "en":
      return "meaningsEn"
    default:
      return undefined
  }
}

export function getVocabularyDefinitions(entry?: VocabularyEntry) {
  const definition = entry?.definition
  const field = definitionField(definition?.language)

  function merge(explicit?: string, localized?: string) {
    if (!explicit || !localized) return explicit ?? localized
    return comparableVocabularyText(explicit) === comparableVocabularyText(localized)
      ? explicit
      : `${explicit}\n\n${localized}`
  }

  return {
    meaningsZh: merge(entry?.meaningsZh, field === "meaningsZh" ? definition?.text : undefined),
    meaningsEn: merge(entry?.meaningsEn, field === "meaningsEn" ? definition?.text : undefined),
    definition: field ? undefined : definition,
  }
}

type VocabularyDefinitions = Pick<VocabularyEdit, "meaningsZh" | "meaningsEn" | "definition">

export function editVocabularyDefinitions(
  entry: VocabularyEntry | undefined,
  input: VocabularyDefinitions,
): VocabularyDefinitions {
  const legacyField = definitionField(entry?.definition?.language)
  // A save that only changes unrelated fields keeps both original strings and
  // the dictionary's locale in old records. Editing a unified field stores its
  // resulting text once, unless another existing definition needs that slot.
  if (
    legacyField &&
    !input.definition &&
    input[legacyField] === getVocabularyDefinitions(entry)[legacyField]
  ) {
    return { ...input, [legacyField]: entry?.[legacyField], definition: entry?.definition }
  }
  return input
}
