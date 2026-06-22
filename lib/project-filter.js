// Server-side filtering rules for project imports.
// NOTE: js/zip.js holds an equivalent copy of these constants for client-side
// ZIP processing. Both sets are intentionally kept identical; consolidation
// into a single shared module is deferred.

export const SKIP_FOLDERS = [
  "node_modules",
  ".git",
  "Library",
  "Temp",
  "Logs",
  "obj",
  "bin",
  "build",
  "dist",
  ".cache",
  "__pycache__"
];

export const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".mp3",
  ".wav",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  ".pyc",
  ".pdb",
  ".uasset",
  ".umap",
  ".fbx",
  ".blend"
]);

export const MAX_FILE_BYTES = 80 * 1024;
export const MAX_ACCEPTED_FILES = 200;
export const MAX_COMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
export const MAX_ENTRIES = 20_000;

/**
 * Filter a JSZip instance and return accepted text files.
 *
 * Expects the archive to have already been loaded via JSZip.loadAsync().
 * Strips the GitHub-generated top-level directory prefix from all paths,
 * rejects path-traversal and absolute-path entries, accumulates uncompressed
 * size as it goes, and applies folder/extension/file-size rules.
 *
 * @param {import('jszip')} zip
 * @returns {{ acceptedFiles: Array<{path: string, content: string}>, skippedCount: number, foundCount: number }}
 */
export async function filterZipEntries(zip) {
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const foundCount = entries.length;

  if (foundCount > MAX_ENTRIES) {
    const error = new Error(`Archive contains too many entries (${foundCount} > ${MAX_ENTRIES}).`);
    error.statusCode = 413;
    throw error;
  }

  // Detect the common top-level prefix GitHub adds to zipball archives
  // (e.g. "owner-repo-abc123/"). Strip it so paths start at the repo root.
  const topLevelPrefix = detectTopLevelPrefix(entries.map((e) => e.name));

  const accepted = [];
  let skippedCount = 0;
  let uncompressedTotal = 0;

  for (const entry of entries) {
    const rawPath = entry.name;
    const path = normalizePath(rawPath, topLevelPrefix);

    if (!path) {
      skippedCount++;
      continue;
    }

    // Reject path-traversal and absolute paths
    if (isUnsafePath(path)) {
      skippedCount++;
      continue;
    }

    const uncompressedSize = entry._data?.uncompressedSize ?? 0;

    if (getSkipReason(path, uncompressedSize)) {
      skippedCount++;
      continue;
    }

    // Enforce total uncompressed limit before reading content
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > MAX_UNCOMPRESSED_BYTES) {
      const error = new Error("Archive uncompressed size exceeds the 200 MB limit.");
      error.statusCode = 413;
      throw error;
    }

    try {
      const content = await entry.async("string");
      if (content.length > MAX_FILE_BYTES || looksBinary(content)) {
        skippedCount++;
        continue;
      }
      accepted.push({ path, content, size: content.length });
    } catch {
      skippedCount++;
    }
  }

  // Sort smallest-first, cap at limit, strip size from final output
  const cappedAccepted = accepted
    .sort((a, b) => a.size - b.size)
    .slice(0, MAX_ACCEPTED_FILES)
    .map(({ path, content }) => ({ path, content }));

  skippedCount += Math.max(accepted.length - cappedAccepted.length, 0);

  if (!cappedAccepted.length) {
    const error = new Error("No readable text files were found after filtering.");
    error.statusCode = 422;
    throw error;
  }

  return { acceptedFiles: cappedAccepted, skippedCount, foundCount };
}

function detectTopLevelPrefix(names) {
  if (!names.length) return "";
  const firstParts = names.map((n) => n.replace(/\\/g, "/").split("/")[0]);
  const candidate = firstParts[0];
  if (candidate && firstParts.every((p) => p === candidate)) {
    return candidate + "/";
  }
  return "";
}

function normalizePath(rawPath, topLevelPrefix) {
  let path = rawPath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (topLevelPrefix && path.startsWith(topLevelPrefix)) {
    path = path.slice(topLevelPrefix.length);
  }
  return path.replace(/^\/+/, "");
}

function isUnsafePath(path) {
  if (path.startsWith("/")) return true;
  const parts = path.split("/");
  return parts.some((part) => part === ".." || part === ".");
}

function getSkipReason(path, size) {
  const parts = path.split("/");
  if (parts.some((part) => SKIP_FOLDERS.includes(part))) {
    return "ignored folder";
  }
  if (path.endsWith(".DS_Store")) {
    return "system file";
  }
  if (BINARY_EXTENSIONS.has(getExtension(path))) {
    return "binary extension";
  }
  if (size > MAX_FILE_BYTES) {
    return "file too large";
  }
  return "";
}

function getExtension(path) {
  const dotIndex = path.lastIndexOf(".");
  return dotIndex === -1 ? "" : path.slice(dotIndex).toLowerCase();
}

function looksBinary(content) {
  return content.includes("\0");
}
