export type UUID = string

export type WriterRole = 'C' | 'A' | 'CA' | 'E' | 'ES' | 'AR' | 'AD' | 'TR' | 'PA' | 'SE'

export interface Party {
  id: UUID
  name: string
  type: 'writer' | 'publisher' | 'sub-publisher' | 'label' | 'performer'
  ipi?: string
  cae?: string
  isni?: string
  society_affiliations: Array<{ society_code: string; right_type: 'PR' | 'MR' | 'SR' }>
}

export interface WriterContrib {
  party_id: UUID
  role: WriterRole
  pr_share: number
  mr_share: number
  sr_share: number
}

export interface PublisherContrib {
  party_id: UUID
  role: 'E' | 'SE' | 'AM' | 'AQ'
  pr_share: number
  mr_share: number
  sr_share: number
  territory: string
  agreement_number?: string
}

export interface Work {
  id: UUID
  title: string
  alternate_titles: string[]
  iswc?: string
  proprietary_ids: Record<string, string>
  writers: WriterContrib[]
  publishers: PublisherContrib[]
  agreements: Array<{ type: string; date?: string; territories?: string[]; number?: string }>
  musical_work_distribution_category: 'POP' | 'SER' | 'JAZ' | 'UNK'
  duration?: string
  created_at: string
  updated_at: string
  source_hash: string
}

export interface Recording {
  id: UUID
  title: string
  isrc?: string
  artist_name: string
  label?: string
  release_date?: string
  duration?: string
  work_id: UUID
  created_at: string
}

export interface Relationship {
  id: UUID
  from_id: UUID
  to_id: UUID
  type: 'writer_of' | 'publisher_of' | 'subpublisher_of' | 'recording_of' | 'performer_of'
}

export interface CanonicalBundle {
  work: Work
  recordings: Recording[]
  parties: Party[]
  relationships: Relationship[]
}

export type Society = 'ASCAP' | 'BMI' | 'SESAC' | 'GMR' | 'SOCAN' | 'PRS' | 'GEMA' | 'SACEM'
export type InputFormat = 'cip60' | 'cwr' | 'ddex'
export type OutputFormat = 'cwr' | 'ddex' | 'cip60'

export interface GenerateOptions {
  society: Society
  version: '2.1' | '2.2'
  sender_name: string
  sender_id: string
  batch_number: number
  recipient?: string
}

export type CWROptions = GenerateOptions

export interface ParseRequest {
  input: string
  inputFormat: InputFormat
}

export interface ParseResponse {
  bundles: CanonicalBundle[]
  warnings: string[]
}

export interface GenerateRequest {
  bundles: CanonicalBundle[]
  outputFormat: OutputFormat
  options: GenerateOptions
}

export interface GenerateResponse {
  output: string
}

// Legacy — kept for existing /api/convert route
export interface ConvertRequest {
  cip60: unknown
  options: CWROptions
}

export interface ConvertResponse {
  cwr: string
  bundles: CanonicalBundle[]
  warnings: string[]
}
