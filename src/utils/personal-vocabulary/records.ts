import type { z } from "zod"
import type {
  VocabularyDraft,
  VocabularyLookup,
  vocabularyDetailsSchema,
  vocabularyFieldsSchema,
} from "./schema"

export const DEFAULT_COLLECTION_ID = "default"

export interface VocabularyEntry
  extends z.output<typeof vocabularyFieldsSchema>, z.output<typeof vocabularyDetailsSchema> {
  id: string
  language: "en"
  normalizedTerm: string
  term: string
  originalTerm: string
  lemmaSource: VocabularyLookup["lemmaSource"]
  encounterCount: number
  createdAt: number
  updatedAt: number
}

export type VocabularyContext = NonNullable<VocabularyDraft["context"]> & {
  id: string
  entryId: string
  originalTerm: string
  fingerprint: string
  createdAt: number
}

export interface VocabularyReceipt {
  entryId: string
  encounterCount: number
  created: boolean
}

export interface VocabularyEncounter extends VocabularyReceipt {
  id: string
  originalTerm: string
  contextId?: string
  createdAt: number
}

export interface VocabularyGroup {
  id: string
  name: string
  nameKey: string
  createdAt: number
}

export interface VocabularyForm {
  originalKey: string
  entryId: string
}

export interface VocabularyCollectionLink {
  entryId: string
  collectionId: string
}

export interface VocabularyTagLink {
  entryId: string
  tagId: string
}

export type VocabularyGroupKind = "collection" | "tag"

export type VocabularySort = "updated" | "added" | "alphabetical" | "encounters"
export type VocabularyFilters = {
  search: string
  collectionId: string
  tagId: string
  difficulty: string
  completeness: "" | "complete" | "missing"
  marker: "" | "favorite" | "important"
  sort: VocabularySort
}

export const DEFAULT_VOCABULARY_FILTERS: VocabularyFilters = {
  search: "",
  collectionId: "",
  tagId: "",
  difficulty: "",
  completeness: "",
  marker: "",
  sort: "updated",
}

export type VocabularyConflictStrategy = "skip" | "merge" | "overwrite"
