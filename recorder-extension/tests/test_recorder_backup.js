import { describe, it, expect } from 'vitest'

function buildBackupPayload(title, startedAt, finalLines) {
  return {
    title,
    startedAt,
    lines: finalLines.map(l => (typeof l === 'string' ? l : l.text)),
  }
}

function buildSavePayload(title, startedAt, endedAt, finalLines) {
  const text = finalLines
    .map(l => (typeof l === 'string' ? l : l.text || ''))
    .filter(t => t.trim())
    .join('\n')
  return { title, started_at: startedAt, ended_at: endedAt, text }
}

const STARTED = '2026-03-16T14:30:00'
const ENDED   = '2026-03-16T15:00:00'

describe('backup payload', () => {
  it('includes title, startedAt, and lines', () => {
    const p = buildBackupPayload('Standup', STARTED, [{ text: 'Hello' }, { text: 'World' }])
    expect(p.title).toBe('Standup')
    expect(p.lines).toEqual(['Hello', 'World'])
  })

  it('handles empty lines', () => {
    expect(buildBackupPayload('T', STARTED, []).lines).toEqual([])
  })

  it('extracts text from object lines', () => {
    expect(buildBackupPayload('T', STARTED, [{ text: 'foo', start: 0 }]).lines).toEqual(['foo'])
  })
})

describe('save payload', () => {
  it('joins lines with newlines', () => {
    const p = buildSavePayload('Meet', STARTED, ENDED, [{ text: 'Line one' }, { text: 'Line two' }])
    expect(p.text).toBe('Line one\nLine two')
  })

  it('filters empty lines', () => {
    const p = buildSavePayload('T', STARTED, ENDED, [{ text: 'Good' }, { text: '   ' }, { text: 'Another' }])
    expect(p.text).toBe('Good\nAnother')
  })

  it('has all required fields', () => {
    const p = buildSavePayload('Review', STARTED, ENDED, [])
    expect(p).toMatchObject({ title: 'Review', started_at: STARTED, ended_at: ENDED, text: '' })
  })
})
