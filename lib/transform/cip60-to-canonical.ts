import { createHash } from 'crypto'
import type {
  CanonicalBundle, Party, Work, Recording, Relationship,
  WriterContrib, PublisherContrib, WriterRole,
} from '../types'

// ─── CIP-60 loose types (real-world data is messier than the CDDL spec) ──────

interface AuthorDetails {
  name?: string
  ipi?: string
  share?: string | number
  // non-standard extensions
  role?: string
  pro?: string
}

interface ArtistDetails {
  name?: string
  isni?: string
}

interface SongDetails {
  song_title?: string | string[]
  song_duration?: string
  track_number?: number
  isrc?: string
  iswc?: string
  authors?: AuthorDetails[]
  artists?: ArtistDetails[]
  contributing_artists?: Array<{ name?: string; ipi?: string; role?: string[] }>
  genres?: string[]
  // non-standard publisher extension
  publishers?: Array<{ name?: string; ipi?: string; share?: string | number; pro?: string; territory?: string }>
}

interface FileEntry {
  name?: string
  mediaType?: string
  src?: string
  song?: SongDetails
}

interface ReleaseDetails {
  release_type?: string
  release_title?: string
  release_date?: string
  distributor?: string
  catalog_number?: string
  // real-world: artists/genres sometimes on release for Album/EP
  artists?: string | ArtistDetails | ArtistDetails[]
  genres?: string[]
}

interface MetadataDetails {
  name?: string
  music_metadata_version?: number | string
  release?: ReleaseDetails
  files?: FileEntry[]
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

const ROLE_MAP: Record<string, WriterRole> = {
  composer: 'C', c: 'C',
  lyricist: 'A', author: 'A', a: 'A',
  'composer/lyricist': 'CA', ca: 'CA',
  arranger: 'AR', ar: 'AR',
  translator: 'TR', tr: 'TR',
  adaptor: 'AD', ad: 'AD',
  'author of arrangement': 'E', e: 'E',
  'sub-author': 'SE', se: 'SE',
}

function normalizeRole(role?: string): WriterRole {
  if (!role) return 'C'
  return ROLE_MAP[role.toLowerCase()] ?? 'C'
}

function normalizeIPI(raw?: string): string | undefined {
  if (!raw) return undefined
  const digits = String(raw).replace(/\D/g, '')
  return digits ? digits.padStart(11, '0').slice(0, 11) : undefined
}

function normalizeISWC(raw?: string): string | undefined {
  if (!raw) return undefined
  const m = String(raw).toUpperCase().match(/T[-.]?(\d{9})[-.]?(\d)/)
  return m ? `T-${m[1]}-${m[2]}` : undefined
}

function normalizeISRC(raw?: string): string | undefined {
  if (!raw) return undefined
  const s = String(raw).replace(/[-\s]/g, '').toUpperCase()
  return s.length >= 12 ? s.slice(0, 12) : undefined
}

function parseDuration(raw?: string): string | undefined {
  if (!raw) return undefined
  const m = String(raw).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/)
  if (!m) return undefined
  const h = parseInt(m[1] || '0')
  const min = parseInt(m[2] || '0')
  const sec = Math.round(parseFloat(m[3] || '0'))
  return `${String(h).padStart(2, '0')}${String(min).padStart(2, '0')}${String(sec).padStart(2, '0')}`
}

function hashInput(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16)
}

function normalizeSplits(raw: number[]): number[] {
  const total = raw.reduce((s, n) => s + n, 0)
  if (total === 0) return raw.map(() => parseFloat((100 / raw.length).toFixed(4)))
  return raw.map(n => parseFloat(((n / total) * 100).toFixed(4)))
}

// release.artists can be a plain string, a single object, or an array
function extractArtistName(artists?: string | ArtistDetails | ArtistDetails[]): string {
  if (!artists) return ''
  if (typeof artists === 'string') return artists
  if (Array.isArray(artists)) return String(artists[0]?.name ?? '')
  return String((artists as ArtistDetails).name ?? '')
}

// ─── Single-song bundle builder ───────────────────────────────────────────────

function buildBundle(
  song: SongDetails,
  release: ReleaseDetails,
  sourceHash: string,
  globalArtistName: string,
  warnings: string[],
): CanonicalBundle {
  const now = new Date().toISOString()
  const parties: Party[] = []
  const relationships: Relationship[] = []

  // song_title: string | string[]
  const titleRaw = song.song_title
  const primaryTitle = (Array.isArray(titleRaw) ? titleRaw[0] : titleRaw ?? '').toUpperCase().trim()
  const alternateTitles = Array.isArray(titleRaw)
    ? titleRaw.slice(1).map(t => String(t).toUpperCase().trim())
    : []

  if (!primaryTitle) warnings.push('song_title is empty or missing.')

  // Authors
  const authors = song.authors ?? []
  const rawShares = authors.map(a => parseFloat(String(a.share ?? 0)))
  const total = rawShares.reduce((s, n) => s + n, 0)
  if (authors.length > 0 && total > 0 && Math.abs(total - 100) > 0.01) {
    warnings.push(`"${primaryTitle}": writer shares sum to ${total.toFixed(2)}, normalized to 100.`)
  }
  const normalizedShares = normalizeSplits(rawShares)

  if (authors.length === 0) {
    warnings.push(`"${primaryTitle}": no authors found — CWR SWR records will be omitted.`)
  }

  const writers: WriterContrib[] = authors.map((author, i) => {
    const partyId = crypto.randomUUID()
    parties.push({
      id: partyId,
      name: String(author.name ?? ''),
      type: 'writer',
      ipi: normalizeIPI(author.ipi),
      society_affiliations: author.pro
        ? [{ society_code: String(author.pro), right_type: 'PR' }]
        : [],
    })
    return {
      party_id: partyId,
      role: normalizeRole(author.role),
      pr_share: normalizedShares[i],
      mr_share: normalizedShares[i],
      sr_share: normalizedShares[i],
    }
  })

  // Publishers (non-standard extension)
  const publishers: PublisherContrib[] = (song.publishers ?? []).map(pub => {
    const partyId = crypto.randomUUID()
    parties.push({
      id: partyId,
      name: String(pub.name ?? ''),
      type: 'publisher',
      ipi: normalizeIPI(pub.ipi),
      society_affiliations: pub.pro
        ? [{ society_code: String(pub.pro), right_type: 'PR' }]
        : [],
    })
    return {
      party_id: partyId,
      role: 'E',
      pr_share: parseFloat(String(pub.share ?? 0)),
      mr_share: parseFloat(String(pub.share ?? 0)),
      sr_share: parseFloat(String(pub.share ?? 0)),
      territory: String(pub.territory ?? 'WW'),
    }
  })

  const iswc = normalizeISWC(song.iswc)
  if (!iswc) warnings.push(`"${primaryTitle}": no ISWC — will be assigned by PRO after registration.`)

  const isrc = normalizeISRC(song.isrc)
  if (!isrc) warnings.push(`"${primaryTitle}": no ISRC.`)

  // Artist: prefer song.artists, then contributing_artists, then release-level artist
  const songArtistName = extractArtistName(song.artists as ArtistDetails[] | undefined)
  const artistName = (songArtistName || globalArtistName).toUpperCase()

  const workId = crypto.randomUUID()
  const work: Work = {
    id: workId,
    title: primaryTitle,
    alternate_titles: alternateTitles,
    iswc,
    proprietary_ids: {},
    writers,
    publishers,
    agreements: [],
    musical_work_distribution_category: 'POP',
    duration: parseDuration(song.song_duration),
    created_at: now,
    updated_at: now,
    source_hash: sourceHash,
  }

  const recId = crypto.randomUUID()
  const recordings: Recording[] = [{
    id: recId,
    title: primaryTitle,
    isrc,
    artist_name: artistName,
    label: String(release.distributor ?? '').toUpperCase(),
    release_date: String(release.release_date ?? '').replace(/-/g, ''),
    duration: parseDuration(song.song_duration),
    work_id: workId,
    created_at: now,
  }]

  relationships.push({ id: crypto.randomUUID(), from_id: recId, to_id: workId, type: 'recording_of' })
  writers.forEach(w => relationships.push({ id: crypto.randomUUID(), from_id: w.party_id, to_id: workId, type: 'writer_of' }))
  publishers.forEach(p => relationships.push({ id: crypto.randomUUID(), from_id: p.party_id, to_id: workId, type: 'publisher_of' }))

  return { work, recordings, parties, relationships }
}

// ─── Main export ─────────────────────────────────────────────────────────────

export interface ParseResult {
  bundles: CanonicalBundle[]
  warnings: string[]
}

export function cip60ToCanonical(input: unknown): ParseResult {
  const warnings: string[] = []
  let assetMeta: MetadataDetails

  // Unwrap { 721: { policy_id: { asset_name: metadata_details } } }
  const raw = input as Record<string, unknown>
  if (raw['721']) {
    const policies = raw['721'] as Record<string, Record<string, unknown>>
    const policyId = Object.keys(policies)[0]
    const assets = policies[policyId]
    const assetName = Object.keys(assets)[0]
    assetMeta = assets[assetName] as MetadataDetails
  } else {
    assetMeta = raw as MetadataDetails
  }

  const ver = String(assetMeta.music_metadata_version ?? '')
  if (!ver.includes('3') && ver !== '3') {
    warnings.push(`music_metadata_version is "${ver}" — targeting CIP-60 v3 fields; some data may not map correctly.`)
  }

  const release = (assetMeta.release ?? {}) as ReleaseDetails
  const releaseType = (release.release_type ?? '').toLowerCase()
  const isAlbumEP = releaseType === 'album/ep' || releaseType === 'multiple'

  // For Album/EP, artists/genres live on release per the spec's common_music_details placement
  const globalArtistName = extractArtistName(release.artists)

  const sourceHash = hashInput(input)

  // Find all files that have a song field
  const songFiles = (assetMeta.files ?? []).filter(f => f.song != null)

  if (songFiles.length === 0) {
    throw new Error('No files with a song field found. CIP-60 v3 requires song details inside files[].')
  }

  if (isAlbumEP && songFiles.length > 1) {
    warnings.push(`${isAlbumEP ? 'Album/EP' : 'Multi-track'} release — generating ${songFiles.length} Work registrations.`)
  }

  const bundles = songFiles.map(file =>
    buildBundle(file.song!, release, sourceHash, globalArtistName, warnings)
  )

  return { bundles, warnings }
}
