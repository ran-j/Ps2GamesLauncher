const {app, BrowserWindow} = require('electron')
const path = require('path')

function createWindow () {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    center: true,
    autoHideMenuBar: true,
    maximize: true,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true
    },
    // icon: __dirname + 'icon.png'
  }) 
  mainWindow.maximize()
  // and load the index.html of the app.
  mainWindow.loadFile(__dirname + '/src/index.html')
  // Open the DevTools.
  // mainWindow.webContents.openDevTools()
}

app.whenReady().then(() => {
  createWindow()  
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})