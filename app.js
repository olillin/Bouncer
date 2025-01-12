const bouncy = require('bouncy')
const fs = require('fs')
const { Validator, ValidationError } = require('jsonschema')
const tls = require('tls')
require('dotenv').config()

const PORT = process.env.PORT || 8080
const CONFIG_FILE = process.env.HOSTS_FILE || 'config.json'
const CONFIG_SCHEMA = 'config.schema.json'

const defaultConfig = { hosts: {}, default: { behaviour: 'error' } }
var config = defaultConfig
var secureContext = {}

try {
    reloadConfig(JSON.parse(fs.readFileSync(CONFIG_FILE).toString()))
} catch (e) {
    console.error('Failed to load hosts from file')
}

fs.watchFile(CONFIG_FILE, (current, previous) => {
    if (!fs.existsSync(CONFIG_FILE)) {
        console.warn('Cannot find hosts file')
        return
    }
    try {
        const newHosts = JSON.parse(fs.readFileSync(CONFIG_FILE).toString())
        reloadConfig(newHosts)
    } catch (e) {
        console.error('Failed to parse hosts file')
    }
})

function reloadConfig(newConfig) {
    console.log('Attempting to reload config...')

    if (!newConfig.default) {
        newConfig.default = defaultConfig.default
    }

    try {
        // Schema validation
        const schema = JSON.parse(fs.readFileSync(CONFIG_SCHEMA).toString())
        let res = new Validator().validate(newConfig, schema, { required: true })

        if (!res.valid) {
            console.error(
                'Hosts file is invalid:\n' +
                    res.errors
                        .map(e => {
                            if (e instanceof ValidationError) {
                                return `Property at {root${e['path'].map(x => ' > ' + x).join('')}} ${e['message']}`
                            }
                            return e
                        })
                        .join('\n')
            )
            return
        }
        // Loop detection
        Object.entries(newConfig.hosts || {}).forEach(entry => {
            const [host, port] = entry
            if (port == PORT) {
                console.error(`Loop detected, host ${host} points to the server port (${PORT})`)
                return
            }
        })
        if (newConfig.default.behaviour == 'bounce' && newConfig.default.port == PORT) {
            console.error(`Loop detected, default bounce points to the server port (${PORT})`)
            return
        }
        // Cert check
        if (!newConfig.https) {
            console.warn("'https' not defined in config. Not using HTTPS")
        } else {
            for (let hostname in newConfig.hosts) {
                let supportsHttps = false
                for (let pattern in newConfig.https) {
                    if (matchesStar(pattern, hostname)) {
                        supportsHttps = true
                        break
                    }
                }
                if (!supportsHttps) {
                    console.warn(`Host ${hostname} is not covered by an SSL certificate and does not support HTTPS`)
                }
            }
        }

        // Update hosts
        config = newConfig
        console.log('Hosts have been updated')

        // Update secure context
        secureContext = {}
        for (let hostname in newConfig.hosts) {
            secureContext[hostname] = createSecureContext(hostname)
        }
        console.log('Secure context has been updated')
    } catch (e) {
        console.warn('Error occured while validating hosts file: ' + e)
    }
}

/**
 * @param {string} pattern
 * @param {string} hostname
 */
function matchesStar(pattern, hostname) {
    const regex = RegExp(
        '^' +
            pattern //
                .replace('.', '\\.')
                .replace('*', '[^.]+') +
            '$'
    )
    return regex.test(hostname)
}

/**
 * @param {string} hostname
 * @returns {number|null}
 */
function getPort(hostname) {
    if (Object.hasOwnProperty.call(config.hosts, hostname)) {
        return config.hosts[hostname]
    }
    for (let pattern in config.hosts) {
        if (matchesStar(pattern, hostname)) {
            return config.hosts[pattern]
        }
    }
    return null
}

/**
 * @param {string} hostname
 * @returns {any|null}
 */
function createSecureContext(hostname) {
    if (!Object.hasOwnProperty.call(config, 'https') || !Object.hasOwnProperty.call(config.https, hostname)) return null

    const paths = config.https[hostname]
    try {
        const key = fs.readFileSync(paths.key)
        const cert = fs.readFileSync(paths.cert)
        if (Object.hasOwnProperty.call(paths, 'ca')) {
            const ca = []
            for (let path of paths.ca) {
                ca.push(fs.readFileSync(path))
            }
            return tls.createSecureContext({ key: key, cert: cert, ca: ca })
        }
        return tls.createSecureContext({ key: key, cert: cert })
    } catch (e) {
        console.error(`Failed to get SSL certificate for host ${hostname}`)
        console.error(e)
        return null
    }
}

const options = Object.hasOwnProperty.call(config, 'https')
    ? {
          SNICallback: hostname => secureContext[hostname],
          key: fs.readFileSync(Object.values(config.https)[0].key),
          cert: fs.readFileSync(Object.values(config.https)[0].cert),
      }
    : {}
const server = bouncy(options, function (req, res, bounce) {
    const hostname = req.headers.host
    console.log(`Request to host ${hostname}`)
    let port = getPort(hostname)
    if (port) {
        bounce(port)
        console.log(`Bounced to port ${port}`)
    } else {
        console.log('Host is not in hosts list')
        if (config.default.behaviour == 'bounce') {
            bounce(config.default.port)
            console.log(`Bounced to port ${port}`)
        } else {
            res.statusCode = 404
            res.end()
            console.log(`Sent error 404`)
        }
    }
})

server.listen(PORT)
console.log(`Bouncer listening with on port ${PORT}`)
