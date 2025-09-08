import express from 'express';
import chalk from 'chalk';
import fetch from 'node-fetch';
import net from 'net';
import cors from 'cors';
import {Client, type ConnectConfig} from 'ssh2';
import {sshHostService} from '../services/ssh-host.js';
import type {SSHHostWithCredentials} from '../services/ssh-host.js';

// Removed HostRecord - using SSHHostWithCredentials from ssh-host service instead

type HostStatus = 'online' | 'offline';

type StatusEntry = {
    status: HostStatus;
    lastChecked: string;
};

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});
app.use(express.json());

const statsIconSymbol = '📡';
const getTimeStamp = (): string => chalk.gray(`[${new Date().toLocaleTimeString()}]`);
const formatMessage = (level: string, colorFn: chalk.Chalk, message: string): string => {
    return `${getTimeStamp()} ${colorFn(`[${level.toUpperCase()}]`)} ${chalk.hex('#22c55e')(`[${statsIconSymbol}]`)} ${message}`;
};
const logger = {
    info: (msg: string): void => {
        console.log(formatMessage('info', chalk.cyan, msg));
    },
    warn: (msg: string): void => {
        console.warn(formatMessage('warn', chalk.yellow, msg));
    },
    error: (msg: string, err?: unknown): void => {
        console.error(formatMessage('error', chalk.redBright, msg));
        if (err) console.error(err);
    },
    success: (msg: string): void => {
        console.log(formatMessage('success', chalk.greenBright, msg));
    },
    debug: (msg: string): void => {
        if (process.env.NODE_ENV !== 'production') {
            console.debug(formatMessage('debug', chalk.magenta, msg));
        }
    }
};

const hostStatuses: Map<number, StatusEntry> = new Map();

async function fetchAllHosts(): Promise<SSHHostWithCredentials[]> {
    const url = 'http://localhost:8081/ssh/db/host/internal';
    try {
        const resp = await fetch(url, {
            headers: {'x-internal-request': '1'}
        });
        if (!resp.ok) {
            throw new Error(`DB service error: ${resp.status} ${resp.statusText}`);
        }
        const data = await resp.json();
        const rawHosts = Array.isArray(data) ? data : [];
        
        // Resolve credentials for each host using the same logic as main SSH connections
        const hostsWithCredentials: SSHHostWithCredentials[] = [];
        for (const rawHost of rawHosts) {
            try {
                // Use the ssh-host service to properly resolve credentials
                const host = await sshHostService.getHostWithCredentials(rawHost.userId, rawHost.id);
                if (host) {
                    hostsWithCredentials.push(host);
                }
            } catch (err) {
                logger.warn(`Failed to resolve credentials for host ${rawHost.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
        }
        
        return hostsWithCredentials.filter(h => !!h.id && !!h.ip && !!h.port);
    } catch (err) {
        logger.error('Failed to fetch hosts from database service', err);
        return [];
    }
}

async function fetchHostById(id: number): Promise<SSHHostWithCredentials | undefined> {
    try {
        // Get all users that might own this host
        const url = 'http://localhost:8081/ssh/db/host/internal';
        const resp = await fetch(url, {
            headers: {'x-internal-request': '1'}
        });
        if (!resp.ok) {
            throw new Error(`DB service error: ${resp.status} ${resp.statusText}`);
        }
        const data = await resp.json();
        const rawHost = (Array.isArray(data) ? data : []).find((h: any) => h.id === id);
        
        if (!rawHost) {
            return undefined;
        }
        
        // Use ssh-host service to properly resolve credentials
        return await sshHostService.getHostWithCredentials(rawHost.userId, id);
    } catch (err) {
        logger.error(`Failed to fetch host ${id}`, err);
        return undefined;
    }
}

function buildSshConfig(host: SSHHostWithCredentials): ConnectConfig {
    const base: ConnectConfig = {
        host: host.ip,
        port: host.port || 22,
        username: host.username || 'root',
        readyTimeout: 10_000,
        algorithms: {}
    } as ConnectConfig;

    // Use the same authentication logic as main SSH connections
    if (host.authType === 'password') {
        if (!host.password) {
            throw new Error(`No password available for host ${host.ip}`);
        }
        (base as any).password = host.password;
    } else if (host.authType === 'key') {
        if (!host.key) {
            throw new Error(`No SSH key available for host ${host.ip}`);
        }
        
        try {
            if (!host.key.includes('-----BEGIN') || !host.key.includes('-----END')) {
                throw new Error('Invalid private key format');
            }
            
            const cleanKey = host.key.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            
            (base as any).privateKey = Buffer.from(cleanKey, 'utf8');
            
            if (host.keyPassword) {
                (base as any).passphrase = host.keyPassword;
            }
        } catch (keyError) {
            logger.error(`SSH key format error for host ${host.ip}: ${keyError instanceof Error ? keyError.message : 'Unknown error'}`);
            throw new Error(`Invalid SSH key format for host ${host.ip}`);
        }
    } else {
        throw new Error(`Unsupported authentication type '${host.authType}' for host ${host.ip}`);
    }
    
    return base;
}

async function withSshConnection<T>(host: SSHHostWithCredentials, fn: (client: Client) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const client = new Client();
        let settled = false;

        const onError = (err: Error) => {
            if (!settled) {
                settled = true;
                try {
                    client.end();
                } catch {
                }
                reject(err);
            }
        };

        client.on('ready', async () => {
            try {
                const result = await fn(client);
                if (!settled) {
                    settled = true;
                    try {
                        client.end();
                    } catch {
                    }
                    resolve(result);
                }
            } catch (err: any) {
                onError(err);
            }
        });

        client.on('error', onError);
        client.on('timeout', () => onError(new Error('SSH connection timeout')));
        try {
            client.connect(buildSshConfig(host));
        } catch (err: any) {
            onError(err);
        }
    });
}

function execCommand(client: Client, command: string): Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
}> {
    return new Promise((resolve, reject) => {
        client.exec(command, {pty: false}, (err, stream) => {
            if (err) return reject(err);
            let stdout = '';
            let stderr = '';
            let exitCode: number | null = null;
            stream.on('close', (code: number | undefined) => {
                exitCode = typeof code === 'number' ? code : null;
                resolve({stdout, stderr, code: exitCode});
            }).on('data', (data: Buffer) => {
                stdout += data.toString('utf8');
            }).stderr.on('data', (data: Buffer) => {
                stderr += data.toString('utf8');
            });
        });
    });
}

function parseCpuLine(cpuLine: string): { total: number; idle: number } | undefined {
    const parts = cpuLine.trim().split(/\s+/);
    if (parts[0] !== 'cpu') return undefined;
    const nums = parts.slice(1).map(n => Number(n)).filter(n => Number.isFinite(n));
    if (nums.length < 4) return undefined;
    const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
    const total = nums.reduce((a, b) => a + b, 0);
    return {total, idle};
}

function toFixedNum(n: number | null | undefined, digits = 2): number | null {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return Number(n.toFixed(digits));
}

function kibToGiB(kib: number): number {
    return kib / (1024 * 1024);
}

async function collectMetrics(host: SSHHostWithCredentials): Promise<{
    cpu: { percent: number | null; cores: number | null; load: [number, number, number] | null };
    memory: { percent: number | null; usedGiB: number | null; totalGiB: number | null };
    disk: { percent: number | null; usedHuman: string | null; totalHuman: string | null };
}> {
    return withSshConnection(host, async (client) => {
        let cpuPercent: number | null = null;
        let cores: number | null = null;
        let loadTriplet: [number, number, number] | null = null;
        try {
            const stat1 = await execCommand(client, 'cat /proc/stat');
            await new Promise(r => setTimeout(r, 500));
            const stat2 = await execCommand(client, 'cat /proc/stat');
            const loadAvgOut = await execCommand(client, 'cat /proc/loadavg');
            const coresOut = await execCommand(client, 'nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo');

            const cpuLine1 = (stat1.stdout.split('\n').find(l => l.startsWith('cpu ')) || '').trim();
            const cpuLine2 = (stat2.stdout.split('\n').find(l => l.startsWith('cpu ')) || '').trim();
            const a = parseCpuLine(cpuLine1);
            const b = parseCpuLine(cpuLine2);
            if (a && b) {
                const totalDiff = b.total - a.total;
                const idleDiff = b.idle - a.idle;
                const used = totalDiff - idleDiff;
                if (totalDiff > 0) cpuPercent = Math.max(0, Math.min(100, (used / totalDiff) * 100));
            }

            const laParts = loadAvgOut.stdout.trim().split(/\s+/);
            if (laParts.length >= 3) {
                loadTriplet = [Number(laParts[0]), Number(laParts[1]), Number(laParts[2])].map(v => Number.isFinite(v) ? Number(v) : 0) as [number, number, number];
            }

            const coresNum = Number((coresOut.stdout || '').trim());
            cores = Number.isFinite(coresNum) && coresNum > 0 ? coresNum : null;
        } catch (e) {
            cpuPercent = null;
            cores = null;
            loadTriplet = null;
        }

        let memPercent: number | null = null;
        let usedGiB: number | null = null;
        let totalGiB: number | null = null;
        try {
            const memInfo = await execCommand(client, 'cat /proc/meminfo');
            const lines = memInfo.stdout.split('\n');
            const getVal = (key: string) => {
                const line = lines.find(l => l.startsWith(key));
                if (!line) return null;
                const m = line.match(/\d+/);
                return m ? Number(m[0]) : null;
            };
            const totalKb = getVal('MemTotal:');
            const availKb = getVal('MemAvailable:');
            if (totalKb && availKb && totalKb > 0) {
                const usedKb = totalKb - availKb;
                memPercent = Math.max(0, Math.min(100, (usedKb / totalKb) * 100));
                usedGiB = kibToGiB(usedKb);
                totalGiB = kibToGiB(totalKb);
            }
        } catch (e) {
            memPercent = null;
            usedGiB = null;
            totalGiB = null;
        }

        let diskPercent: number | null = null;
        let usedHuman: string | null = null;
        let totalHuman: string | null = null;
        try {
            // Get both human-readable and bytes format for accurate calculation
            const diskOutHuman = await execCommand(client, 'df -h -P / | tail -n +2');
            const diskOutBytes = await execCommand(client, 'df -B1 -P / | tail -n +2');
            
            const humanLine = diskOutHuman.stdout.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
            const bytesLine = diskOutBytes.stdout.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
            
            const humanParts = humanLine.split(/\s+/);
            const bytesParts = bytesLine.split(/\s+/);
            
            if (humanParts.length >= 6 && bytesParts.length >= 6) {
                totalHuman = humanParts[1] || null;
                usedHuman = humanParts[2] || null;
                
                // Calculate our own percentage using bytes for accuracy
                const totalBytes = Number(bytesParts[1]);
                const usedBytes = Number(bytesParts[2]);
                
                if (Number.isFinite(totalBytes) && Number.isFinite(usedBytes) && totalBytes > 0) {
                    diskPercent = Math.max(0, Math.min(100, (usedBytes / totalBytes) * 100));
                }
            }
        } catch (e) {
            diskPercent = null;
            usedHuman = null;
            totalHuman = null;
        }

        return {
            cpu: {percent: toFixedNum(cpuPercent, 0), cores, load: loadTriplet},
            memory: {
                percent: toFixedNum(memPercent, 0),
                usedGiB: usedGiB ? toFixedNum(usedGiB, 2) : null,
                totalGiB: totalGiB ? toFixedNum(totalGiB, 2) : null
            },
            disk: {percent: toFixedNum(diskPercent, 0), usedHuman, totalHuman},
        };
    });
}

function tcpPing(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;

        const onDone = (result: boolean) => {
            if (settled) return;
            settled = true;
            try {
                socket.destroy();
            } catch {
            }
            resolve(result);
        };

        socket.setTimeout(timeoutMs);

        socket.once('connect', () => onDone(true));
        socket.once('timeout', () => onDone(false));
        socket.once('error', () => onDone(false));
        socket.connect(port, host);
    });
}

async function pollStatusesOnce(): Promise<void> {
    const hosts = await fetchAllHosts();
    if (hosts.length === 0) {
        logger.warn('No hosts retrieved for status polling');
        return;
    }

    const now = new Date().toISOString();

    const checks = hosts.map(async (h) => {
        const isOnline = await tcpPing(h.ip, h.port, 5000);
        const now = new Date().toISOString();
        const statusEntry: StatusEntry = {status: isOnline ? 'online' : 'offline', lastChecked: now};
        hostStatuses.set(h.id, statusEntry);
        return isOnline;
    });

    const results = await Promise.allSettled(checks);
    const onlineCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    const offlineCount = hosts.length - onlineCount;
}

app.get('/status', async (req, res) => {
    if (hostStatuses.size === 0) {
        await pollStatusesOnce();
    }
    const result: Record<number, StatusEntry> = {};
    for (const [id, entry] of hostStatuses.entries()) {
        result[id] = entry;
    }
    res.json(result);
});

app.get('/status/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
        return res.status(400).json({error: 'Invalid id'});
    }

    try {
        const host = await fetchHostById(id);
        if (!host) {
            return res.status(404).json({error: 'Host not found'});
        }
        
        const isOnline = await tcpPing(host.ip, host.port, 5000);
        const now = new Date().toISOString();
        const statusEntry: StatusEntry = {status: isOnline ? 'online' : 'offline', lastChecked: now};
        
        hostStatuses.set(id, statusEntry);
        res.json(statusEntry);
    } catch (err) {
        logger.error('Failed to check host status', err);
        res.status(500).json({error: 'Failed to check host status'});
    }
});

app.post('/refresh', async (req, res) => {
    await pollStatusesOnce();
    res.json({message: 'Refreshed'});
});

app.get('/metrics/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
        return res.status(400).json({error: 'Invalid id'});
    }
    try {
        const host = await fetchHostById(id);
        if (!host) {
            return res.status(404).json({error: 'Host not found'});
        }
        const metrics = await collectMetrics(host);
        res.json({...metrics, lastChecked: new Date().toISOString()});
    } catch (err) {
        logger.error('Failed to collect metrics', err);
        return res.json({
            cpu: {percent: null, cores: null, load: null},
            memory: {percent: null, usedGiB: null, totalGiB: null},
            disk: {percent: null, usedHuman: null, totalHuman: null},
            lastChecked: new Date().toISOString()
        });
    }
});

const PORT = 8085;
app.listen(PORT, async () => {
    try {
        await pollStatusesOnce();
    } catch (err) {
        logger.error('Initial poll failed', err);
    }
});