/**
 * 匿名省流方案的 commit sha 缓存（localStorage，10min TTL）。
 *
 * 用途：匿名读文件时，用「仓库最新 commit sha」构造 jsDelivr `/gh/` URL（内容寻址精确绕墙）。
 * 缓存避免同仓库 10min 内反复消耗 REST 额度去查最新提交（`GET /repos/{o}/{r}/commits/{branch}`）。
 *
 * 非敏感数据（仅 sha + 时间戳），localStorage 即可；key 含 owner/repo@branch 隔离不同仓库分支。
 */
const SHA_KEY_PREFIX = "puregit:sha:";
const SHA_TTL_MS = 10 * 60 * 1000;

interface ShaEntry {
  sha: string;
  at: number;
}

function cacheKey(owner: string, repo: string, branch: string): string {
  return `${SHA_KEY_PREFIX}${owner}/${repo}@${branch}`;
}

/** 读取缓存的 commit sha（未命中 / 超 10min / 解析失败返回 null） */
export function getCachedSha(owner: string, repo: string, branch: string): string | null {
  try {
    const raw = localStorage.getItem(cacheKey(owner, repo, branch));
    if (!raw) return null;
    const entry = JSON.parse(raw) as ShaEntry;
    if (typeof entry.sha !== "string" || Date.now() - entry.at > SHA_TTL_MS) return null;
    return entry.sha;
  } catch {
    return null;
  }
}

/** 写入 commit sha（失败静默，仅失去缓存收益） */
export function setCachedSha(owner: string, repo: string, branch: string, sha: string): void {
  try {
    localStorage.setItem(cacheKey(owner, repo, branch), JSON.stringify({ sha, at: Date.now() }));
  } catch {
    /* ignore */
  }
}
