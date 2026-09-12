'use client'

import { useState, useCallback } from 'react'
import type { CanonicalBundle, InputFormat, OutputFormat, Society, WriterRole, TerritoryScope } from '@/lib/types'
import { TERRITORIES } from '@/lib/data/territories'

interface EditableWriter {
  id: string; name: string; ipi: string; role: string; prShare: string; pro: string
}
interface EditablePublisher {
  id: string; name: string; ipi: string; share: string; pro: string
}
interface EditableTrack {
  workId: string; title: string; iswc: string; isrc: string
  artistName: string; duration: string
  writers: EditableWriter[]
  publishers: EditablePublisher[]
  // Collection territory for this work's SPT/SWT records. `territorySpecified` is false
  // when the parsed source metadata didn't say — CIP-60 has no territory field at all —
  // so the UI always prompts to confirm worldwide or pick territories before generating.
  territoryMode: TerritoryScope['mode']
  territoryCodes: string[]
  territorySpecified: boolean
}

const TERRITORIES_BY_CODE = new Map(TERRITORIES.map(t => [t.code, t]))
const SORTED_TERRITORIES = [...TERRITORIES].sort((a, b) => a.name.localeCompare(b.name))

const WRITER_ROLES: [WriterRole, string][] = [
  ['C', 'C — Composer'], ['A', 'A — Lyricist/Author'], ['CA', 'CA — Composer & Author'],
  ['AR', 'AR — Arranger'], ['TR', 'TR — Translator'], ['AD', 'AD — Adaptor'],
  ['E', 'E — Author of Arrangement'], ['SA', 'SA — Sub-author'], ['SR', 'SR — Sub-arranger'],
]
const PROS = ['', 'ASCAP', 'BMI', 'SESAC', 'GMR', 'SOCAN', 'PRS', 'GEMA', 'SACEM']
const SOCIETIES: Society[] = ['ASCAP', 'BMI', 'SESAC', 'GMR', 'SOCAN', 'PRS', 'GEMA', 'SACEM']

function bundlesToEditable(bundles: CanonicalBundle[]): EditableTrack[] {
  return bundles.map(b => {
    const pm = new Map(b.parties.map(p => [p.id, p]))
    const scope = b.work.territory_scope
    return {
      workId: b.work.id, title: b.work.title, iswc: b.work.iswc ?? '',
      duration: b.work.duration ?? '', isrc: b.recordings[0]?.isrc ?? '',
      artistName: b.recordings[0]?.artist_name ?? '',
      territoryMode: scope?.mode ?? 'world',
      territoryCodes: scope?.territories ?? [],
      territorySpecified: scope != null,
      writers: b.work.writers.map(w => {
        const p = pm.get(w.party_id)
        return {
          id: w.party_id, name: p?.name ?? '', ipi: p?.ipi ?? '', role: w.role,
          prShare: w.pr_share.toFixed(2), pro: p?.society_affiliations[0]?.society_code ?? ''
        }
      }),
      publishers: b.work.publishers.map(pub => {
        const p = pm.get(pub.party_id)
        return {
          id: pub.party_id, name: p?.name ?? '', ipi: p?.ipi ?? '',
          share: pub.pr_share.toFixed(2), pro: p?.society_affiliations[0]?.society_code ?? ''
        }
      }),
    }
  })
}

// Browser-side equivalent of lib/hash.ts's server-side hashInput — Node's `crypto`
// module isn't available in a client component, but the Web Crypto API is.
async function hashTrack(t: EditableTrack): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(t))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

async function editablesToBundles(tracks: EditableTrack[]): Promise<CanonicalBundle[]> {
  const now = new Date().toISOString()
  return Promise.all(tracks.map(async t => {
    const parties: CanonicalBundle['parties'] = []
    const writers: CanonicalBundle['work']['writers'] = []
    const publishers: CanonicalBundle['work']['publishers'] = []
    t.writers.forEach(w => {
      parties.push({
        id: w.id, name: w.name, type: 'writer', ipi: w.ipi.trim() || undefined,
        society_affiliations: w.pro ? [{ society_code: w.pro, right_type: 'PR' }] : []
      })
      const s = parseFloat(w.prShare) || 0
      writers.push({ party_id: w.id, role: (w.role as WriterRole) || 'C', pr_share: s, mr_share: s, sr_share: s })
    })
    t.publishers.forEach(p => {
      parties.push({
        id: p.id, name: p.name, type: 'publisher', ipi: p.ipi.trim() || undefined,
        society_affiliations: p.pro ? [{ society_code: p.pro, right_type: 'PR' }] : []
      })
      const s = parseFloat(p.share) || 0
      publishers.push({ party_id: p.id, role: 'E', pr_share: s, mr_share: s, sr_share: s })
    })
    const territory_scope: TerritoryScope = { mode: t.territoryMode, territories: t.territoryMode === 'world' ? [] : t.territoryCodes }
    const source_hash = await hashTrack(t)
    return {
      work: {
        id: t.workId, title: t.title.toUpperCase().trim(), alternate_titles: [],
        iswc: t.iswc.trim() || undefined, proprietary_ids: {}, writers, publishers, agreements: [],
        musical_work_distribution_category: 'POP', duration: t.duration.trim() || undefined,
        territory_scope, created_at: now, updated_at: now, source_hash
      },
      recordings: [{
        id: crypto.randomUUID(), title: t.title.toUpperCase().trim(),
        isrc: t.isrc.trim() || undefined, artist_name: t.artistName.toUpperCase().trim(),
        label: '', release_date: '', duration: t.duration.trim() || undefined,
        work_id: t.workId, created_at: now
      }],
      parties, relationships: [],
    }
  }))
}

const EXAMPLES: Record<InputFormat, string> = {
  cip60: JSON.stringify({
    '721': {
      '<policy_id>': {
        '<asset_name>': {
          name: 'Echoes of the Grid', image: 'ipfs://', music_metadata_version: 3,
          release: { release_type: 'Single', release_title: 'Echoes of the Grid', release_date: '2026-03-14', distributor: 'The Psyence Lab' },
          files: [{
            name: 'Echoes of the Grid', mediaType: 'audio/mp4', src: 'ipfs://', song: {
              song_title: 'Echoes of the Grid', song_duration: 'PT4M12S', track_number: 1,
              isrc: 'USPSC2600001', iswc: 'T-123456789-0', genres: ['Electronic', 'Ambient'],
              artists: [{ name: 'ARPRADIO', isni: '0000000121212121' }],
              authors: [
                { name: 'Author One', share: '50', ipi: '00000000250', role: 'C', pro: 'BMI' },
                { name: 'Author Two', share: '50', ipi: '00000000251', role: 'CA', pro: 'ASCAP' },
              ],
              publishers: [{ name: 'Psyence Lab Publishing', ipi: '00000000300', share: '50', pro: 'BMI' }],
            }
          }],
        }
      }
    },
  }, null, 2),
  cwr: '(Paste a CWR file — HDR/GRH/NWR/SWR/REC/GRT/TRL records)',
  ddex: '(Paste DDEX MWN XML — <MusicalWorkNotificationMessage>...)',
}

function FieldInput({ label, value, onChange, warn, mono, placeholder }:
  { label: string; value: string; onChange: (v: string) => void; warn?: 'required' | 'info'; mono?: boolean; placeholder?: string }) {
  const missing = !value.trim()
  const border = missing
    ? warn === 'required' ? 'border-red-400 bg-red-50' : warn === 'info' ? 'border-amber-300 bg-amber-50' : 'border-zinc-200'
    : 'border-zinc-200'
  return (
    <label className="flex flex-col gap-0.5 min-w-0">
      <span className={`text-xs font-medium ${missing && warn === 'required' ? 'text-red-500' : 'text-zinc-400'}`}>
        {label}{missing && warn === 'required' ? ' ⚠' : missing && warn === 'info' ? ' ·' : ''}
      </span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={`text-xs border rounded px-2 py-1.5 outline-none focus:ring-2 focus:ring-blue-300 w-full ${mono ? 'font-mono' : ''} ${border}`} />
    </label>
  )
}

function TerritoryInput({ mode, codes, specified, onChange }: {
  mode: TerritoryScope['mode']; codes: string[]; specified: boolean
  onChange: (u: { mode?: TerritoryScope['mode']; codes?: string[] }) => void
}) {
  const needsConfirmation = !specified
  const toggle = (code: string) =>
    onChange({ codes: codes.includes(code) ? codes.filter(c => c !== code) : [...codes, code] })
  return (
    <div className={`col-span-2 border rounded p-2 ${needsConfirmation ? 'border-amber-300 bg-amber-50' : 'border-zinc-200'}`}>
      <span className={`text-xs font-medium ${needsConfirmation ? 'text-amber-700' : 'text-zinc-400'}`}>
        Collection Territory{needsConfirmation ? ' · not specified in source — confirm below' : ''}
      </span>
      <div className="flex gap-3 mt-1 mb-1.5">
        {(['world', 'include', 'exclude'] as const).map(m => (
          <label key={m} className="flex items-center gap-1 text-xs text-zinc-600 cursor-pointer">
            <input type="radio" name="territoryMode" checked={mode === m} onChange={() => onChange({ mode: m })} />
            {m === 'world' ? 'Worldwide' : m === 'include' ? 'Only these territories' : 'All except these territories'}
          </label>
        ))}
      </div>
      {mode !== 'world' && (
        <div className="max-h-32 overflow-y-auto border border-zinc-100 rounded p-1.5 grid grid-cols-3 gap-x-2 bg-white">
          {SORTED_TERRITORIES.map(t => (
            <label key={t.code} className="flex items-center gap-1 text-xs text-zinc-600 cursor-pointer truncate">
              <input type="checkbox" checked={codes.includes(t.code)} onChange={() => toggle(t.code)} />
              <span className="truncate">{t.name}</span>
            </label>
          ))}
        </div>
      )}
      {mode !== 'world' && codes.length > 0 && (
        <p className="text-xs text-zinc-400 mt-1">{codes.map(c => TERRITORIES_BY_CODE.get(c)?.alpha2 ?? c).join(', ')}</p>
      )}
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${active ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-600'}`}>
      {children}
    </button>
  )
}

function SecHead({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">{children}</p>
}

export default function Home() {
  const [inputFormat, setInputFormat] = useState<InputFormat>('cip60')
  const [rawInput, setRawInput] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [tracks, setTracks] = useState<EditableTrack[]>([])
  const [selectedTrack, setSelectedTrack] = useState(0)
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('cwr')
  const [output, setOutput] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [society, setSociety] = useState<Society>('BMI')
  const [cwrVersion, setCwrVersion] = useState<'2.1' | '2.2'>('2.1')
  const [senderName, setSenderName] = useState('The Psyence Lab')
  const [senderId, setSenderId] = useState('PSL00001')

  const handleParse = useCallback(async () => {
    setParseError(null); setParseWarnings([]); setOutput(null); setGenerateError(null); setIsParsing(true)
    try {
      const res = await fetch('/api/parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: rawInput, inputFormat })
      })
      const data = await res.json()
      if (!res.ok) { setParseError(data.error ?? 'Parse failed'); return }
      setTracks(bundlesToEditable(data.bundles)); setParseWarnings(data.warnings ?? []); setSelectedTrack(0)
    } catch (e) { setParseError(e instanceof Error ? e.message : 'Network error') }
    finally { setIsParsing(false) }
  }, [rawInput, inputFormat])

  const handleGenerate = useCallback(async () => {
    setGenerateError(null); setOutput(null); setIsGenerating(true)
    try {
      const bundles = await editablesToBundles(tracks)
      const res = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bundles, outputFormat,
          options: { society, version: cwrVersion, sender_name: senderName, sender_id: senderId, batch_number: 1 }
        })
      })
      const data = await res.json()
      if (!res.ok) { setGenerateError(data.error ?? 'Generation failed'); return }
      setOutput(data.output)
    } catch (e) { setGenerateError(e instanceof Error ? e.message : 'Network error') }
    finally { setIsGenerating(false) }
  }, [tracks, outputFormat, society, cwrVersion, senderName, senderId])

  const download = useCallback(() => {
    if (!output) return
    const ext = outputFormat === 'cwr' ? 'cwr' : outputFormat === 'ddex' ? 'xml' : 'json'
    const blob = new Blob([output], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: `${(tracks[0]?.title || 'output').replace(/\s+/g, '_')}.${ext}` }).click()
    URL.revokeObjectURL(url)
  }, [output, outputFormat, tracks])

  const ct = tracks[selectedTrack]
  const setTrack = (u: Partial<EditableTrack>) => setTracks(p => p.map((t, i) => i === selectedTrack ? { ...t, ...u } : t))
  const setWriter = (wi: number, u: Partial<EditableWriter>) => setTrack({ writers: ct.writers.map((w, i) => i === wi ? { ...w, ...u } : w) })
  const setPub = (pi: number, u: Partial<EditablePublisher>) => setTrack({ publishers: ct.publishers.map((p, i) => i === pi ? { ...p, ...u } : p) })
  const addWriter = () => setTrack({ writers: [...ct.writers, { id: crypto.randomUUID(), name: '', ipi: '', role: 'C', prShare: '', pro: '' }] })
  const removeWriter = (i: number) => setTrack({ writers: ct.writers.filter((_, j) => j !== i) })
  const addPublisher = () => setTrack({ publishers: [...ct.publishers, { id: crypto.randomUUID(), name: '', ipi: '', share: '', pro: '' }] })
  const removePublisher = (i: number) => setTrack({ publishers: ct.publishers.filter((_, j) => j !== i) })

  return (
    <div className="h-screen flex flex-col font-sans">
      <header className="bg-zinc-900 text-white px-5 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Metadata Pipeline <span className="text-zinc-500 font-normal text-sm">The Psyence Lab</span></h1>
          <p className="text-xs text-zinc-500">CIP-60 · CWR · DDEX — bidirectional</p>
        </div>
        <span className="text-xs font-mono text-zinc-600 border border-zinc-700 rounded px-2 py-0.5">v0.2</span>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Left panel */}
        <div className="w-1/2 border-r border-zinc-200 overflow-y-auto">
          <div className="p-4 border-b border-zinc-100">
            <div className="flex items-center justify-between mb-2">
              <SecHead>Input</SecHead>
              <button onClick={() => setRawInput(EXAMPLES[inputFormat])} className="text-xs text-blue-500 hover:text-blue-700">Load example</button>
            </div>
            <div className="flex gap-0 border-b border-zinc-100 mb-3 text-amber-100">
              {(['cip60', 'cwr', 'ddex'] as InputFormat[]).map(f => (
                <Tab key={f} active={inputFormat === f} onClick={() => { setInputFormat(f); setRawInput('') }}>
                  {f.toUpperCase()}
                </Tab>
              ))}
            </div>
            <textarea value={rawInput} onChange={e => setRawInput(e.target.value)}
              placeholder={inputFormat === 'cip60' ? '{ "721": { ... } }' : inputFormat === 'cwr' ? 'HDR...\nNWR...' : '<MusicalWorkNotificationMessage>'}
              className="w-full h-48 font-mono text-xs p-3 border border-zinc-200 rounded resize-none outline-none focus:ring-2 focus:ring-blue-300 text-blue-600" spellCheck={false} />
            {parseError && <p className="mt-2 text-xs text-red-600 font-mono bg-red-50 border border-red-200 rounded p-2">{parseError}</p>}
            <button onClick={handleParse} disabled={!rawInput.trim() || isParsing}
              className="mt-3 w-full py-2 bg-zinc-900 text-white text-sm font-semibold rounded hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {isParsing ? 'Parsing…' : 'Parse →'}
            </button>
          </div>

          {tracks.length > 0 && (
            <div className="p-4">
              {parseWarnings.length > 0 && (
                <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded space-y-0.5">
                  {parseWarnings.map((w, i) => <p key={i} className="text-xs text-amber-700">&#9888; {w}</p>)}
                </div>
              )}
              {tracks.length > 1 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {tracks.map((t, i) => (
                    <button key={t.workId} onClick={() => setSelectedTrack(i)}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${selectedTrack === i ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-500 hover:border-zinc-400'}`}>
                      #{i + 1} {t.title.slice(0, 18) || '(untitled)'}
                    </button>
                  ))}
                </div>
              )}
              {ct && (
                <div className="space-y-5">
                  <div>
                    <SecHead>Work · track {selectedTrack + 1}/{tracks.length}</SecHead>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2"><FieldInput label="Title" value={ct.title} onChange={v => setTrack({ title: v })} warn="required" /></div>
                      <FieldInput label="ISWC" value={ct.iswc} onChange={v => setTrack({ iswc: v })} warn="info" mono placeholder="T-XXXXXXXXX-C" />
                      <FieldInput label="ISRC" value={ct.isrc} onChange={v => setTrack({ isrc: v })} warn="info" mono placeholder="CCXXXYYNNNNN" />
                      <FieldInput label="Artist / Performer" value={ct.artistName} onChange={v => setTrack({ artistName: v })} warn="info" />
                      <FieldInput label="Duration (HHMMSS)" value={ct.duration} onChange={v => setTrack({ duration: v })} mono placeholder="000412" />
                      <TerritoryInput
                        mode={ct.territoryMode} codes={ct.territoryCodes} specified={ct.territorySpecified}
                        onChange={u => setTrack({
                          territoryMode: u.mode ?? ct.territoryMode,
                          territoryCodes: u.codes ?? ct.territoryCodes,
                          territorySpecified: true,
                        })}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <SecHead>{ct.writers.length === 0 ? 'Writers ⚠' : 'Writers'}</SecHead>
                      <button onClick={addWriter} className="text-xs text-blue-500 hover:text-blue-700">+ Add</button>
                    </div>
                    {ct.writers.length === 0 && <p className="text-xs text-amber-600 mb-2">No writers — SWR records will be omitted.</p>}
                    <div className="space-y-2">
                      {ct.writers.map((w, wi) => (
                        <div key={w.id} className="border border-zinc-100 rounded p-2 grid grid-cols-6 gap-1.5">
                          <div className="col-span-2"><FieldInput label="Name" value={w.name} onChange={v => setWriter(wi, { name: v })} warn="required" /></div>
                          <div>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-xs font-medium text-zinc-400">Role</span>
                              <select value={w.role} onChange={e => setWriter(wi, { role: e.target.value })} className="text-xs border border-zinc-200 rounded px-1.5 py-1.5 outline-none bg-neutral-200">
                                {WRITER_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            </label>
                          </div>
                          <FieldInput label="IPI" value={w.ipi} onChange={v => setWriter(wi, { ipi: v })} warn="info" mono placeholder="00000000000" />
                          <FieldInput label="Share %" value={w.prShare} onChange={v => setWriter(wi, { prShare: v })} warn="required" mono />
                          <div className="flex flex-col gap-0.5">
                            <label className="flex flex-col gap-0.5">
                              <span className="text-xs font-medium text-zinc-400">PRO</span>
                              <select value={w.pro} onChange={e => setWriter(wi, { pro: e.target.value })} className="text-xs border border-zinc-200 rounded px-1.5 py-1.5 outline-none bg-white">
                                {PROS.map(p => <option key={p} value={p}>{p || '—'}</option>)}
                              </select>
                            </label>
                            <button onClick={() => removeWriter(wi)} className="text-xs text-red-400 hover:text-red-600 text-right">✕ remove</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <SecHead>Publishers</SecHead>
                      <button onClick={addPublisher} className="text-xs text-blue-500 hover:text-blue-700">+ Add</button>
                    </div>
                    <div className="space-y-2">
                      {ct.publishers.map((p, pi) => (
                        <div key={p.id} className="border border-zinc-100 rounded p-2 grid grid-cols-5 gap-1.5">
                          <div className="col-span-2"><FieldInput label="Name" value={p.name} onChange={v => setPub(pi, { name: v })} warn="required" /></div>
                          <FieldInput label="IPI" value={p.ipi} onChange={v => setPub(pi, { ipi: v })} warn="info" mono placeholder="00000000000" />
                          <FieldInput label="Share %" value={p.share} onChange={v => setPub(pi, { share: v })} warn="required" mono />
                          <div className="flex flex-col gap-0.5">
                            <label className="flex flex-col gap-0.5">
                              <span className="text-xs font-medium text-zinc-400">PRO</span>
                              <select value={p.pro} onChange={e => setPub(pi, { pro: e.target.value })} className="text-xs border border-zinc-200 rounded px-1.5 py-1.5 outline-none bg-white">
                                {PROS.map(s => <option key={s} value={s}>{s || '—'}</option>)}
                              </select>
                            </label>
                            <button onClick={() => removePublisher(pi)} className="text-xs text-red-400 hover:text-red-600 text-right">✕ remove</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="w-1/2 flex flex-col min-h-0">
          <div className="p-4 border-b border-zinc-100 shrink-0">
            <SecHead>Output</SecHead>
            <div className="flex gap-0 border-b border-zinc-100 mb-3">
              {(['cwr', 'ddex', 'cip60'] as OutputFormat[]).map(f => (
                <Tab key={f} active={outputFormat === f} onClick={() => { setOutputFormat(f); setOutput(null) }}>
                  {f === 'cip60' ? 'CIP-60' : f.toUpperCase()}
                </Tab>
              ))}
            </div>
            {(outputFormat === 'cwr' || outputFormat === 'ddex') && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-zinc-400">{outputFormat === 'ddex' ? 'Recipient' : 'Society'}</span>
                  <select value={society} onChange={e => setSociety(e.target.value as Society)} className="text-xs border border-zinc-200 rounded px-2 py-1.5 outline-none bg-neutral-400">
                    {SOCIETIES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
                {outputFormat === 'cwr' && (
                  <label className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-zinc-400">CWR Version</span>
                    <select value={cwrVersion} onChange={e => setCwrVersion(e.target.value as '2.1' | '2.2')} className="text-xs border border-zinc-200 rounded text-white px-2 py-1.5 outline-none bg-neutral-400">
                      <option value="2.1">2.1</option><option value="2.2">2.2</option>
                    </select>
                  </label>
                )}
                <FieldInput label="Sender Name" value={senderName} onChange={setSenderName} />
                <FieldInput label="Sender ID" value={senderId} onChange={setSenderId} mono />
              </div>
            )}
            {outputFormat === 'cip60' && <p className="text-xs text-zinc-400 mb-3">Reconstructs CIP-60 v3 JSON from the canonical model.</p>}
            {generateError && <p className="mb-2 text-xs text-red-600 font-mono bg-red-50 border border-red-200 rounded p-2">{generateError}</p>}
            <button onClick={handleGenerate} disabled={tracks.length === 0 || isGenerating}
              className="w-full py-2 bg-zinc-900 text-white text-sm font-semibold rounded hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {isGenerating ? 'Generating…' : `Generate ${outputFormat === 'cip60' ? 'CIP-60' : outputFormat.toUpperCase()}`}
            </button>
          </div>

          {output ? (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-100 shrink-0">
                <span className="text-xs text-zinc-400 font-mono">{tracks.length} work{tracks.length !== 1 ? 's' : ''} · {outputFormat === 'cip60' ? 'CIP-60' : outputFormat.toUpperCase()}</span>
                <div className="flex gap-2">
                  <button onClick={() => navigator.clipboard.writeText(output)} className="text-xs border border-zinc-200 rounded px-2 py-1 hover:border-zinc-400 text-zinc-600">Copy</button>
                  <button onClick={download} className="text-xs bg-zinc-900 text-white rounded px-2 py-1 hover:bg-zinc-700">Download</button>
                </div>
              </div>
              <pre className={`flex-1 overflow-auto text-xs p-4 font-mono whitespace-pre min-h-0 ${outputFormat === 'cwr' ? 'bg-zinc-950 text-green-400' : 'bg-zinc-50 text-zinc-800'}`}>{output}</pre>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-300 gap-2 select-none">
              <span className="text-3xl">→</span>
              <span className="text-sm">Parse input, then generate</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
