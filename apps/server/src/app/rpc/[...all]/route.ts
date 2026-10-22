import { createContext } from '@/lib/context'
import { appRouter } from '@/routers'
import { RPCHandler } from '@orpc/server/fetch'
import { NextRequest } from 'next/server'
import { scrubPlexTokens } from '@/lib/plex-token-scrub'

// Nothing sent to the browser may carry the Plex token: Plex artwork URLs in any
// procedure's output become /images/plex links, other URLs just lose the token.
const handler = new RPCHandler(appRouter, {
  clientInterceptors: [async ({ next }) => scrubPlexTokens(await next())],
})

async function handleRequest(req: NextRequest) {
  const { response } = await handler.handle(req, {
    prefix: '/rpc',
    context: await createContext(req),
  })

  return response ?? new Response('Not found', { status: 404 })
}

export const GET = handleRequest
export const POST = handleRequest
export const PUT = handleRequest
export const PATCH = handleRequest
export const DELETE = handleRequest
