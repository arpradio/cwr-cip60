import type { CanonicalBundle, Party, Work, Recording, WriterContrib, PublisherContrib } from '../types'

// Field extractor using string slicing (offsets match canonical-to-cwr.ts generator)
function f(line: string, start: number, end: number): string {
  return line.slice(start, Math.min(end, line.length)).trim()
}

export function cwrToCanonical(input: string): { bundles: CanonicalBundle[]; warnings: string[] } {
  const warnings: string[] = []
  const lines = input.split(/\r?\n/)
  const now = new Date().toISOString()

  // Group records into transactions by transaction sequence number
  const txMap = new Map<string, string[]>()

  for (const line of lines) {
    if (line.length < 3) continue
    const type = line.slice(0, 3)
    if (['HDR', 'GRH', 'GRT', 'TRL'].includes(type)) continue

    // Transaction sequence is at [3:11] for NWR/SWR/SPU/REC
    const txSeq = line.slice(3, 11).trim()
    if (!txSeq) continue

    if (!txMap.has(txSeq)) txMap.set(txSeq, [])
    txMap.get(txSeq)!.push(line)
  }

  if (txMap.size === 0) {
    throw new Error('No transactions found — make sure this is a valid CWR file.')
  }

  const bundles: CanonicalBundle[] = []

  for (const [, txLines] of txMap) {
    const parties: Party[] = []
    const writers: WriterContrib[] = []
    const publishers: PublisherContrib[] = []
    const recordings: Recording[] = []
    let work: Work | null = null

    for (const line of txLines) {
      const type = line.slice(0, 3)

      if (type === 'NWR' || type === 'REV') {
        // NWR offsets from our generator:
        // [19:79] title, [79:81] lang, [81:95] submitter num, [95:106] iswc
        // [126:129] dist category, [129:135] duration
        const title = f(line, 19, 79)
        const iswc = f(line, 95, 106)
        const duration = f(line, 129, 135)
        work = {
          id: crypto.randomUUID(),
          title: title || '(UNTITLED)',
          alternate_titles: [],
          iswc: iswc || undefined,
          proprietary_ids: {},
          writers,    // filled by reference, populated below
          publishers,
          agreements: [],
          musical_work_distribution_category: 'POP',
          duration: (duration && duration !== '000000') ? duration : undefined,
          created_at: now,
          updated_at: now,
          source_hash: '',
        }
        if (!title) warnings.push('NWR record has empty title.')
      }

      else if (type === 'SWR') {
        // [19:28] ipi, [28:73] last name, [73:103] first name
        // [119:122] PR society, [122:127] PR share (5 digits, implied 2 dec = value/100)
        const ipi = f(line, 19, 28)
        const lastName = f(line, 28, 73)
        const firstName = f(line, 73, 103)
        const proCode = f(line, 119, 122)
        const prRaw = f(line, 122, 127)
        const prShare = prRaw ? parseInt(prRaw) / 100 : 0

        const name = [firstName, lastName].filter(Boolean).join(' ') || '(UNKNOWN)'
        const partyId = crypto.randomUUID()
        parties.push({
          id: partyId, name, type: 'writer',
          ipi: ipi || undefined,
          society_affiliations: proCode ? [{ society_code: proCode, right_type: 'PR' }] : [],
        })
        writers.push({ party_id: partyId, role: 'C', pr_share: prShare, mr_share: prShare, sr_share: prShare })
      }

      else if (type === 'SPU') {
        // [19:28] ipi, [28:73] publisher name
        // [89:92] PR society (but we don't generate it), [92:97] PR share
        const ipi = f(line, 19, 28)
        const pubName = f(line, 28, 73) || '(UNKNOWN)'
        const prRaw = f(line, 92, 97)
        const prShare = prRaw ? parseInt(prRaw) / 100 : 0

        const partyId = crypto.randomUUID()
        parties.push({ id: partyId, name: pubName, type: 'publisher', ipi: ipi || undefined, society_affiliations: [] })
        publishers.push({ party_id: partyId, role: 'E', pr_share: prShare, mr_share: prShare, sr_share: prShare, territory: 'WW' })
      }

      else if (type === 'REC') {
        // [19:27] release date, [27:33] duration, [93:153] label, [172:184] isrc
        // [200:260] title, [260:320] artist
        const releaseDate = f(line, 19, 27)
        const duration = f(line, 27, 33)
        const label = f(line, 93, 153)
        const isrc = f(line, 172, 184)
        const recTitle = f(line, 200, 260)
        const artist = f(line, 260, 320)

        recordings.push({
          id: crypto.randomUUID(),
          title: recTitle || work?.title || '',
          isrc: isrc || undefined,
          artist_name: artist,
          label: label || undefined,
          release_date: (releaseDate && releaseDate !== '00000000') ? releaseDate : undefined,
          duration: (duration && duration !== '000000') ? duration : undefined,
          work_id: work?.id ?? '',
          created_at: now,
        })
      }
    }

    if (!work) {
      warnings.push('A transaction group had no NWR record — skipped.')
      continue
    }

    if (recordings.length === 0) {
      warnings.push(`"${work.title}": no REC record — recording data will be empty.`)
    }

    bundles.push({ work, recordings, parties, relationships: [] })
  }

  return { bundles, warnings }
}
