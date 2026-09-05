import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './windowManager'

// Memory discipline: cap concurrent renderer processes (tabs on the shared
// partition can otherwise spawn one process per site) and keep V8 heaps tight.
app.commandLine.appendSwitch('renderer-process-limit', '6')
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1024')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.agentic.browser')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Cleanup happens via window close
})
