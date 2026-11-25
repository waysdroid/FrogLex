import type { FormEvent } from "react"
import type { VocabularyGroup, VocabularyGroupKind } from "@/utils/personal-vocabulary/records"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import { i18n } from "@/utils/i18n"
import { DEFAULT_COLLECTION_ID } from "@/utils/personal-vocabulary/records"
import {
  groupLabel,
  useVocabularyGroups,
  vocabularyError,
  vocabularyQueryKey,
  vocabularyRepository,
} from "./controls"

function GroupManager({ kind, groups }: { kind: VocabularyGroupKind; groups: VocabularyGroup[] }) {
  const [editing, setEditing] = useState<VocabularyGroup | null>(null)
  const [name, setName] = useState("")
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (action: { remove: string } | { save: string; id?: string }) => {
      if ("remove" in action) await vocabularyRepository.deleteGroup(kind, action.remove)
      else await vocabularyRepository.saveGroup(kind, action.save, action.id)
    },
    onSuccess: async () => {
      setEditing(null)
      setName("")
      await queryClient.invalidateQueries({ queryKey: vocabularyQueryKey })
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (name.trim()) mutation.mutate({ save: name, id: editing?.id })
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">
        {i18n.t(
          kind === "collection" ? "personalVocabulary.collections" : "personalVocabulary.tags",
        )}
      </h3>
      <form className="flex flex-wrap gap-2" onSubmit={submit}>
        <Input
          aria-label={i18n.t("personalVocabulary.groupName")}
          placeholder={i18n.t("personalVocabulary.groupName")}
          value={name}
          maxLength={100}
          required
          onChange={(event) => setName(event.target.value)}
          className="min-w-36 flex-1"
        />
        <Button type="submit" size="sm" disabled={mutation.isPending || !name.trim()}>
          {i18n.t(editing ? "personalVocabulary.rename" : "personalVocabulary.add")}
        </Button>
        {editing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(null)
              setName("")
            }}
          >
            {i18n.t("personalVocabulary.cancel")}
          </Button>
        )}
      </form>
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {vocabularyError(mutation.error)}
        </p>
      )}
      <ul className="divide-y">
        {groups.map((group) => (
          <li
            key={group.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
          >
            <span className="wrap-anywhere">{groupLabel(group)}</span>
            {group.id !== DEFAULT_COLLECTION_ID && (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setEditing(group)
                    setName(group.name)
                  }}
                >
                  {i18n.t("personalVocabulary.rename")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() => {
                    const description = i18n.t(
                      kind === "collection"
                        ? "personalVocabulary.confirmCollectionDelete"
                        : "personalVocabulary.confirmTagDelete",
                      [group.name],
                    )
                    if (window.confirm(description)) mutation.mutate({ remove: group.id })
                  }}
                >
                  {i18n.t("personalVocabulary.delete")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function VocabularyGroups() {
  const { data, isPending, error } = useVocabularyGroups()
  if (isPending) return <p role="status">{i18n.t("personalVocabulary.loading")}</p>
  if (error || !data) return <p role="alert">{vocabularyError(error)}</p>
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <GroupManager kind="collection" groups={data.collections} />
      <GroupManager kind="tag" groups={data.tags} />
    </div>
  )
}
