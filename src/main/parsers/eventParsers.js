const patterns = [
  {
    type: "character_detected",
    regex: /Welcome to City of Heroes,\s*(.+?)(?:!|\.)?$/i,
    map: (m) => ({ name: m[1].trim() })
  },
  {
    type: "character_detected",
    regex: /Welcome to City of Villains,\s*(.+?)(?:!|\.)?$/i,
    map: (m) => ({ name: m[1].trim() })
  },
  {
    type: "character_detected",
    regex: /Welcome to [^,]+,\s*(.+?)(?:!|\.)?$/i,
    map: (m) => ({ name: m[1].trim() })
  },
  {
    type: "character_detected",
    regex: /Now playing:\s*(.+)$/i,
    map: (m) => ({ name: m[1].trim() })
  },
  {
    type: "character_detected",
    regex: /Now entering game as\s+(.+?)(?:!|\.)?$/i,
    map: (m) => ({ name: m[1].trim() })
  },
  {
    type: "character_detected",
    regex: /You are now playing\s+(.+)$/i,
    map: (m) => ({ name: m[1].trim() })
  },
  {
    type: "character_detected",
    regex: /Character:\s*(.+)$/i,
    map: (m) => ({ name: m[1].trim() })
  },
  {
    type: "badge_unlocked",
    regex: /Badge Earned:\s*(.+)$/i,
    map: (m) => ({ badgeName: m[1].trim() })
  },
  {
    type: "badge_unlocked",
    regex: /Congratulations!\s+You\s+earned\s+the\s+(.+?)\s+badge\.?$/i,
    map: (m) => ({ badgeName: m[1].trim() })
  },
  {
    type: "enemy_defeat",
    regex: /You (?:have\s+)?defeated\s+(.+?)[.!]?$/i,
    map: (m) => ({ enemyName: m[1].trim() })
  },
  {
    type: "influence_gain",
    regex:
      /You gain(?:ed)?\s+(?:[0-9,]+\s+experience\s+and\s+)?([0-9,]+)\s+(influence|infamy)\b/i,
    map: (m) => ({
      amount: Number(m[1].replace(/,/g, "")) || 0,
      currency: String(m[2] || "influence").toLowerCase()
    })
  },
  {
    type: "zone_entry",
    regex: /Entering(?:\s+zone:)?\s+(.+?)[.!]?$/i,
    map: (m) => ({ zoneName: m[1].trim() })
  },
  {
    type: "mission_complete",
    regex: /Mission Complete:\s*(.+)$/i,
    map: (m) => ({ missionName: m[1].trim() })
  },
  {
    type: "loot_received",
    regex: /You received\s+(.+?)[.!]?$/i,
    map: (m) => ({ itemName: m[1].trim() })
  }
];

function parseTimestampAndMessage(line) {
  const bracket = line.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (!bracket) {
    const isoPrefix = line.match(
      /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+(.*)$/
    );
    if (!isoPrefix) {
      return { timestamp: new Date().toISOString(), message: line };
    }
    const normalized = isoPrefix[1].replace(" ", "T");
    const parsedDate = new Date(normalized);
    return {
      timestamp: Number.isNaN(parsedDate.getTime())
        ? new Date().toISOString()
        : parsedDate.toISOString(),
      message: isoPrefix[2]
    };
  }
  const parsedDate = new Date(bracket[1]);
  return {
    timestamp: Number.isNaN(parsedDate.getTime())
      ? new Date().toISOString()
      : parsedDate.toISOString(),
    message: bracket[2]
  };
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const { timestamp, message } = parseTimestampAndMessage(trimmed);
  for (const entry of patterns) {
    const match = message.match(entry.regex);
    if (match) {
      return {
        type: entry.type,
        timestamp,
        payload: entry.map(match)
      };
    }
  }
  return null;
}

module.exports = {
  parseLine
};
