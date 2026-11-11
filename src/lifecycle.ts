/** Own optional UI effects independently from the browser package's lifetime. */
export function watchActivation(options: {
  read(): Promise<boolean>
  subscribe(refresh: () => void): () => void
  mount(): { dispose(): unknown }
}) {
  let disposed = false
  let generation = 0
  let mounted: { dispose(): unknown } | undefined
  const refresh = async () => {
    const current = ++generation
    try {
      const enabled = await options.read()
      if (disposed || current !== generation) return
      if (enabled && !mounted) mounted = options.mount()
      if (!enabled && mounted) { void mounted.dispose(); mounted = undefined }
    } catch { /* Preserve state through a transient disconnect; refresh on reconnect. */ }
  }
  const unsubscribe = options.subscribe(() => { void refresh() })
  void refresh()
  return () => { disposed = true; generation++; unsubscribe(); if (mounted) void mounted.dispose() }
}
