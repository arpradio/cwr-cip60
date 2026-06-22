import { NextRequest } from 'next/server'
import { cip60ToCanonical } from '@/lib/transform/cip60-to-canonical'
import { canonicalToCWR } from '@/lib/transform/canonical-to-cwr'
import type { ConvertRequest, ConvertResponse } from '@/lib/types'

export async function POST(req: NextRequest) {
  let body: ConvertRequest

  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.cip60) {
    return Response.json({ error: 'Missing cip60 field' }, { status: 400 })
  }

  try {
    const { bundles, warnings } = cip60ToCanonical(body.cip60)
    const cwr = canonicalToCWR(bundles, body.options)

    const result: ConvertResponse = { cwr, bundles, warnings }
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transformation failed'
    return Response.json({ error: message }, { status: 422 })
  }
}
