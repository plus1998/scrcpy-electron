// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.js    > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//

import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { release } from 'os'
import { join } from 'path'
import cp from 'child_process'
import * as ws from './ws'
import fixPath from 'fix-path';

fixPath()

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// Remove electron security warnings
// This warning only shows in development mode
// Read more on https://www.electronjs.org/docs/latest/tutorial/security
// process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

let win: BrowserWindow | null = null
let previewWin: BrowserWindow | null = null
// Here, you can also use other preload
const preload = join(__dirname, '../preload/index.js')
const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = join(process.env.DIST, 'index.html')

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    title: '设备',
    icon: join(process.env.PUBLIC, 'favicon.ico'),
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (app.isPackaged) {
    win.loadFile(indexHtml)
  } else {
    win.loadURL(url)
    // Open devTool if the app is not packaged
    win.webContents.openDevTools()
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  ws.startServer()
  createWindow()
})

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// new window example arg: new windows url
ipcMain.handle('open-win', (event, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
    },
  })

  if (app.isPackaged) {
    childWindow.loadFile(indexHtml, { hash: arg })
  } else {
    childWindow.loadURL(`${url}/#${arg}`)
    // childWindow.webContents.openDevTools({ mode: "undocked", activate: true })
  }
})


ipcMain.handle('devices', () => {
  const stdout = cp.execSync('adb devices')
  const output = stdout.toString()
  console.log(JSON.stringify(output))
  const devices: { host: string, name: string }[] = [];
  const arr = output.split('\n').filter(o => !!o)
  for (const item of arr) {
    const [host, name] = item.split('\t')
    if (host && name) devices.push({ host, name })
  }
  return devices
})

ipcMain.handle('scrcpy', (e, data) => {
  console.log(data)
  cp.exec(`scrcpy -s ${data.host} --stay-awake --window-title ${data.title}`, (error, stdout, stderr) => {
    // 被关闭了
    e.sender.send('disconnect', { host: data.host })
  })
  return { success: true, message: '启动成功' }
})

ipcMain.handle('tcpip', (e, data) => {
  console.log(data)
  cp.execSync(`adb -s ${data.host} tcpip 5555`)
  return { success: true, message: 'tcpip 5555' }
})

ipcMain.handle('adb-connect', (e, data) => {
  console.log(data)
  return { success: true, message: cp.execSync(`adb connect ${data.host}`).toString() }
})

ipcMain.handle('adb-install', (e, data) => {
  console.log(data)
  const { apk, hosts, targetDir } = data;
  for (const host of hosts) {
    win.webContents.send('install-msg', { host, msg: '开始推送' })
    cp.exec(`adb -s ${host} push ${apk} ${targetDir}`, (err, stdout, stderr) => {
      console.log(`adb push`, stdout, stderr)
      win.webContents.send('install-msg', { host, msg: stdout.toString() })
    })
  }
  return { success: true, message: '已发送指令' }
})