import JSZip from "jszip";
import { MAX_COMPRESSED_BYTES, filterZipEntries } from "./project-filter.js";

const GITHUB_API = "https://api.github.com";
const DOWNLOAD_TIMEOUT_MS = 30_000;

// Only alphanumeric, hyphens, underscores, and dots — no path injection.
const VALID_SEGMENT = /^[a-zA-Z0-9_.\-]+$/;

/**
 * Parse and validate a public GitHub repository URL.
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/
 *   https://github.com/owner/repo.git
 *
 * Rejects non-GitHub hosts, missing owner/repo, PR/issue/blob/file paths,
 * and segments that don't match the allowed character set.
 *
 * @param {string} rawUrl
 * @returns {{ owner: string, repo: string }}
 */
export function parseGithubUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    const error = new Error("Invalid URL. Paste a full GitHub repository URL.");
    error.statusCode = 400;
    throw error;
  }

  if (url.hostname !== "github.com") {
    const error = new Error("Only github.com repository URLs are supported.");
    error.statusCode = 400;
    throw error;
  }

  // Strip leading slash and trailing .git / slash
  const cleanPath = url.pathname.replace(/^\//, "").replace(/\.git\/?$/, "").replace(/\/$/, "");
  const parts = cleanPath.split("/");

  if (parts.length < 2 || !parts[0] || !parts[1]) {
    const error = new Error("URL must point to a repository: github.com/owner/repo");
    error.statusCode = 400;
    throw error;
  }

  const [owner, repo, extra] = parts;

  // Reject URLs pointing at sub-pages (PRs, issues, files, etc.)
  if (extra && !["tree", "blob"].includes(extra)) {
    const error = new Error(
      "URL must point to the repository root, not a specific file, PR, or issue."
    );
    error.statusCode = 400;
    throw error;
  }

  // Only reject extra == "blob" (individual file), allow "tree" paths to be
  // silently ignored — we always use the default branch anyway.
  if (extra === "blob") {
    const error = new Error("URL points to a specific file. Use the repository root URL instead.");
    error.statusCode = 400;
    throw error;
  }

  if (!VALID_SEGMENT.test(owner) || !VALID_SEGMENT.test(repo)) {
    const error = new Error("Repository owner or name contains invalid characters.");
    error.statusCode = 400;
    throw error;
  }

  return { owner, repo };
}

/**
 * Download the repository as a single ZIP archive and return a filtered
 * project object in the same shape as extractProjectZip() produces on the client.
 *
 * Makes exactly one GitHub API request:
 *   GET /repos/{owner}/{repo}/zipball  (no ref → GitHub uses the default branch)
 *
 * @param {string} repoUrl
 * @returns {Promise<{
 *   fileName: string,
 *   source: string,
 *   repoUrl: string,
 *   acceptedFiles: Array<{path: string, content: string}>,
 *   acceptedCount: number,
 *   skippedCount: number,
 *   foundCount: number
 * }>}
 */
export async function fetchRepoFiles(repoUrl) {
  const { owner, repo } = parseGithubUrl(repoUrl);

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "coding-agent-instruction-generator",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const buffer = await downloadZipball(owner, repo, headers);
  const zip = await JSZip.loadAsync(buffer);
  const { acceptedFiles, skippedCount, foundCount } = await filterZipEntries(zip);

  return {
    fileName: `${owner}/${repo}`,
    source: "github",
    repoUrl: `https://github.com/${owner}/${repo}`,
    acceptedFiles,
    acceptedCount: acceptedFiles.length,
    skippedCount,
    foundCount
  };
}

async function downloadZipball(owner, repo, headers) {
  const zipballUrl = `${GITHUB_API}/repos/${owner}/${repo}/zipball`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(zipballUrl, {
      headers,
      redirect: "follow",
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      const err = new Error("GitHub download timed out after 30 seconds.");
      err.statusCode = 504;
      throw err;
    }
    throw error;
  }

  clearTimeout(timeout);

  if (response.status === 404) {
    const err = new Error(
      `Repository not found or not public: github.com/${owner}/${repo}`
    );
    err.statusCode = 404;
    throw err;
  }

  if (response.status === 429 || response.status === 403) {
    const err = new Error(
      "GitHub API rate limit reached. Add a GITHUB_TOKEN to your .env file for higher limits."
    );
    err.statusCode = 429;
    throw err;
  }

  if (!response.ok) {
    const err = new Error(`GitHub returned an unexpected error (HTTP ${response.status}).`);
    err.statusCode = 502;
    throw err;
  }

  // Stream the body while enforcing the compressed-size limit
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of response.body) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_COMPRESSED_BYTES) {
      const err = new Error("Repository archive exceeds the 50 MB compressed size limit.");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}
