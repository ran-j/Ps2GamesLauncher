const fs = require('fs');
const path = require('path')
const axios = require('axios')
const Seven = require('node-7z')
const secrets = require('./secret')
const sevenBin = require('7zip-bin')
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
        emulatorStarded: false
    },
    methods: {
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
                        return reject(err)
                    }
                    const output = []
                    files.forEach(function (file, index, arr) {
                        if (file.indexOf('.iso') > -1) {
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
            const files = await this.getIsoList(config.gamesPath)
            const { NTSCJ, NTSCU, PAL } = require('./database/index')
            const blanckImg = 'data:image/jpeg;base64,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'
            this.gameList = []
            for await (const file of files) {
                const cnFPath = await this.extractCnf(config.gamesPath, file)
                const cnfInfo = await this.incorporateCnf(cnFPath, file)
                const gameInfo = await this.decodeName(cnfInfo, { NTSCJ, NTSCU, PAL })
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
            }
            // console.log(this.gameList)
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
                    this.runCommand(command, (error, stdout) => {
                        console.log(error, stdout)
                        this.emulatorStarded = false
                        if(error) {
                            Swal.fire({
                                icon: 'error',
                                title: 'Erro to run command: '+ command,
                            })
                        } else {
                            Swal.fire({
                                icon: 'success',
                                title: 'Emulation end',
                            })
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
                                } else {
                                    Swal.fire(
                                        'Canceled!',
                                        'Operation canceled.',
                                        'success'
                                    )
                                }
                            } else {
                                Swal.fire(
                                    'Canceled!',
                                    'Operation canceled.',
                                    'success'
                                )
                            }
                        })
                    } else {
                        Swal.fire(
                            'Canceled!',
                            'Operation canceled.',
                            'success'
                        )
                    }
                }
            })

            // Swal.fire({
            //     title: 'Title',
            //     text: `Do you want to run ${gameObj.name}!`,
            //     html: "Some Text" +
            //         "<br>" +
            //         '<button type="button" role="button" tabindex="0" class="SwalBtn1 customSwalBtn">' + 'Configurar' + '</button>' +
            //         '<button type="button" role="button" tabindex="0" class="SwalBtn2 customSwalBtn">' + 'Emular' + '</button>',
            //     showCancelButton: false,
            //     showConfirmButton: false
            // });
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
        }
    }
})