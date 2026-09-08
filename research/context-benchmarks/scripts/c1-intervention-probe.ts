import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runC1InterventionProbe } from '../src/c1-intervention-probe'

const output = process.argv[2]
if (!output) throw new Error('Expected a new output JSON path')
const report = await runC1InterventionProbe(resolve(import.meta.dirname, '../../..'))
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
if (report.status !== 'PASS') process.exitCode = 1
