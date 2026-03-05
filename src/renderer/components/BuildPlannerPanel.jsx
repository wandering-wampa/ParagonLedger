import React, { useMemo, useState } from "react";

function resolveAssetPath(assetPath) {
  const normalized = String(assetPath || "").replace(/\\/g, "/");
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

function renderSlotPath(level) {
  const items = (level?.enhancements || [])
    .map((entry) => Number(entry.slot_level) || 0)
    .sort((a, b) => a - b);
  if (!items.length) {
    return "No slot data";
  }
  return items.join(" -> ");
}

export function BuildPlannerPanel({ buildPlan }) {
  const [activeTab, setActiveTab] = useState("overview");
  const build = buildPlan?.build;
  const levels = buildPlan?.levels || [];
  const insights = buildPlan?.insights || null;
  const slotList = useMemo(() => {
    const byLevel = new Map();
    for (const level of levels) {
      const powerName = String(level.power_name || "Unknown Power");
      const powerPickLevel = Number(level.level) || 0;
      for (const enhancement of level.enhancements || []) {
        const slotLevel = Number(enhancement.slot_level) || 0;
        // Ignore the power's initial slot (usually same level the power is taken).
        // Slot List should only show additional allocated slots.
        if (slotLevel <= 0 || slotLevel <= powerPickLevel) {
          continue;
        }
        if (!byLevel.has(slotLevel)) {
          byLevel.set(slotLevel, new Map());
        }
        const powerMap = byLevel.get(slotLevel);
        powerMap.set(powerName, (powerMap.get(powerName) || 0) + 1);
      }
    }
    return [...byLevel.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, powerMap]) => {
        const slotAdds = [...powerMap.entries()]
          .map(([powerName, count]) => ({ powerName, count }))
          .sort((a, b) => a.powerName.localeCompare(b.powerName));
        return {
          level,
          slotAdds,
          totalSlotsAdded: slotAdds.reduce((sum, row) => sum + row.count, 0)
        };
      });
  }, [levels]);

  return (
    <section className="card">
      <h3>Build Planner</h3>
      <div className="build-tabs">
        <button
          className={activeTab === "overview" ? "parser-btn parser-btn--active" : "parser-btn"}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          className={activeTab === "slot-list" ? "parser-btn parser-btn--active" : "parser-btn"}
          onClick={() => setActiveTab("slot-list")}
        >
          Slot List
        </button>
      </div>
      {!build ? (
        <p className="muted">No build imported yet.</p>
      ) : activeTab === "slot-list" ? (
        <section className="build-section">
          <h4>Slot Allocation Levels</h4>
          <ul className="simple-list compact-list slot-list">
            {slotList.map((row) => (
              <li key={`slot-level-${row.level}`}>
                <span>
                  <strong>L{row.level} Slot Added To:</strong>{" "}
                  {row.slotAdds
                    .map((entry) =>
                      entry.count > 1 ? `${entry.powerName} x${entry.count}` : entry.powerName
                    )
                    .join(", ")}
                </span>
                <span>
                  {row.totalSlotsAdded} slot{row.totalSlotsAdded === 1 ? "" : "s"}
                </span>
              </li>
            ))}
            {!slotList.length && (
              <li>
                <span className="muted">No slot-level data found in this import.</span>
              </li>
            )}
          </ul>
        </section>
      ) : (
        <>
          <div className="build-meta-grid">
            <p className="muted">
              <strong>Name:</strong> {build.build_name || "Unnamed build"}
            </p>
            <p className="muted">
              <strong>Class:</strong> {build.class_display || build.class_name || "Unknown"}
            </p>
            <p className="muted">
              <strong>Origin:</strong> {build.origin || "Unknown"}
            </p>
            <p className="muted">
              <strong>Alignment:</strong> {build.alignment || "Unknown"}
            </p>
            <p className="muted">
              <strong>Target level:</strong> {build.target_level || "N/A"}
            </p>
            <p className="muted">
              <strong>Mids:</strong>{" "}
              {[build.mids_app, build.mids_version].filter(Boolean).join(" ") || "Unknown"}
            </p>
            <p className="muted">
              <strong>Database:</strong>{" "}
              {[build.mids_database, build.mids_database_version].filter(Boolean).join(" ") ||
                "Unknown"}
            </p>
            <p className="muted">
              <strong>Imported:</strong>{" "}
              {build.imported_at ? new Date(build.imported_at).toLocaleString() : "Unknown"}
            </p>
          </div>

          {insights?.compatibility?.warnings?.length ? (
            <section className="build-warning-box">
              <h4>Compatibility Warning</h4>
              <ul className="simple-list compact-list">
                {insights.compatibility.warnings.map((warning, idx) => (
                  <li key={`warn-${idx}`}>
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="build-section">
            <h4>Power Timeline</h4>
            <div className="build-power-grid">
              {levels.map((level, idx) => (
                <article
                  key={`${level.level}-${level.power_name}-${idx}`}
                  className="build-power-card"
                >
                  <div className="build-power-header">
                    {level.power_icon_path ? (
                      <img
                        src={resolveAssetPath(level.power_icon_path)}
                        alt={level.power_name}
                        className="build-power-icon"
                      />
                    ) : (
                      <div className="build-power-fallback">{level.power_name?.[0] || "?"}</div>
                    )}
                    <div>
                      <p className="build-power-title">
                        L{level.level} - {level.power_name}
                      </p>
                      <p className="muted">
                        {level.power_set || "Unknown Set"} | {level.enhancement_slots} slots
                      </p>
                    </div>
                  </div>
                  {level.power_description ? (
                    <p className="muted build-power-desc">{level.power_description}</p>
                  ) : null}
                  <p className="muted">
                    <strong>Slot path:</strong> {renderSlotPath(level)}
                  </p>
                  <ul className="simple-list compact-list">
                    {(level.enhancements || []).map((enh, enhIdx) => (
                      <li key={`${level.id}-enh-${enhIdx}`}>
                        <span>
                          L{enh.slot_level} {enh.enhancement_display || enh.enhancement_uid}
                        </span>
                        <span>{enh.io_level ? `IO ${enh.io_level}` : ""}</span>
                      </li>
                    ))}
                    {!level.enhancements?.length && (
                      <li>
                        <span className="muted">No enhancement details.</span>
                      </li>
                    )}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="build-section split-grid">
            <article className="card build-subcard">
              <h4>Set and IO Summary</h4>
              <p className="muted">
                {insights?.setSummary?.total_sets || 0} sets |{" "}
                {insights?.setSummary?.complete_sets || 0} complete |{" "}
                {insights?.setSummary?.partial_sets || 0} partial
              </p>
              <p className="muted">
                Purple sets: {insights?.setSummary?.purple_sets || 0} | ATO sets:{" "}
                {insights?.setSummary?.ato_sets || 0} | Likely unique IOs:{" "}
                {insights?.setSummary?.likely_unique_ios || 0}
              </p>
              <ul className="simple-list compact-list">
                {(insights?.setSummary?.top_sets || []).map((row) => (
                  <li key={row.set_name}>
                    <span>
                      {row.set_name} ({row.unique_pieces} pieces)
                    </span>
                    <span>{row.slots} slots</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card build-subcard">
              <h4>Proc Report</h4>
              <p className="muted">
                Proc-enabled powers: {insights?.procReport?.powers_with_proc_enabled || 0}/
                {insights?.procReport?.powers_total || 0}
              </p>
              <ul className="simple-list compact-list">
                {(insights?.procReport?.top_proc_powers || []).map((row) => (
                  <li key={`${row.power_name}-${row.level}`}>
                    <span>
                      L{row.level} {row.power_name}
                    </span>
                    <span>{row.proc_like_slots}</span>
                  </li>
                ))}
              </ul>
            </article>
          </section>

          <section className="build-section split-grid">
            <article className="card build-subcard">
              <h4>Slot Efficiency</h4>
              <p className="muted">Under-slotted powers</p>
              <ul className="simple-list compact-list">
                {(insights?.slotEfficiency?.under_slotted || []).map((row) => (
                  <li key={`under-${row.power_name}-${row.level}`}>
                    <span>
                      L{row.level} {row.power_name}
                    </span>
                    <span>{row.slots} slots</span>
                  </li>
                ))}
                {!insights?.slotEfficiency?.under_slotted?.length && (
                  <li>
                    <span className="muted">No under-slotted powers found.</span>
                  </li>
                )}
              </ul>
              <p className="muted">Over-slotted powers</p>
              <ul className="simple-list compact-list">
                {(insights?.slotEfficiency?.over_slotted || []).map((row) => (
                  <li key={`over-${row.power_name}-${row.level}`}>
                    <span>
                      L{row.level} {row.power_name}
                    </span>
                    <span>{row.slots} slots</span>
                  </li>
                ))}
                {!insights?.slotEfficiency?.over_slotted?.length && (
                  <li>
                    <span className="muted">No over-slotted powers found.</span>
                  </li>
                )}
              </ul>
            </article>

            <article className="card build-subcard">
              <h4>Build Checklist</h4>
              <p className="muted">Top sets to acquire</p>
              <ul className="simple-list compact-list">
                {(insights?.checklist?.by_set || []).slice(0, 10).map((row) => (
                  <li key={row.set_name}>
                    <span>
                      {row.set_name} (start L{row.earliest_level})
                    </span>
                    <span>{row.count}</span>
                  </li>
                ))}
              </ul>
              <p className="muted">By level milestone</p>
              <ul className="simple-list compact-list">
                {(insights?.checklist?.by_level || []).slice(0, 10).map((row) => (
                  <li key={`lvl-${row.level}`}>
                    <span>L{row.level}</span>
                    <span>{row.items.length} buys</span>
                  </li>
                ))}
              </ul>
            </article>
          </section>
        </>
      )}
    </section>
  );
}
