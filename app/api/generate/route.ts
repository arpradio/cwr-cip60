import { NextRequest } from 'next/server'
import { canonicalToCWR } from '@/lib/transform/canonical-to-cwr'
import { canonicalToDDEX } from '@/lib/transform/canonical-to-ddex'
import { canonicalToCIP60 } from '@/lib/transform/canonical-to-cip60'
import type { GenerateRequest } from '@/lib/types'

export async function POST(req: NextRequest) {
  let body: GenerateRequest
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!Array.isArray(body.bundles) || body.bundles.length === 0) {
    return Response.json({ error: 'bundles array is required and must not be empty' }, { status: 400 })
  }

  try {
    let output: string
    if (body.outputFormat === 'cwr') {
      output = canonicalToCWR(body.bundles, body.options)
    } else if (body.outputFormat === 'ddex') {
      output = canonicalToDDEX(body.bundles, body.options)
    } else if (body.outputFormat === 'cip60') {
      output = canonicalToCIP60(body.bundles)
    } else {
      return Response.json({ error: `Unknown output format: ${body.outputFormat}` }, { status: 400 })
    }
    return Response.json({ output })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Generation failed' }, { status: 422 })
  }
}
