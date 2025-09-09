import express from 'express';
import fetch from 'node-fetch';
import net from 'net';
import cors from 'cors';
import {Client, type ConnectConfig} from 'ssh2';
import {db} from '../database/db/index.js';
import {sshData, sshCredentials} from '../database/db/schema.js';
import {eq, and} from 'drizzle-orm';
import { statsLogger } from '../utils/logger.js';

type HostStatus = 'online' | 'offline';

interface SSHHostWithCredentials {
    id: number;
    name: string;
    ip: string;
    port: number;
    username: string;
    folder: string;
    tags: string[];
    pin: boolean;
    authType: string;
    password?: string;
    key?: string;
    keyPassword?: string;
    keyType?: string;
    credentialId?: number;
    enableTerminal: boolean;
    enableTunnel: boolean;
    enableFileManager: boolean;
    defaultPath: string;
    tunnelConnections: any[];
    createdAt: string;
    updatedAt: string;
    userId: string;
}

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


const hostStatuses: Map<number, StatusEntry> = new Map();

async function fetchAllHosts(): Promise<SSHHostWithCredentials[]> {
    try {
        const hosts = await db.select().from(sshData);

        const hostsWithCredentials: SSHHostWithCredentials[] = [];
        for (const host of hosts) {
            try {
                const hostWithCreds = await resolveHostCredentials(host);
                if (hostWithCreds) {
                    hostsWithCredentials.push(hostWithCreds);
                }
            } catch (err) {
                statsLogger.warn(`Failed to resolve credentials for host ${host.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
        }

        return hostsWithCredentials.filter(h => !!h.id && !!h.ip && !!h.port);
    } catch (err) {
        statsLogger.error('Failed to fetch hosts from database', err);
        return [];
    }
}

async function fetchHostById(id: number): Promise<SSHHostWithCredentials | undefined> {
    try {
        const hosts = await db.select().from(sshData).where(eq(sshData.id, id));

        if (hosts.length === 0) {
            return undefined;
        }

        const host = hosts[0];
        return await resolveHostCredentials(host);
    } catch (err) {
        statsLogger.error(`Failed to fetch host ${id}`, err);
        return undefined;
    }
}

async function resolveHostCredentials(host: any): Promise<SSHHostWithCredentials | undefined> {
    try {
        statsLogger.info('Resolving credentials for host', { operation: 'host_credential_resolve', hostId: host.id, hostName: host.name, hasCredentialId: !!host.credentialId });
        
        const baseHost: any = {
            id: host.id,
            name: host.name,
            ip: host.ip,
            port: host.port,
            username: host.username,
            folder: host.folder || '',
            tags: typeof host.tags === 'string' ? (host.tags ? host.tags.split(',').filter(Boolean) : []) : [],
            pin: !!host.pin,
            authType: host.authType,
            enableTerminal: !!host.enableTerminal,
            enableTunnel: !!host.enableTunnel,
            enableFileManager: !!host.enableFileManager,
            defaultPath: host.defaultPath || '/',
            tunnelConnections: host.tunnelConnections ? JSON.parse(host.tunnelConnections) : [],
            createdAt: host.createdAt,
            updatedAt: host.updatedAt,
            userId: host.userId
        };

        if (host.credentialId) {
            statsLogger.info('Fetching credentials from database', { operation: 'host_credential_resolve', hostId: host.id, credentialId: host.credentialId, userId: host.userId });
            try {
                const credentials = await db
                    .select()
                    .from(sshCredentials)
                    .where(and(
                        eq(sshCredentials.id, host.credentialId),
                        eq(sshCredentials.userId, host.userId)
                    ));

                if (credentials.length > 0) {
                    const credential = credentials[0];
                    baseHost.credentialId = credential.id;
                    baseHost.username = credential.username;
                    baseHost.authType = credential.authType;

                    if (credential.password) {
                        baseHost.password = credential.password;
                    }
                    if (credential.key) {
                        baseHost.key = credential.key;
                    }
                    if (credential.keyPassword) {
                        baseHost.keyPassword = credential.keyPassword;
                    }
                    if (credential.keyType) {
                        baseHost.keyType = credential.keyType;
                    }
                } else {
                    statsLogger.warn(`Credential ${host.credentialId} not found for host ${host.id}, using legacy data`);
                    addLegacyCredentials(baseHost, host);
                }
            } catch (error) {
                statsLogger.warn(`Failed to resolve credential ${host.credentialId} for host ${host.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                addLegacyCredentials(baseHost, host);
            }
        } else {
            addLegacyCredentials(baseHost, host);
        }

        return baseHost;
    } catch (error) {
        statsLogger.error(`Failed to resolve host credentials for host ${host.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return undefined;
    }
}

function addLegacyCredentials(baseHost: any, host: any): void {
    baseHost.password = host.password || null;
    baseHost.key = host.key || null;
    baseHost.keyPassword = host.keyPassword || null;
    baseHost.keyType = host.keyType;
}

function buildSshConfig(host: SSHHostWithCredentials): ConnectConfig {
    const base: ConnectConfig = {
        host: host.ip,
        port: host.port || 22,
        username: host.username || 'root',
        readyTimeout: 10_000,
        algorithms: {}
    } as ConnectConfig;

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
            statsLogger.error(`SSH key format error for host ${host.ip}: ${keyError instanceof Error ? keyError.message : 'Unknown error'}`);
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
            const diskOutHuman = await execCommand(client, 'df -h -P / | tail -n +2');
            const diskOutBytes = await execCommand(client, 'df -B1 -P / | tail -n +2');

            const humanLine = diskOutHuman.stdout.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
            const bytesLine = diskOutBytes.stdout.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';

            const humanParts = humanLine.split(/\s+/);
            const bytesParts = bytesLine.split(/\s+/);

            if (humanParts.length >= 6 && bytesParts.length >= 6) {
                totalHuman = humanParts[1] || null;
                usedHuman = humanParts[2] || null;

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
    statsLogger.info('Starting status polling for all hosts', { operation: 'status_poll' });
    const hosts = await fetchAllHosts();
    if (hosts.length === 0) {
        statsLogger.warn('No hosts retrieved for status polling', { operation: 'status_poll' });
        return;
    }

    statsLogger.info('Polling status for hosts', { operation: 'status_poll', hostCount: hosts.length, hostIds: hosts.map(h => h.id) });
    const now = new Date().toISOString();

    const checks = hosts.map(async (h) => {
        statsLogger.info('Checking host status', { operation: 'status_poll', hostId: h.id, hostName: h.name, ip: h.ip, port: h.port });
        const isOnline = await tcpPing(h.ip, h.port, 5000);
        const now = new Date().toISOString();
        const statusEntry: StatusEntry = {status: isOnline ? 'online' : 'offline', lastChecked: now};
        hostStatuses.set(h.id, statusEntry);
        statsLogger.info('Host status check completed', { operation: 'status_poll', hostId: h.id, hostName: h.name, status: isOnline ? 'online' : 'offline' });
        return isOnline;
    });

    const results = await Promise.allSettled(checks);
    const onlineCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    const offlineCount = hosts.length - onlineCount;
    statsLogger.success('Status polling completed', { operation: 'status_poll', totalHosts: hosts.length, onlineCount, offlineCount });
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
        statsLogger.error('Failed to check host status', err);
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
        statsLogger.error('Failed to collect metrics', err);
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
    statsLogger.success('Server Stats API server started', { operation: 'server_start', port: PORT });
    try {
        await pollStatusesOnce();
    } catch (err) {
        statsLogger.error('Initial poll failed', err, { operation: 'initial_poll' });
    }
});