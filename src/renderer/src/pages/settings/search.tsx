import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search, X, CornerDownLeft, ArrowUp, ArrowDown, FolderOpen, ChevronRight } from 'lucide-react'
import { cx } from '@/components/ui'

export interface SettingEntry { id: string; section: string; title: string; desc?: string; keywords?: string }
export interface SectionInfo { k: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }

/** Every setting, where it lives, and words people might search for. Rows carry the same ids. */
export const SETTINGS_INDEX: SettingEntry[] = [
  { id: 'theme', section: 'appearance', title: 'Theme', desc: 'Dark, Light or Sakura.', keywords: 'colour color dark mode light mode pink cherry blossom look' },
  { id: 'accent', section: 'appearance', title: 'Accent colour', desc: 'Gold, blue, mint or rose highlights.', keywords: 'color highlight tint' },
  { id: 'uiScale', section: 'appearance', title: 'Interface size', desc: 'Scale the whole interface.', keywords: 'zoom bigger smaller text size scaling' },
  { id: 'particles', section: 'appearance', title: 'Floating notes', desc: 'Notes and rests drifting behind the app.', keywords: 'background particles petals animation performance' },
  { id: 'particleSpeed', section: 'appearance', title: 'Floating notes speed', desc: 'How fast the background notes drift.', keywords: 'background particles animation slow fast' },
  { id: 'particleSize', section: 'appearance', title: 'Floating notes size', desc: 'How big the background notes are.', keywords: 'background particles scale' },
  { id: 'sidebarNames', section: 'appearance', title: 'Sidebar names', desc: 'Show page names and open pieces, or icons only.', keywords: 'sidebar collapse expand sessions navigation' },
  { id: 'reduceMotion', section: 'appearance', title: 'Reduce motion', desc: 'Turn off animations and keep the background still.', keywords: 'animation accessibility motion sickness' },
  { id: 'outputDevice', section: 'audio', title: 'Output device', desc: 'Where playback, previews and the metronome are heard.', keywords: 'speakers headphones interface sound card' },
  { id: 'masterVolume', section: 'audio', title: 'Master volume', keywords: 'loudness level gain' },
  { id: 'sampleRate', section: 'audio', title: 'Sample rate', desc: 'Match your audio interface.', keywords: 'khz 44.1 48 96 audio quality' },
  { id: 'bufferSize', section: 'audio', title: 'Buffer size', desc: 'Smaller feels tighter, larger avoids crackles.', keywords: 'latency crackle glitch dropout' },
  { id: 'latency', section: 'audio', title: 'Reported latency', keywords: 'delay lag ms' },
  { id: 'testSound', section: 'audio', title: 'Test sound', desc: 'Play a chord to check your speakers.', keywords: 'check speakers' },
  { id: 'midiInput', section: 'midi', title: 'MIDI input device', desc: 'USB or Bluetooth keyboard.', keywords: 'keyboard controller usb piano' },
  { id: 'midiChannel', section: 'midi', title: 'MIDI input channel', keywords: 'channel split layer' },
  { id: 'midiPlays', section: 'midi', title: 'What the MIDI keyboard plays', desc: 'Which part the keyboard sounds like.', keywords: 'audition track instrument' },
  { id: 'midiNotes', section: 'midi', title: 'Notes you play', desc: 'Write them into the score or play only.', keywords: 'record input step entry' },
  { id: 'countIn', section: 'playback', title: 'Count-in', desc: 'Clicks before playback starts.', keywords: 'metronome pre-roll lead in' },
  { id: 'metronome', section: 'playback', title: 'Metronome volume', keywords: 'click tick' },
  { id: 'autoScroll', section: 'playback', title: 'Follow playback', desc: 'Scroll the score to keep the cursor in view.', keywords: 'auto scroll page turn' },
  { id: 'soloFollows', section: 'playback', title: 'Solo follows track selection', keywords: 'mute solo part' },
  { id: 'cursorStyle', section: 'playback', title: 'Playback cursor', desc: 'Band or thin line.', keywords: 'playhead marker' },
  { id: 'highlightNotes', section: 'playback', title: 'Highlight playing notes', keywords: 'light up colour follow' },
  { id: 'effectTails', section: 'playback', title: 'Effect tails after stopping', desc: 'Let reverb and delay ring out.', keywords: 'reverb delay stop' },
  { id: 'deleteMode', section: 'editor', title: 'Deleting a note', desc: 'Leave a rest, or shift the following notes back.', keywords: 'delete remove rest shift ripple' },
  { id: 'inputMode', section: 'editor', title: 'Piano, fretboard & MIDI keyboard', desc: 'Write notes or play only.', keywords: 'input entry write' },
  { id: 'notePreview', section: 'editor', title: 'Hear notes while writing', keywords: 'preview sound audition' },
  { id: 'grandStaff', section: 'editor', title: 'Two staves for keyboard instruments', keywords: 'piano grand staff treble bass clef' },
  { id: 'defaultView', section: 'editor', title: 'Default notation view', desc: 'Sheet, Tab or Both.', keywords: 'tablature staff' },
  { id: 'chords', section: 'editor', title: 'Chord mode', keywords: 'chord stack shortcut' },
  { id: 'customSounds', section: 'sounds', title: 'Your instruments', desc: 'Make an instrument from your own samples.', keywords: 'samples custom sound wav import' },
  { id: 'vstInstruments', section: 'sounds', title: 'VST3 instruments', desc: 'Use an installed VST3 instrument as a sound.', keywords: 'kontakt plugin virtual instrument vsti' },
  { id: 'builtinSounds', section: 'sounds', title: 'Built-in instruments', desc: 'Download or check the bundled sounds.', keywords: 'samples download piano guitar soundfont' },
  { id: 'vstFolders', section: 'plugins', title: 'Plug-in folders', desc: 'Where Aurel looks for VST3 plug-ins.', keywords: 'vst3 scan path directory' },
  { id: 'vstRescan', section: 'plugins', title: 'Rescan plug-ins', keywords: 'vst3 refresh scan' },
  { id: 'defaultEffects', section: 'effects', title: 'Default effects', desc: 'Each built-in instrument’s starting effects chain.', keywords: 'reverb eq compressor chain fx' },
  { id: 'quality', section: 'transcribe', title: 'Transcription quality', desc: 'Fast, Balanced or Best.', keywords: 'ai speed accuracy models engine strength' },
  { id: 'sensitivity', section: 'transcribe', title: 'Note sensitivity', desc: 'Fewer, cleaner notes or catch quiet notes too.', keywords: 'strength threshold ghost notes extra notes missing notes slider' },
  { id: 'rhythmDetail', section: 'transcribe', title: 'Rhythm detail', desc: 'Simple, Standard or Detailed rhythms.', keywords: 'quantize quantization grid eighths sixteenths 32nds' },
  { id: 'fillGaps', section: 'transcribe', title: 'Hold notes over short gaps', desc: 'Fewer tiny rests.', keywords: 'rests legato quantize' },
  { id: 'straightSwing', section: 'transcribe', title: 'Write swing as straight eighths', keywords: 'shuffle triplet feel jazz blues' },
  { id: 'followTempo', section: 'transcribe', title: 'Tempo', desc: 'Follow the recording or one steady tempo.', keywords: 'bpm tempo map drift live band' },
  { id: 'chordLimit', section: 'transcribe', title: 'Notes per guitar chord', keywords: 'polyphony strings voicing' },
  { id: 'drumModel', section: 'transcribe', title: 'Drum transcription', desc: 'Advanced (ADTOF) or Basic.', keywords: 'drums kick snare hihat toms cymbals' },
  { id: 'lyricWords', section: 'transcribe', title: 'Recognise the singer’s words', keywords: 'lyrics whisper vocals text' },
  { id: 'vocalMelody', section: 'transcribe', title: 'Write the singer’s melody', desc: 'Vocal notes on the Singer staff.', keywords: 'vocals melody notes singing' },
  { id: 'lyricsModel', section: 'transcribe', title: 'Word recognition model', desc: 'Base is faster, Small is more accurate.', keywords: 'whisper lyrics accuracy' },
  { id: 'lyricsLanguage', section: 'transcribe', title: 'Lyrics language', keywords: 'english spanish language whisper' },
  { id: 'applyNow', section: 'transcribe', title: 'Apply to the open song', desc: 'Rewrite the open transcription with these settings.', keywords: 're-apply requantize redo' },
  { id: 'openAfterImport', section: 'transcribe', title: 'Open new recordings in the studio', keywords: 'import navigate' },
  { id: 'engineInstall', section: 'engine', title: 'AI engine', desc: 'Install or update the transcription engine.', keywords: 'python pytorch install models download gpu' },
  { id: 'device', section: 'engine', title: 'Processing device', desc: 'Auto, CUDA (NVIDIA GPU) or CPU.', keywords: 'gpu nvidia cuda cpu speed' },
  { id: 'separationModel', section: 'engine', title: 'Separation model', desc: 'How the song is split into instruments.', keywords: 'demucs stems split isolate' },
  { id: 'drumSplit', section: 'engine', title: 'Split drums', desc: 'Kick, snare and hi-hat stems.', keywords: 'stems drums' },
  { id: 'pythonPath', section: 'engine', title: 'Custom Python', keywords: 'advanced interpreter path' },
  { id: 'ytdlp', section: 'import', title: 'YouTube importer', desc: 'Check or update yt-dlp.', keywords: 'youtube download yt-dlp link' },
  { id: 'ytdlpPath', section: 'import', title: 'Custom yt-dlp', keywords: 'advanced path' },
  { id: 'duplicates', section: 'import', title: 'Duplicate detection', keywords: 'same song reimport fingerprint' },
  { id: 'exportSampleRate', section: 'export', title: 'Export sample rate', keywords: 'wav khz audio export' },
  { id: 'bitDepth', section: 'export', title: 'Bit depth', keywords: '16 24 32 float wav export' },
  { id: 'channels', section: 'export', title: 'Export channels', desc: 'Stereo or mono.', keywords: 'mono stereo' },
  { id: 'normalize', section: 'export', title: 'Normalize', desc: 'Peak-normalize single-file exports.', keywords: 'loudness level export' },
  { id: 'tail', section: 'export', title: 'Release tail', desc: 'Seconds rendered after the last bar.', keywords: 'ring out reverb end export' },
  { id: 'shortcuts', section: 'shortcuts', title: 'Keyboard shortcuts', keywords: 'keys hotkeys keyboard' },
  { id: 'terms', section: 'legal', title: 'Terms of use & privacy', keywords: 'license privacy legal credits' },
  { id: 'checkUpdates', section: 'about', title: 'Check for updates automatically', keywords: 'update version github release' },
  { id: 'updatesNow', section: 'about', title: 'Check for updates now', keywords: 'update version' },
  { id: 'limits', section: 'about', title: 'What to expect from transcription', keywords: 'accuracy limits about version' }
]

function norm(s: string): string { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') }

/** Every query word must appear somewhere; titles count most, then keywords, then descriptions. */
export function searchSettings(query: string, sections: SectionInfo[]): (SettingEntry & { score: number })[] {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const label = new Map(sections.map((s) => [s.k, s.label]))
  const out: (SettingEntry & { score: number })[] = []
  for (const e of SETTINGS_INDEX) {
    const title = norm(e.title), kw = norm(e.keywords ?? ''), desc = norm(e.desc ?? ''), sec = norm(label.get(e.section) ?? '')
    let score = 0
    let all = true
    for (const w of words) {
      if (title.startsWith(w)) score += 10
      else if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)) score += 7
      else if (title.includes(w)) score += 5
      else if (kw.includes(w)) score += 3
      else if (sec.includes(w)) score += 2
      else if (desc.includes(w)) score += 1
      else { all = false; break }
    }
    if (all) out.push({ ...e, score })
  }
  return out.sort((a, b) => b.score - a.score)
}

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return text
  const n = norm(text)
  const marks = new Array(text.length).fill(false)
  for (const w of words) {
    let i = n.indexOf(w)
    while (i >= 0) { for (let j = i; j < i + w.length; j++) marks[j] = true; i = n.indexOf(w, i + 1) }
  }
  const parts: ReactNode[] = []
  let i = 0
  while (i < text.length) {
    let j = i
    while (j < text.length && marks[j] === marks[i]) j++
    parts.push(marks[i] ? <mark key={i} className="search-mark">{text.slice(i, j)}</mark> : text.slice(i, j))
    i = j
  }
  return parts
}

/** Search box at the top of Settings: results show which page a setting is on; choosing one opens it there. */
export function SettingsSearch({ sections, onOpen }: { sections: SectionInfo[]; onOpen: (e: SettingEntry) => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const results = useMemo(() => searchSettings(q, sections), [q, sections])
  const bySection = useMemo(() => {
    const groups: { section: SectionInfo; items: (SettingEntry & { index: number })[] }[] = []
    results.forEach((r, index) => {
      const section = sections.find((s) => s.k === r.section)!
      let g = groups.find((x) => x.section.k === r.section)
      if (!g) groups.push(g = { section, items: [] })
      g.items.push({ ...r, index })
    })
    return groups
  }, [results, sections])
  // results are shown grouped, so keyboard order follows the groups
  const order = bySection.flatMap((g) => g.items.map((i) => i.index))
  useEffect(() => setActive(0), [q])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'f' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement))) {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active])
  const choose = (e: SettingEntry) => { onOpen(e); setQ(''); setOpen(false); input.current?.blur() }
  const show = open && q.trim().length > 0
  return (
    <div className="relative mb-3">
      <label className={cx('settings-search flex items-center gap-2 h-10 px-3 rounded-xl', show && 'is-open')}>
        <Search size={15} className="shrink-0 text-muted" />
        <input ref={input} value={q} placeholder="Search settings" aria-label="Search settings" role="combobox" aria-expanded={show} aria-controls="settings-results"
          className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-faint"
          onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(order.length - 1, a + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
            else if (e.key === 'Enter' && order.length) { e.preventDefault(); choose(results[order[active]]) }
            else if (e.key === 'Escape') { if (q) setQ(''); else input.current?.blur() }
          }} />
        {q ? <button className="icon-btn !h-6 !w-6" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => setQ('')}><X size={13} /></button>
          : <span className="kbd !text-[10px] shrink-0">Ctrl F</span>}
      </label>
      {show && (
        <div id="settings-results" ref={list} role="listbox" className="settings-results animate-pop-down">
          {results.length ? <>
            <div className="px-3 pt-2.5 pb-1.5 text-[11px] text-faint">{results.length} setting{results.length === 1 ? '' : 's'}</div>
            <div className="stagger-fast">
              {bySection.map((g) => (
                <div key={g.section.k} className="pb-1">
                  <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 label"><g.section.icon size={12} className="text-accent" />{g.section.label}</div>
                  {g.items.map((r) => {
                    const on = order[active] === r.index
                    return (
                      <button key={r.id} role="option" aria-selected={on} data-active={on} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}
                        onMouseEnter={() => setActive(order.indexOf(r.index))}
                        className={cx('search-result w-full text-left px-3 py-2 rounded-lg', on && 'on')}>
                        <div className="flex items-center gap-2">
                          <span className="flex-1 min-w-0 text-[13px] font-medium truncate"><Highlight text={r.title} query={q} /></span>
                          <span className="search-crumb"><FolderOpen size={10} />Settings<ChevronRight size={10} className="opacity-60" />{g.section.label}</span>
                        </div>
                        {r.desc && <div className="text-[11.5px] text-muted truncate mt-0.5"><Highlight text={r.desc} query={q} /></div>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 px-3 py-2 border-t border-line/70 text-[10.5px] text-faint">
              <span className="flex items-center gap-1"><ArrowUp size={11} /><ArrowDown size={11} /> move</span>
              <span className="flex items-center gap-1"><CornerDownLeft size={11} /> open</span>
              <span>Esc clear</span>
            </div>
          </> : (
            <div className="px-4 py-6 text-center">
              <Search size={20} className="mx-auto mb-2 text-faint" />
              <div className="text-[13px]">No settings match “{q.trim()}”</div>
              <div className="text-[11.5px] text-faint mt-1">Try a shorter word, like “tempo”, “drums” or “theme”.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** After opening a setting from search, bring its row into view and make it glow for a moment. */
export function revealSetting(id: string): void {
  let tries = 0
  const find = () => {
    const el = document.querySelector<HTMLElement>(`[data-setting="${id}"]`)
    if (!el) { if (tries++ < 20) requestAnimationFrame(find); return }
    el.scrollIntoView({ block: 'center', behavior: document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth' })
    el.classList.remove('setting-flash')
    void el.offsetWidth
    el.classList.add('setting-flash')
    setTimeout(() => el.classList.remove('setting-flash'), 2200)
    el.querySelector<HTMLElement>('input, button, [role="switch"]')?.focus({ preventScroll: true })
  }
  requestAnimationFrame(find)
}
