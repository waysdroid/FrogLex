import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { useSelector } from "@tanstack/react-store"
import { useAtomValue } from "jotai"
import { useMemo } from "react"
import { useAutosaveContext } from "@/components/form/use-autosave"
import ProviderSelector from "@/components/llm-providers/provider-selector"
import { Field, FieldTitle } from "@/components/ui/base-ui/field"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import {
  doesProviderSupportsCapability,
  getSelectableProvidersForCapability,
} from "@/utils/providers/provider-registry"
import { withForm } from "./form"

export const ProviderField = withForm({
  ...{ defaultValues: {} as SelectionToolbarCustomAction },
  render: function Render({ form }) {
    const autosave = useAutosaveContext()
    const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)

    const builtInAiModels = null
    const selectedProviderId = useSelector(form.store, (state) => state.values.providerId)

    const baseCustomActionProviders = useMemo(
      () =>
        getSelectableProvidersForCapability("customAction", providersConfig, builtInAiModels, [
          selectedProviderId,
        ]),
      [providersConfig, builtInAiModels, selectedProviderId],
    )
    const customActionProviders = baseCustomActionProviders

    return (
      <form.AppField
        name="providerId"
        validators={{
          onChange: ({ value }) => {
            // Any Built-in AI model passes, listed or not: whether it can run
            // is the server's call, and the menu marks one it cannot.
            if (
              !doesProviderSupportsCapability("customAction", providersConfig, value, {
                requireEnable: true,
              })
            ) {
              return i18n.t("options.selectionToolbar.customActions.errors.providerRequired")
            }
            return undefined
          },
        }}
      >
        {(field) => (
          <Field>
            <FieldTitle>
              {i18n.t("options.selectionToolbar.customActions.form.provider")}
            </FieldTitle>
            <ProviderSelector
              providers={customActionProviders}
              value={field.state.value}
              onChange={(id) => {
                autosave.edit(() => field.handleChange(id), { immediate: true })
              }}
              placeholder={i18n.t("options.selectionToolbar.customActions.form.selectProvider")}
            />
            {field.state.meta.errors.length > 0 && (
              <span className="text-sm font-normal text-destructive">
                {field.state.meta.errors.join(", ")}
              </span>
            )}
          </Field>
        )}
      </form.AppField>
    )
  },
})
