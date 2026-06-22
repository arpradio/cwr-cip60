import { NextRequest } from 'next/server'
import { cip60ToCanonical } from '@/lib/transform/cip60-to-canonical'
import { cwrToCanonical } from '@/lib/transform/cwr-to-canonical'
import { ddexToCanonical } from '@/lib/transform/ddex-to-canonical'
import type { ParseRequest } from '@/lib/types'

export async function POST(req: NextRequest) {
  let body: ParseRequest
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    if (body.inputFormat === 'cip60') {
      let parsed: unknown
      try {
        parsed = JSON.parse(body.input)
      } catch {
        return Response.json({ error: 'Invalid JSON — check CIP-60 input.' }, { status: 422 })
      }
      const result = cip60ToCanonical(parsed)
      return Response.json(result)
    }

    if (body.inputFormat === 'cwr') {
      const result = cwrToCanonical(body.input)
      return Response.json(result)
    }

    if (body.inputFormat === 'ddex') {
      const result = ddexToCanonical(body.input)
      return Response.json(result)
    }

    return Response.json({ error: `Unknown input format: ${body.inputFormat}` }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Parse failed' }, { status: 422 })
  }
}
