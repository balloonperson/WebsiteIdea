const SKIP_FOLDERS = [
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

const BINARY_EXTENSIONS = new Set([
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

const MAX_FILE_BYTES = 80 * 1024;
const MAX_ACCEPTED_FILES = 200;

export async function extractProjectZip(file) {
  if (!file?.name?.toLowerCase().endsWith(".zip")) {
    throw new Error("Please upload a .zip project file.");
  }

  if (!window.JSZip) {
    throw new Error("JSZip did not load. Check your internet connection and refresh.");
  }

  const zip = await window.JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const accepted = [];
  const skipped = [];

  for (const entry of entries) {
    const path = normalizePath(entry.name);
    const size = entry._data?.uncompressedSize || 0;
    const skipReason = getSkipReason(path, size);

    if (skipReason) {
      skipped.push({ path, reason: skipReason });
      continue;
    }

    try {
      const content = await entry.async("string");
      if (content.length > MAX_FILE_BYTES || looksBinary(content)) {
        skipped.push({ path, reason: "large or binary content" });
        continue;
      }
      accepted.push({ path, content, size: content.length });
    } catch {
      skipped.push({ path, reason: "could not read as text" });
    }
  }

  const cappedAccepted = accepted
    .sort((a, b) => a.size - b.size)
    .slice(0, MAX_ACCEPTED_FILES)
    .map(({ path, content }) => ({ path, content }));

  if (!cappedAccepted.length) {
    throw new Error("No readable text files were found after filtering.");
  }

  return {
    fileName: file.name,
    acceptedFiles: cappedAccepted,
    skippedCount: skipped.length + Math.max(accepted.length - cappedAccepted.length, 0),
    foundCount: entries.length,
    isLargeZip: file.size > 50 * 1024 * 1024
  };
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

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

function getExtension(path) {
  const dotIndex = path.lastIndexOf(".");
  return dotIndex === -1 ? "" : path.slice(dotIndex).toLowerCase();
}

function looksBinary(content) {
  return content.includes("\0");
}
