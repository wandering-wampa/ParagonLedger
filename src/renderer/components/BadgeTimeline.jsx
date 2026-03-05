import React from "react";

export function BadgeTimeline({ badges }) {
  return (
    <section className="card">
      <h3>Badge Timeline</h3>
      <div className="badge-list">
        {badges.map((badge, idx) => (
          <article key={`${badge.badge_name}-${idx}`} className="badge-item">
            <div>
              <p className="badge-name">{badge.badge_name}</p>
              <p className="muted">{badge.category || "Uncategorized"}</p>
            </div>
            <time className="muted">
              {new Date(badge.timestamp).toLocaleString()}
            </time>
          </article>
        ))}
        {!badges.length && (
          <p className="muted">No badges unlocked yet for this character.</p>
        )}
      </div>
    </section>
  );
}
