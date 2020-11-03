const fs = require('fs');
const path = require('path')
const axios = require('axios')
const Seven = require('node-7z')
const secrets = require('./secret')
const sevenBin = require('7zip-bin')
const { remote } = require('electron');
const execProc = require('child_process').exec

const defaultsConfig = {
    gamesPath: 'none',
    pcsx2Path: 'C:\\Program Files (x86)\\PCSX2\\pcsx2.exe',
    parans: '--fullscreen --nogui',
    default: true
}

var config = localStorage.getItem('config') ? JSON.parse(localStorage.getItem('config')) : defaultsConfig

var app = new Vue({
    el: '#app',
    data: {
        dir: './tmp',
        gamesListMeta: [],
        gameList: [],  // { name: '', image: '', path: '', filename: '', configPath: '' }
        apiKey: secrets.apiKey,
        regionTypes: ['SLUS', 'SLES'],
        emulatorStarded: false,
        usingGamePad: false,
        gamePadButtons: {
            A: false,
            B: false,
            Y: false,
            Axis: {
                x: 0,
                y: 0
            }
        },
        popUp: null,
        cards: null,
        cardsIndex: -1
    },
    methods: {
        hideApp () {
            remote.getCurrentWindow().hide()
        },
        focusApp () {
            var win = remote.getCurrentWindow();
            win.setAlwaysOnTop(true);
            win.focus();
            win.setAlwaysOnTop(false);
            remote.getCurrentWindow().show()
            console.log("Focus");
        },
        clearTemp() {
            fs.rmdirSync(this.dir, { recursive: true });
        },
        creteTempFolder() {
            if (!fs.existsSync(this.dir)) {
                fs.mkdirSync(this.dir);
            }
        },
        getIsoList(directory) {
            return new Promise((resolve, reject) => {
                this.clearTemp()
                fs.readdir(directory, function (err, files) {
                    // handling error
                    if (err) {
                        console.log('Unable to scan directory: ' + err)
                        Swal.fire({
                            icon: 'error',
                            title: 'Erro to search for game in '+directory,
                        })
                        this.setButtons('', 'error')
                        return resolve([])
                    }
                    const output = []
                    files.forEach(function (file, index, arr) {
                        if (path.extname(file) === '.iso') {
                            output.push(file)
                        }
                    })
                    resolve(output)
                })
            })
        },
        extractCnf(directory, file) {
            return new Promise((resolve, reject) => {
                this.creteTempFolder()
                let output = path.join(this.dir, file.split(".")[0])
                if (!fs.existsSync(output)) {
                    fs.mkdirSync(output);
                }
                const pathTo7zip = sevenBin.path7za
                var myStream = Seven.extract(path.join(directory, file), output, {
                    recursive: true,
                    $cherryPick: '*.cnf',
                    // $bin: pathTo7zip,
                    $progress: true
                })
                myStream.on('end', function () {
                    console.log('done')
                    resolve(output)
                })
                myStream.on('error', (err) => {
                    console.log(err)
                    reject(err)
                })
                myStream.on('progress', function (progress) {
                    console.log(progress) // ? { percent: 67, fileCount: 5, file: undefinded }
                })
                // var myTask = new Zip();
                // myTask.extractFull(path.join(directory, file), output, { wildcards: ['*.cnf'], r: true })
                // 	// Equivalent to `on('data', function (files) { // ... });`
                // 	.progress(function (files) {
                // 		console.log('Some files are extracted: %s', files);
                // 	})
                // 	// When all is done
                // 	.then(function () {
                // 		console.log('Extracting done!');
                // 		resolve(output)
                // 	})
                // 	// On error
                // 	.catch(function (err) {
                // 		console.error(err);
                // 		reject(err)
                // 	});
            })
        },
        incorporateCnf(filePath, file) {
            return new Promise((resolve, reject) => {
                const confFile = path.join(filePath, 'SYSTEM.CNF')
                fs.readFile(confFile, 'utf8', (err, data) => {
                    if (err) return reject(err)
                    fs.unlink(confFile, (error) => {
                        let gamaMeta = {}
                        try {
                            gamaMeta = {
                                meta: data,
                                fileName: file,
                                region: ((data.split('\n')[0]).split(':')[1]).split(';')[0].replace('_', '-').replace('.', '').replace('\\', '')
                            }
                            this.gamesListMeta.push(gamaMeta)
                        } catch (error) {
                            console.log(error)
                            return reject(err)
                        }
                        if (error) return reject(err)
                        resolve(gamaMeta)
                    })
                })
            })
        },
        getImage(nameName) {
            return new Promise((resolve, reject) => {
                try {
                    let gameID = ''
                    const gameParsed = nameName.trim().toLocaleLowerCase().replace(/[^\w\s]/gi, '')
                    if (localStorage.getItem(gameParsed)) {
                        console.log('using cache for', gameParsed)
                        return resolve(JSON.parse(localStorage.getItem(gameParsed)))
                    }
                    axios.get('https://api.thegamesdb.net/v1.1/Games/ByGameName', {
                        params: {
                            apikey: this.apiKey,
                            name: nameName.trim().toLocaleLowerCase(),
                            "filter[platform]": 11
                        }
                    })
                        .then((response) => {
                            const responsePayload = response.data
                            var gameName = responsePayload.data.games.find((game) => game.game_title.trim().toLocaleLowerCase().replace(/[^\w\s]/gi, '') === gameParsed)
                            if (!gameName) gameName = responsePayload.data.games[responsePayload.data.count - 1]
                            // console.log(responsePayload)
                            gameID = gameName.id;
                            if (!gameID) return resolve(null)
                            return axios.get('https://api.thegamesdb.net/v1/Games/Images', {
                                params: {
                                    apikey: this.apiKey,
                                    games_id: gameName.id
                                }
                            })
                        })
                        .then((response) => {
                            const responsePayload = response.data
                            const basePath = responsePayload.data.base_url.large
                            const image = responsePayload.data.images[gameID].find((image) => image.type === 'boxart' && image.side === 'front')
                            localStorage.setItem(gameParsed, JSON.stringify({ ...image, basePath }))
                            // console.log({ ...image, basePath })
                            console.log(nameName.trim().toLocaleLowerCase().replace(/[^\w\s]/gi, ''))
                            resolve({ ...image, basePath })
                        })
                        .catch(function (error) {
                            console.log(error);
                            resolve(null)
                        })
                } catch (error) {
                    console.log(error)
                    resolve(null)
                }
            })
        },
        async decodeName({ region }, { NTSCJ, NTSCU, PAL }) {
            const regionIdentify = this.regionTypes.indexOf(region.split('-')[0]);
            const regionCode = region;
            const regionList = regionIdentify === 0 ? NTSCU : regionIdentify === 1 ? PAL : NTSCJ
            return regionList.find((gameInfo) => gameInfo.code === regionCode)
        },
        async refreshLibrary() {
            this.gamesListMeta = []
            Swal.fire({
                title: 'Refreshing library',
                html: 'Searching games and geting covers',
                timer: 900000,
                timerProgressBar: true,
                allowOutsideClick: () => !Swal.isLoading(),
                willOpen: () => {
                  Swal.showLoading()
                }
              }).then((result) => {
                /* Read more about handling dismissals below */
                if (result.dismiss === Swal.DismissReason.timer) {
                  console.log('I was closed by the timer')
                }
            })

            const files = await this.getIsoList(config.gamesPath)
            const { NTSCJ, NTSCU, PAL } = require('./database/index')
            const blanckImg = 'data:image/jpeg;base64,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'
            this.gameList = []
            for await (const file of files) {
                try {
                    const cnFPath = await this.extractCnf(config.gamesPath, file)
                    const cnfInfo = await this.incorporateCnf(cnFPath, file)
                    const gameInfo = await this.decodeName(cnfInfo, { NTSCJ, NTSCU, PAL })
                    try {
                        let index = (this.gameList.push({
                            name: gameInfo.name,
                            region: gameInfo.code,
                            image: blanckImg,
                            filename: file,
                            path: config.gamesPath,
                            configPath: ''
                        })) - 1
                        this.getImage(gameInfo.name).then((image) => {
                            this.gameList[index].image = image ? image.basePath + image.filename : blanckImg
                        }).catch(console.error)
                    } catch (error) {
                        console.log(error)
                        var extension = path.extname(cnfInfo.fileName);
                        var fileNameNoExtension = path.basename(cnfInfo.fileName, extension);
                        this.gameList.push({
                            name: fileNameNoExtension,
                            region: cnfInfo.region,
                            image: blanckImg,
                            filename: file,
                            path: config.gamesPath,
                            configPath: ''
                        })
                    }
                } catch (error) {
                    console.log(error)
                    var extension = path.extname(file);
                    var fileNameNoExtension = path.basename(file, extension);
                    this.gameList.push({
                        name: fileNameNoExtension,
                        region: 'Unknow',
                        image: blanckImg,
                        filename: file,
                        path: config.gamesPath,
                        configPath: ''
                    })
                }
            }
            // console.log(this.gameList)
            this.cards = document.getElementsByClassName("card")
            Swal.fire({
                icon: 'success',
                title: 'Refresh end',
            })
            this.setButtons('', 'success')
            this.clearTemp()
        },
        runCommand(command, callback) {
            this.emulatorStarded = true
            execProc(command, function (error, stdout, stderr) {
                console.log(error, stderr)
                if (error) return callback(error, null)
                callback(null, stdout)
            })
        },
        showLoadingEmulator() {
            let timerInterval
            Swal.fire({
                title: 'Waiting emulator to start',
                html: 'I will close in <b></b> milliseconds.',
                timer: 9000,
                timerProgressBar: true,
                allowOutsideClick: () => !Swal.isLoading(),
                willOpen: () => {
                  Swal.showLoading()
                  timerInterval = setInterval(() => {
                    const content = Swal.getContent()
                    if (content) {
                      const b = content.querySelector('b')
                      if (b) {
                        b.textContent = Swal.getTimerLeft()
                      }
                    }
                  }, 100)
                },
                onClose: () => {
                  clearInterval(timerInterval)
                }
              }).then((result) => {
                /* Read more about handling dismissals below */
                if (result.dismiss === Swal.DismissReason.timer) {
                  console.log('I was closed by the timer')
                }
              })
        },
        runGame(gameObj, index) {
            if(this.emulatorStarded) return;
            Swal.fire({
                title: 'Run game?',
                text: `Do you want to run ${gameObj.name}!`,
                // icon: 'question',
                imageUrl: gameObj.image,
                showCancelButton: true,
                // confirmButtonColor: '#3085d6',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Emulate',
                cancelButtonText: 'Set Up',
                showLoaderOnConfirm: true,
                allowOutsideClick: () => !Swal.isLoading()
            }).then((result) => {
                if (result.isConfirmed) {
                    let command = `"${config.pcsx2Path}" "${path.join(gameObj.path, gameObj.filename)}" ${config.parans}`
                    if(gameObj.configPath) {
                        command += ` --cfgpath="${gameObj.configPath}"`
                    }
                    console.log("Running:"+ command )

                    this.showLoadingEmulator()

                    setTimeout(() => {
                        console.log('hidding app')
                        this.hideApp()
                    }, 2000)

                    this.runCommand(command, (error, stdout) => {
                        console.log(error, stdout)
                        this.emulatorStarded = false
                        if(error) {
                            Swal.fire({
                                icon: 'error',
                                title: 'Erro to run command: '+ command,
                            })
                            this.setButtons('', 'error')
                        } else {
                            this.focusApp()
                            Swal.fire({
                                icon: 'success',
                                title: 'Emulation end',
                            })
                            this.setButtons('', 'success')
                        }
                    })
                } else {
                    console.log(result)
                    if(result.dismiss === "cancel") {
                        Swal.fire({
                            title: "<i>Game settings</i>",
                            icon: 'info',
                            html: `
                                <form>
                                    <label for="cfgpath">Config path:</label><br>
                                        <input spellcheck="false" class="inputConfig" type="text" id="cfgpath" name="cfgpath" value="${gameObj.configPath}"><br>
                                </form>
                            `,
                            confirmButtonText: " <u>Save</u>",
                            cancelButtonColor: '#d33',
                            showCancelButton: true
                        }).then((result) => {
                            if (result.isConfirmed) {
                                const cfgpath = document.getElementById("cfgpath").value
                                if(cfgpath) {
                                    this.gameList[index].configPath = cfgpath
                                    Swal.fire(
                                        'Success!',
                                        'Saved',
                                        'success'
                                    )
                                    this.setButtons('', 'cancel')
                                } else {
                                    Swal.fire(
                                        'Canceled!',
                                        'Operation canceled.',
                                        'success'
                                    )
                                    this.setButtons('', 'cancel')
                                }
                            } else {
                                Swal.fire(
                                    'Canceled!',
                                    'Operation canceled.',
                                    'success'
                                )
                                this.setButtons('', 'cancel')
                            }
                        })

                        this.setButtons('', 'settings')
                    } else {
                        Swal.fire(
                            'Canceled!',
                            'Operation canceled.',
                            'success'
                        )
                        this.setButtons('', 'cancel')
                    }
                }
            })
            this.setButtons('config', 'runGame')
        },
        setButtons (b, popUpname) {
            setTimeout(() => {
                this.popUp = popUpname
                if(this.usingGamePad) {
                    if(document.getElementsByClassName("swal2-confirm swal2-styled")[0]) document.getElementsByClassName("swal2-confirm swal2-styled")[0].innerHTML += '<img style="padding-left: 2%;" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABmJLR0QA/wD/AP+gvaeTAAABWklEQVRIid2UvUoDQRSFvxgM2AqKYqEivoSgGHwAYxIjWvgIPkfi+hgxhY1/va2VVkJWE+NDaCe6FnMHBp25s1m7XDhkuHvOuT+bHZj0qAAHQA9IgQ9BKrmWcApFA3gFsgiGQH0c4zJwlsP4NxJgKk+BIuYWnZh5QxF/ikECfCm8Wsi8gtlnSHjncO8V3gjnxbs72wPWlOlunPOlwlsFdn0PekpXGbACzANzwHqE2/UVeFEEj8I5BPbl/KTwU2vqrmhRGftafneAqpy1NS35CmQ5CpQEAFcK3+v1jH/cN8VoFND0LcGd4CFgYjvdAtqCTcndBjRer1agm215fuHkziVXDWia1rTsFBgAR8Csk/vGXHgbwDEwI/kFzPTL0kDJ0QyBE9H+iXqgo3Hg/cjcSP5h3o6ZI6OfFjDvkPO6tlHDvJeY8YAcawnFNOZq6GL+2++CvuSawpng+AGUCdWz9DgDuAAAAABJRU5ErkJggg=="/>'
                    if(b === 'config') document.getElementsByClassName("swal2-cancel swal2-styled")[0].innerHTML += '<img style="padding-left: 2%;" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABmJLR0QA/wD/AP+gvaeTAAABWUlEQVRIid2UQUoDQRBFn0oCEcWs9AgiCB7FkMTEW+hSLxCNcaO41J14DnGjIK4zEuMBshqixp3joqu1Gbp6JpNdPhQUv3//rq6aaZh3lIE2cAdEwKdEJFxLNIXQAIZAkhFvQH0a4yXgPIdxOnrAYp4Dipjb6GaZN2Ywt1HTzMuYfqY3XMr6JvAj3JZwVx79O8rg20pFX8C6aB6Ae8k3gImyZ8+aukPRrrYMHEh+A1xLfghUlD27PvJVqSYBYmBNDqtIHgf0ke+AcWBDAhw52uMM7dgK3RYtKNe1+FZyHxIfGWrRCNOeVWBF8lFA/9ci9wYvgYouMF/MPub9mfD/+frw7CNbSjUxUBXNE/AoeRV90E3fASVg4BF3ZH3b4XaEO/HohwRe2LpS0TTh/Qdc9GYwP80yBzP4swLmXXI+1xY1/DNJx4AcbdFQwjxct0Af+JDoC9cUzRzjF1b/6w4nRkX6AAAAAElFTkSuQmCC"/>'
                    else document.getElementsByClassName("swal2-cancel swal2-styled")[0].innerHTML += '<img style="padding-left: 2%;" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABmJLR0QA/wD/AP+gvaeTAAABP0lEQVRIid2UsUoDQRCGPxJyFr6CiGCj2Aj6CinEwpCLiS8jWBqTIo1vEPMa+gCKhUVOTvEB7GI6hVjsLAbZuZ27dBn4ud25//7Zf2dvYd0jAXrABMiAuSCTXFc4lSIF3oFFBG9Au4xwHRgahP9jANQsBaqIe/Rj4ukK4h4tTTxB3/O9Jd4GcADcKdwcpfG9glX5Ak3gFNenGvCi8M9DBSaGAs8yv5D5SOGPvehy149CVQOxAD5lvK1wjkPJmcHBPrAj4xT4UfizkANLbAGHwCZwD3yU+fjV4MD34FLmVwo/Czl4KrGYb3nOlfePoWTX4KAJnPB3zh8UfidUIMFdXLEfrQ7sArcKNwcaijPaBS6sONPEfQxWEL+OiYNr/E0F8T4lj30Lt58x4RzDtmjRwF1cY2AKfAmmkutQ0ND1iF/nFeH8ST/nhgAAAABJRU5ErkJggg=="/>'
                }
            }, 100) 
        },
        editConfig() {
            Swal.fire({
                title: "<i>Settings</i>",
                html: `
                    <form>
                        <label for="pcsx2Path">Pcsx2 path:</label><br>
                            <input spellcheck="false" class="inputConfig" type="text" id="pcsx2Path" name="pcsx2Path" value="${config.pcsx2Path}"><br>
                        <label for="lname">Pcsx2 parans:</label><br>
                            <input spellcheck="false" class="inputConfig" type="text" id="parans" name="parans" value="${config.parans}"><br>
                        <label for="lname">Isos path:</label><br>
                            <input spellcheck="false" class="inputConfig" type="text" id="gamesPath" name="gamesPath" value="${config.gamesPath}"><br>
                    </form>
                `,
                confirmButtonText: " <u>Save</u>",
                cancelButtonColor: '#d33',
                showCancelButton: true
            }).then((result) => {
                if (result.isConfirmed) {
                    const gamesPath = document.getElementById("gamesPath").value
                    const parans = document.getElementById("parans").value
                    const pcsx2Path = document.getElementById("pcsx2Path").value
                    let newConfig = {
                        gamesPath,
                        parans,
                        pcsx2Path
                    }
                    config = newConfig;
                    localStorage.setItem('config', JSON.stringify(newConfig))
                    Swal.fire(
                        'Success!',
                        'Saved',
                        'success'
                    )
                }
            })
            this.setButtons('', 'editConfig')
        },
        help() {
            Swal.fire({
                title: "<i>Help</i>",
                html: `
                <ul style="list-style-type:none">
                    <li>Created by Ran-J</li>
                    <li>Version: 1.0.0</li>
                </ul>
                `,
                confirmButtonText: " <u>Ok</u>",
                cancelButtonColor: '#d33',
            })
        }
    },
    created() {
        if(localStorage.getItem('gameList')) {
            console.log('using local cache')
            this.gameList = JSON.parse(localStorage.getItem('gameList'))
        } else {
            if(config.default) {
                if(config.gamesPath === 'none') {
                    config.gamesPath = path.join(require('os').homedir(), 'PCSX2/games')
                }
            }
            console.log("Using config", config)
            this.refreshLibrary()
        }

        var _vm = this
        var i = 1; 
        var interval = null
        window.addEventListener("gamepadconnected", function(e) {
            _vm.usingGamePad = true;
            console.log(e.gamepad.index)
            var gp = navigator.getGamepads()[e.gamepad.index];

            console.log("A " + gp.id + " was successfully detected! There are a total of " + gp.buttons.length + " buttons.")

            interval = setInterval(function(){
                _vm.gamePadButtons.A = navigator.getGamepads()[e.gamepad.index].buttons[0].pressed
                _vm.gamePadButtons.B = navigator.getGamepads()[e.gamepad.index].buttons[1].pressed
                _vm.gamePadButtons.Y = navigator.getGamepads()[e.gamepad.index].buttons[2].pressed
                _vm.gamePadButtons.Pause = navigator.getGamepads()[e.gamepad.index].buttons[9].pressed
                _vm.gamePadButtons.Axis.x = navigator.getGamepads()[e.gamepad.index].axes[0]
                // console.log(navigator.getGamepads()[e.gamepad.index].axes[0]);
                console.log(_vm.gamePadButtons.A)
            }, 100)

            this.cardsIndex = 0
        });

        window.addEventListener("gamepaddisconnected", function(e) {
            console.log("Gamepad disconnected from index %d: %s", e.gamepad.index, e.gamepad.id); 
            _vm.usingGamePad = false;
            _vm.gamePadButtons.A = false
            _vm.gamePadButtons.B = false
            _vm.gamePadButtons.Y = false
            _vm.gamePadButtons.Pause = false
            if(interval) clearInterval(interval)
            this.cardsIndex = -1
        });
    },
    watch: {
        gameList: {
            handler: function (after, before) {
                if(after) {
                    // console.log(after)
                    localStorage.setItem("gameList", JSON.stringify(after))
                }
            },
            deep: true
        },
        gamePadButtons: {
            handler: function (after, before) {
                if(after && !this.emulatorStarded) {
                    if(this.popUp) {
                        if(after.A) {
                            console.log(`da ok`)
                            document.getElementsByClassName("swal2-confirm swal2-styled")[0].click()
                            this.popUp = null
                        } else if (after.B && this.popUp !== 'canceling') {
                            console.log(`cancela`)
                            Swal.fire(
                                'Canceled!',
                                'Operation canceled.',
                                'success'
                            )
                            this.setButtons('', 'canceling')
                        } else if (after.Y) {
                            console.log(`set up`)
                            document.getElementsByClassName("swal2-cancel swal2-styled")[0].click()
                            this.popUp = null
                        }
                    } else {
                        if(after.A) {
                            if(this.cardsIndex > -1) document.getElementsByClassName("card")[this.cardsIndex].click()
                        }
                    }
                    if(after.Axis.x >= 1) {
                        if(this.cardsIndex < document.getElementsByClassName("card").length -1) {
                            this.cardsIndex += 1
                        } else {
                            this.cardsIndex = 0
                        }
                    } else if (after.Axis.x <= -1) {
                        if(this.cardsIndex > 0) this.cardsIndex -= 1
                    }
                }
            },
            deep: true
        },
        cardsIndex : {
            handler: function (after, before) {
                // console.log(after)
                if(before > -1) {
                    document.getElementsByClassName("card")[before].style.transition = ''
                    document.getElementsByClassName("card")[before].style.boxShadow = ''
                    document.getElementsByClassName("card")[before].style.transform = ''
                }
                if(after > -1) {
                    document.getElementsByClassName("card")[after].style.transition = '0.3s'
                    document.getElementsByClassName("card")[after].style.boxShadow = '0 8px 16px 3px rgba(0,0,0,0.6)'
                    document.getElementsByClassName("card")[after].style.transform = 'translateY(-3px) scale(1.09) rotateX(15deg)'
                }
            },
            deep: true
        }
    }
})