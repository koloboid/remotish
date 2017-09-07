"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const child = require("child_process");
const readline = require("readline");
const os = require("os");
function logger(tag, resp) {
    const rv = function (...args) {
        const dt = new Date().toISOString();
        const arr = [dt, '\t', tag, tag.length < 8 ? '\t\t' : '\t', ...arguments];
        console.log.apply(console, arr);
        const txt = arr.join(' ');
        if (resp)
            resp.write(txt + "\n");
        return txt;
    };
    rv['addTag'] = (t) => {
        return logger(tag + t, resp);
    };
    return rv;
}
const log = logger('MAIN');
const app = express();
const config = require(process.argv[2] || process.cwd() + '/config.json');
const running = {};
let reqId = 0;
log('Config:', config);
for (const url in config) {
    const script = config[url];
    script.url = url;
    app.get('/' + url, (req, resp) => runTask(req, resp, script));
}
app.listen(8888);
function runTask(req, resp, script) {
    return __awaiter(this, void 0, void 0, function* () {
        resp.setHeader('Content-type', 'text/plain; charset=utf-8');
        const log = logger(`R${reqId++}`, resp);
        log(`Request to run ${script.url} from ${req.ips}`);
        if (script.singleton && running[script.url]) {
            log(`Only one run of ${script.url} allowed.`);
            return resp.end();
        }
        running[script.url] = true;
        yield Promise.all(script.cmd.map((cmd, idx) => runCmdChain(script, idx, log)));
        delete running[script.url];
        log('DONE');
        resp.end();
    });
}
function runCmdChain(script, idx, log) {
    return __awaiter(this, void 0, void 0, function* () {
        log = log.addTag(":C" + idx);
        log(`Running command chain`);
        const chain = script.cmd[idx];
        for (const cmd of chain) {
            try {
                yield runCmd(cmd, script, log);
            }
            catch (err) {
                if (!script.skipError) {
                    log(`${idx}:\tBreak execution due previous error in chain`);
                    break;
                }
            }
        }
        log(`Finished command chain`);
    });
}
function runCmd(cmd, script, log) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            let sh = '/bin/sh';
            let args = ["-c", cmd];
            if (script.user || script.group) {
                if (os.userInfo().uid === 0) {
                    let user = script.user || os.userInfo().username;
                    sh = '/usr/bin/su';
                    args = [user, "-c", cmd];
                    if (script.group)
                        args.push('-g', script.group);
                }
                else
                    log('Setting user/group in config not effective when non-root user runnin this service. Ignoring');
            }
            log(`Spawning`, sh, args);
            const prc = child.spawn(sh, args);
            let killtimer, termtimer;
            log = log.addTag(':P' + prc.pid);
            log('Starting ', cmd);
            prc.on('close', (code) => {
                if (killtimer)
                    clearTimeout(killtimer);
                if (termtimer)
                    clearTimeout(termtimer);
                if (code !== 0)
                    reject(log(`Command '${cmd}' aborted with error code ${code}.`));
                else
                    resolve(log(`Command '${cmd}' done with error code ${code}.`));
            });
            const stdout = readline.createInterface({ input: prc.stdout });
            const stderr = readline.createInterface({ input: prc.stderr });
            stdout.on('line', line => {
                log(line);
            });
            stderr.on('line', line => {
                log('ERR: ' + line);
            });
            if (script.timeout) {
                termtimer = setTimeout(() => {
                    killtimer = setTimeout(() => {
                        log('Sending SIGKILL, due timeout');
                        prc.kill("SIGKILL");
                    }, script.timeout);
                    log('Sending SIGTERM, due timeout');
                    prc.kill("SIGTERM");
                }, script.timeout);
            }
        });
    });
}
//# sourceMappingURL=index.js.map