/** Decode authored local links once; never turn web or executable URLs into files. */
export function localFileLink(href: string | undefined): string | undefined {
  if (!href || href.startsWith('#') || href.startsWith('?') || /^[/\\]{2}/.test(href)) return
  let path = href
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path)
      if (url.hostname && url.hostname !== 'localhost') return
      path = url.pathname
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
    } catch { return }
  } else if (/^sandbox:\//i.test(path)) path = path.slice('sandbox:'.length)
  else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[/\\]/i.test(path)) return
  // Line anchors annotate source locations, not the downloaded filename.
  path = path.replace(/#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/, '').replace(/:\d+(?::\d+)?$/, '')
  try { path = decodeURIComponent(path) } catch { return }
  if (!path || /[\u0000-\u001f\u007f]/.test(path) || /^[/\\]{2}/.test(path)) return
  return path
}

export type GroupFileTarget = { path: string } | { rowId: string; index: number; name: string }
export type DownloadGroupFile = (target: GroupFileTarget) => Promise<void>
