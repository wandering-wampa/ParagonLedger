const path = require("path");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { initDatabase } = require("../src/main/db/database");
const { SettingsService } = require("../src/main/services/settingsService");
const { LogIngestService } = require("../src/main/services/logIngestService");
const { QueryService } = require("../src/main/services/queryService");
const { ExportService } = require("../src/main/services/exportService");
const { MidsImportService } = require("../src/main/services/midsImportService");

let mainWindow;
let db;
let settings;
let ingest;
let query;
let exporter;
let midsImporter;

async function upsertAccountRow(accountName, logsDir) {
  if (!accountName) {
    return;
  }
  await db.run(
    "INSERT OR IGNORE INTO accounts (name, logs_dir) VALUES (?, ?)",
    [accountName, logsDir || ""]
  );
  await db.run("UPDATE accounts SET logs_dir = ? WHERE name = ?", [
    logsDir || "",
    accountName
  ]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#0f1418",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function wireIpc() {
  ipcMain.handle("settings:get", async () => settings.getSettings());
  ipcMain.handle("settings:setLogsDir", async (_event, logsDir) => {
    const updated = settings.setLogsDir(logsDir);
    const active = settings.getActiveAccount();
    if (active) {
      await upsertAccountRow(active.accountName, active.logsDir);
      await ingest.stop();
      ingest.setAccountContext(active.accountName, active.logsDir);
    }
    return updated;
  });
  ipcMain.handle(
    "settings:setActiveAccount",
    async (_event, accountName, logsDir = "") => {
      const updated = settings.setActiveAccount(accountName, logsDir);
      if (accountName) {
        await upsertAccountRow(accountName, logsDir);
      }
      const active = settings.getActiveAccount();
      if (active) {
        await ingest.stop();
        ingest.setAccountContext(active.accountName, active.logsDir);
      }
      return updated;
    }
  );
  ipcMain.handle("dialog:pickLogsDir", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return result.filePaths[0];
  });
  ipcMain.handle("parser:start", async () => {
    const active = settings.getActiveAccount();
    if (!active) {
      return { ok: false, error: "Select an account logs directory first." };
    }
    ingest.setAccountContext(active.accountName, active.logsDir);
    return ingest.start();
  });
  ipcMain.handle("parser:stop", async () => ingest.stop());
  ipcMain.handle("parser:getState", async () => ingest.getState());
  ipcMain.handle("accounts:list", async () => query.getAccounts());
  ipcMain.handle("characters:list", async (_event, accountId) =>
    query.getCharactersWithStats(accountId)
  );
  ipcMain.handle("dashboard:get", async (_event, characterId) =>
    query.getDashboard(characterId)
  );
  ipcMain.handle("badges:getTimeline", async (_event, characterId) =>
    query.getBadgeTimeline(characterId)
  );
  ipcMain.handle("badges:getBrowser", async (_event, characterId) =>
    query.getBadgeBrowser(characterId)
  );
  ipcMain.handle("exports:run", async (_event, format) => {
    const filters =
      format === "csv"
        ? [{ name: "CSV files", extensions: ["csv"] }]
        : [{ name: "JSON files", extensions: ["json"] }];
    const result = await dialog.showSaveDialog(mainWindow, {
      filters
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    return exporter.exportTo(format, result.filePath);
  });
  ipcMain.handle("build:import", async (_event, characterId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }
    return midsImporter.importBuild(result.filePaths[0], characterId);
  });
  ipcMain.handle("build:getLatest", async (_event, characterId) =>
    query.getLatestBuildPlan(characterId)
  );
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  db = await initDatabase(userDataPath);
  settings = new SettingsService(userDataPath);
  ingest = new LogIngestService(db);
  query = new QueryService(db);
  exporter = new ExportService(db);
  midsImporter = new MidsImportService(db);
  for (const entry of settings.getSettings().accountLogs || []) {
    await upsertAccountRow(entry.accountName, entry.logsDir);
  }
  const active = settings.getActiveAccount();
  if (active) {
    ingest.setAccountContext(active.accountName, active.logsDir);
  }

  wireIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  if (ingest) {
    await ingest.stop();
  }
  if (db) {
    await db.close();
  }
});
