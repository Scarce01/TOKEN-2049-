#!/usr/bin/env bun
import { attack } from './attack'
import { scan } from './scanner'

const cmd = process.argv[2]
const baseUrl = process.env.EXCHANGE_API_URL ?? 'http://127.0.0.1:8787'
const token = process.env.ADMIN_TOKEN
if (!token) throw new Error('missing env ADMIN_TOKEN')

if (cmd === 'scan') {
  console.log(await scan(baseUrl, token))
} else if (cmd === 'attack') {
  console.log(await attack())
} else {
  console.error('usage: redteam scan | attack')
  process.exit(1)
}
