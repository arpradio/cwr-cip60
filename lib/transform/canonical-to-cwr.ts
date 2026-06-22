import type { CanonicalBundle, CWROptions, Party, WriterContrib, PublisherContrib } from '../types'

function left(val: string | number | undefined, len: number): string {
  return String(val ?? '').slice(0, len).padEnd(len)
}

function right(val: string | number | undefined, len: number): string {
  return String(val ?? '').slice(0, len).padStart(len, '0')
}

function share(val: number): string {
  // 5 digits, implied 2 decimal places — e.g. 5000 = 50.00%
  return right(Math.round(val * 100), 5)
}

function yyyymmdd(date?: string): string {
  return left(date?.replace(/-/g, '') ?? '', 8)
}

function hhmmss(): string {
  const d = new Date()
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join('')
}

function dateToday(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

// Maps opts.version ('2.1'|'2.2') to the 5-char CWR EDI version string
function cwrVersion(opts: CWROptions): string {
  return opts.version === '2.2' ? '02.20' : '02.10'
}

// Every CWR record must be exactly 200 characters
function pad200(s: string): string {
  return s.slice(0, 200).padEnd(200)
}

// Numeric PRO affiliation codes used in CWR society fields
const SOCIETY_CODE: Record<string, string> = {
  ASCAP: '021', BMI: '022', SESAC: '071', GMR: '319',
  SOCAN: '022', PRS: '021', GEMA: '035', SACEM: '058',
}

// ─── Record builders ──────────────────────────────────────────────────────────

function hdr(opts: CWROptions): string {
  // HDR meaningful content: 3+2+9+45+5+8+6+8+15 = 101 chars → padded to 200
  return pad200(
    'HDR' +
    left('PB', 2) +
    left(opts.sender_id, 9) +
    left(opts.sender_name.toUpperCase(), 45) +
    left(cwrVersion(opts), 5) +
    dateToday() +
    hhmmss() +
    dateToday() +
    left('', 15)              // character set
  )
}

function grh(type: string, groupId: number, opts: CWROptions): string {
  // GRH meaningful content: 3+3+5+5+10 = 26 chars → padded to 200
  return pad200(
    'GRH' +
    left(type, 3) +
    right(groupId, 5) +
    left(cwrVersion(opts), 5) +
    left('', 10)              // batch request (optional)
  )
}

function nwr(work: CanonicalBundle['work'], txSeq: number): string {
  const submitterWorkNum = work.id.replace(/-/g, '').slice(0, 14).toUpperCase()
  // NWR fields through composite component count sum to exactly 200 chars.
  // Remaining optional fields (opus, catalogue, etc.) are truncated by pad200.
  return pad200(
    'NWR' +
    right(txSeq, 8) +
    right(0, 8) +                                         // record sequence (NWR is always 0)
    left(work.title, 60) +
    left('EN', 2) +                                       // language code
    left(submitterWorkNum, 14) +
    left(work.iswc ?? '', 11) +
    left('', 8) +                                         // copyright date
    left('', 12) +                                        // copyright number
    left(work.musical_work_distribution_category, 3) +
    left(work.duration ?? '000000', 6) +
    left('Y', 1) +                                        // recorded indicator
    left('MUS', 3) +                                      // text-music relationship
    left('', 3) +                                         // composite type
    left('ORI', 3) +                                      // version type
    left('', 3) +                                         // excerpt type
    left('ORI', 3) +                                      // music arrangement
    left('ORI', 3) +                                      // lyric adaptation
    left('', 30) +                                        // contact name
    left('', 10) +                                        // contact id
    left('', 2) +                                         // CWR work type
    left('N', 1) +                                        // grand rights indicator
    right(0, 3) +                                         // composite component count
    left('', 8) +                                         // date of publication of printed edition
    left('N', 1) +                                        // exceptional clause
    left('', 25) +                                        // opus number
    left('', 25) +                                        // catalogue number
    left('N', 1)                                          // priority flag
  )
}

function spu(pub: PublisherContrib, party: Party, txSeq: number, recSeq: number): string {
  return pad200(
    'SPU' +
    right(txSeq, 8) +
    right(recSeq, 8) +
    left(party.ipi ?? '', 9) +
    left(party.name.toUpperCase(), 45) +
    left('', 1) +                                         // unknown indicator
    left(pub.role, 2) +                                   // publisher type (E, SE, AM, AQ)
    left(pub.agreement_number ?? '', 14) +
    left('', 3) +                                         // PR society
    share(pub.pr_share) +
    left('', 3) +                                         // MR society
    share(pub.mr_share) +
    left('', 3) +                                         // SR society
    share(pub.sr_share) +
    left('', 14) +                                        // special agreements
    left('N', 1) +                                        // first recording refusal
    left('', 22) +                                        // filler
    left(party.ipi ?? '', 13) +                           // IPI name number
    left('', 13) +                                        // IPI base number
    left('', 12)                                          // personal number
  )
}

function swr(writer: WriterContrib, party: Party, txSeq: number, recSeq: number): string {
  const parts = party.name.toUpperCase().trim().split(/\s+/)
  const firstName = parts.length > 1 ? parts[0] : ''
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
  const prSociety = SOCIETY_CODE[
    party.society_affiliations.find(a => a.right_type === 'PR')?.society_code ?? ''
  ] ?? ''

  return pad200(
    'SWR' +
    right(txSeq, 8) +
    right(recSeq, 8) +
    left(party.ipi ?? '', 9) +
    left(lastName, 45) +
    left(firstName, 30) +
    left('', 1) +                                         // unknown indicator
    left(writer.role, 2) +                                // writer designation code (C, A, CA, E, …)
    left('', 14) +                                        // agreement number
    left(prSociety, 3) +                                  // PR society (numeric code, e.g. 021)
    share(writer.pr_share) +
    left('', 3) +                                         // MR society
    share(writer.mr_share) +
    left('', 3) +                                         // SR society
    share(writer.sr_share) +
    left('N', 1) +                                        // reversionary
    left('N', 1) +                                        // first recording refusal
    left('N', 1) +                                        // work for hire
    left('', 22) +                                        // filler
    left(party.ipi ?? '', 13) +                           // IPI name number
    left('', 13) +                                        // IPI base number
    left('', 12)                                          // personal number
  )
}

function rec(recording: CanonicalBundle['recordings'][0], txSeq: number, recSeq: number): string {
  // REC fields: 3+8+8+8+6+60+60+18+1+12+1+3+3+3+6 = 200 chars exactly
  return pad200(
    'REC' +
    right(txSeq, 8) +
    right(recSeq, 8) +
    left(yyyymmdd(recording.release_date), 8) +           // first release date
    left(recording.duration ?? '000000', 6) +             // first release duration
    left('', 60) +                                        // first album title
    left(recording.label ?? '', 60) +                     // first album label
    left('', 18) +                                        // first release catalog number
    left('', 1) +                                         // EAN
    left(recording.isrc ?? '', 12) +
    left('Y', 1) +                                        // recorded indicator
    left('ORI', 3) +                                      // version type
    left('ORI', 3) +                                      // music arrangement
    left('ORI', 3) +                                      // lyric adaptation
    left(recording.duration ?? '000000', 6)               // recording duration
  )
}

function grt(groupId: number, txCount: number, recCount: number): string {
  return pad200('GRT' + right(groupId, 5) + right(txCount, 8) + right(recCount, 8))
}

function trl(groupCount: number, txCount: number, recCount: number): string {
  return pad200('TRL' + right(groupCount, 5) + right(txCount, 8) + right(recCount, 8))
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function canonicalToCWR(bundles: CanonicalBundle[], opts: CWROptions): string {
  const lines: string[] = []
  lines.push(hdr(opts))
  lines.push(grh('NWR', 1, opts))

  let totalGroupRecords = 0  // NWR + detail records inside the group (excludes GRH/GRT)

  bundles.forEach((bundle, bundleIdx) => {
    const partyMap = new Map<string, Party>(bundle.parties.map(p => [p.id, p]))
    const txSeq = bundleIdx + 1
    let recSeq = 0  // NWR is record 0 within a transaction

    lines.push(nwr(bundle.work, txSeq))
    recSeq++
    totalGroupRecords++

    bundle.work.publishers.forEach(pub => {
      const party = partyMap.get(pub.party_id)
      if (party) {
        lines.push(spu(pub, party, txSeq, recSeq))
        recSeq++
        totalGroupRecords++
      }
    })

    bundle.work.writers.forEach(writer => {
      const party = partyMap.get(writer.party_id)
      if (party) {
        lines.push(swr(writer, party, txSeq, recSeq))
        recSeq++
        totalGroupRecords++
      }
    })

    bundle.recordings.forEach(recording => {
      lines.push(rec(recording, txSeq, recSeq))
      recSeq++
      totalGroupRecords++
    })
  })

  const txCount = bundles.length
  // GRT record count includes GRH + all NWR/detail records + GRT itself
  lines.push(grt(1, txCount, totalGroupRecords + 2))
  // TRL record count is the full transmission: HDR + GRH + all records + GRT + TRL
  lines.push(trl(1, txCount, totalGroupRecords + 4))

  return lines.join('\r\n')
}
