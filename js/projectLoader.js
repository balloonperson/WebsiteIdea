import { extractProjectZip } from "./zip.js";
import { loadGithubRepo } from "./api.js";

export function wireProjectLoader({ fileInput, uploadBox, githubUrlInput, githubButton, statusEl, errorEl, onLoaded }) {
  fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) await handleZip(file);
  });

  uploadBox.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadBox.classList.add("dragging");
  });
  uploadBox.addEventListener("dragleave", () => uploadBox.classList.remove("dragging"));
  uploadBox.addEventListener("drop", async (event) => {
    event.preventDefault();
    uploadBox.classList.remove("dragging");
    const [file] = event.dataTransfer.files;
    if (file) await handleZip(file);
  });

  githubButton.addEventListener("click", () => handleGithub());
  githubUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleGithub();
  });

  async function handleZip(file) {
    clearError();
    statusEl.textContent = "Processing ZIP...";
    try {
      const project = await extractProjectZip(file);
      statusEl.textContent = `${project.fileName}: ${project.acceptedFiles.length} files accepted, ${project.skippedCount} skipped.`;
      onLoaded(project);
    } catch (error) {
      statusEl.textContent = "No project loaded yet.";
      showError(error.message);
    }
  }

  async function handleGithub() {
    const repoUrl = githubUrlInput.value.trim();
    if (!repoUrl) return;
    clearError();
    statusEl.textContent = "Downloading repository...";
    githubButton.disabled = true;
    try {
      const project = await loadGithubRepo({ repoUrl });
      statusEl.textContent = `${project.fileName}: ${project.acceptedCount} files accepted, ${project.skippedCount} skipped.`;
      onLoaded(project);
    } catch (error) {
      statusEl.textContent = "";
      showError(error.message);
    } finally {
      githubButton.disabled = false;
    }
  }

  function showError(message) {
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
}

export function selectRelevantFiles(files, subject, limit = 40) {
  const tokens = (subject || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 2);

  const alwaysInclude = /(^|\/)(package\.json|index\.(html|js|ts|tsx)|main\.(js|ts|tsx)|app\.(js|ts|tsx)|server\.(js|ts))$/i;
  const selected = files.filter((file) => {
    const lowerPath = file.path.toLowerCase();
    return alwaysInclude.test(file.path) || tokens.some((token) => lowerPath.includes(token));
  });

  const fallback = selected.length ? selected : files.slice(0, 20);
  return fallback.slice(0, limit);
}
