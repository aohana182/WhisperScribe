import { describe, it, expect } from 'vitest'

// --- renderLines logic (extracted for testing) ---
// Mirrors recorder.js: filter silence markers, extract text, join with newline
function renderLines(lines) {
  return (lines || [])
    .filter(l => l.speaker !== -2)
    .map(l => typeof l === 'string' ? l : (l.text || ''))
    .filter(t => t.trim())
    .join('\n')
}

// --- processMessage logic (extracted for testing) ---
// Mirrors recorder.js ws.onmessage for non-typed messages
function processMessage(data, state) {
  if (data.type) return { handled: data.type }
  if (data.lines) {
    state.finalLines = data.lines          // full replace
    state.rendered   = renderLines(data.lines)
  }
  state.interim = data.buffer_transcription || data.buffer_diarization || ''
  return { handled: null }
}

describe('renderLines', () => {
  it('joins text lines with newlines', () => {
    expect(renderLines([{ text: 'Hello' }, { text: 'World' }])).toBe('Hello\nWorld')
  })

  it('filters silence markers (speaker === -2)', () => {
    const lines = [{ text: 'Hello', speaker: 1 }, { speaker: -2, text: '[silence]' }, { text: 'World', speaker: 1 }]
    expect(renderLines(lines)).toBe('Hello\nWorld')
  })

  it('filters blank/whitespace lines', () => {
    expect(renderLines([{ text: 'Good' }, { text: '   ' }, { text: 'Line' }])).toBe('Good\nLine')
  })

  it('handles string lines', () => {
    expect(renderLines(['foo', 'bar'])).toBe('foo\nbar')
  })

  it('handles empty array', () => {
    expect(renderLines([])).toBe('')
  })

  it('handles undefined', () => {
    expect(renderLines(undefined)).toBe('')
  })

  it('handles lines with missing text field', () => {
    expect(renderLines([{ speaker: 1 }, { text: 'Hello' }])).toBe('Hello')
  })
})

describe('processMessage — full replace semantics', () => {
  it('replaces finalLines on every message', () => {
    const state = { finalLines: [], rendered: '', interim: '' }
    processMessage({ lines: [{ text: 'Hello' }, { text: 'World' }] }, state)
    expect(state.finalLines).toHaveLength(2)

    // Second message with revised first line — old approach would have missed this
    processMessage({ lines: [{ text: 'Hello revised' }, { text: 'World' }, { text: 'Goodbye' }] }, state)
    expect(state.finalLines).toHaveLength(3)
    expect(state.finalLines[0].text).toBe('Hello revised')
  })

  it('replaces even when line count shrinks', () => {
    const state = { finalLines: [], rendered: '', interim: '' }
    processMessage({ lines: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] }, state)
    processMessage({ lines: [{ text: 'A merged B C' }] }, state)
    expect(state.finalLines).toHaveLength(1)
    expect(state.finalLines[0].text).toBe('A merged B C')
  })

  it('renders correct text after replace', () => {
    const state = { finalLines: [], rendered: '', interim: '' }
    processMessage({ lines: [{ text: 'First' }, { text: 'Second' }] }, state)
    expect(state.rendered).toBe('First\nSecond')

    processMessage({ lines: [{ text: 'Updated first' }, { text: 'Second' }] }, state)
    expect(state.rendered).toBe('Updated first\nSecond')
  })

  it('tracks interim buffer_transcription', () => {
    const state = { finalLines: [], rendered: '', interim: '' }
    processMessage({ lines: [], buffer_transcription: 'speaking...' }, state)
    expect(state.interim).toBe('speaking...')
  })

  it('falls back to buffer_diarization for interim', () => {
    const state = { finalLines: [], rendered: '', interim: '' }
    processMessage({ lines: [], buffer_diarization: 'diarizing...' }, state)
    expect(state.interim).toBe('diarizing...')
  })

  it('clears interim when absent', () => {
    const state = { finalLines: [], rendered: '', interim: 'old' }
    processMessage({ lines: [] }, state)
    expect(state.interim).toBe('')
  })
})

describe('processMessage — typed message dispatch', () => {
  it('returns handled=config for config message and does not touch state', () => {
    const state = { finalLines: [{ text: 'existing' }], rendered: '', interim: '' }
    const result = processMessage({ type: 'config', useAudioWorklet: true }, state)
    expect(result.handled).toBe('config')
    expect(state.finalLines).toHaveLength(1) // untouched
  })

  it('returns handled=ready_to_stop for ready_to_stop', () => {
    const state = { finalLines: [], rendered: '', interim: '' }
    const result = processMessage({ type: 'ready_to_stop' }, state)
    expect(result.handled).toBe('ready_to_stop')
  })

  it('returns handled=diff for unknown typed messages', () => {
    const state = { finalLines: [], rendered: '', interim: '' }
    const result = processMessage({ type: 'diff', payload: {} }, state)
    expect(result.handled).toBe('diff')
  })

  it('does not touch state for any typed message', () => {
    const state = { finalLines: [{ text: 'keep me' }], rendered: 'keep me', interim: 'keep' }
    processMessage({ type: 'config' }, state)
    processMessage({ type: 'ready_to_stop' }, state)
    processMessage({ type: 'snapshot' }, state)
    expect(state.finalLines).toHaveLength(1)
    expect(state.interim).toBe('keep')
  })
})
