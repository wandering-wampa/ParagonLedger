import React from "react";

export function CharacterList({ characters, selectedId, onSelect }) {
  return (
    <aside className="card panel">
      <h2>Characters</h2>
      <div className="character-list">
        {characters.map((character) => (
          <button
            key={character.id}
            className={`character-row ${
              selectedId === character.id ? "character-row--active" : ""
            }`}
            onClick={() => onSelect(character.id)}
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
