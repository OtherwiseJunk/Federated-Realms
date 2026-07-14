import { useState } from "react";
import { validateCharacterName } from "@realms/common";
import "./pages.css";

interface ClassInfo {
  id: string;
  name: string;
  description: string;
  attributeBonuses?: Record<string, number>;
  spells?: string[];
  tags?: string[];
}

interface RaceInfo {
  id: string;
  name: string;
  description: string;
  attributeBonuses?: Record<string, number>;
  tags?: string[];
}

interface Props {
  classes: ClassInfo[];
  races: RaceInfo[];
  playerName: string;
  onComplete: (name: string, classId: string, raceId: string) => void;
}

type Phase = "class" | "race" | "confirm";

export function CharacterCreate({ classes, races, playerName, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>("class");
  const [classIndex, setClassIndex] = useState(0);
  const [raceIndex, setRaceIndex] = useState(0);
  const [name, setName] = useState(playerName);

  const selectedClass = classes[classIndex];
  const selectedRace = races[raceIndex];
  const nameCheck = validateCharacterName(name);

  if (phase === "confirm") {
    const combined: Record<string, number> = {};
    for (const [attr, val] of Object.entries(selectedClass.attributeBonuses ?? {})) {
      combined[attr] = (combined[attr] ?? 10) + val;
    }
    for (const [attr, val] of Object.entries(selectedRace.attributeBonuses ?? {})) {
      combined[attr] = (combined[attr] ?? 10) + val;
    }

    return (
      <div className="page-container">
        <h2 style={{ color: "var(--color-cyan)" }}>Confirm Your Character</h2>
        <div className="create-card create-card-active">
          <div className="bold">{nameCheck.ok ? nameCheck.name : name}</div>
          <div>
            <span className="dim">Class: </span>
            <span style={{ color: "var(--color-yellow)" }}>{selectedClass.name}</span>
            <span className="dim"> | Race: </span>
            <span style={{ color: "var(--color-yellow)" }}>{selectedRace.name}</span>
          </div>
          {selectedClass.spells && selectedClass.spells.length > 0 && (
            <div>
              <span style={{ color: "var(--color-cyan)" }}>Spells: </span>
              <span style={{ color: "var(--color-magenta)" }}>
                {selectedClass.spells.join(", ")}
              </span>
            </div>
          )}
          <div>
            <span style={{ color: "var(--color-cyan)" }}>Attributes: </span>
            <span style={{ color: "var(--color-green)" }}>
              {Object.entries(combined)
                .map(([attr, val]) => `${attr.toUpperCase()} ${val}`)
                .join(", ")}
            </span>
          </div>
        </div>
        <div className="create-buttons">
          <button className="page-button" onClick={() => setPhase("race")}>
            Back
          </button>
          <button
            className="page-button page-button-primary"
            disabled={!nameCheck.ok}
            onClick={() =>
              onComplete(nameCheck.ok ? nameCheck.name : name, selectedClass.id, selectedRace.id)
            }
          >
            Enter the Realm
          </button>
        </div>
      </div>
    );
  }

  const items = phase === "class" ? classes : races;
  const index = phase === "class" ? classIndex : raceIndex;
  const setIndex = phase === "class" ? setClassIndex : setRaceIndex;
  const selected = items[index];

  return (
    <div className="page-container">
      <div className="create-header">
        <h2 style={{ color: "var(--color-yellow)" }}>Create Your Character</h2>
        <div>
          <span className="dim">Name: </span>
          <input
            className="page-input"
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            aria-label="Character name"
          />
          {!nameCheck.ok && <span className="dim">{nameCheck.error}</span>}
          {phase === "race" && (
            <>
              <span className="dim"> | Class: </span>
              <span style={{ color: "var(--color-yellow)" }}>{selectedClass.name}</span>
            </>
          )}
        </div>
      </div>

      <h3 style={{ color: "var(--color-cyan)" }}>Choose your {phase}:</h3>

      <div className="create-list">
        {items.map((item, i) => (
          <div
            key={item.id}
            className={`create-option ${i === index ? "create-option-active" : ""}`}
            onClick={() => setIndex(i)}
          >
            <span className="create-marker">{i === index ? "\u25B6 " : "  "}</span>
            <span className={i === index ? "bold" : "dim"}>{item.name}</span>
          </div>
        ))}
      </div>

      <div className="create-card">
        <div className="bold">{selected.name}</div>
        <div className="dim">{selected.description}</div>
        {selected.attributeBonuses && (
          <div>
            <span style={{ color: "var(--color-cyan)" }}>Bonuses: </span>
            <span style={{ color: "var(--color-green)" }}>
              {Object.entries(selected.attributeBonuses)
                .map(([attr, val]) => `${attr.toUpperCase()} +${val}`)
                .join(", ")}
            </span>
          </div>
        )}
        {"spells" in selected &&
          (selected as ClassInfo).spells &&
          (selected as ClassInfo).spells!.length > 0 && (
            <div>
              <span style={{ color: "var(--color-cyan)" }}>Spells: </span>
              <span style={{ color: "var(--color-magenta)" }}>
                {(selected as ClassInfo).spells!.join(", ")}
              </span>
            </div>
          )}
      </div>

      <div className="create-buttons">
        {phase === "race" && (
          <button className="page-button" onClick={() => setPhase("class")}>
            Back
          </button>
        )}
        <button
          className="page-button page-button-primary"
          onClick={() => {
            if (phase === "class") setPhase("race");
            else setPhase("confirm");
          }}
        >
          {phase === "class" ? "Next: Race" : "Confirm"}
        </button>
      </div>
    </div>
  );
}
