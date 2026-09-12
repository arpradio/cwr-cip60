import type { CanonicalBundle, Party, Work, Recording, WriterContrib, PublisherContrib, WriterRole } from '../types'
import { hashInput } from '../hash'

// Basic regex-based XML field extraction (no external parser needed)
function firstTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? m[1].trim() : ''
}

function allBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

const ROLE_MAP: Record<string, WriterRole> = {
  Composer: 'C', Author: 'A', Lyricist: 'A', ComposerLyricist: 'CA',
  Arranger: 'AR', Translator: 'TR', Adaptor: 'AD', AuthorOfArrangement: 'E', SubAuthor: 'SA',
}

export function ddexToCanonical(xml: string): { bundles: CanonicalBundle[]; warnings: string[] } {
  const warnings: string[] = []
  const now = new Date().toISOString()

  const notifications = allBlocks(xml, 'MusicalWorkNotification')
  if (notifications.length === 0) {
    throw new Error('No MusicalWorkNotification elements found — confirm this is DDEX MWN XML.')
  }

  const sourceHash = hashInput(xml)

  const bundles: CanonicalBundle[] = notifications.map(notif => {
    const workBlock = allBlocks(notif, 'MusicalWork')[0] ?? notif

    const iswc = firstTag(workBlock, 'ISWC')
    const rawTitle = firstTag(workBlock, 'WorkTitle')
    const title = (rawTitle || '(UNTITLED)').toUpperCase()

    const parties: Party[] = []
    const writers: WriterContrib[] = []
    const publishers: PublisherContrib[] = []

    allBlocks(workBlock, 'MusicalWorkContributor').forEach(contrib => {
      const roleStr = firstTag(contrib, 'MusicalWorkContributorRole')
      const fullName = firstTag(contrib, 'FullName')
      const ipi = firstTag(contrib, 'IPINameNumber')
      const isni = firstTag(contrib, 'ISNI')

      // First RightsShare = PR, second = MR
      const rightShares = allBlocks(contrib, 'RightsShare')
      let prShare = 0
      let mrShare = 0
      rightShares.forEach(rs => {
        const type = firstTag(rs, 'RightType')
        const pct = parseFloat(firstTag(rs, 'PercentageOfRightsAssigned')) || 0
        if (type === 'PerformingRight') prShare = pct
        else if (type === 'MechanicalRight') mrShare = pct
      })

      const partyId = crypto.randomUUID()
      if (roleStr === 'MusicPublisher') {
        parties.push({ id: partyId, name: fullName, type: 'publisher', ipi: ipi || undefined, society_affiliations: [] })
        publishers.push({ party_id: partyId, role: 'E', pr_share: prShare, mr_share: mrShare || prShare, sr_share: prShare })
      } else {
        parties.push({ id: partyId, name: fullName, type: 'writer', ipi: ipi || undefined, isni: isni || undefined, society_affiliations: [] })
        writers.push({ party_id: partyId, role: ROLE_MAP[roleStr] ?? 'C', pr_share: prShare, mr_share: mrShare || prShare, sr_share: prShare })
      }
    })

    const workId = crypto.randomUUID()
    const work: Work = {
      id: workId, title, alternate_titles: [], iswc: iswc || undefined,
      proprietary_ids: {}, writers, publishers, agreements: [],
      musical_work_distribution_category: 'POP',
      created_at: now, updated_at: now, source_hash: sourceHash,
    }

    if (writers.length === 0) warnings.push(`"${title}": no contributors found.`)

    const recordings: Recording[] = allBlocks(notif, 'SoundRecording').map(recBlock => {
      const isrc = firstTag(recBlock, 'ISRC')
      const recTitle = (firstTag(recBlock, 'ResourceTitle') || title).toUpperCase()
      const artist = firstTag(recBlock, 'FullName').toUpperCase()
      const label = firstTag(recBlock, 'LabelName')
      const relDate = firstTag(recBlock, 'ReleaseDate').replace(/-/g, '')
      const dur = firstTag(recBlock, 'Duration')

      // Parse ISO duration PT4M12S → 000412
      let durHHMMSS: string | undefined
      const dm = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
      if (dm) {
        const h = parseInt(dm[1] || '0'), m = parseInt(dm[2] || '0'), s = parseInt(dm[3] || '0')
        durHHMMSS = `${String(h).padStart(2,'0')}${String(m).padStart(2,'0')}${String(s).padStart(2,'0')}`
      }

      return {
        id: crypto.randomUUID(), title: recTitle, isrc: isrc || undefined, artist_name: artist,
        label: label || undefined, release_date: relDate || undefined, duration: durHHMMSS,
        work_id: workId, created_at: now,
      }
    })

    if (recordings.length === 0) warnings.push(`"${title}": no SoundRecording found.`)

    return { work, recordings, parties, relationships: [] }
  })

  return { bundles, warnings }
}
