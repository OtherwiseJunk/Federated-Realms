import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { validateCharacterName } from "@realms/common";

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

type Phase = "name" | "class" | "race" | "confirm";

export function CharacterCreate({ classes, races, playerName, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>("name");
  const [name, setName] = useState(playerName);
  const [classIndex, setClassIndex] = useState(0);
  const [raceIndex, setRaceIndex] = useState(0);
  const [selectedClass, setSelectedClass] = useState<ClassInfo | null>(null);

  const nameCheck = validateCharacterName(name);

  useInput((input, key) => {
    if (phase === "name") {
      if (key.return) {
        if (nameCheck.ok) setPhase("class");
        return;
      }
      if (key.backspace || key.delete) {
        setName((prev) => prev.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setName((prev) => prev + input);
      }
    } else if (phase === "class") {
      if (key.upArrow) setClassIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setClassIndex((i) => Math.min(classes.length - 1, i + 1));
      if (key.return) {
        setSelectedClass(classes[classIndex]);
        setPhase("race");
      }
      if (key.escape) setPhase("name");
    } else if (phase === "race") {
      if (key.upArrow) setRaceIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setRaceIndex((i) => Math.min(races.length - 1, i + 1));
      if (key.return) setPhase("confirm");
      if (key.escape) {
        setPhase("class");
      }
    } else if (phase === "confirm") {
      if (key.return) {
        onComplete(
          nameCheck.ok ? nameCheck.name : name,
          classes[classIndex].id,
          races[raceIndex].id,
        );
      }
      if (key.escape) setPhase("race");
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="double" borderColor="yellow" paddingX={2} justifyContent="center">
        <Text color="yellow" bold>
          {"  Create Your Character  "}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">Name: </Text>
        <Text color="green" bold>
          {name}
        </Text>
        {phase === "name" && <Text color="gray">{"█"}</Text>}
      </Box>

      {phase === "name" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray" dimColor>
            {"(Type your character's name, Enter to confirm)"}
          </Text>
          {!nameCheck.ok && <Text color="red">{nameCheck.error}</Text>}
        </Box>
      )}

      {phase === "class" && <ClassSelect classes={classes} index={classIndex} />}

      {phase === "race" && (
        <RaceSelect races={races} index={raceIndex} selectedClass={selectedClass!} />
      )}

      {phase === "confirm" && (
        <ConfirmScreen playerName={name} cls={classes[classIndex]} race={races[raceIndex]} />
      )}
    </Box>
  );
}

function ClassSelect({ classes, index }: { classes: ClassInfo[]; index: number }) {
  const selected = classes[index];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan" bold>
        Choose your class:
      </Text>
      <Text color="gray" dimColor>
        {"(↑/↓ to select, Enter to confirm)"}
      </Text>

      <Box marginTop={1} flexDirection="column">
        {classes.map((cls, i) => (
          <Box key={cls.id}>
            <Text color={i === index ? "yellow" : "gray"}>{i === index ? " ► " : "   "}</Text>
            <Text color={i === index ? "white" : "gray"} bold={i === index}>
              {cls.name}
            </Text>
          </Box>
        ))}
      </Box>

      <Box
        marginTop={1}
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <Text color="white" bold>
          {selected.name}
        </Text>
        <Text color="gray">{selected.description}</Text>
        {selected.attributeBonuses && (
          <Box marginTop={1}>
            <Text color="cyan">Bonuses: </Text>
            <Text color="green">
              {Object.entries(selected.attributeBonuses)
                .map(([attr, val]) => `${attr.toUpperCase()} +${val}`)
                .join(", ")}
            </Text>
          </Box>
        )}
        {selected.spells && selected.spells.length > 0 && (
          <Box>
            <Text color="cyan">Spells: </Text>
            <Text color="magenta">{selected.spells.join(", ")}</Text>
          </Box>
        )}
        {selected.tags && (
          <Box>
            <Text color="cyan">Tags: </Text>
            <Text color="gray">{selected.tags.join(", ")}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function RaceSelect({
  races,
  index,
  selectedClass,
}: {
  races: RaceInfo[];
  index: number;
  selectedClass: ClassInfo;
}) {
  const selected = races[index];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="gray">Class: </Text>
        <Text color="yellow" bold>
          {selectedClass.name}
        </Text>
      </Box>

      <Text color="cyan" bold>
        Choose your race:
      </Text>
      <Text color="gray" dimColor>
        {"(↑/↓ to select, Enter to confirm, Esc to go back)"}
      </Text>

      <Box marginTop={1} flexDirection="column">
        {races.map((race, i) => (
          <Box key={race.id}>
            <Text color={i === index ? "yellow" : "gray"}>{i === index ? " ► " : "   "}</Text>
            <Text color={i === index ? "white" : "gray"} bold={i === index}>
              {race.name}
            </Text>
          </Box>
        ))}
      </Box>

      <Box
        marginTop={1}
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <Text color="white" bold>
          {selected.name}
        </Text>
        <Text color="gray">{selected.description}</Text>
        {selected.attributeBonuses && (
          <Box marginTop={1}>
            <Text color="cyan">Bonuses: </Text>
            <Text color="green">
              {Object.entries(selected.attributeBonuses)
                .map(([attr, val]) => `${attr.toUpperCase()} +${val}`)
                .join(", ")}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function ConfirmScreen({
  playerName,
  cls,
  race,
}: {
  playerName: string;
  cls: ClassInfo;
  race: RaceInfo;
}) {
  // Merge bonuses for preview
  const combined: Record<string, number> = {};
  for (const [attr, val] of Object.entries(cls.attributeBonuses ?? {})) {
    combined[attr] = (combined[attr] ?? 10) + val;
  }
  for (const [attr, val] of Object.entries(race.attributeBonuses ?? {})) {
    combined[attr] = (combined[attr] ?? 10) + val;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan" bold>
        Confirm your character:
      </Text>
      <Text color="gray" dimColor>
        {"(Enter to begin, Esc to go back)"}
      </Text>

      <Box
        marginTop={1}
        flexDirection="column"
        borderStyle="single"
        borderColor="yellow"
        paddingX={1}
      >
        <Text color="white" bold>
          {playerName}
        </Text>
        <Box>
          <Text color="gray">Class: </Text>
          <Text color="yellow">{cls.name}</Text>
          <Text color="gray"> | Race: </Text>
          <Text color="yellow">{race.name}</Text>
        </Box>
        {cls.spells && cls.spells.length > 0 && (
          <Box>
            <Text color="gray">Spells: </Text>
            <Text color="magenta">{cls.spells.join(", ")}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color="cyan">Starting attributes: </Text>
          <Text color="green">
            {Object.entries(combined)
              .map(([attr, val]) => `${attr.toUpperCase()} ${val}`)
              .join(", ")}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="green" bold>
          {"Press Enter to enter the realm..."}
        </Text>
      </Box>
    </Box>
  );
}
