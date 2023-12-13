const bouncy = require('bouncy')
const fs = require('fs')
const { Validator, ValidationError } = require('jsonschema')
require('dotenv').config()

const PORT = process.env.PORT || 8080
const HOSTS_FILE = process.env.HOSTS_FILE || 'hosts.json'

const defaultHosts = {hosts:{},default:{behaviour:'error'}}
var hosts = defaultHosts

try {
    reloadHosts(JSON.parse(fs.readFileSync(HOSTS_FILE).toString()))
} catch (e) {
    console.error('Failed to load hosts from file')
}

fs.watchFile(HOSTS_FILE, (current, previous) => {
    if (!fs.existsSync(HOSTS_FILE)) {
        console.warn('Cannot find hosts file')
        return
    }
    try {
        const newHosts = JSON.parse(fs.readFileSync(HOSTS_FILE).toString())
        reloadHosts(newHosts)
    } catch (e) {
        console.error('Failed to parse hosts file')
    }
})

function reloadHosts(newHosts) {
    console.log('Attempting to reload hosts...')
    if (!newHosts.default) {
        newHosts.default = defaultHosts.default
    }
    try {
        // Schema validation
        const schema = JSON.parse(fs.readFileSync('hosts.schema.json').toString())
        let res = new Validator().validate(newHosts, schema, {required: true})
        
        if (!res.valid) {
            console.error('Hosts file is invalid:\n' + res.errors.map(e => {
                if (e instanceof ValidationError) {
                    return `Property at {root${e['path'].map(x => ' > ' + x).join('')}} ${e['message']}`
                }
                return e
            }).join('\n'))
            return
        }
        // Loop detection
        Object.entries(newHosts.hosts || {}).forEach(entry => {
            const [host, port] = entry
            if (port == PORT) {
                console.error(`Loop detected, host ${host} points to the server port (${PORT})`)
                return
            }
        })
        if (newHosts.default.behaviour == 'bounce' && newHosts.default.port == PORT) {
            console.error(`Loop detected, default bounce points to the server port (${PORT})`)
            return
        }
        // Update hosts
        hosts = newHosts
        console.log('Hosts have been updated')
    } catch (e) {
        console.warn('Error occured while validating hosts file: ' + e)
    }
}


const options = (fs.existsSync('cert.pem') && fs.existsSync('key.pem'))
    ? {'key': fs.readFileSync('key.pem'), 'cert': fs.readFileSync('cert.pem')}
    : {}
const server = bouncy(options, function (req, res, bounce) {
    let port = hosts.hosts[req.headers.host]
    if (port) {
        bounce(port)
    } else {
        if (hosts.default.behaviour == 'bounce') {
            bounce(hosts.default.port)
        } else {
            res.statusCode = 404
            res.end()
        }
    }
})

server.listen(PORT)
console.log(`Bouncer listening on port ${PORT}`)