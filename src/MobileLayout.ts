/** Compact touch UI; desktop controls keep their existing layout. */
export function setupMobileLayout() {
  const controls = document.querySelector<HTMLButtonElement>("#mobile-controls")!;
  const plots = [...document.querySelectorAll<HTMLButtonElement>("[data-mobile-plot]")];
  const closePlots = () => {
    delete document.body.dataset.mobilePlot;
    for (const button of plots) button.setAttribute("aria-expanded", "false");
  };
  const closeControls = () => {
    controls.setAttribute("aria-expanded", "false");
    controls.textContent = "Controls";
    document.body.classList.remove("mobile-controls-open");
  };
  document.querySelector(".menu-trigger")?.addEventListener("click", () => {
    closeControls();
    closePlots();
  });
  controls.addEventListener("click", () => {
    const menu = document.querySelector<HTMLElement>("#menu");
    if (menu) menu.style.display = "none";
    const expanded = controls.getAttribute("aria-expanded") !== "true";
    controls.setAttribute("aria-expanded", String(expanded));
    controls.textContent = expanded ? "Close" : "Controls";
    document.body.classList.toggle("mobile-controls-open", expanded);
    if (expanded) closePlots();
  });
  for (const button of plots) button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") !== "true";
    closePlots();
    if (expanded) {
      document.body.dataset.mobilePlot = button.dataset.mobilePlot;
      button.setAttribute("aria-expanded", "true");
      controls.setAttribute("aria-expanded", "false");
      controls.textContent = "Controls";
      document.body.classList.remove("mobile-controls-open");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closePlots();
    controls.setAttribute("aria-expanded", "false");
    controls.textContent = "Controls";
    document.body.classList.remove("mobile-controls-open");
  });
}
