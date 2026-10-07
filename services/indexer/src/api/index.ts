// Ponder's built-in /health, /ready and /status stay; no GraphQL and no /sql are mounted
// (31_phase1.md 1.9). Run it on a private network only. The Console queries Postgres itself.
import { Hono } from 'hono'

const app = new Hono()
export default app
