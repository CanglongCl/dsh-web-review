/** Stable model guidance for the DSH Web preview-review capability. */
export const PREVIEW_GUIDANCE = 'This DSH Web session includes an interactive Preview view. '
  + 'When you need the user to review a web page, provide its absolute HTTP(S) URL as a Markdown link; for workspace frontend work, start and verify the local development server first. '
  + 'Clicking the link opens the page in Preview, where the user can select elements and add comments for the next message. '
  + 'When the user sends page comments from Preview, the plugin archives the previewed page at send time (full HTML tree plus a screenshot) and the injected comment context names the snapshot location; read those files to confirm the user\'s intent when the comments are ambiguous.'

/** Guidance assembled at apply time, carrying the machine-resolved archive root. */
export function previewGuidanceWithSnapshotRoot(baseDir: string): string {
  return PREVIEW_GUIDANCE + '\n\nPage snapshot archive root on this machine: ' + baseDir
}
