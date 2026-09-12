import type { CanonicalBundle, CWROptions, Party, WriterContrib, PublisherContrib, TerritoryScope } from '../types'
import { WORLD_TIS_CODE, toTisCode } from '../data/territories'

// CWR 2.1 fixed-width field helpers
function left(val: string | number | undefined, len: number): string {
  return String(val ?? '').slice(0, len).padEnd(len)
}

function right(val: string | number | undefined, len: number): string {
  return String(val ?? '').slice(0, len).padStart(len, '0')
}

function share(val: number): string {
  // CWR ownership share: 5 digits, implied 2 decimal places (e.g. 5000 = 50.00%)
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

// CISAC PR society codes. Verify against the official CISAC society code table
// (cisac.org) before relying on these in production — GMR is not a CISAC member
// and has no such code, so it's intentionally omitted rather than guessed.
const SOCIETY_PR_CODE: Record<string, string> = {
  ASCAP: '010', ASC: '010', BMI: '021', SESAC: '071',
  SOCAN: '088', PRS: '052', GEMA: '035', SACEM: '058',
}

// Society affiliation fields are a fixed-width numeric CISAC code, not free text.
// Source data (e.g. CIP-60's "pro" field) is often a plain-text abbreviation like
// "ASCAP" — resolve it, and pass through anything that's already numeric.
function resolveSocietyCode(raw?: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) return trimmed
  return SOCIETY_PR_CODE[trimmed.toUpperCase()] ?? ''
}

// Expands a work's territory scope into the ordered (Inclusion/Exclusion, TIS code)
// pairs an SPT/SWT chain needs. Undefined (not yet specified by the user) defaults to
// worldwide, matching the CWR convention that an absent SPT/SWT implies world collection.
function territoryRecords(scope: TerritoryScope | undefined): Array<{ included: boolean; tis: string }> {
  if (!scope || scope.mode === 'world' || scope.territories.length === 0) {
    return [{ included: true, tis: WORLD_TIS_CODE }]
  }
  if (scope.mode === 'include') {
    return scope.territories.map(t => ({ included: true, tis: toTisCode(t) }))
  }
  // 'exclude': "all but Y" — include the world, then exclude each listed territory.
  return [
    { included: true, tis: WORLD_TIS_CODE },
    ...scope.territories.map(t => ({ included: false, tis: toTisCode(t) })),
  ]
}

// "LAST FIRST" → { first, last }; single-token names go entirely into last name
// per the CWR convention for parties that can't be split.
function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.toUpperCase().trim().split(/\s+/)
  return parts.length > 1
    ? { first: parts[0], last: parts.slice(1).join(' ') }
    : { first: '', last: parts[0] ?? '' }
}

// ─── Record builders ──────────────────────────────────────────────────────────

// HDR's Sender Identifier occupies positions 4-14 (11 chars) in both versions, but its
// shape differs: CWR 2.1 splits it into Sender Type (2, e.g. "PB") + numeric Sender ID
// (9, right-justified/zero-filled — it's a lookup key, not free text); CWR 2.2 merges
// both into a single alphanumeric identifier (spec §3.5, "SenderIdentifier").
function hdr(opts: CWROptions): string {
  const senderId = String(opts.sender_id ?? '').trim()
  const isNumeric = /^\d+$/.test(senderId)
  const senderField = opts.version === '2.2'
    ? left(isNumeric ? senderId.padStart(11, '0') : senderId, 11)
    : left('PB', 2) + right(senderId, 9)
  const v22Fields = opts.version === '2.2'
    ? left('', 3) + left('', 3) + left('', 30) + left('', 30)  // version, revision, software package, package version
    : ''
  return (
    'HDR' +
    senderField +
    left(opts.sender_name.toUpperCase(), 45) +
    left('01.10', 5) +
    dateToday() +
    hhmmss() +
    dateToday() +
    left('', 15) +   // character set
    v22Fields
  )
}

function grh(type: string, groupId: number, version: CWROptions['version']): string {
  return (
    'GRH' +
    left(type, 3) +
    right(groupId, 5) +
    left(version === '2.2' ? '02.20' : '02.10', 5) +
    left('', 10) +                                // batch request #
    left('', 2)                                   // submission/distribution type
  )
}

function nwr(work: CanonicalBundle['work'], txSeq: number): string {
  const submitterWorkNum = work.id.replace(/-/g, '').slice(0, 14).toUpperCase()
  return (
    'NWR' +
    right(txSeq, 8) +
    right(0, 8) +                                // record sequence
    left(work.title, 60) +
    left('EN', 2) +                              // language code
    left(submitterWorkNum, 14) +
    left(work.iswc ?? '', 11) +
    left('', 8) +                                // copyright date
    left('', 12) +                               // copyright number
    left(work.musical_work_distribution_category, 3) +
    left(work.duration ?? '000000', 6) +
    left('Y', 1) +                               // recorded indicator
    left('MUS', 3) +                             // text-music relationship
    left('', 3) +                                // composite type
    left('ORI', 3) +                             // version type
    left('', 3) +                                // excerpt type
    left('ORI', 3) +                             // music arrangement
    left('ORI', 3) +                             // lyric adaptation
    left('', 30) +                               // contact name
    left('', 10) +                               // contact id
    left('', 2) +                                // CWR work type
    left('N', 1) +                               // grand rights indicator
    right(0, 3) +                                // composite component count
    left('', 8) +                                // date of publication of printed edition
    left('N', 1) +                               // exceptional clause
    left('', 25) +                               // opus number
    left('', 25) +                               // catalogue number
    left('N', 1)                                 // priority flag
  )
}

// Publisher Controlled By Submitter — fields and widths per CWR 2.2 Functional
// Specification §5.4/5.5 (record format table). Field order: Publisher Sequence #,
// Interested Party #, Name, Unknown Ind, Publisher Type (2 chars — was wrongly 1),
// Tax ID # (was entirely missing), IPI Name # (was wrongly placed at the record's
// tail), Submitter Agreement #, PR/MR/SR society+share, Reversionary Ind, First
// Recording Refusal Ind, Filler, IPI Base #, ISAC, Society-Assigned Agreement #,
// Agreement Type, USA License Ind.
function spu(pub: PublisherContrib, party: Party, txSeq: number, recSeq: number, sequenceNum: number): string {
  const proCode = resolveSocietyCode(party.society_affiliations.find(a => a.right_type === 'PR')?.society_code)
  return (
    'SPU' +
    right(txSeq, 8) +
    right(recSeq, 8) +
    right(sequenceNum, 2) +                      // publisher sequence #
    left(party.ipi ?? '', 9) +                   // interested party #
    left(party.name.toUpperCase(), 45) +
    left('', 1) +                                // publisher unknown indicator
    left('E', 2) +                                // publisher type
    left('', 9) +                                 // tax id #
    left(party.ipi ?? '', 11) +                   // publisher IPI name #
    left(pub.agreement_number ?? '', 14) +        // submitter agreement #
    left(proCode, 3) +                            // PR society
    share(pub.pr_share) +
    left('', 3) +                                 // MR society
    share(pub.mr_share) +
    left('', 3) +                                 // SR society
    share(pub.sr_share) +
    left('', 1) +                                 // reversionary indicator
    left('N', 1) +                                // first recording refusal ind
    left('', 1) +                                 // filler
    left('', 13) +                                // publisher IPI base number
    left('', 14) +                                // international standard agreement code
    left('', 14) +                                // society-assigned agreement number
    left('', 2) +                                 // agreement type
    left('', 1)                                   // USA license ind
  )
}

// Writer Controlled By Submitter — fields and widths per CWR 2.2 Functional
// Specification §5.9 (record format table). Field order: Interested Party #, Last/First
// Name, Unknown Ind, Writer Designation Code (2 chars, was wrongly 1 char and always
// blank — the writer's role was being computed but never written), Tax ID # (was
// entirely missing), IPI Name # (was wrongly placed at the tail), PR/MR/SR
// society+share, Reversionary/First Recording Refusal/Work For Hire, Filler, IPI Base #,
// Personal Number, USA License Ind. There is no "agreement number" field on SWR at
// all — that concept only exists on PWR — so the field the old code had here was
// fabricated and has been removed.
function swr(writer: WriterContrib, party: Party, txSeq: number, recSeq: number): string {
  const { first: firstName, last: lastName } = splitName(party.name)
  const proCode = resolveSocietyCode(party.society_affiliations.find(a => a.right_type === 'PR')?.society_code)

  return (
    'SWR' +
    right(txSeq, 8) +
    right(recSeq, 8) +
    left(party.ipi ?? '', 9) +                    // interested party #
    left(lastName, 45) +
    left(firstName, 30) +
    left('', 1) +                                 // writer unknown indicator
    left(writer.role, 2) +                        // writer designation code
    left('', 9) +                                 // tax id #
    left(party.ipi ?? '', 11) +                   // writer IPI name #
    left(proCode, 3) +                            // PR society
    share(writer.pr_share) +
    left('', 3) +                                 // MR society
    share(writer.mr_share) +
    left('', 3) +                                 // SR society
    share(writer.sr_share) +
    left('', 1) +                                 // reversionary indicator
    left('N', 1) +                                // first recording refusal ind
    left('N', 1) +                                // work for hire indicator
    left('', 1) +                                 // filler
    left('', 13) +                                // writer IPI base number
    left('', 12) +                                // personal number
    left('', 1)                                   // USA license ind
  )
}

// Recording Detail record — fields and widths per CWR 2.2 Functional Specification
// §5.21 (record format table): Release Date, a 60-char reserved/blank gap, Release
// Duration, a 5-char reserved/blank gap, then Album Title/Label/Catalogue #, EAN,
// ISRC, Recording Format/Technique, Media Type, and — for CWR 2.2 — Recording Title,
// Version Title, Display Artist, Record Label, ISRC Validity, Submitter Recording
// Identifier. The previous version of this function had the wrong field order
// (duration after catalogue #, no reserved gaps), a 1-char EAN field (should be 13),
// and several fields borrowed from NWR that don't exist on REC at all — artist name
// is correctly its own PER record for 2.1, and additionally Display Artist for 2.2.
function rec(recording: CanonicalBundle['recordings'][0], txSeq: number, recSeq: number, version: CWROptions['version']): string {
  const submitterRecordingId = recording.id.replace(/-/g, '').slice(0, 14).toUpperCase()
  const v22Fields = version === '2.2'
    ? left(recording.title, 60) +                   // recording title
      left('', 60) +                                // version title (no canonical equivalent)
      left(recording.artist_name, 60) +              // display artist
      left(recording.label ?? '', 60) +               // record label
      left(recording.isrc ? 'Y' : '', 20) +           // ISRC validity — "Y": passed our own format check
      left(submitterRecordingId, 14)                  // submitter recording identifier
    : ''
  return (
    'REC' +
    right(txSeq, 8) +
    right(recSeq, 8) +
    left(yyyymmdd(recording.release_date), 8) +   // release date
    left('', 60) +                                 // reserved (fill with blanks)
    left(recording.duration ?? '000000', 6) +      // release duration
    left('', 5) +                                  // reserved (fill with blanks)
    left('', 60) +                                 // album title
    left(recording.label ?? '', 60) +               // album label
    left('', 18) +                                  // release catalogue #
    left('', 13) +                                  // EAN-13
    left(recording.isrc ?? '', 12) +                 // ISRC
    left('A', 1) +                                   // recording format: audio
    left('D', 1) +                                   // recording technique: digital
    left('', 3) +                                    // media type
    v22Fields
  )
}

// Alternate Title — one per work.alternate_titles entry (CWR manual §5.6).
function alt(title: string, txSeq: number, recSeq: number): string {
  return (
    'ALT' +
    right(txSeq, 8) +
    right(recSeq, 8) +
    left(title, 60) +
    left('AT', 2) +                              // title type: Alternative Title
    left('', 2)                                  // language code
  )
}

// Publisher Territory of Control — fields per CWR 2.2 spec §5.7: Interested Party #,
// a 6-char constant (spec: "set this field equal to spaces" — previously missing
// entirely here, which shifted every field after it), then PR/MR/SR collection
// shares, inclusion/exclusion, TIS code, shares-change, sequence #. One record is
// emitted per territoryRecords() entry — an excluded territory always carries zero
// shares per spec ("all Collection Shares must be set to zero" when Excluded).
function spt(pub: PublisherContrib, party: Party, txSeq: number, recSeq: number, record: { included: boolean; tis: string }, sequenceNum: number): string {
  return (
    'SPT' +
    right(txSeq, 8) +
    right(recSeq, 8) +
    left(party.ipi ?? '', 9) +
    left('', 6) +                                // constant (spaces)
    share(record.included ? pub.pr_share : 0) +
    share(record.included ? pub.mr_share : 0) +
    share(record.included ? pub.sr_share : 0) +
    left(record.included ? 'I' : 'E', 1) +        // inclusion/exclusion indicator
    left(record.tis, 4) +                         // TIS numeric code
    left('N', 1) +                                // shares change
    right(sequenceNum, 3)                         // sequence #
  )
}

// Writer Territory of Control — mirrors SPT for writers (CWR spec §5.12). One record is
// emitted per territoryRecords() entry, following the same exclude-means-zero-shares
// rule as SPT. Per the manual, SWT may be omitted entirely when the writer has no
// collection share for any right — callers should skip calling this in that case.
function swt(writer: WriterContrib, party: Party, txSeq: number, recSeq: number, record: { included: boolean; tis: string }, sequenceNum: number): string {
  return (
    'SWT' +
    right(txSeq, 8) +
    right(recSeq, 8) +
    left(party.ipi ?? '', 9) +
    share(record.included ? writer.pr_share : 0) +
    share(record.included ? writer.mr_share : 0) +
    share(record.included ? writer.sr_share : 0) +
    left(record.included ? 'I' : 'E', 1) +        // inclusion/exclusion indicator
    left(record.tis, 4) +                         // TIS numeric code
    left('N', 1) +                                // shares change
    right(sequenceNum, 3)                         // sequence #
  )
}

// Publisher for Writer — links a controlled writer to the publisher they assigned rights to
// (CWR spec §5.14). Our model doesn't track per-writer assignment, so every controlled
// writer is linked to every publisher on the work — correct for the common single-chain case.
// Publisher Sequence # (2.2) is mandatory and must match the SPU record it refers back to.
function pwr(pub: PublisherContrib, pubParty: Party, writerParty: Party, txSeq: number, recSeq: number, sequenceNum: number, version: CWROptions['version']): string {
  const v22Fields = version === '2.2'
    ? right(sequenceNum, 2) +                     // publisher sequence #
      left('', 1)                                 // relinquishment indicator
    : ''
  return (
    'PWR' +
    right(txSeq, 8) +
    right(recSeq, 8) +
    left(pubParty.ipi ?? '', 9) +
    left(pubParty.name.toUpperCase(), 45) +
    left(pub.agreement_number ?? '', 14) +        // submitter agreement #
    left('', 14) +                                // society-assigned agreement #
    left(writerParty.ipi ?? '', 9) +               // writer IP #
    v22Fields
  )
}

// Performing Artist — one per distinct recording artist (CWR manual §5.8).
function per(artistName: string, txSeq: number, recSeq: number): string {
  const { first, last } = splitName(artistName)
  return (
    'PER' +
    right(txSeq, 8) +
    right(recSeq, 8) +
    left(last, 45) +
    left(first, 30) +
    left('', 11) +                                // CAE/IPI name #
    left('', 13)                                  // IPI base #
  )
}

function grt(groupId: number, txCount: number, recCount: number): string {
  return 'GRT' + right(groupId, 5) + right(txCount, 8) + right(recCount, 8)
}

function trl(groupCount: number, txCount: number, recCount: number): string {
  return 'TRL' + right(groupCount, 5) + right(txCount, 8) + right(recCount, 8)
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function canonicalToCWR(bundles: CanonicalBundle[], opts: CWROptions): string {
  const lines: string[] = []
  lines.push(hdr(opts))
  lines.push(grh('NWR', 1, opts.version))

  let totalGroupRecords = 0  // records inside the group (excluding GRH/GRT)

  bundles.forEach((bundle, bundleIdx) => {
    const partyMap = new Map<string, Party>(bundle.parties.map(p => [p.id, p]))
    const txSeq = bundleIdx + 1
    let recSeq = 0  // within this transaction; NWR is record 0
    const territories = territoryRecords(bundle.work.territory_scope)

    lines.push(nwr(bundle.work, txSeq))
    recSeq++
    totalGroupRecords++

    bundle.work.alternate_titles.forEach(title => {
      lines.push(alt(title, txSeq, recSeq))
      recSeq++
      totalGroupRecords++
    })

    bundle.work.publishers.forEach((pub, pubIdx) => {
      const party = partyMap.get(pub.party_id)
      if (party) {
        lines.push(spu(pub, party, txSeq, recSeq, pubIdx + 1))
        recSeq++
        totalGroupRecords++

        if (pub.pr_share > 0 || pub.mr_share > 0 || pub.sr_share > 0) {
          territories.forEach((record, i) => {
            lines.push(spt(pub, party, txSeq, recSeq, record, i + 1))
            recSeq++
            totalGroupRecords++
          })
        }
      }
    })

    bundle.work.writers.forEach(writer => {
      const party = partyMap.get(writer.party_id)
      if (party) {
        lines.push(swr(writer, party, txSeq, recSeq))
        recSeq++
        totalGroupRecords++

        if (writer.pr_share > 0 || writer.mr_share > 0 || writer.sr_share > 0) {
          territories.forEach((record, i) => {
            lines.push(swt(writer, party, txSeq, recSeq, record, i + 1))
            recSeq++
            totalGroupRecords++
          })
        }

        bundle.work.publishers.forEach((pub, pubIdx) => {
          const pubParty = partyMap.get(pub.party_id)
          if (pubParty) {
            lines.push(pwr(pub, pubParty, party, txSeq, recSeq, pubIdx + 1, opts.version))
            recSeq++
            totalGroupRecords++
          }
        })
      }
    })

    const artistNames = new Set(bundle.recordings.map(r => r.artist_name).filter(Boolean))
    artistNames.forEach(name => {
      lines.push(per(name, txSeq, recSeq))
      recSeq++
      totalGroupRecords++
    })

    bundle.recordings.forEach(recording => {
      lines.push(rec(recording, txSeq, recSeq, opts.version))
      recSeq++
      totalGroupRecords++
    })
  })

  const txCount = bundles.length
  // +2 for GRH + GRT, +2 for HDR + TRL
  lines.push(grt(1, txCount, totalGroupRecords + 2))
  lines.push(trl(1, txCount, totalGroupRecords + 4))

  return lines.join('\r\n')
}
