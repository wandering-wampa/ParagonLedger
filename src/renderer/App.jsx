import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./services/api";
import { usePolling } from "./hooks/usePolling";
import { CharacterList } from "./components/CharacterList";
import { StatsGrid } from "./components/StatsGrid";
import { BadgeTimeline } from "./components/BadgeTimeline";
import { BadgeBrowser } from "./components/BadgeBrowser";
import { BuildPlannerPanel } from "./components/BuildPlannerPanel";

export function App() {
  const [settings, setSettings] = useState({
    accountLogs: [],
    activeAccountName: null
  });
  const [accounts, setAccounts] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [badges, setBadges] = useState([]);
  const [badgeCatalog, setBadgeCatalog] = useState([]);
  const [buildPlan, setBuildPlan] = useState({ build: null, levels: [] });
  const [status, setStatus] = useState("stopped");
  const [parserRunning, setParserRunning] = useState(false);
  const [parserBusy, setParserBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");
  const [currentLogFile, setCurrentLogFile] = useState("");
  const [currentParsedCharacter, setCurrentParsedCharacter] = useState("");
  const [lastMessage, setLastMessage] = useState("");
  const [zoneInput, setZoneInput] = useState("");
  const [knownZones, setKnownZones] = useState([]);
  const [settingZone, setSettingZone] = useState(false);
  const didBootRef = useRef(false);

  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );

  const activeLogConfig = useMemo(() => {
    if (!settings.activeAccountName) {
      return null;
    }
    return (
      settings.accountLogs?.find(
        (entry) => entry.accountName === settings.activeAccountName
      ) || null
    );
  }, [settings]);

  const needsOnboarding = !settings.accountLogs?.length;

  const loadAccounts = useCallback(
    async (settingsOverride) => {
      const list = await api.getAccounts();
      setAccounts(list);
      const source = settingsOverride || settings;
      if (!list.length) {
        setSelectedAccountId(null);
        return;
      }
      const activeByName = source.activeAccountName
        ? list.find((row) => row.name === source.activeAccountName)
        : null;
      if (activeByName && activeByName.id !== selectedAccountId) {
        setSelectedAccountId(activeByName.id);
        return;
      }
      if (!selectedAccountId) {
        setSelectedAccountId(list[0].id);
      }
    },
    [selectedAccountId, settings]
  );

  const loadCharacters = useCallback(async () => {
    if (!selectedAccountId) {
      setCharacters([]);
      setSelectedCharacterId(null);
      return;
    }
    const list = await api.getCharacters(selectedAccountId);
    setCharacters(list);
    const selectedStillExists = list.some((row) => row.id === selectedCharacterId);
    if (!selectedStillExists) {
      setSelectedCharacterId(list.length ? list[0].id : null);
    }
  }, [selectedAccountId, selectedCharacterId]);

  const loadCharacterData = useCallback(async () => {
    if (!selectedCharacterId) {
      setDashboard(null);
      setBadges([]);
      setBadgeCatalog([]);
      setBuildPlan({ build: null, levels: [] });
      setKnownZones([]);
      return;
    }
    const [dash, badgeTimeline, badgeBrowser, build, zones] = await Promise.all([
      api.getDashboard(selectedCharacterId),
      api.getBadgeTimeline(selectedCharacterId),
      api.getBadgeBrowser(selectedCharacterId),
      api.getLatestBuild(selectedCharacterId),
      api.getKnownZones(selectedCharacterId)
    ]);
    setDashboard(dash);
    setBadges(badgeTimeline);
    setBadgeCatalog(badgeBrowser);
    setBuildPlan(build);
    setKnownZones(Array.isArray(zones) ? zones : []);
  }, [selectedCharacterId]);

  const loadParserState = useCallback(async () => {
    const state = await api.getParserState();
    const running = Boolean(state?.running ?? state?.status === "running");
    setParserRunning(running);
    setStatus(state?.status || (running ? "running" : "stopped"));
    setCurrentLogFile(state?.currentLogFilePath || "");
    setCurrentParsedCharacter(state?.currentCharacterName || "");
  }, []);

  const refreshAll = useCallback(
    async (showMessage = true) => {
      setRefreshing(true);
      try {
        await loadParserState();
        await loadAccounts();
        await loadCharacters();
        await loadCharacterData();
        setLastRefreshedAt(new Date().toISOString());
        if (showMessage) {
          setLastMessage("Dashboard refreshed.");
        }
      } finally {
        setRefreshing(false);
      }
    },
    [loadAccounts, loadCharacterData, loadCharacters, loadParserState]
  );

  useEffect(() => {
    if (didBootRef.current) {
      return;
    }
    didBootRef.current = true;
    const boot = async () => {
      let currentSettings = await api.getSettings();
      if (!currentSettings.activeAccountName && currentSettings.accountLogs?.length) {
        const fallback = currentSettings.accountLogs[0];
        currentSettings = await api.setActiveAccount(fallback.accountName, fallback.logsDir);
      }
      setSettings(currentSettings);
      await loadAccounts(currentSettings);
      if (currentSettings.activeAccountName && currentSettings.accountLogs?.length) {
        const autoStartResult = await api.startParser();
        if (autoStartResult?.ok) {
          setParserRunning(Boolean(autoStartResult.running ?? true));
          setStatus(autoStartResult.status || "running");
          setCurrentLogFile(autoStartResult.currentLogFilePath || "");
          setCurrentParsedCharacter(autoStartResult.currentCharacterName || "");
          setLastMessage("Parser started automatically.");
        } else if (autoStartResult?.error) {
          setStatus("error");
          setLastMessage(autoStartResult.error);
        }
      }
      await loadParserState();
    };
    boot();
  }, [loadAccounts, loadParserState]);

  useEffect(() => {
    loadCharacters();
  }, [loadCharacters]);

  useEffect(() => {
    loadCharacterData();
  }, [loadCharacterData]);

  const pollMs = parserRunning ? 1500 : 5000;
  usePolling(loadParserState, pollMs, true);
  usePolling(() => loadAccounts(), pollMs, true);
  usePolling(loadCharacters, pollMs, Boolean(selectedAccountId));
  usePolling(loadCharacterData, pollMs, Boolean(selectedCharacterId));

  const chooseLogsDir = async () => {
    const picked = await api.pickLogsDir();
    if (!picked) {
      return;
    }
    const updated = await api.setLogsDir(picked);
    setSettings(updated);
    await loadAccounts(updated);
    await loadCharacters();
    setParserRunning(false);
    setStatus("stopped");
    setCurrentLogFile("");
    setCurrentParsedCharacter("");
    setLastMessage(`Configured logs folder: ${picked}`);
  };

  const onAccountChange = async (event) => {
    const id = Number(event.target.value);
    const account = accounts.find((row) => row.id === id);
    setSelectedAccountId(id || null);
    setSelectedCharacterId(null);
    if (account) {
      const updated = await api.setActiveAccount(account.name, account.logs_dir);
      setSettings(updated);
      setParserRunning(false);
      setStatus("stopped");
      setCurrentLogFile("");
      setCurrentParsedCharacter("");
      setLastMessage(`Active account: ${account.name}`);
    }
  };

  const toggleParser = async () => {
    if (parserBusy) {
      return;
    }
    setParserBusy(true);
    try {
      if (parserRunning) {
        const result = await api.stopParser();
        const running = Boolean(result?.running ?? result?.status === "running");
        setParserRunning(running);
        setStatus(result?.status || (running ? "running" : "stopped"));
        setCurrentLogFile(result?.currentLogFilePath || "");
        setCurrentParsedCharacter(result?.currentCharacterName || "");
        setLastMessage(result?.error || "Parsing paused.");
        return;
      }
      if (!activeAccount) {
        setStatus("error");
        setLastMessage("Select an account with a configured logs directory first.");
        return;
      }
      const result = await api.startParser();
      const running = Boolean(
        (result?.running ?? (result?.status === "running")) || result?.ok
      );
      setParserRunning(running);
      setStatus(result?.status || (running ? "running" : "error"));
      setCurrentLogFile(result?.currentLogFilePath || "");
      setCurrentParsedCharacter(result?.currentCharacterName || "");
      setLastMessage(result?.error || "Parsing resumed.");
      await refreshAll(false);
    } finally {
      setParserBusy(false);
    }
  };

  const importBuild = async () => {
    if (!selectedCharacterId) {
      setLastMessage("Select a character before importing a build.");
      return;
    }
    const result = await api.importBuild(selectedCharacterId);
    setLastMessage(
      result.ok
        ? `Imported ${result.importedLevels} build levels and ${
            result.importedEnhancements || 0
          } enhancements.`
        : result.error || "Build import canceled."
    );
    await loadCharacterData();
  };

  const manuallyUnlockBadge = async (badge) => {
    if (!selectedCharacterId) {
      setLastMessage("Select a character before unlocking badges.");
      return { ok: false, error: "No character selected." };
    }
    if (!badge?.id) {
      setLastMessage("Invalid badge selection.");
      return { ok: false, error: "Invalid badge id." };
    }
    const result = await api.unlockBadge(selectedCharacterId, badge.id);
    if (!result?.ok) {
      setLastMessage(result?.error || "Failed to unlock badge.");
      return result;
    }
    setLastMessage(
      result.created
        ? `Manually unlocked badge: ${badge.badge_name}.`
        : `Badge already unlocked: ${badge.badge_name}.`
    );
    await loadCharacters();
    await loadCharacterData();
    return result;
  };

  const reorderCharacters = async (orderedIds, previousIds = []) => {
    if (!selectedAccountId) {
      return { ok: false, error: "No account selected." };
    }
    const rowById = new Map(characters.map((row) => [row.id, row]));
    const optimistic = orderedIds.map((id) => rowById.get(id)).filter(Boolean);
    const leftovers = characters.filter((row) => !orderedIds.includes(row.id));
    setCharacters([...optimistic, ...leftovers]);

    const result = await api.reorderCharacters(selectedAccountId, orderedIds);
    if (!result?.ok) {
      const rollbackById = new Map(characters.map((row) => [row.id, row]));
      const rollback = previousIds.map((id) => rollbackById.get(id)).filter(Boolean);
      const rollbackRest = characters.filter((row) => !previousIds.includes(row.id));
      setCharacters([...rollback, ...rollbackRest]);
      setLastMessage(result?.error || "Failed to reorder characters.");
      return result;
    }

    setLastMessage("Character order updated.");
    await loadCharacters();
    return result;
  };

  const setCurrentZone = async () => {
    if (!selectedCharacterId) {
      setLastMessage("Select a character before setting zone.");
      return;
    }
    const zoneName = zoneInput.trim();
    if (!zoneName) {
      setLastMessage("Enter a zone name first.");
      return;
    }
    setSettingZone(true);
    try {
      const result = await api.addManualZoneEntry(selectedCharacterId, zoneName);
      if (!result?.ok) {
        setLastMessage(result?.error || "Failed to set current zone.");
        return;
      }
      setLastMessage(`Current zone set to ${result.zoneName}.`);
      setZoneInput(result.zoneName);
      await loadCharacterData();
    } finally {
      setSettingZone(false);
    }
  };

  if (needsOnboarding) {
    return (
      <div className="setup-screen">
        <section className="card setup-card">
          <h1>ParagonLedger First Run Setup</h1>
          <p className="muted">
            Select a City of Heroes logs folder to create your first account profile.
          </p>
          <p className="muted mono">
            Example: C:\Games\COH\accounts\wanderingwampa\Logs
          </p>
          <button onClick={chooseLogsDir}>Choose Logs Folder</button>
        </section>
      </div>
    );
  }

  return (
    <div className="layout">
      <header className="topbar">
        <div>
          <h1>ParagonLedger</h1>
          <p className="muted">
            Local City of Heroes Homecoming companion analytics dashboard
          </p>
        </div>
        <div className="actions">
          <label className="account-picker">
            <span className="muted">Account</span>
            <select
              value={selectedAccountId || ""}
              onChange={onAccountChange}
              className="select-input"
            >
              <option value="" disabled>
                Select account
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={chooseLogsDir}>Add/Update Account Logs Folder</button>
          <button
            onClick={toggleParser}
            disabled={parserBusy}
            className={parserRunning ? "parser-btn parser-btn--active" : "parser-btn"}
          >
            {parserBusy
              ? parserRunning
                ? "Pausing..."
                : "Resuming..."
              : parserRunning
                ? "Pause Parsing"
                : "Resume Parsing"}
          </button>
          <button onClick={() => refreshAll(true)} disabled={refreshing || parserBusy}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button onClick={importBuild}>Import Build</button>
        </div>
      </header>

      <div className="status-bar card">
        <p>
          <strong>Active account:</strong> {activeAccount?.name || "Not selected"}
        </p>
        <p>
          <strong>Logs directory:</strong>{" "}
          <span className="mono">{activeLogConfig?.logsDir || "Not configured"}</span>
        </p>
        <p>
          <strong>Current log file:</strong>{" "}
          <span className="mono">{currentLogFile || "None"}</span>
        </p>
        <p>
          <strong>Current parsed character:</strong>{" "}
          <span className="mono">{currentParsedCharacter || "Unknown"}</span>
        </p>
        <p>
          <strong>Parser status:</strong>{" "}
          {parserRunning ? "running" : status === "error" ? "error" : "paused"}
        </p>
        {lastRefreshedAt && (
          <p>
            <strong>Last refresh:</strong> {new Date(lastRefreshedAt).toLocaleTimeString()}
          </p>
        )}
        {lastMessage && (
          <p>
            <strong>Message:</strong> {lastMessage}
          </p>
        )}
      </div>

      <main className="content">
        <CharacterList
          characters={characters}
          selectedId={selectedCharacterId}
          onSelect={setSelectedCharacterId}
          onReorder={reorderCharacters}
        />
        <section className="main-panel">
          <StatsGrid summary={dashboard?.summary} />
          <section className="split-grid">
            <section className="card">
              <h3># of Enemies Defeated by Faction</h3>
              <ul className="simple-list">
                {(dashboard?.enemyFactions || []).map((entry) => (
                  <li key={entry.name}>
                    <span>{entry.name}</span>
                    <span>{entry.defeats}</span>
                  </li>
                ))}
                {!dashboard?.enemyFactions?.length && (
                  <li className="muted">No enemy defeats yet.</li>
                )}
              </ul>
            </section>
            <section className="card">
              <h3>Top Zones</h3>
              <div className="zone-manual-controls">
                <input
                  className="text-input"
                  placeholder="Select zone"
                  value={zoneInput}
                  onChange={(event) => setZoneInput(event.target.value)}
                  list="known-zones-list"
                />
                <button onClick={setCurrentZone} disabled={settingZone || !selectedCharacterId}>
                  {settingZone ? "Setting..." : "Set Current Zone"}
                </button>
                <datalist id="known-zones-list">
                  {knownZones.map((zoneName) => (
                    <option key={zoneName} value={zoneName} />
                  ))}
                </datalist>
              </div>
              <ul className="simple-list">
                {(dashboard?.topZones || []).map((entry) => (
                  <li key={entry.name}>
                    <span>{entry.name}</span>
                    <span>{entry.visits}</span>
                  </li>
                ))}
                {!dashboard?.topZones?.length && (
                  <li className="muted">No zone entries yet.</li>
                )}
              </ul>
            </section>
          </section>
          <BadgeTimeline badges={badges} />
          <BadgeBrowser badges={badgeCatalog} onUnlockBadge={manuallyUnlockBadge} />
          <BuildPlannerPanel buildPlan={buildPlan} />
        </section>
      </main>
    </div>
  );
}
