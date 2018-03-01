const path = require('path')
const fs = require('fs')
const http = require('http')
const querystring = require('querystring')
const URL = require('url')
const exec = require('child_process').exec
const request = require('request')

const config = require('./config')

class Util {

    saveFile(imgStr, location) {
        let imgBuffer = Buffer.from(imgStr, 'base64')
        this.mkdirSync(path.dirname(location))
        fs.writeFileSync(location, imgBuffer)
        return true
    }

    mkdirSync(dirpath) {
        if (!fs.existsSync(dirpath)) {
            let pathtmp = null
            dirpath.split(path.sep).filter(v => v).forEach((dirname) => {
                if (pathtmp) {
                    pathtmp = path.join(pathtmp, dirname)
                }
                else {
                    pathtmp = '/' + dirname
                }
                if (!fs.existsSync(pathtmp)) {
                    if (!fs.mkdirSync(pathtmp)) {
                        return false
                    }
                }
            })
        }
        return true
    }

    uploadFileServer(path, formData) {
        let url = `http://${config.server.hostname}:${config.server.port}${path}`
        return this.uploadFile(url, formData)
    }

    uploadFile(url, formData) {
        return new Promise((resolve, reject) => {
            request.post({url, formData}, (err, response, body) => {
                if (err) {
                    return reject(err)
                }
                return resolve(body)
            })
        })
    }

    requestServer(method, path, data={}) {
        let url = `http://${config.server.hostname}:${config.server.port}${path}`
        return this.request(method, url, data)
    }

    request(method, url, data={}) {
        return new Promise((resolve, reject) => {
            data = querystring.stringify(data)
            url = URL.parse(url)
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.path,
                method: method,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(data),
                },
            }
            const req = http.request(options, (res) => {
                let body = ''
                res.setEncoding('utf8')
                res.on('data', chunk => {
                    body += chunk
                })
                res.on('end', () => {
                    return resolve(JSON.parse(body))
                })
            })
            
            req.on('error', (e) => {
                return reject(e)
            })
            
            if (data) req.write(data)
            req.end()
        })
    }

    exec(cmd) {
        return new Promise((resolve, reject) => {
            let out = exec(cmd)
            let data = ''
            out.stdout.on('data', (v) => {
              data += v
            })
            out.on('exit', (code) => {
              if (code === 0) {
                resolve(data.trim())
              }
              else {
                resolve(-1)
              }
            })
        })
    }
}

module.exports = new Util()