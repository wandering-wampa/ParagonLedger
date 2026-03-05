import React, { useMemo, useState } from "react";

function reorderByIds(characters, sourceId, targetId) {
  const sourceIndex = characters.findIndex((row) => row.id === sourceId);
  const targetIndex = characters.findIndex((row) => row.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return characters;
  }
  const next = [...characters];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function CharacterList({ characters, selectedId, onSelect, onReorder }) {
  const [dragSourceId, setDragSourceId] = useState(null);
  const [dragTargetId, setDragTargetId] = useState(null);

  const hasReorder = typeof onReorder === "function";
  const orderedIds = useMemo(() => characters.map((row) => row.id), [characters]);

  const handleDrop = async (targetId) => {
    if (!hasReorder || !dragSourceId || dragSourceId === targetId) {
      setDragSourceId(null);
      setDragTargetId(null);
      return;
    }
    const reordered = reorderByIds(characters, dragSourceId, targetId);
    await onReorder(reordered.map((row) => row.id), orderedIds);
    setDragSourceId(null);
    setDragTargetId(null);
  };

  return (
    <aside className="card panel">
      <h2>Characters</h2>
      <div className="character-list">
        {characters.map((character) => (
          <button
            key={character.id}
            className={`character-row ${
              selectedId === character.id ? "character-row--active" : ""
            } ${dragTargetId === character.id ? "character-row--drag-target" : ""} ${
              hasReorder ? "character-row--draggable" : ""
            }`}
            onClick={() => onSelect(character.id)}
            draggable={hasReorder}
            onDragStart={() => setDragSourceId(character.id)}
            onDragEnter={() => setDragTargetId(character.id)}
            onDragOver={(event) => {
              if (!hasReorder) {
                return;
              }
              event.preventDefault();
            }}
            onDrop={() => handleDrop(character.id)}
            onDragEnd={() => {
              setDragSourceId(null);
              setDragTargetId(null);
            }}
          >
            <span className="character-name">{character.name}</span>
            <span className="muted">{character.badges_earned} badges</span>
          </button>
        ))}
        {!characters.length && <p className="muted">No characters detected yet.</p>}
      </div>
    </aside>
  );
}
