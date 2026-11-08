import type { NoteEvent, Part, Score } from '@shared/types'
import { PPQ } from '@shared/types'
import { durInfo, tripletBase, INSTRUMENTS, isFretted, measureTicks, spell, drumPiece, WHOLE } from './theory'
import { measureCount } from './score'
import { assignTab } from './tab'
import type { RangeOpts } from './midi'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const TYPE: Record<number, string> = { [WHOLE]: 'whole', [WHOLE / 2]: 'half', [PPQ]: 'quarter', [PPQ / 2]: 'eighth', [PPQ / 4]: '16th', [PPQ / 8]: '32nd' }

const KIND: Record<string, string> = { '': 'major', m: 'minor', '5': 'power', '7': 'dominant', maj7: 'major-seventh', m7: 'minor-seventh', sus4: 'suspended-fourth', sus2: 'suspended-second', dim: 'diminished' }

/** A chord symbol (C, F#m, Bb7, G/B …) as a MusicXML <harmony>. */
export function harmonyXml(name: string, offset = 0): string {
  const m = name.match(/^([A-G])([#b]?)(maj7|m7|sus4|sus2|dim|m|7|5)?(?:\/([A-G])([#b]?))?$/)
  if (!m) return ''
  const alter = (a: string) => (a === '#' ? '<root-alter>1</root-alter>' : a === 'b' ? '<root-alter>-1</root-alter>' : '')
  const bass = m[4] ? `<bass><bass-step>${m[4]}</bass-step>${(m[5] === '#' ? '<bass-alter>1</bass-alter>' : m[5] === 'b' ? '<bass-alter>-1</bass-alter>' : '')}</bass>` : ''
  return `<harmony><root><root-step>${m[1]}</root-step>${alter(m[2])}</root><kind text="${esc(m[3] ?? '')}">${KIND[m[3] ?? ''] ?? 'major'}</kind>${bass}${offset ? `<offset>${offset}</offset>` : ''}</harmony>`
}

function clefXml(p: Part): string {
  switch (p.clef) {
    case 'bass': return p.kind === 'bass' ? '<clef><sign>F</sign><line>4</line><clef-octave-change>-1</clef-octave-change></clef>' : '<clef><sign>F</sign><line>4</line></clef>'
    case 'treble8': return '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>'
    case 'percussion': return '<clef><sign>percussion</sign></clef>'
    default: return '<clef><sign>G</sign><line>2</line></clef>'
  }
}

export function scoreToMusicXml(score: Score, o: RangeOpts = {}): string {
  const mt = measureTicks(score.timeSig)
  const from = o.from ?? 0
  const to = o.to ?? measureCount(score) - 1
  const parts = score.parts.filter((p) => !o.partIds || o.partIds.includes(p.id))
  const pid = (i: number) => `P${i + 1}`
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
  lines.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">')
  lines.push('<score-partwise version="4.0">')
  lines.push(`<work><work-title>${esc(score.title)}</work-title></work>`)
  lines.push(`<identification>${score.composer ? `<creator type="composer">${esc(score.composer)}</creator>` : ''}<encoding><software>Aurel</software><encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding></identification>`)
  lines.push('<part-list>')
  let openGroup: string | undefined
  let groupNo = 0
  parts.forEach((p, i) => {
    if (p.group && p.group !== openGroup) {
      if (openGroup) lines.push(`<part-group type="stop" number="${groupNo}"/>`)
      groupNo++
      lines.push(`<part-group type="start" number="${groupNo}"><group-symbol>brace</group-symbol><group-barline>yes</group-barline></part-group>`)
      openGroup = p.group
    } else if (!p.group && openGroup) { lines.push(`<part-group type="stop" number="${groupNo}"/>`); openGroup = undefined }
    lines.push(`<score-part id="${pid(i)}"><part-name>${esc(p.name)}</part-name>`)
    if (p.kind === 'drums') {
      const used = new Set<number>()
      p.measures.forEach((m) => m.events.forEach((e) => e.notes.forEach((n) => used.add(drumPiece(n.pitch).midi))))
      for (const midi of used) lines.push(`<score-instrument id="${pid(i)}-I${midi}"><instrument-name>${esc(drumPiece(midi).label)}</instrument-name></score-instrument>`)
      for (const midi of used) lines.push(`<midi-instrument id="${pid(i)}-I${midi}"><midi-channel>10</midi-channel><midi-unpitched>${midi + 1}</midi-unpitched></midi-instrument>`)
    } else {
      lines.push(`<score-instrument id="${pid(i)}-I1"><instrument-name>${esc(INSTRUMENTS[p.kind].label)}</instrument-name></score-instrument>`)
      lines.push(`<midi-instrument id="${pid(i)}-I1"><midi-channel>${(i % 15) + (i % 15 >= 9 ? 2 : 1)}</midi-channel><midi-program>${INSTRUMENTS[p.kind].program + 1}</midi-program><volume>${Math.round(p.volume * 100)}</volume><pan>${Math.round(p.pan * 90)}</pan></midi-instrument>`)
    }
    lines.push('</score-part>')
  })
  if (openGroup) lines.push(`<part-group type="stop" number="${groupNo}"/>`)
  lines.push('</part-list>')

  parts.forEach((p, i) => {
    const tab = isFretted(p.kind) ? assignTab(p) : null
    lines.push(`<part id="${pid(i)}">`)
    let pendingStops: string[] = []
    for (let mi = from; mi <= to; mi++) {
      const m = p.measures[mi]
      lines.push(`<measure number="${mi - from + 1}">`)
      if (mi === from) {
        let staffDetails = ''
        if (p.tuning && isFretted(p.kind)) {
          staffDetails = `<staff-details><staff-lines>5</staff-lines>${p.tuning
            .map((t, si) => { const s = spell(t, 0); return `<staff-tuning line="${p.tuning!.length - si}"><tuning-step>${s.step}</tuning-step>${s.alter ? `<tuning-alter>${s.alter}</tuning-alter>` : ''}<tuning-octave>${s.octave}</tuning-octave></staff-tuning>` })
            .join('')}${p.capo ? `<capo>${p.capo}</capo>` : ''}</staff-details>`
        }
        lines.push(`<attributes><divisions>${PPQ}</divisions><key><fifths>${p.kind === 'drums' ? 0 : score.keyFifths}</fifths></key><time><beats>${score.timeSig.num}</beats><beat-type>${score.timeSig.den}</beat-type></time>${clefXml(p)}${staffDetails}</attributes>`)
      }
      const bpm = mi === from ? (score.tempoChanges ?? []).filter((c) => c.measure <= mi).pop()?.bpm ?? score.tempo : score.tempoChanges?.find((c) => c.measure === mi)?.bpm
      if (bpm && i === 0) lines.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`)
      const wholeRest = m.events.length === 1 && !!m.events[0].rest && m.events[0].dur === mt
      const chords = i === 0 ? (score.chords ?? []).filter((c) => c.measure === mi) : []
      for (const e of m.events) {
        for (const c of chords) if (c.tick >= e.start && c.tick < e.start + e.dur) lines.push(harmonyXml(c.name, c.tick - e.start))
        if (e.dynamic) lines.push(`<direction placement="below"><direction-type><dynamics><${e.dynamic}/></dynamics></direction-type></direction>`)
        if (e.tech?.includes('palmMute')) lines.push('<direction placement="above"><direction-type><words>P.M.</words></direction-type></direction>')
        const stops = pendingStops
        pendingStops = []
        lines.push(...eventXml(p, e, wholeRest, tab?.get(e.id), stops, (s) => pendingStops.push(s), pid(i), score.keyFifths))
      }
      lines.push('</measure>')
    }
    lines.push('</part>')
  })
  lines.push('</score-partwise>')
  return lines.join('\n')
}

function eventXml(p: Part, e: NoteEvent, wholeRest: boolean, tab: ({ string: number; fret: number } | null)[] | undefined, stops: string[], queueStop: (s: string) => void, pid: string, fifths: number): string[] {
  const triplet = !durInfo(e.dur) ? tripletBase(e.dur) : null
  const info = durInfo(e.dur) ?? { base: triplet ?? e.dur, dotted: false }
  const type = wholeRest ? '' : `<type>${TYPE[info.base] ?? 'quarter'}</type>${info.dotted ? '<dot/>' : ''}${triplet ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : ''}`
  if (e.rest || !e.notes.length) return [`<note><rest${wholeRest ? ' measure="yes"' : ''}/><duration>${e.dur}</duration><voice>1</voice>${type}</note>`]
  const out: string[] = []
  const ordered = [...e.notes].sort((a, b) => a.pitch - b.pitch)
  ordered.forEach((n, k) => {
    const chord = k > 0 ? '<chord/>' : ''
    let pitchXml: string
    let extra = ''
    if (p.kind === 'drums') {
      const piece = drumPiece(n.pitch)
      const [step, oct] = piece.key.split('/')
      pitchXml = `<unpitched><display-step>${step.toUpperCase()}</display-step><display-octave>${oct}</display-octave></unpitched>`
      extra = piece.head !== 'normal' ? '<notehead>x</notehead>' : ''
      extra = `<instrument id="${pid}-I${piece.midi}"/>${extra}`
    } else {
      const sk = spell(n.pitch, fifths)
      pitchXml = `<pitch><step>${sk.step}</step>${sk.alter ? `<alter>${sk.alter}</alter>` : ''}<octave>${sk.octave}</octave></pitch>`
    }
    const notations: string[] = []
    const technical: string[] = []
    if (e.tie) notations.push('<tied type="start"/>')
    const arts = (e.art ?? []).filter((a) => a !== 'fermata').map((a) => (a === 'marcato' ? '<strong-accent/>' : `<${a}/>`))
    if (arts.length) notations.push(`<articulations>${arts.join('')}</articulations>`)
    if (e.art?.includes('fermata')) notations.push('<fermata/>')
    if (e.arpeggio && ordered.length > 1 && p.kind !== 'drums') notations.push(`<arpeggiate direction="${e.arpeggio.direction}"/>`)
    if (tab) {
      const pos = tab[e.notes.indexOf(n)]
      if (pos) technical.push(`<string>${pos.string}</string><fret>${pos.fret}</fret>`)
    }
    if (k === 0) {
      for (const s of stops) (s.startsWith('<slide') ? notations : technical).push(s)
      if (e.tech?.includes('hammer')) { technical.push('<hammer-on type="start">H</hammer-on>'); queueStop('<hammer-on type="stop"/>') }
      if (e.tech?.includes('slide')) { notations.push('<slide type="start" line-type="solid"/>'); queueStop('<slide type="stop"/>') }
    }
    if (e.tech?.includes('bend')) technical.push(`<bend><bend-alter>${e.bend ?? 2}</bend-alter></bend>`)
    if (e.tech?.includes('harmonic')) technical.push('<harmonic><natural/></harmonic>')
    if (e.tech?.includes('vibrato')) technical.push('<other-technical>vibrato</other-technical>')
    if (technical.length) notations.push(`<technical>${technical.join('')}</technical>`)
    const instrument = extra.replace('<notehead>x</notehead>', '')
    const notehead = extra.includes('notehead') ? '<notehead>x</notehead>' : ''
    out.push(`<note>${chord}${pitchXml}<duration>${e.dur}</duration>${e.tie ? '<tie type="start"/>' : ''}${instrument}<voice>1</voice>${type}${notehead}${notations.length ? `<notations>${notations.join('')}</notations>` : ''}</note>`)
  })
  return out
}

export const exportMusicXml = scoreToMusicXml
