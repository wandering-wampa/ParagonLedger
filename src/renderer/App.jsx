import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./services/api";
import { usePolling } from "./hooks/usePolling";
import { CharacterList } from "./components/CharacterList";
import { StatsGrid } from "./components/StatsGrid";
import { AnalyticsCharts } from "./components/AnalyticsCharts";
import { BadgeTimeline } from "./components/BadgeTimeline";
import { BadgeBrowser } from "./components/BadgeBrowser";

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
  const [currentLogFile, setCurrentLogFile] = useState("");
  const [currentParsedCharacter, setCurrentParsedCharacter] = useState("");
  const [lastMessage, setLastMessage] = useState("");

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
      return;
    }
    const [dash, badgeTimeline, badgeBrowser, build] = await Promise.all([
      api.getDashboard(selectedCharacterId),
      api.getBadgeTimeline(selectedCharacterId),
      api.getBadgeBrowser(selectedCharacterId),
      api.getLatestBuild(selectedCharacterId)
    ]);
    setDashboard(dash);
    setBadges(badgeTimeline);
    setBadgeCatalog(badgeBrowser);
    setBuildPlan(build);
  }, [selectedCharacterId]);

  const loadParserState = useCallback(async () => {
    const state = await api.getParserState();
    if (state?.status) {
      setStatus(state.status);
    }
    setCurrentLogFile(state?.currentLogFilePath || "");
    setCurrentParsedCharacter(state?.currentCharacterName || "");
  }, []);

  useEffect(() => {
    const boot = async () => {
      const currentSettings = await api.getSettings();
      setSettings(currentSettings);
      await loadAccounts(currentSettings);
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

  const pollMs = status === "running" ? 1500 : 5000;
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
      setStatus("stopped");
      setCurrentLogFile("");
      setCurrentParsedCharacter("");
      setLastMessage(`Active account: ${account.name}`);
    }
  };

  const startParser = async () => {
    if (!activeAccount) {
      setStatus("error");
      setLastMessage("Select an account with a configured logs directory first.");
      return;
    }
    const result = await api.startParser();
    setStatus(result.ok ? "running" : "error");
    setCurrentLogFile(result.currentLogFilePath || "");
    setCurrentParsedCharacter(result.currentCharacterName || "");
    setLastMessage(result.error || result.status || "");
    await loadAccounts();
    await loadCharacters();
    await loadCharacterData();
  };

  const stopParser = async () => {
    const result = await api.stopParser();
    setStatus(result.status || "stopped");
    setCurrentLogFile(result.currentLogFilePath || "");
    setCurrentParsedCharacter(result.currentCharacterName || "");
    setLastMessage(result.status || "");
  };

  const exportJson = async () => {
    const result = await api.exportData("json");
    setLastMessage(result.ok ? `Exported: ${result.filePath}` : "Export canceled.");
  };

  const exportCsv = async () => {
    const result = await api.exportData("csv");
    setLastMessage(result.ok ? `Exported: ${result.filePath}` : "Export canceled.");
  };

  const importBuild = async () => {
    if (!selectedCharacterId) {
      setLastMessage("Select a character before importing a build.");
      return;
    }
    const result = await api.importBuild(selectedCharacterId);
    setLastMessage(
      result.ok
        ? `Imported ${result.importedLevels} build levels.`
        : result.error || "Build import canceled."
    );
    await loadCharacterData();
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
            onClick={startParser}
            className={status === "running" ? "parser-btn parser-btn--active" : "parser-btn"}
          >
            Start Parser
          </button>
          <button
            onClick={stopParser}
            className={
              status === "stopped" ? "parser-btn parser-btn--active" : "parser-btn"
            }
          >
            Stop Parser
          </button>
          <button onClick={exportJson}>Export JSON</button>
          <button onClick={exportCsv}>Export CSV</button>
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
          <strong>Parser status:</strong> {status}
        </p>
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
        />
        <section className="main-panel">
          <StatsGrid summary={dashboard?.summary} />
          <AnalyticsCharts dashboard={dashboard} />
          <section className="split-grid">
            <section className="card">
              <h3>Top Powers</h3>
              <ul className="simple-list">
                {(dashboard?.topPowers || []).map((entry) => (
                  <li key={entry.name}>
                    <span>{entry.name}</span>
                    <span>{entry.uses}</span>
                  </li>
                ))}
                {!dashboard?.topPowers?.length && (
                  <li className="muted">No power usage yet.</li>
                )}
              </ul>
            </section>
            <section className="card">
              <h3>Top Zones</h3>
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
          <BadgeBrowser badges={badgeCatalog} />
          <section className="card">
            <h3>Build Planner</h3>
            <p className="muted">
              {buildPlan?.build
                ? `Imported ${new Date(buildPlan.build.imported_at).toLocaleString()}`
                : "No build imported yet."}
            </p>
            <ul className="simple-list">
              {(buildPlan?.levels || []).map((row, idx) => (
                <li key={`${row.level}-${row.power_name}-${idx}`}>
                  <span>
                    L{row.level} - {row.power_name}
                  </span>
                  <span>{row.enhancement_slots} slots</span>
                </li>
              ))}
            </ul>
          </section>
        </section>
      </main>
    </div>
  );
}
