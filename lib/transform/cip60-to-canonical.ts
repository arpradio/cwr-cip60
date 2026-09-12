import type {
  CanonicalBundle, Party, Work, Recording, Relationship,
  WriterContrib, PublisherContrib, WriterRole, TerritoryScope,
} from '../types'
import { resolveTerritoryCode } from '../data/territories'
import { hashInput } from '../hash'

// ─── CIP-60 loose types (real-world data is messier than the CDDL spec) ──────

interface AuthorDetails {
  name?: string
  ipi?: string
  share?: string | number
  // non-standard extensions
  role?: string
  pro?: string
  territory?: string
}

interface ArtistDetails {
  name?: string
  isni?: string
}

interface SongDetails {
  song_title?: string | string[]
  song_duration?: string
  track_number?: number
  // CIP-60 v3 CDDL defines these as plain strings; real-world encoders sometimes
  // wrap them in an array (e.g. multi-territory ISRCs) — tolerate that, but flag it.
  isrc?: string | string[]
  iswc?: string | string[]
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
  // CWR Writer Designation Table: SA = Sub-Author, SR = Sub-Arranger (distinct from
  // the Publisher Type table's own "SE" = Sub-publisher, a different code list).
  'sub-author': 'SA', sa: 'SA',
  'sub-arranger': 'SR', sr: 'SR',
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

// CIP-60 defines isrc/iswc as a single string; some encoders emit a one-element
// (or multi-element) array instead. Take the first non-empty entry and flag the deviation.
function pickSpecString(raw: string | string[] | undefined, field: string, label: string, warnings: string[]): string | undefined {
  if (raw == null) return undefined
  if (Array.isArray(raw)) {
    const first = raw.map(v => String(v ?? '').trim()).find(v => v.length > 0)
    if (raw.length > 1) {
      warnings.push(`"${label}": ${field} has ${raw.length} values but CIP-60 defines ${field} as a single string — using "${first ?? ''}" and discarding the rest.`)
    } else {
      warnings.push(`"${label}": ${field} is wrapped in an array but CIP-60 defines it as a single string — unwrapping.`)
    }
    return first
  }
  const s = String(raw).trim()
  return s.length > 0 ? s : undefined
}

// ISWC standard form is T-DDD.DDD.DDD-D (a "T", a 9-digit work code, a check digit),
// commonly written with dots, dashes, or no separators at all.
function normalizeISWC(raw: string | string[] | undefined, label: string, warnings: string[]): string | undefined {
  const value = pickSpecString(raw, 'iswc', label, warnings)
  if (!value) return undefined
  const compact = value.toUpperCase().replace(/[^T0-9]/g, '')
  const m = compact.match(/^T(\d{10})$/)
  if (!m) {
    warnings.push(`"${label}": iswc "${value}" does not match the ISWC format T-DDD.DDD.DDD-D — omitting.`)
    return undefined
  }
  return `T${m[1]}`
}

// ISRC standard form is CC-XXX-YY-NNNNN: 2-letter country, 3 alphanumeric registrant,
// 2-digit year, 5-digit designation code (12 characters once separators are stripped).
function normalizeISRC(raw: string | string[] | undefined, label: string, warnings: string[]): string | undefined {
  const value = pickSpecString(raw, 'isrc', label, warnings)
  if (!value) return undefined
  const compact = value.replace(/[-\s]/g, '').toUpperCase()
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(compact)) {
    warnings.push(`"${label}": isrc "${value}" does not match the ISRC format CC-XXX-YY-NNNNN — omitting.`)
    return undefined
  }
  return compact
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

function normalizeSplits(raw: number[]): number[] {
  const total = raw.reduce((s, n) => s + n, 0)
  if (total === 0) return raw.map(() => parseFloat((100 / raw.length).toFixed(4)))
  return raw.map(n => parseFloat(((n / total) * 100).toFixed(4)))
}

// CIP-60 has no standard territory field (it's not in the v3 CDDL at all), so this is a
// small invented convention for the non-standard `publishers[].territory` extension:
//   "WW" / "WORLD" / unset  -> worldwide
//   "US,CA,GB"              -> collect only in the listed territories
//   "!DE,FR"                -> collect everywhere except the listed territories
// Tokens may be an alpha-2 code, a country name, or a numeric ISO/TIS code.
function parseTerritoryScope(raw: string | undefined, label: string, warnings: string[]): TerritoryScope | undefined {
  if (raw == null) return undefined
  const trimmed = raw.trim()
  if (!trimmed || /^(WW|WORLD|WORLDWIDE)$/i.test(trimmed)) return { mode: 'world', territories: [] }

  const exclude = trimmed.startsWith('!')
  const tokens = (exclude ? trimmed.slice(1) : trimmed).split(',').map(t => t.trim()).filter(Boolean)
  const territories: string[] = []
  for (const token of tokens) {
    const code = resolveTerritoryCode(token)
    if (code) territories.push(code)
    else warnings.push(`"${label}": territory "${token}" is not a recognized country — skipping.`)
  }
  if (territories.length === 0) return { mode: 'world', territories: [] }
  return { mode: exclude ? 'exclude' : 'include', territories }
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

  // CIP-60's author_details has no "role" field per spec, but real-world encoders overload
  // it with "Publisher" to mix publisher shares into the authors array. Route those into
  // publishers instead of writers, while keeping the original share values — the combined
  // authors pool was already normalized to 100% above, so each entry's share stays intact.
  const writers: WriterContrib[] = []
  const authorPublishers: PublisherContrib[] = []
  authors.forEach((author, i) => {
    const partyId = crypto.randomUUID()
    const society_affiliations = author.pro
      ? [{ society_code: String(author.pro), right_type: 'PR' as const }]
      : []
    if ((author.role ?? '').trim().toLowerCase() === 'publisher') {
      parties.push({ id: partyId, name: String(author.name ?? ''), type: 'publisher', ipi: normalizeIPI(author.ipi), society_affiliations })
      authorPublishers.push({
        party_id: partyId,
        role: 'E',
        pr_share: normalizedShares[i],
        mr_share: normalizedShares[i],
        sr_share: normalizedShares[i],
      })
    } else {
      parties.push({ id: partyId, name: String(author.name ?? ''), type: 'writer', ipi: normalizeIPI(author.ipi), society_affiliations })
      writers.push({
        party_id: partyId,
        role: normalizeRole(author.role),
        pr_share: normalizedShares[i],
        mr_share: normalizedShares[i],
        sr_share: normalizedShares[i],
      })
    }
  })

  if (writers.length === 0) {
    warnings.push(`"${primaryTitle}": no authors with a writer role — CWR SWR records will be omitted.`)
  }

  // Publishers (non-standard extension) + any "Publisher"-role authors above
  const publishers: PublisherContrib[] = [...authorPublishers, ...(song.publishers ?? []).map((pub): PublisherContrib => {
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
    }
  })]

  // Territory is not part of the CIP-60 spec at all; check both places a "Publisher" can
  // appear (the authors[] role="Publisher" convention, and the non-standard publishers[]
  // extension) for a hint, else leave unset so the UI prompts for it before generating CWR.
  const territoryHint = authors.map(a => a.territory).find(t => t != null)
    ?? (song.publishers ?? []).map(p => p.territory).find(t => t != null)
  const territoryScope = parseTerritoryScope(territoryHint, primaryTitle, warnings)
  if (!territoryScope) {
    warnings.push(`"${primaryTitle}": no collection territory specified — confirm worldwide or set explicitly before generating CWR.`)
  }

  const iswc = normalizeISWC(song.iswc, primaryTitle, warnings)
  if (song.iswc == null && !iswc) warnings.push(`"${primaryTitle}": no ISWC — will be assigned by PRO after registration.`)

  const isrc = normalizeISRC(song.isrc, primaryTitle, warnings)
  if (song.isrc == null && !isrc) warnings.push(`"${primaryTitle}": no ISRC.`)

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
    territory_scope: territoryScope,
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
