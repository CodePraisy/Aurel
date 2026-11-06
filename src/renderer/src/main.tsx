import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import PrintView from './pages/Print'
import { useProject } from './store/project'
import { player } from './audio/player'
import { renderWav } from './audio/render'
import { useApp, applyAnalysis } from './store/app'
import * as samples from './audio/samples'
import { midi } from './audio/midi'

const isPrint = window.location.hash.replace('#', '').startsWith('print')
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isPrint ? <PrintView /> : <App />}</React.StrictMode>
)

// Test/automation hook (used by the end-to-end smoke test)
;(window as unknown as Record<string, unknown>).__aurelTest = { useProject, player, renderWav, useApp, applyAnalysis, samples, midi }
