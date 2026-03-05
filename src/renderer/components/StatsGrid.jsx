import React from "react";

export function StatsGrid({ summary }) {
  const cards = [
    { label: "Badges Earned", value: summary?.badges_earned ?? 0 },
    { label: "Enemies Defeated", value: summary?.enemies_defeated ?? 0 },
    { label: "Missions Completed", value: summary?.missions_completed ?? 0 },
    { label: "Influence/Infamy (Defeats Only)", value: summary?.influence_earned ?? 0 }
  ];

  return (
    <div className="stats-grid">
      {cards.map((card) => (
        <article key={card.label} className="card stat-card">
          <p className="muted">{card.label}</p>
          <h3>{Number(card.value).toLocaleString()}</h3>
        </article>
      ))}
    </div>
  );
}
