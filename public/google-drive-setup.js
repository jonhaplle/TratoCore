(() => {
  const keyField = document.getElementById("adminKey");
  const status = document.getElementById("status");
  keyField.value = sessionStorage.getItem("googleDriveAdminKey") || "";
  const query = new URLSearchParams(location.search);
  if (query.has("oauth")) {
    status.textContent = query.get("oauth") === "connected"
      ? "Conta Google autorizada. Selecione FOTOS no Picker."
      : "Autorização não concluída. Confira a conta e tente novamente.";
    history.replaceState(null, "", location.pathname);
  }

  function saveKey() {
    const key = keyField.value.trim();
    if (!key) throw new Error("Informe a chave administrativa.");
    sessionStorage.setItem("googleDriveAdminKey", key);
    return key;
  }

  async function api(path, options = {}) {
    const response = await fetch(`/api/google-drive/oauth${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${saveKey()}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Falha na solicitação.");
    return body;
  }

  document.getElementById("authorize").addEventListener("click", async () => {
    try {
      status.textContent = "Preparando autorização segura…";
      const result = await api("/start", { method: "POST", body: "{}" });
      location.assign(result.authorization_url);
    } catch (error) { status.textContent = error.message; }
  });

  document.getElementById("pick").disabled = !query.has("oauth") && !sessionStorage.getItem("googleDriveAdminKey");
  document.getElementById("pick").addEventListener("click", async () => {
    try {
      const config = await api("/picker-config");
      await new Promise((resolve, reject) => {
        if (window.gapi?.picker) return resolve();
        const script = document.createElement("script");
        script.src = "https://apis.google.com/js/api.js";
        script.onload = () => window.gapi.load("picker", { callback: resolve });
        script.onerror = reject;
        document.head.appendChild(script);
      });
      const picker = new google.picker.PickerBuilder()
        .addView(new google.picker.DocsView(google.picker.ViewId.FOLDERS).setSelectFolderEnabled(true))
        .setOAuthToken(config.accessToken)
        .setDeveloperKey(config.developerKey)
        .setAppId(config.appId)
        .setCallback(async data => {
          if (data.action !== google.picker.Action.PICKED) return;
          try {
            const folder = data.docs?.[0];
            await api("/selected-folder", { method: "POST", body: JSON.stringify({ fileId: folder?.id }) });
            document.getElementById("verify").disabled = false;
            status.textContent = "Pasta FOTOS validada. Execute o teste temporário antes de liberar uploads.";
          } catch (error) { status.textContent = error.message; }
        }).build();
      picker.setVisible(true);
    } catch (error) { status.textContent = error.message; }
  });

  document.getElementById("verify").addEventListener("click", async () => {
    try {
      status.textContent = "Testando gravação, leitura e exclusão…";
      await api("/verify-write", { method: "POST", body: "{}" });
      document.getElementById("verify").disabled = true;
      status.textContent = "Drive confirmado. O TXT temporário foi removido e uploads novos podem ser habilitados.";
    } catch (error) { status.textContent = error.message; }
  });

  if (sessionStorage.getItem("googleDriveAdminKey")) {
    document.getElementById("pick").disabled = false;
    api("/status").then(result => {
      if (result.authorized) document.getElementById("pick").disabled = false;
      if (result.folderSelected) document.getElementById("verify").disabled = false;
      if (result.writeVerified) status.textContent = "Autorização, pasta e gravação já validadas.";
    }).catch(() => {});
  }
})();
