import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const uiFiles = ['index.html', 'main.jsx', 'App.jsx', 'Editor.jsx', 'Inventory.jsx', 'Projects.jsx', 'app.module.css']

describe('ui source', () => {
  it('has all expected files', () => {
    for (const f of uiFiles) {
      expect(fs.existsSync(path.join('src/ui', f)), f).toBe(true)
    }
  })

  it('never uses innerHTML or dangerouslySetInnerHTML', () => {
    for (const f of uiFiles) {
      const src = fs.readFileSync(path.join('src/ui', f), 'utf8')
      expect(src, f).not.toMatch(/innerHTML|dangerouslySetInnerHTML/)
    }
  })

  it('renders the four states rather than a bare count', () => {
    const src = uiFiles.map((f) => fs.readFileSync(path.join('src/ui', f), 'utf8')).join('\n')
    for (const state of ['absent', 'empty', 'denied', 'malformed']) {
      expect(src, state).toContain(state)
    }
  })
})
