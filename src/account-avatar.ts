type AccountState = { status: string }
export interface AccountFrame {
  value: AccountState | { state: AccountState }
  accept(): void
}

export function avatarStore() {
  let url: string | undefined
  const listeners = new Set<() => void>()
  const publish = (value?: string) => {
    if (value === url) return
    url = value
    listeners.forEach(listener => listener())
  }
  return {
    publish,
    getSnapshot: () => url,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    failed(value: string) { if (value === url) publish() },
  }
}

export async function followAccountAvatar(
  frames: AsyncIterable<AccountFrame>,
  profileUrl: () => Promise<string | null | undefined>,
  preload: (url: string, signal: AbortSignal) => Promise<boolean>,
  publish: (url?: string) => void,
  lifetime: AbortSignal,
) {
  let current: AbortController | undefined
  const clear = () => { current?.abort(); publish() }
  lifetime.addEventListener('abort', clear, { once: true })
  try {
    for await (const frame of frames) {
      if (lifetime.aborted) return
      clear()
      const state = 'state' in frame.value ? frame.value.state : frame.value
      frame.accept()
      if (state.status !== 'credential-stored') continue
      const load = new AbortController()
      current = load
      void (async () => {
        const url = await profileUrl()
        if (!url || load.signal.aborted || !/^https?:\/\//iu.test(url)) return
        const loaded = await preload(url, load.signal)
        if (loaded && !load.signal.aborted) publish(url)
      })().catch(() => {})
    }
  } finally {
    lifetime.removeEventListener('abort', clear)
    if (!lifetime.aborted) clear()
  }
}

export function preloadAvatar(url: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    const image = new Image()
    const settled = (loaded: boolean) => {
      image.onload = null
      image.onerror = null
      signal.removeEventListener('abort', abort)
      if (!loaded) image.removeAttribute('src')
      resolve(loaded)
    }
    const abort = () => settled(false)
    image.referrerPolicy = 'no-referrer'
    image.onload = () => settled(true)
    image.onerror = abort
    signal.addEventListener('abort', abort, { once: true })
    image.src = url
  })
}
