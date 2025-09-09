import express from 'express';
import bodyParser from 'body-parser';
import userRoutes from './routes/users.js';
import sshRoutes from './routes/ssh.js';
import alertRoutes from './routes/alerts.js';
import credentialsRoutes from './routes/credentials.js';
import cors from 'cors';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { databaseLogger, apiLogger } from '../utils/logger.js';

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

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
        databaseLogger.error(`Failed to fetch from GitHub API`, error, { operation: 'github_api', endpoint });
        throw error;
    }
}

app.use(bodyParser.json());

app.get('/health', (req, res) => {
    res.json({status: 'ok'});
});

app.get('/version', async (req, res) => {
    let localVersion = process.env.VERSION;

    if (!localVersion) {
        try {
            const packagePath = path.resolve(process.cwd(), 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            localVersion = packageJson.version;
        } catch (error) {
            databaseLogger.error('Failed to read version from package.json', error, { operation: 'version_check' });
        }
    }

    if (!localVersion) {
        databaseLogger.error('No version information available', undefined, { operation: 'version_check' });
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
            databaseLogger.warn('Remote version not found in GitHub response', { operation: 'version_check', rawTag });
            return res.status(401).send('Remote Version Not Found');
        }

        const isUpToDate = localVersion === remoteVersion;

        const response = {
            status: isUpToDate ? 'up_to_date' : 'requires_update',
            localVersion: localVersion,
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
        databaseLogger.error('Version check failed', err, { operation: 'version_check' });
        res.status(500).send('Fetch Error');
    }
});

app.get('/releases/rss', async (req, res) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const per_page = Math.min(parseInt(req.query.per_page as string) || 20, 100);
        const cacheKey = `releases_rss_${page}_${per_page}`;

        // RSS releases requested

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

        // RSS releases generated successfully

        res.json(response);
    } catch (error) {
        databaseLogger.error('Failed to generate RSS format', error, { operation: 'rss_releases' });
        res.status(500).json({
            error: 'Failed to generate RSS format',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});


app.use('/users', userRoutes);
app.use('/ssh', sshRoutes);
app.use('/alerts', alertRoutes);
app.use('/credentials', credentialsRoutes);

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    apiLogger.error('Unhandled error in request', err, { 
        operation: 'error_handler', 
        method: req.method, 
        url: req.url,
        userAgent: req.get('User-Agent')
    });
    res.status(500).json({error: 'Internal Server Error'});
});

const PORT = 8081;
app.listen(PORT, () => {
    databaseLogger.success(`Database API server started on port ${PORT}`, { 
        operation: 'server_start', 
        port: PORT,
        routes: ['/users', '/ssh', '/alerts', '/credentials', '/health', '/version', '/releases/rss']
    });
});