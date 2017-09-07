import * as express from "express"
import * as child from "child_process"
import * as readline from "readline"
import * as os from "os"

interface Logger {
    (...args: any[]): string
    addTag(t: string): Logger
}
function logger(tag: string, resp?: express.Response): Logger {
    const rv = function(...args: any[]) {
        const dt = new Date().toISOString();
        const arr = [ dt, '\t', tag, tag.length < 8 ? '\t\t' : '\t', ...arguments ];
        console.log.apply(console, arr);
        const txt = arr.join(' ');
        if (resp) resp.write(txt + "\n");
        return txt;
    }
    rv['addTag'] = (t: string)=> {
        return logger(tag + t, resp);
    }
    return rv as any;
}

const log = logger('MAIN');

interface Script {
    cmd: string[][]
    timeout: number
    user: string
    group: string
    singleton: boolean
    skipError: boolean
    url: string
}
interface Config {
    [ url: string ]: Script
}

const app = express();
const config = require(process.argv[2] || process.cwd() + '/config.json') as Config;
const running = {};
let reqId = 0;

log('Config:', config);

for (const url in config) {
    const script = config[url];
    script.url = url;
    app.get('/' + url, (req, resp)=> runTask(req, resp, script));
}
app.listen(8888);

async function runTask(req: express.Request, resp: express.Response, script: Script) {
    resp.setHeader('Content-type', 'text/plain; charset=utf-8');
    const log = logger(`R${reqId++}`, resp);
    log(`Request to run ${ script.url } from ${ req.ips }`);
    if (script.singleton && running[script.url]) {
        log(`Only one run of ${ script.url } allowed.`);
        return resp.end();
    }
    running[script.url] = true;
    await Promise.all(script.cmd.map((cmd, idx)=> runCmdChain(script, idx, log)));
    delete running[script.url];
    log('DONE');
    resp.end();
}

async function runCmdChain(script: Script, idx: number, log: Logger) {
    log = log.addTag(":C" + idx);
    log(`Running command chain`);
    const chain = script.cmd[idx];
    for (const cmd of chain) {
        try {
            await runCmd(cmd, script, log);
        } catch (err) {
            if (!script.skipError) {
                log(`${idx}:\tBreak execution due previous error in chain`);
                break;
            }
        }
    }
    log(`Finished command chain`);
}

async function runCmd(cmd: string, script: Script, log: Logger) {
    return new Promise((resolve, reject)=> {
        let sh = '/bin/sh';
        let args = ["-c", cmd];
        if (script.user || script.group) {
            if (os.userInfo().uid === 0) {
                let user = script.user || os.userInfo().username;
                sh = '/usr/bin/su';
                args = [user, "-c", cmd];
                if (script.group) args.push('-g', script.group);
            } else log('Setting user/group in config not effective when non-root user runnin this service. Ignoring');
        }
        log(`Spawning`, sh, args);
        const prc = child.spawn(sh, args);
        let killtimer: NodeJS.Timer, termtimer: NodeJS.Timer;
        log = log.addTag(':P' + prc.pid);
        log('Starting ', cmd);
        prc.on('close', (code)=> {
            if (killtimer) clearTimeout(killtimer);
            if (termtimer) clearTimeout(termtimer);
            if (code !== 0) reject(log(`Command '${cmd}' aborted with error code ${code}.`));
            else resolve(log(`Command '${cmd}' done with error code ${code}.`));
        });
        const stdout = readline.createInterface({ input: prc.stdout });
        const stderr = readline.createInterface({ input: prc.stderr });
        stdout.on('line', line=> {
            log(line);
        });
        stderr.on('line', line=> {
            log('ERR: ' + line);
        });
        if (script.timeout) {
            termtimer = setTimeout(()=> {
                killtimer = setTimeout(()=> {
                    log('Sending SIGKILL, due timeout');
                    prc.kill("SIGKILL");
                }, script.timeout);
                log('Sending SIGTERM, due timeout');
                prc.kill("SIGTERM");
            }, script.timeout)
        }
    });
}
