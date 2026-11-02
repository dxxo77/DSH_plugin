/**
 * Host half of the quota-balance bundle.
 *
 * The signed-in account balance lives behind the Host-only `deepseekAccount`
 * service, so the browser cannot read it directly. This half exposes one
 * read-only same-origin route that the Client half polls; the balance request
 * itself is cached so several open pages share one upstream call.
 */

export const name = 'quota-balance'

export const inject = ['webServer']

/** Route the Client half fetches; same origin, so no base URL is configured. */
const ROUTE_PATH = '/plugin/quota-balance/status'

/** A successful read stays fresh this long: balances move on the order of minutes. */
const OK_TTL_MS = 30_000

/** A failed read retries sooner, so a signed-in user sees the chip appear quickly. */
const FAIL_TTL_MS = 5_000

/** Sent as `x-client-version`; the platform only records which client asked. */
const CLIENT_VERSION = '0.2.1-rc.5'

export function apply(ctx) {
  /** Last settled answer plus how long it stays fresh. */
  let cached
  /** One in-flight read that concurrent requests join instead of duplicating. */
  let inflight

  const clientMetadata = () => ({
    version: CLIENT_VERSION,
    locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  })

  /** @returns the route payload, never throwing. */
  async function read() {
    const account = ctx.get('deepseekAccount')
    if (account === undefined) return { ok: false, reason: 'unavailable' }
    const balance = await account.getBalance(clientMetadata())
    if (balance === null) return { ok: false, reason: 'signed-out' }
    if (balance.status !== 'ready') return { ok: false, reason: 'failed' }
    const pick = (wallet) => ({ currency: wallet.currency, balance: wallet.balance })
    const normal = balance.value.map(pick)
    const bonus = (balance.bonusWallets ?? []).map(pick)
    return {
      ok: true,
      wallets: [...normal, ...bonus],
      /** Kept apart so the Client can label granted credit on its own row. */
      normal,
      bonus,
      links: await accountLinks(account),
      fetchedAt: Date.now(),
    }
  }

  /** Account links are local state, so a failure here must not sink the balance. */
  async function accountLinks(account) {
    try {
      const view = await account.getState()
      return view?.links ?? null
    } catch {
      return null
    }
  }

  async function snapshot() {
    const now = Date.now()
    if (cached !== undefined && now - cached.at < cached.ttl) return cached.body
    inflight ??= (async () => {
      let body
      try {
        body = await read()
      } catch (error) {
        ctx.logger?.warn?.('quota-balance: balance read failed', error)
        body = { ok: false, reason: 'error' }
      }
      cached = { at: Date.now(), ttl: body.ok ? OK_TTL_MS : FAIL_TTL_MS, body }
      inflight = undefined
      return body
    })()
    return inflight
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405
        res.end()
        return
      }
      void snapshot().then((body) => {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify(body))
      })
    },
  }))
}
