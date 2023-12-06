const bouncy = require('bouncy')
const fs = require('fs')
const { Validator, ValidationError } = require('jsonschema')
require('dotenv').config()

var hosts
try {
    hosts = JSON.parse(fs.readFileSync('hosts.json').toString())
} catch (e) {}

try {
    const schema = JSON.parse(fs.readFileSync('hosts.schema.json').toString())
    let res = new Validator().validate(hosts, schema, {required: true})
    
    if (!res.valid) {
        console.error('hosts.json is invalid or missing:')
        console.log(res.errors.map(e => {
            if (e instanceof ValidationError) {
                return `Property at {root${e['path'].map(x => ' > ' + x).join('')}} ${e['message']}`
            }
            return e
        }).join('\n'))
        process.exit()
    }

} catch (e) {
    console.warn('Failed to read schema, skipping validation')
}

const def = hosts.default || {'behaviour': 'error'}

const PORT = process.env.PORT || 8080
Object.entries(hosts.hosts).forEach(entry => {
    const [host, port] = entry
    if (port == PORT) {
        console.error(`Looping detected, host ${host} points to the server port (${PORT})`)
        process.exit()
    }
})
if (def.behaviour == 'bounce' && def.port == PORT) {
    console.error(`Looping detected, default bounce points to the server port (${PORT})`)
    process.exit()
}

var server = bouncy(function (req, res, bounce) {
    let port = hosts[req.headers.host]
    if (port) {
        bounce(port)
    } else {
        if (def.behaviour == 'error') {
            res.statusCode = 404
            res.end()
        } else if (def.behaviour == 'bounce') {
            bounce(def.port)
        }
    }
})

server.listen(PORT)
console.log(`Bouncy listening on port ${PORT}`)