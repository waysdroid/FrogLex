import { browser } from "#imports"

// The upstream identifier still keys existing local databases and page markers.
export { APP_NAME } from "@read-frog/definitions"
export const APP_EXPORT_PREFIX = "froglex"
const manifest = browser.runtime.getManifest()
export const EXTENSION_VERSION = manifest.version
