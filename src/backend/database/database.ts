import express from 'express';
import bodyParser from 'body-parser';
import userRoutes from './routes/users.js';
import sshRoutes from './routes/ssh.js';
import alertRoutes from './routes/alerts.js';
import chalk from 'chalk';
import cors from 'cors';
import fetch from 'node-fetch';
import 'dotenv/config';

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

const dbIconSymbol = '🗄️';
const getTimeStamp = (): string => chalk.gray(`[${new Date().toLocaleTimeString()}]`);
const formatMessage = (level: string, colorFn: chalk.Chalk, message: string): string => {
    return `${getTimeStamp()} ${colorFn(`[${level.toUpperCase()}]`)} ${chalk.hex('#1e3a8a')(`[${dbIconSymbol}]`)} ${message}`;
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

interface CacheEntry {
    data: any;
    timestamp: number;
    expiresAt: number;
}

class GitHubCache {
    private cache: Map<string, CacheEntry> = new Map();
    private readonly CACHE_DURATION = 30 * 60 * 1000;

    set(key: string, data: any): void {
        const now = Date.now();
        this.cache.set(key, {
            data,
            timestamp: now,
            expiresAt: now + this.CACHE_DURATION
        });
    }

    get(key: string): any | null {
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        }

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }
}

const githubCache = new GitHubCache();

const GITHUB_API_BASE = 'https://api.github.com';
const REPO_OWNER = 'LukeGus';
const REPO_NAME = 'Termix';

interface GitHubRelease {
    id: number;
    tag_name: string;
    name: string;
    body: string;
    published_at: string;
    html_url: string;
    assets: Array<{
        id: number;
        name: string;
        size: number;
        download_count: number;
        browser_download_url: string;
    }>;
    prerelease: boolean;
    draft: boolean;
}

async function fetchGitHubAPI(endpoint: string, cacheKey: string): Promise<any> {
    const cachedData = githubCache.get(cacheKey);
    if (cachedData) {
        return {
            data: cachedData,
            cached: true,
            cache_age: Date.now() - cachedData.timestamp
        };
    }

    try {
        const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
            headers: {
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'TermixUpdateChecker/1.0',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        githubCache.set(cacheKey, data);

        return {
            data: data,
            cached: false
        };
    } catch (error) {
        logger.error(`Failed to fetch from GitHub API: ${endpoint}`, error);
        throw error;
    }
}

app.use(bodyParser.json());

app.get('/health', (req, res) => {
    res.json({status: 'ok'});
});

app.get('/version', async (req, res) => {
    const localVersion = process.env.VERSION;

    if (!localVersion) {
        return res.status(404).send('Local Version Not Set');
    }

    try {
        const cacheKey = 'latest_release';
        const releaseData = await fetchGitHubAPI(
            `/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
            cacheKey
        );

        const rawTag = releaseData.data.tag_name || releaseData.data.name || '';
        const remoteVersionMatch = rawTag.match(/(\d+\.\d+(\.\d+)?)/);
        const remoteVersion = remoteVersionMatch ? remoteVersionMatch[1] : null;

        if (!remoteVersion) {
            return res.status(401).send('Remote Version Not Found');
        }

        const response = {
            status: localVersion === remoteVersion ? 'up_to_date' : 'requires_update',
            version: remoteVersion,
            latest_release: {
                tag_name: releaseData.data.tag_name,
                name: releaseData.data.name,
                published_at: releaseData.data.published_at,
                html_url: releaseData.data.html_url
            },
            cached: releaseData.cached,
            cache_age: releaseData.cache_age
        };

        res.json(response);
    } catch (err) {
        logger.error('Version check failed', err);
        res.status(500).send('Fetch Error');
    }
});

app.get('/releases/rss', async (req, res) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const per_page = Math.min(parseInt(req.query.per_page as string) || 20, 100);
        const cacheKey = `releases_rss_${page}_${per_page}`;

        const releasesData = await fetchGitHubAPI(
            `/repos/${REPO_OWNER}/${REPO_NAME}/releases?page=${page}&per_page=${per_page}`,
            cacheKey
        );

        const rssItems = releasesData.data.map((release: GitHubRelease) => ({
            id: release.id,
            title: release.name || release.tag_name,
            description: release.body,
            link: release.html_url,
            pubDate: release.published_at,
            version: release.tag_name,
            isPrerelease: release.prerelease,
            isDraft: release.draft,
            assets: release.assets.map(asset => ({
                name: asset.name,
                size: asset.size,
                download_count: asset.download_count,
                download_url: asset.browser_download_url
            }))
        }));

        const response = {
            feed: {
                title: `${REPO_NAME} Releases`,
                description: `Latest releases from ${REPO_NAME} repository`,
                link: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
                updated: new Date().toISOString()
            },
            items: rssItems,
            total_count: rssItems.length,
            cached: releasesData.cached,
            cache_age: releasesData.cache_age
        };

        res.json(response);
    } catch (error) {
        logger.error('Failed to generate RSS format', error)
        res.status(500).json({
            error: 'Failed to generate RSS format',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Health check endpoint for Electron backend manager
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'database-api',
        port: PORT
    });
});

app.use('/users', userRoutes);
app.use('/ssh', sshRoutes);
app.use('/alerts', alertRoutes);

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({error: 'Internal Server Error'});
});

const PORT = 8081;
app.listen(PORT, () => {
});