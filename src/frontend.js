function createLabeledControl(labelText, control) {
  const label = document.createElement("label");
  label.className = "dsc-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

function createButton(text, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dsc-button";
  button.textContent = text;
  button.addEventListener("click", action);
  return button;
}

export function setup(ctx) {
  ctx.deferReady();
  const cleanups = [];
  let latestStatus = null;
  let latestConnections = [];
  let activeChatId = null;
  let connectionDiagnostic = "Loading connection profiles…";
  let connectionPermissionGranted = null;

  const removeStyle = ctx.dom.addStyle(`
    .dsc-panel { padding: 14px; color: var(--lumiverse-text); display: grid; gap: 12px; }
    .dsc-card { border: 1px solid var(--lumiverse-border); border-radius: var(--lumiverse-radius); padding: 12px; background: var(--lumiverse-fill-subtle); }
    .dsc-status { font-weight: 700; }
    .dsc-status[data-level="green"] { color: #22c55e; }
    .dsc-status[data-level="amber"] { color: #f59e0b; }
    .dsc-field { display: grid; gap: 5px; font-size: .86rem; }
    .dsc-field select, .dsc-field input { color: var(--lumiverse-text); background: var(--lumiverse-fill); border: 1px solid var(--lumiverse-border); border-radius: 8px; padding: 8px; }
    .dsc-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .dsc-button { color: var(--lumiverse-accent-fg); background: var(--lumiverse-accent); border: 0; border-radius: 8px; padding: 8px 10px; cursor: pointer; }
    .dsc-hint { color: var(--lumiverse-text-muted); font-size: .76rem; overflow-wrap: anywhere; }
    .dsc-hint[data-level="amber"] { color: #f59e0b; }
    .dsc-state { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 45vh; overflow: auto; font-size: .78rem; color: var(--lumiverse-text-muted); }
    .ds-tracker-status[data-engine-level="green"] { color: #bbf7d0 !important; border-color: rgba(34,197,94,.45) !important; background: rgba(21,128,61,.18) !important; }
    .ds-tracker-status[data-engine-level="amber"] { color: #fde68a !important; border-color: rgba(245,158,11,.45) !important; background: rgba(146,64,14,.18) !important; }
  `);
  cleanups.push(removeStyle);

  const tab = ctx.ui.registerDrawerTab({
    id: "continuity",
    title: "Date Simulator Continuity",
    shortName: "Continuity",
    headerTitle: "Continuity",
    description: "Configure and inspect Date Simulator scene and arc tracking",
    keywords: ["date simulator", "tracker", "scene", "arc", "sidecar"],
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v6h6"/><path d="M12 8v4l3 2"/></svg>',
  });
  cleanups.push(() => tab.destroy());

  const panel = document.createElement("div");
  panel.className = "dsc-panel";
  const statusCard = document.createElement("section");
  statusCard.className = "dsc-card";
  const statusText = document.createElement("div");
  statusText.className = "dsc-status";
  const statusMeta = document.createElement("div");
  statusMeta.style.fontSize = ".78rem";
  statusMeta.style.marginTop = "6px";
  statusMeta.style.color = "var(--lumiverse-text-muted)";
  statusCard.append(statusText, statusMeta);

  const configCard = document.createElement("section");
  configCard.className = "dsc-card";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  const connection = document.createElement("select");
  const connectionStatus = document.createElement("div");
  connectionStatus.className = "dsc-hint";
  const maxTokens = document.createElement("input");
  maxTokens.type = "number";
  maxTokens.min = "400";
  maxTokens.max = "2000";
  const timeout = document.createElement("input");
  timeout.type = "number";
  timeout.min = "5";
  timeout.max = "120";
  configCard.append(
    createLabeledControl("Tracking enabled", enabled),
    createLabeledControl("Tracker connection", connection),
    connectionStatus,
    createLabeledControl("Maximum tracker output tokens", maxTokens),
    createLabeledControl("Tracker timeout in seconds", timeout),
  );
  configCard.style.display = "grid";
  configCard.style.gap = "10px";

  const stateCard = document.createElement("section");
  stateCard.className = "dsc-card";
  const showPrivateLabel = document.createElement("label");
  const showPrivate = document.createElement("input");
  showPrivate.type = "checkbox";
  showPrivateLabel.append(showPrivate, document.createTextNode(" Show private tracker state"));
  const stateText = document.createElement("pre");
  stateText.className = "dsc-state";
  stateText.textContent = "Private state is hidden.";
  stateCard.append(showPrivateLabel, stateText);

  const actions = document.createElement("div");
  actions.className = "dsc-actions";
  actions.append(
    createButton("Save Settings", () => {
      ctx.sendToBackend({
        type: "continuity_save_config",
        chatId: activeChatId,
        config: {
          enabled: enabled.checked,
          connectionId: connection.value,
          maxTokens: Number(maxTokens.value),
          timeoutMs: Number(timeout.value) * 1_000,
          promptWaitMs: latestStatus?.config?.promptWaitMs ?? 2_000,
        },
      });
    }),
    createButton("Refresh Connections", () => {
      connectionDiagnostic = "Refreshing connection profiles…";
      renderConnections();
      ctx.sendToBackend({ type: "continuity_get_connections" });
    }),
    createButton("Reprocess Latest Turn", () => {
      ctx.sendToBackend({ type: "continuity_reprocess", chatId: activeChatId });
    }),
    createButton("Migrate Current Chat", () => {
      ctx.sendToBackend({ type: "continuity_migrate", chatId: activeChatId });
    }),
  );

  panel.append(statusCard, configCard, actions, stateCard);
  tab.root.appendChild(panel);

  function requestStatus() {
    ctx.sendToBackend({
      type: "continuity_get_status",
      chatId: activeChatId,
      includePrivate: showPrivate.checked,
    });
  }

  function renderConnections() {
    const selected = latestStatus?.config?.connectionId ?? connection.value;
    connection.replaceChildren();
    const automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = "Active default connection";
    connection.appendChild(automatic);
    for (const item of latestConnections.filter((entry) => entry?.id)) {
      const option = document.createElement("option");
      option.value = item.id;
      const details = [item.provider, item.model].filter(Boolean).join("/");
      option.textContent = `${item.name || item.id}${details ? ` — ${details}` : ""}`;
      connection.appendChild(option);
    }
    if (selected && !latestConnections.some((item) => item?.id === selected)) {
      const unavailable = document.createElement("option");
      unavailable.value = selected;
      unavailable.textContent = `${selected} — saved profile unavailable`;
      connection.appendChild(unavailable);
    }
    connection.value = selected;
    connection.disabled = connectionPermissionGranted === false;
    connectionStatus.dataset.level = connectionPermissionGranted === false || connectionDiagnostic
      ? "amber"
      : "green";
    connectionStatus.textContent = connectionDiagnostic || (
      latestConnections.length > 0
        ? `${latestConnections.length} connection profile${latestConnections.length === 1 ? "" : "s"} available.`
        : "No named connection profiles were returned; the active default connection remains available."
    );
  }

  function updateProfileCard(status) {
    if (!status?.caseMessageId) return;
    const bubble = ctx.dom.findMessageElement(status.caseMessageId);
    if (!bubble) return;
    const badge = bubble.querySelector(".ds-tracker-status");
    if (badge) {
      badge.dataset.engineLevel = status.level;
      badge.textContent = status.text;
    }
    const button = bubble.querySelector(".ds-state-button");
    if (button) {
      button.disabled = Boolean(status.profileSaved);
      if (status.profileSaved) {
        button.dataset.lumiverseRegexActionUsed = "true";
        button.textContent = "Private Profile Saved";
      }
    }
  }

  function renderStatus(status) {
    latestStatus = status;
    if (typeof status.chatId === "string" && status.chatId) activeChatId = status.chatId;
    statusText.dataset.level = status.level;
    statusText.textContent = status.text;
    statusMeta.textContent = status.chatId
      ? `Revision ${status.revision || 0}${status.updatedAt ? ` · ${status.updatedAt}` : ""}`
      : "No active chat.";
    enabled.checked = status.config?.enabled !== false;
    maxTokens.value = String(status.config?.maxTokens ?? 1_200);
    timeout.value = String(Math.round((status.config?.timeoutMs ?? 45_000) / 1_000));
    renderConnections();
    stateText.textContent = showPrivate.checked && status.state
      ? JSON.stringify(status.state, null, 2)
      : "Private state is hidden.";
    tab.setBadge(status.level === "green" ? null : "!");
    updateProfileCard(status);
  }

  showPrivate.addEventListener("change", requestStatus);
  cleanups.push(tab.onActivate(() => {
    requestStatus();
    ctx.sendToBackend({ type: "continuity_get_connections" });
  }));

  cleanups.push(ctx.onBackendMessage((payload) => {
    if (payload?.type === "continuity_status") renderStatus(payload);
    if (payload?.type === "continuity_connections") {
      latestConnections = Array.isArray(payload.connections) ? payload.connections : [];
      connectionPermissionGranted = payload.permissionGranted !== false;
      if (!connectionPermissionGranted) {
        connectionDiagnostic = "Generation permission is not granted. Grant it to Continuity Engine, then refresh connections.";
      } else if (payload.error) {
        connectionDiagnostic = `Lumiverse could not list connection profiles: ${payload.error}`;
      } else {
        connectionDiagnostic = "";
      }
      renderConnections();
    }
    if (payload?.type === "continuity_config_saved") requestStatus();
  }));

  cleanups.push(ctx.events.on("CHAT_SWITCHED", (payload) => {
    activeChatId = typeof payload?.chatId === "string" ? payload.chatId : null;
    requestStatus();
  }));
  for (const eventName of ["CHARACTER_MESSAGE_RENDERED", "MESSAGE_SENT"]) {
    cleanups.push(ctx.events.on(eventName, (payload) => {
      if (typeof payload?.chatId === "string" && payload.chatId) activeChatId = payload.chatId;
      requestStatus();
    }));
  }

  ctx.ready();
  requestStatus();
  ctx.sendToBackend({ type: "continuity_get_connections" });

  return () => {
    for (const cleanup of cleanups.reverse()) {
      try { cleanup(); } catch { /* best-effort cleanup */ }
    }
    ctx.dom.cleanup();
  };
}
