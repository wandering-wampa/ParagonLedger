import React, { useMemo, useState } from "react";

function resolveIconPath(iconPath) {
  const normalized = String(iconPath || "").replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }
  if (/^(https?:|data:|file:)/i.test(normalized)) {
    return normalized;
  }
  if (window.location.protocol === "file:") {
    return `../${normalized}`;
  }
  return `/${normalized}`;
}

export function BadgeBrowser({ badges }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const categories = useMemo(() => {
    const set = new Set();
    for (const badge of badges) {
      if (badge.category) {
        set.add(badge.category);
      }
    }
    return ["all", ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [badges]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return badges.filter((badge) => {
      if (filter === "unlocked" && !badge.unlocked) {
        return false;
      }
      if (filter === "locked" && badge.unlocked) {
        return false;
      }
      if (category !== "all" && badge.category !== category) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        badge.badge_name?.toLowerCase().includes(q) ||
        badge.description?.toLowerCase().includes(q)
      );
    });
  }, [badges, filter, search, category]);

  const unlockedCount = badges.filter((x) => x.unlocked).length;

  return (
    <section className="card">
      <div className="badge-browser-header">
        <h3>Badge Browser</h3>
        <p className="muted">
          {unlockedCount}/{badges.length} unlocked
        </p>
      </div>
      <div className="badge-browser-controls">
        <input
          className="text-input"
          placeholder="Search badges..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="select-input"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {categories.map((entry) => (
            <option key={entry} value={entry}>
              {entry === "all" ? "All categories" : entry}
            </option>
          ))}
        </select>
        <div className="badge-filter-buttons">
          <button
            className={filter === "all" ? "parser-btn parser-btn--active" : "parser-btn"}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            className={
              filter === "unlocked" ? "parser-btn parser-btn--active" : "parser-btn"
            }
            onClick={() => setFilter("unlocked")}
          >
            Unlocked
          </button>
          <button
            className={filter === "locked" ? "parser-btn parser-btn--active" : "parser-btn"}
            onClick={() => setFilter("locked")}
          >
            Locked
          </button>
        </div>
      </div>
      <div className="badge-browser-grid">
        {filtered.map((badge) => (
          <article
            key={badge.id}
            className={`badge-browser-item ${
              badge.unlocked ? "badge-browser-item--unlocked" : ""
            }`}
          >
            <div className="badge-browser-icon-wrap">
              {badge.icon_path ? (
                <img
                  src={resolveIconPath(badge.icon_path)}
                  alt={badge.badge_name}
                  className="badge-browser-icon"
                />
              ) : (
                <div className="badge-browser-icon-fallback">
                  {badge.badge_name?.[0] || "?"}
                </div>
              )}
            </div>
            <div className="badge-browser-body">
              <p className="badge-name">{badge.badge_name}</p>
              <p className="muted">{badge.category || "Unknown"}</p>
              {badge.description ? (
                <p className="muted badge-browser-description">{badge.description}</p>
              ) : null}
              <p className="badge-browser-state">
                {badge.unlocked
                  ? `Unlocked ${new Date(badge.unlocked_at).toLocaleString()}`
                  : "Locked"}
              </p>
            </div>
          </article>
        ))}
        {!filtered.length && <p className="muted">No badges match the current filters.</p>}
      </div>
    </section>
  );
}
