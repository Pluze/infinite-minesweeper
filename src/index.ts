import { setupMobileLayout } from "./MobileLayout";
import { trackDensity } from "./DensityHistory";
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
    scoreElement.innerHTML = localField.score.toString();
  }

  const probability = 0.2;

  let field: Field | undefined = await fieldStorage.loadLatest(fieldName);

  if (!field) {
    field = new Field(probability, 3, fieldName, "1");
    field.open(1, 1);
    await fieldStorage.saveAsync(field, fieldName);
  } else {
    console.log(
      `loading previous field with ${
        field.getAll().filter((cell) => cell.isOpen).length
      } fields opened`,
    );
  }

  // Existing saves predate click history: start from their current score.
  if (!Array.isArray(field.clickScores) || !field.clickScores.length) {
    field.clickScores = [field.score];
  }

  trackDensity(field);
  self.toggleMenu = function () {
    const menu = document.getElementById("menu");
    if (menu === null)
      throw new Error("Tried to toggle menu, but element is null");
    menu.style.display = menu.style.display == "none" ? "block" : "none";
  };

  self.restart = async function () {
    field.emit("beforeRestart");
    await fieldStorage.clearAsync(fieldName);
    localStorage.clear();

    window.location.reload();
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

    await loadTextures();

    const app = new FieldRenderer(field, updateScore, fieldStorage);
    await app.init({
      resizeTo: window,
      backgroundColor: 0x0f0f0f,
    });

    document.body.appendChild(app.canvas);

    // We have to setup after canvas has been added to the dom because we add interactivity on the canvas element instead of using pixi interaction manager.
    app.setupAfterCanvasReady();
    updateScore(field);
    new ScorePlot(field);
    new ScorePlot(field, true);
  })();
}
void main().catch((error) => {
  console.error(error);
  document.querySelector("#auto-status")!.textContent =
    "Loading failed. Check the browser console.";
});
