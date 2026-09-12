import type { CanonicalBundle, Party, Work, Recording, WriterContrib, PublisherContrib, WriterRole } from '../types'
import { hashInput } from '../hash'

// Field extractor using string slicing (offsets match canonical-to-cwr.ts's current
// record layouts, which follow the CWR 2.2 Functional Specification field-by-field —
// see canonical-to-cwr.ts for the authoritative position comments).
function f(line: string, start: number, end: number): string {
  return line.slice(start, Math.min(end, line.length)).trim()
}

const VALID_WRITER_ROLES = new Set<WriterRole>(['C', 'A', 'CA', 'E', 'ES', 'AR', 'AD', 'TR', 'PA', 'SA', 'SR'])
const VALID_PUBLISHER_ROLES = new Set<PublisherContrib['role']>(['E', 'SE', 'AM', 'AQ'])

export function cwrToCanonical(input: string): { bundles: CanonicalBundle[]; warnings: string[] } {
  const warnings: string[] = []
  const lines = input.split(/\r?\n/)
  const now = new Date().toISOString()
  const sourceHash = hashInput(input)

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
    const alternateTitles: string[] = []
    let work: Work | null = null

    for (const line of txLines) {
      const type = line.slice(0, 3)

      if (type === 'NWR' || type === 'REV') {
        // [19:79] title, [79:81] lang, [81:95] submitter num, [95:106] iswc,
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
          source_hash: sourceHash,
        }
        if (!title) warnings.push('NWR record has empty title.')
      }

      else if (type === 'ALT') {
        // [19:79] alternate title
        const title = f(line, 19, 79)
        if (title) alternateTitles.push(title)
      }

      else if (type === 'SWR') {
        // [19:28] interested party #, [28:73] last name, [73:103] first name,
        // [104:106] writer designation code, [115:126] IPI name #,
        // [126:129] PR society, [129:134] PR share, [137:142] MR share, [145:150] SR share
        const ipi = f(line, 115, 126)
        const lastName = f(line, 28, 73)
        const firstName = f(line, 73, 103)
        const designationCode = f(line, 104, 106)
        const proCode = f(line, 126, 129)
        const prShare = parseInt(f(line, 129, 134) || '0', 10) / 100
        const mrShare = parseInt(f(line, 137, 142) || '0', 10) / 100
        const srShare = parseInt(f(line, 145, 150) || '0', 10) / 100

        const role = VALID_WRITER_ROLES.has(designationCode as WriterRole) ? (designationCode as WriterRole) : 'C'
        if (designationCode && !VALID_WRITER_ROLES.has(designationCode as WriterRole)) {
          warnings.push(`Unrecognized writer designation code "${designationCode}" — defaulting to Composer (C).`)
        }

        const name = [firstName, lastName].filter(Boolean).join(' ') || '(UNKNOWN)'
        const partyId = crypto.randomUUID()
        parties.push({
          id: partyId, name, type: 'writer',
          ipi: ipi || undefined,
          society_affiliations: proCode ? [{ society_code: proCode, right_type: 'PR' }] : [],
        })
        writers.push({ party_id: partyId, role, pr_share: prShare, mr_share: mrShare, sr_share: srShare })
      }

      else if (type === 'SPU') {
        // [21:30] interested party #, [30:75] publisher name, [76:78] publisher type,
        // [87:98] IPI name #, [112:115] PR society, [115:120] PR share,
        // [120:123] MR society, [123:128] MR share, [128:131] SR society, [131:136] SR share
        const ipi = f(line, 87, 98)
        const pubName = f(line, 30, 75) || '(UNKNOWN)'
        const pubType = f(line, 76, 78).trim()
        const proCode = f(line, 112, 115)
        const prShare = parseInt(f(line, 115, 120) || '0', 10) / 100
        const mrShare = parseInt(f(line, 123, 128) || '0', 10) / 100
        const srShare = parseInt(f(line, 131, 136) || '0', 10) / 100

        const role = VALID_PUBLISHER_ROLES.has(pubType as PublisherContrib['role']) ? (pubType as PublisherContrib['role']) : 'E'

        const partyId = crypto.randomUUID()
        parties.push({
          id: partyId, name: pubName, type: 'publisher', ipi: ipi || undefined,
          society_affiliations: proCode ? [{ society_code: proCode, right_type: 'PR' }] : [],
        })
        publishers.push({ party_id: partyId, role, pr_share: prShare, mr_share: mrShare, sr_share: srShare })
      }

      else if (type === 'REC') {
        // [19:27] release date, [87:93] duration, [158:218] album label, [249:261] ISRC.
        // [266:326] recording title and [386:446] display artist only exist on CWR 2.2
        // files; f() returns '' for ranges past a shorter 2.1 line, so this degrades
        // gracefully to the work's own title/no artist on 2.1 input.
        const releaseDate = f(line, 19, 27)
        const duration = f(line, 87, 93)
        const label = f(line, 158, 218)
        const isrc = f(line, 249, 261)
        const recordingTitle = f(line, 266, 326)
        const displayArtist = f(line, 386, 446)

        recordings.push({
          id: crypto.randomUUID(),
          title: recordingTitle || work?.title || '',
          isrc: isrc || undefined,
          artist_name: displayArtist,
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

    work.alternate_titles = alternateTitles

    if (recordings.length === 0) {
      warnings.push(`"${work.title}": no REC record — recording data will be empty.`)
    }

    bundles.push({ work, recordings, parties, relationships: [] })
  }

  return { bundles, warnings }
}
