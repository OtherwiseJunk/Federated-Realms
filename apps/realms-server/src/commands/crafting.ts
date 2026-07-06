import type { ParsedCommand } from "@realms/common";
import { encodeMessage } from "@realms/protocol";
import type { CommandContext } from "./index.js";
import { sendNarrative } from "./index.js";

export function handleCrafting(cmd: ParsedCommand, ctx: CommandContext): void {
  switch (cmd.verb) {
    case "recipes":
    case "recipe":
      handleRecipes(cmd, ctx);
      break;
    case "craft":
      handleCraft(cmd, ctx);
      break;
    case "gather":
      handleGather(cmd, ctx);
      break;
  }
}

function handleRecipes(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const room = world.getRoom(session.currentRoom);
  const showAll = cmd.args[0] === "all";

  const allRecipes = world.craftingSystem.listRecipes(session, room ?? undefined);

  if (allRecipes.length === 0) {
    sendNarrative(session, "You don't know any crafting recipes yet.", "info");
    return;
  }

  const visible = showAll ? allRecipes : allRecipes.filter((r) => r.craftable);

  if (visible.length === 0) {
    const hint =
      allRecipes.length > 0
        ? ` (${allRecipes.length} recipes known — use 'recipes all' to see them)`
        : "";
    sendNarrative(session, `You can't craft anything here right now.${hint}`, "info");
    return;
  }

  const itemDefs = world.areaManager.getAllItemDefinitions();
  const lines = [showAll ? "=== Known Recipes ===" : "=== Craftable Recipes ==="];

  for (const { def, craftable, missingStation } of visible) {
    const ingredientList = def.ingredients
      .map((ing) => {
        const d = itemDefs.get(ing.itemId);
        const have = session.countItem(ing.itemId);
        return `${ing.count}x ${d?.name ?? ing.itemId} (${have}/${ing.count})`;
      })
      .join(", ");

    const outputDef = itemDefs.get(def.output.itemId);
    const outputName = outputDef?.name ?? def.output.itemId;
    const stationNote = def.station ? ` [${def.station}]` : "";
    const readyMark = craftable
      ? ""
      : missingStation
        ? ` [needs ${missingStation}]`
        : " [missing ingredients]";

    lines.push(
      `  ${def.name} — ${ingredientList} → ${def.output.count}x ${outputName}${stationNote}${readyMark}`,
    );
  }

  if (!showAll && allRecipes.length > visible.length) {
    lines.push(
      `\n(${allRecipes.length - visible.length} more recipes not currently craftable — 'recipes all' to list them)`,
    );
  }

  sendNarrative(session, lines.join("\n"), "info");
}

function handleCraft(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const recipeName = cmd.args.join(" ");

  if (!recipeName) {
    sendNarrative(session, "Craft what? Use 'recipes' to see what you can make.", "error");
    return;
  }

  const room = world.getRoom(session.currentRoom);
  if (!room) {
    sendNarrative(session, "You are nowhere. Something went wrong.", "error");
    return;
  }

  const itemDefs = world.areaManager.getAllItemDefinitions();
  const result = world.craftingSystem.craft(session, room, recipeName, itemDefs);

  if (!result.success) {
    if (result.missingIngredients) {
      const missing = result.missingIngredients
        .map((m) => `${m.name} (have ${m.have}, need ${m.need})`)
        .join(", ");
      sendNarrative(session, `You're missing: ${missing}.`, "error");
    } else if (result.failedRoll) {
      sendNarrative(
        session,
        "Your hands slip — the materials are ruined. You fail to craft anything.",
        "info",
      );
    } else {
      sendNarrative(session, result.reason ?? "Crafting failed.", "error");
    }
    return;
  }

  sendNarrative(
    session,
    `You craft: ${result.outputName} (x${result.outputCount}) — added to inventory.`,
    "info",
  );

  // Send inventory update
  session.send(encodeMessage({ type: "inventory_update", inventory: session.inventory }));
}

function handleGather(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const nodeName = cmd.args.length > 0 ? cmd.args.join(" ") : undefined;
  const itemDefs = world.areaManager.getAllItemDefinitions();

  const result = world.craftingSystem.gather(session, session.currentRoom, nodeName, itemDefs);

  if (!result.success) {
    sendNarrative(session, result.reason ?? "Nothing to gather here.", "error");
    return;
  }

  if (result.depleted) {
    sendNarrative(
      session,
      `The ${result.node?.name ?? "gathering spot"} is depleted. Come back later.`,
      "info",
    );
    return;
  }

  if (!result.items || result.items.length === 0) {
    sendNarrative(
      session,
      `You search the ${result.node?.name ?? "area"} but find nothing this time.`,
      "info",
    );
    return;
  }

  const gained = result.items.map((i) => `${i.name} (x${i.count})`).join(", ");
  sendNarrative(session, `You gather from the ${result.node?.name}: ${gained}.`, "info");

  // Send inventory update
  session.send(encodeMessage({ type: "inventory_update", inventory: session.inventory }));
}
