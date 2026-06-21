export async function getConfig() {
  const response = await fetch("/api/config");
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Could not load app config.");
  }

  return payload;
}

export async function suggestSubjects({ fileTree, fileSamples, targetModel }) {
  return postJson("/api/suggest", { fileTree, fileSamples, targetModel });
}

export async function generateInstructions({
  targetModel,
  subject,
  optimizationPath,
  fileTree,
  relevantFiles
}) {
  return postJson("/api/generate", {
    targetModel,
    subject,
    optimizationPath,
    fileTree,
    relevantFiles
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}
