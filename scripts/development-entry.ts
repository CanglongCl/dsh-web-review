/**
 * The source-checkout launch channel uses the stable public package identity.
 *
 * At alpha.5 the client-modules boot graph requires the loader row name to
 * equal the package.json name (DSH-0.1.2-A1-26) and the bundle banner id to
 * match that row, so the checkout is linked into the active profile under its
 * real npm name instead of a development-only alias.
 */
export const DEVELOPMENT_ENTRY_NAME = '@canglongcl/dsh-web-review'

/** Stable public npm identity used by the official profile bundle. */
export const OFFICIAL_PACKAGE_NAME = '@canglongcl/dsh-web-review'


