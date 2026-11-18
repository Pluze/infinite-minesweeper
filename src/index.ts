import { prepareProbability } from "./MineProbability";
import { formatInteger } from "./NumberFormat";
import { setupMobileLayout } from "./MobileLayout";
import { LoadingScreen } from "./LoadingScreen";
import { trackDensityAsync } from "./DensityHistory";
import { ScorePlot } from "./ScorePlot";
import { Field } from "./Field";
import { FieldRenderer } from "./FieldRenderer";
import { FieldPersistence } from "./FieldPersistence";
import { loadTextures } from "./Textures";
import * as PIXI from "pixi.js";

setupMobileLayout();

async function main() {
  const fieldName = (window.fieldName = "defaultSavedFieldv3");
  const localStorage = window.localStorage;
  const fieldStorage = (window.FieldStorage = new FieldPersistence(
    localStorage,
  ));

  function updateScore(localField: Field) {
    const scoreElement = document.getElementById("score");
    if (scoreElement === null)
      throw Error("Could not find score element when updating score");
    scoreElement.textContent = formatInteger(localField.score);
  }

  const probability = 0.2;

  const startFresh = async () => {
    await fieldStorage.clearAsync(fieldName);
    localStorage.removeItem("savedCamerTransform");
    window.location.reload();
  };
  const loading = new LoadingScreen(startFresh);
  const signal = loading.controller.signal;
  try {
  await loading.stage("Reading saved game…");
  let field: Field | undefined = await fieldStorage.loadLatest(fieldName, signal, (done, total) => {
    loading.update(`Restoring saved updates · ${formatInteger(done)} / ${formatInteger(total)}`, done, total);
  });
  signal.throwIfAborted();

  if (!field) {
    field = new Field(probability, 3, fieldName, "1");
    field.open(1, 1);
    await fieldStorage.saveAsync(field, fieldName);
  }

  // Existing saves predate click history: start from their current score.
  if (!Array.isArray(field.clickScores) || !field.clickScores.length) {
    field.clickScores = [field.score];
  }

  await loading.stage("Restoring board statistics…");
  const total = field.cellData.numberStorage.size;
  await trackDensityAsync(field, signal, done => loading.update(`Restoring statistics · ${formatInteger(done)} / ${formatInteger(total)} cells`, done, total));
  await loading.stage("Preparing probability indexes…");
  await prepareProbability(field, signal, (done, phase) => loading.update(`${phase} · ${formatInteger(done)} cells`, done, total));
  self.toggleMenu = function () {
    const menu = document.getElementById("menu");
    if (menu === null)
      throw new Error("Tried to toggle menu, but element is null");
    menu.style.display = menu.style.display == "none" ? "block" : "none";
  };

  self.restart = async function () {
    field.emit("beforeRestart");
    await startFresh();
  };

  self.toggleFullscreen = function () {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(
          `Error attempting to enable fullscreen mode: ${err.message} (${err.name})`,
        );
      });
    } else {
      document.exitFullscreen().catch((err) => {
        console.error(
          `Error attempting to exit fullscreen mode: ${err.message} (${err.name})`,
        );
      });
    }
  };

  await (async () => {
    PIXI.TextureSource.defaultOptions.scaleMode = "nearest";

    await loading.stage("Loading textures…");
    await loadTextures();
    signal.throwIfAborted();

    await loading.stage("Preparing board…");
    const app = new FieldRenderer(field, updateScore, fieldStorage, true);
    await app.prepareCells(signal, done => loading.update(`Preparing board · ${formatInteger(done)} / ${formatInteger(total)} cells`, done, total));
    await loading.stage("Starting display…");
    await app.init({
      resizeTo: window,
      backgroundColor: 0x0f0f0f,
    });

    signal.throwIfAborted();
    document.body.appendChild(app.canvas);

    // We have to setup after canvas has been added to the dom because we add interactivity on the canvas element instead of using pixi interaction manager.
    app.setupAfterCanvasReady();
    updateScore(field);
    new ScorePlot(field);
    new ScorePlot(field, true);
  })();
  loading.finish();
  } catch (error) {
    if (signal.aborted) return;
    loading.fail(error);
    throw error;
  }
}
void main().catch((error) => {
  console.error(error);
  document.querySelector("#auto-status")!.textContent =
    "Loading failed. Check the browser console.";
});
