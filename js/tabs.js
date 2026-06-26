const buttons = document.querySelectorAll(".tab-button");
const panels = document.querySelectorAll(".tab-panel");

for (const button of buttons) {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
}

function activateTab(tabName) {
  for (const button of buttons) {
    button.classList.toggle("active", button.dataset.tab === tabName);
  }
  for (const panel of panels) {
    panel.classList.toggle("active", panel.dataset.tabPanel === tabName);
  }
  window.dispatchEvent(new CustomEvent("tab-activated", { detail: { tab: tabName } }));
}

const initialTab = window.location.hash.replace("#", "") || "generate";
if (document.querySelector(`.tab-button[data-tab="${initialTab}"]`)) {
  activateTab(initialTab);
}
