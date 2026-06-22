import type { CanonicalBundle } from '../types'

function durISO(hhmmss?: string): string {
  if (!hhmmss || hhmmss.length < 6) return 'PT0S'
  const h = parseInt(hhmmss.slice(0, 2))
  const m = parseInt(hhmmss.slice(2, 4))
  const s = parseInt(hhmmss.slice(4, 6))
  return `PT${h ? h + 'H' : ''}${m ? m + 'M' : ''}${s ? s + 'S' : ''}` || 'PT0S'
}

function fmtDate(yyyymmdd?: string): string {
  if (!yyyymmdd || yyyymmdd.length < 8) return ''
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

export function canonicalToCIP60(bundles: CanonicalBundle[]): string {
  if (bundles.length === 0) throw new Error('No bundles provided.')
  const first = bundles[0]
  const firstRec = first.recordings[0]
  const isMultiple = bundles.length > 1

  const files = bundles.map((bundle, i) => {
    const pm = new Map(bundle.parties.map(p => [p.id, p]))
    const rec = bundle.recordings[0]
    const song: Record<string, unknown> = {
      song_title: bundle.work.title,
      song_duration: durISO(bundle.work.duration),
      track_number: i + 1,
    }

    if (rec?.isrc) song.isrc = rec.isrc
    if (bundle.work.iswc) song.iswc = bundle.work.iswc

    if (rec?.artist_name) {
      song.artists = [{ name: rec.artist_name }]
    }

    if (bundle.work.writers.length > 0) {
      song.authors = bundle.work.writers.map(w => {
        const p = pm.get(w.party_id)
        const author: Record<string, unknown> = { name: p?.name ?? '' }
        if (p?.ipi) author.ipi = p.ipi
        author.share = w.pr_share.toFixed(2)
        if (w.role && w.role !== 'C') author.role = w.role
        if (p?.society_affiliations[0]?.society_code) author.pro = p.society_affiliations[0].society_code
        return author
      })
    }

    if (bundle.work.publishers.length > 0) {
      song.publishers = bundle.work.publishers.map(pub => {
        const p = pm.get(pub.party_id)
        const publisher: Record<string, unknown> = { name: p?.name ?? '' }
        if (p?.ipi) publisher.ipi = p.ipi
        publisher.share = pub.pr_share.toFixed(2)
        if (p?.society_affiliations[0]?.society_code) publisher.pro = p.society_affiliations[0].society_code
        return publisher
      })
    }

    return {
      name: bundle.work.title,
      mediaType: 'audio/mp4',
      src: 'ipfs://<cid>',
      song,
    }
  })

  const out = {
    '721': {
      '<policy_id>': {
        '<asset_name>': {
          name: first.work.title,
          image: 'ipfs://<cid>',
          music_metadata_version: 3,
          release: {
            release_type: isMultiple ? 'Multiple' : 'Single',
            release_title: first.work.title,
            ...(firstRec?.release_date ? { release_date: fmtDate(firstRec.release_date) } : {}),
            ...(firstRec?.label ? { distributor: firstRec.label } : {}),
          },
          files,
        },
      },
    },
  }

  return JSON.stringify(out, null, 2)
}
