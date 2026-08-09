import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexAgentAdapter, type AgentAdapter } from '@canvas-agent/worker-runtime'
import { trackTempDir } from './git-fixture'

export interface FakeCodexOptions {
  version?: string
  loginExit?: number
  execBody: string
}

export const FAKE_CODEX_SUCCESS_EXEC = `
const fs=require('node:fs');const path=require('node:path')
const cdIdx=process.argv.indexOf('--cd');const cwd=process.argv[cdIdx+1]
fs.writeFileSync(path.join(cwd,'feature.txt'),'added\\n')
const summary={summary:'added feature.txt',changes:[{file:'feature.txt',change_type:'created',description:'add'}],tool_calls_observed:1,tests_run:[],success:true}
const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n')
out({type:'thread.started',thread_id:'thr_1'})
out({type:'turn.started'})
out({type:'item.completed',item:{id:'item_1',type:'command_execution',command:'touch',aggregated_output:'',exit_code:0,status:'completed'}})
out({type:'item.completed',item:{id:'item_2',type:'agent_message',text:JSON.stringify(summary)}})
out({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}})
`

export async function writeFakeCodex(options: FakeCodexOptions): Promise<string> {
  const dir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-fake-codex-')))
  const file = join(dir, 'codex')
  const body = `#!/usr/bin/env node
if (process.argv[2] === '--version') { process.stdout.write('${options.version ?? 'codex-cli 0.146.0'}\\n'); process.exit(0) }
if (process.argv[2] === 'login') { process.exit(${options.loginExit ?? 0}) }
${options.execBody}
`
  await writeFile(file, body, 'utf8')
  await chmod(file, 0o755)
  return file
}

export function fakeCodexAdapter(executable: string, runtimeDirectory: string): AgentAdapter {
  return createCodexAgentAdapter({
    executable,
    environment: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: tmpdir()
    },
    runtimeDirectory
  })
}
