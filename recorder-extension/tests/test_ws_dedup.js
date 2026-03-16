import { describe, it, expect, beforeEach } from 'vitest'

function makeState() {
  return { lastLineCount: 0, finalLines: [], appendedTexts: [], interim: '' }
}

function processMessage(data, state) {
  const newLines = []
  if (data.lines && data.lines.length > state.lastLineCount) {
    const incoming = data.lines.slice(state.lastLineCount)
    for (const line of incoming) {
      newLines.push(line)
      state.appendedTexts.push(typeof line === 'string' ? line : line.text)
    }
    state.finalLines = data.lines
    state.lastLineCount = data.lines.length
  }
  state.interim = data.buffer_transcription || data.buffer_diarization || ''
  return newLines
}

describe('WS message deduplication', () => {
  let state
  beforeEach(() => { state = makeState() })

  it('appends all lines from first message', () => {
    const newLines = processMessage({ lines: [{ text: 'Hello' }, { text: 'World' }], buffer_transcription: '' }, state)
    expect(newLines).toHaveLength(2)
    expect(state.lastLineCount).toBe(2)
  })

  it('appends only new lines on second message', () => {
    processMessage({ lines: [{ text: 'Hello' }, { text: 'World' }], buffer_transcription: '' }, state)
    const newLines = processMessage({ lines: [{ text: 'Hello' }, { text: 'World' }, { text: 'Goodbye' }], buffer_transcription: '' }, state)
    expect(newLines).toHaveLength(1)
    expect(newLines[0].text).toBe('Goodbye')
  })

  it('does not append when line count unchanged', () => {
    processMessage({ lines: [{ text: 'Hello' }], buffer_transcription: '' }, state)
    const newLines = processMessage({ lines: [{ text: 'Hello' }], buffer_transcription: 'typing...' }, state)
    expect(newLines).toHaveLength(0)
    expect(state.appendedTexts).toHaveLength(1)
  })

  it('does not append when lines empty', () => {
    const newLines = processMessage({ lines: [], buffer_transcription: '' }, state)
    expect(newLines).toHaveLength(0)
  })

  it('does not append when lines absent', () => {
    const newLines = processMessage({ buffer_transcription: 'hello?' }, state)
    expect(newLines).toHaveLength(0)
  })

  it('tracks interim buffer_transcription', () => {
    processMessage({ lines: [], buffer_transcription: 'speaking...' }, state)
    expect(state.interim).toBe('speaking...')
  })

  it('falls back to buffer_diarization', () => {
    processMessage({ lines: [], buffer_diarization: 'diarizing...' }, state)
    expect(state.interim).toBe('diarizing...')
  })

  it('handles rapid-fire incremental messages', () => {
    const allLines = Array.from({ length: 10 }, (_, i) => ({ text: `Line ${i + 1}` }))
    let totalNew = 0
    for (let i = 1; i <= allLines.length; i++) {
      const newLines = processMessage({ lines: allLines.slice(0, i), buffer_transcription: '' }, state)
      expect(newLines).toHaveLength(1)
      totalNew += newLines.length
    }
    expect(totalNew).toBe(10)
  })
})
