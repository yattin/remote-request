import { loadConfig } from "./config"
import { createServer } from "./server"

const config = loadConfig()
const server = Bun.serve(createServer(config))

console.info(`remote-request listening on http://localhost:${server.port}`)
