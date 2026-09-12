import type { CanonicalBundle, GenerateOptions } from '../types'

const WRITER_ROLE_MAP: Record<string, string> = {
  C: 'Composer', A: 'Lyricist', CA: 'ComposerLyricist',
  AR: 'Arranger', TR: 'Translator', AD: 'Adaptor',
  E: 'AuthorOfArrangement', SA: 'SubAuthor', SR: 'SubArranger',
}

const RECIPIENT_IDS: Record<string, string> = {
  MLC: 'PADPIDA2012113001O',
  HFA: 'PADPIDAHFA00000001',
  ASCAP: 'PADPIDAASCAP000001',
  BMI: 'PADPIDABMI0000001O',
  SESAC: 'PADPIDASESAC00001O',
  GMR: 'PADPIDAGMR000001O',
}

function x(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function tag(depth: number, open: string, content: string, close?: string): string {
  const pad = '  '.repeat(depth)
  if (close) return `${pad}<${open}>${content}</${close}>`
  return `${pad}<${open}>${content}</${open}>`
}

function durISO(hhmmss?: string): string {
  if (!hhmmss || hhmmss.length < 6) return 'PT0S'
  const h = parseInt(hhmmss.slice(0, 2))
  const m = parseInt(hhmmss.slice(2, 4))
  const s = parseInt(hhmmss.slice(4, 6))
  return `PT${h ? h + 'H' : ''}${m ? m + 'M' : ''}${s ? s + 'S' : ''}` || 'PT0S'
}

function releaseDate(raw?: string): string {
  if (!raw || raw.length < 8) return ''
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

export function canonicalToDDEX(bundles: CanonicalBundle[], opts: GenerateOptions): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, '')
  const recipient = opts.recipient ?? opts.society
  const lines: string[] = []

  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<MusicalWorkNotificationMessage xmlns="http://ddex.net/xml/mwn/10"')
  lines.push('  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">')

  // MessageHeader
  lines.push('  <MessageHeader>')
  lines.push(`    <MessageThreadId>thread-${Date.now()}</MessageThreadId>`)
  lines.push(`    <MessageId>msg-${Date.now()}-001</MessageId>`)
  lines.push('    <MessageSender>')
  lines.push(tag(3, 'PartyId', x(opts.sender_id)))
  lines.push(`      <PartyName><FullName>${x(opts.sender_name)}</FullName></PartyName>`)
  lines.push('    </MessageSender>')
  lines.push('    <MessageRecipient>')
  lines.push(tag(3, 'PartyId', RECIPIENT_IDS[recipient] ?? x(recipient)))
  lines.push('    </MessageRecipient>')
  lines.push(tag(2, 'MessageCreatedDateTime', now))
  lines.push(tag(2, 'MessageControlType', 'LiveMessage'))
  lines.push('  </MessageHeader>')

  for (const bundle of bundles) {
    const pm = new Map(bundle.parties.map(p => [p.id, p]))

    lines.push('  <MusicalWorkNotification>')
    lines.push('    <MusicalWork>')

    if (bundle.work.iswc) {
      lines.push('      <MusicalWorkId IsDefault="true">')
      lines.push(tag(4, 'ISWC', x(bundle.work.iswc)))
      lines.push('      </MusicalWorkId>')
    }
    lines.push('      <MusicalWorkId>')
    lines.push(`        <ProprietaryId Namespace="SUBMITTER">${x(bundle.work.id)}</ProprietaryId>`)
    lines.push('      </MusicalWorkId>')

    lines.push(`      <WorkTitle Type="OriginalTitle">${x(bundle.work.title)}</WorkTitle>`)
    bundle.work.alternate_titles.forEach(t =>
      lines.push(`      <WorkTitle Type="AlternativeTitle">${x(t)}</WorkTitle>`)
    )

    // Writers
    bundle.work.writers.forEach(w => {
      const party = pm.get(w.party_id)
      if (!party) return
      lines.push('      <MusicalWorkContributor>')
      lines.push(tag(4, 'MusicalWorkContributorRole', WRITER_ROLE_MAP[w.role] ?? 'Composer'))
      lines.push('        <ContributorParty>')
      lines.push(`          <PartyName><FullName>${x(party.name)}</FullName></PartyName>`)
      if (party.ipi) lines.push(tag(5, 'IPINameNumber', party.ipi))
      if (party.isni) lines.push(tag(5, 'ISNI', party.isni))
      lines.push('        </ContributorParty>')
      if (w.pr_share > 0) {
        lines.push('        <RightsShare>')
        lines.push(tag(5, 'RightType', 'PerformingRight'))
        lines.push(tag(5, 'PercentageOfRightsAssigned', w.pr_share.toFixed(2)))
        lines.push('        </RightsShare>')
      }
      if (w.mr_share > 0) {
        lines.push('        <RightsShare>')
        lines.push(tag(5, 'RightType', 'MechanicalRight'))
        lines.push(tag(5, 'PercentageOfRightsAssigned', w.mr_share.toFixed(2)))
        lines.push('        </RightsShare>')
      }
      lines.push('      </MusicalWorkContributor>')
    })

    // Publishers
    bundle.work.publishers.forEach(pub => {
      const party = pm.get(pub.party_id)
      if (!party) return
      lines.push('      <MusicalWorkContributor>')
      lines.push(tag(4, 'MusicalWorkContributorRole', 'MusicPublisher'))
      lines.push('        <ContributorParty>')
      lines.push(`          <PartyName><FullName>${x(party.name)}</FullName></PartyName>`)
      if (party.ipi) lines.push(tag(5, 'IPINameNumber', party.ipi))
      lines.push('        </ContributorParty>')
      if (pub.pr_share > 0) {
        lines.push('        <RightsShare>')
        lines.push(tag(5, 'RightType', 'PerformingRight'))
        lines.push(tag(5, 'PercentageOfRightsAssigned', pub.pr_share.toFixed(2)))
        lines.push('        </RightsShare>')
      }
      lines.push('      </MusicalWorkContributor>')
    })

    lines.push('    </MusicalWork>')

    // SoundRecording blocks
    bundle.recordings.forEach(rec => {
      lines.push('    <SoundRecording>')
      if (rec.isrc) {
        lines.push('      <SoundRecordingId>')
        lines.push(tag(4, 'ISRC', x(rec.isrc)))
        lines.push('      </SoundRecordingId>')
      }
      lines.push(tag(3, 'ResourceTitle', x(rec.title)))
      if (rec.artist_name) lines.push(`      <MainArtist><FullName>${x(rec.artist_name)}</FullName></MainArtist>`)
      if (rec.label) lines.push(tag(3, 'LabelName', x(rec.label)))
      if (rec.release_date) lines.push(tag(3, 'ReleaseDate', releaseDate(rec.release_date)))
      if (rec.duration) lines.push(tag(3, 'Duration', durISO(rec.duration)))
      lines.push('    </SoundRecording>')
    })

    lines.push('  </MusicalWorkNotification>')
  }

  lines.push('</MusicalWorkNotificationMessage>')
  return lines.join('\n')
}
