(() => {
  const $ = (id) => document.getElementById(id);
  const input = $("searchInput");
  const results = $("results");
  const searchButton = $("searchButton");
  const voiceButton = $("voiceButton");
  const voiceHint = $("voiceHint");
  const resultCount = $("resultCount");
  const resultsTitle = $("resultsTitle");
  const dialog = $("handoffDialog");
  let selectedProduct = null;
  let recognition = null;

  function money(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function speak(message) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "pt-BR";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }

  function setConnection(online, message) {
    const status = document.querySelector(".connection");
    status.classList.toggle("online", Boolean(online));
    $("connectionText").textContent = message;
  }

  function makeButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderProducts(products) {
    results.replaceChildren();
    resultCount.textContent = products.length ? products.length + " resultado(s)" : "";
    if (!products.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Não encontrei produtos disponíveis com esse termo. Tente outra palavra ou chame nosso vendedor.";
      results.appendChild(empty);
      return;
    }

    for (const product of products) {
      const card = document.createElement("article");
      card.className = "product-card";
      const photo = document.createElement("div");
      photo.className = "product-photo";
      if (product.image_url) {
        const image = document.createElement("img");
        image.src = product.image_url;
        image.alt = product.title;
        image.loading = "lazy";
        image.onerror = () => {
          photo.replaceChildren();
          const fallback = document.createElement("span");
          fallback.className = "no-photo";
          fallback.textContent = "Imagem indisponível";
          photo.appendChild(fallback);
        };
        photo.appendChild(image);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "no-photo";
        fallback.textContent = "Sem foto cadastrada";
        photo.appendChild(fallback);
      }

      const info = document.createElement("div");
      info.className = "product-info";
      const title = document.createElement("h3");
      title.textContent = product.title;
      const condition = document.createElement("span");
      condition.className = "product-condition";
      condition.textContent = product.condition === "new" ? "Novo" : "Usado";
      const price = document.createElement("p");
      price.className = "product-price";
      price.textContent = money(product.price);
      const actions = document.createElement("div");
      actions.className = "product-actions";
      actions.append(
        makeButton("Ver detalhes", "details-button", () => {
          const text = product.title + ". " + condition.textContent + ". Preço: " + money(product.price) + ". " + (product.description || "");
          speak(text.slice(0, 700));
        }),
        makeButton("Tenho interesse", "ask-button", () => openHandoff(product))
      );
      info.append(title, condition, price, actions);
      card.append(photo, info);
      results.appendChild(card);
    }
  }

  async function search(query) {
    const term = String(query || input.value).trim();
    if (term.length < 2) {
      voiceHint.textContent = "Digite pelo menos duas letras.";
      return;
    }
    input.value = term;
    searchButton.disabled = true;
    searchButton.textContent = "Buscando...";
    resultsTitle.textContent = "Buscando: " + term;
    results.innerHTML = '<div class="empty-state">Consultando o catálogo...</div>';
    try {
      const response = await fetch("/api/vendedor/search?q=" + encodeURIComponent(term));
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Falha na busca.");
      renderProducts(data.products || []);
      resultsTitle.textContent = "Resultados para " + term;
      voiceHint.textContent = data.count
        ? "Encontrei " + data.count + " produto(s) disponíveis."
        : "Não encontrei esse produto no catálogo disponível.";
      if (data.count) speak("Encontrei " + data.count + " produtos para " + term + ".");
    } catch (error) {
      results.innerHTML = '<div class="empty-state">Não foi possível consultar o catálogo. Verifique a conexão com o TratoCore.</div>';
      voiceHint.textContent = error.message;
      setConnection(false, "Catálogo indisponível");
    } finally {
      searchButton.disabled = false;
      searchButton.textContent = "Buscar";
    }
  }

  function openHandoff(product = null) {
    selectedProduct = product;
    $("selectedProduct").textContent = product ? "Produto: " + product.title : "Atendimento geral";
    $("customerMessage").value = product ? "Tenho interesse em " + product.title + ". Gostaria de saber mais." : "";
    $("handoffStatus").textContent = "";
    dialog.showModal();
  }

  async function submitHandoff(event) {
    event.preventDefault();
    const message = $("customerMessage").value.trim();
    if (!message) return;
    const button = $("handoffForm").querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = "Enviando...";
    try {
      const response = await fetch("/api/vendedor/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: $("customerName").value.trim(),
          customer_contact: $("customerContact").value.trim(),
          message,
          product_id: selectedProduct?.id || null,
          product_title: selectedProduct?.title || ""
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Não foi possível enviar.");
      $("handoffStatus").textContent = "Solicitação enviada. A equipe da loja recebeu sua mensagem.";
      speak("Sua solicitação foi encaminhada para a equipe da loja.");
      $("customerMessage").value = "";
      setTimeout(() => dialog.close(), 1800);
    } catch (error) {
      $("handoffStatus").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Enviar solicitação";
    }
  }

  async function loadHandoffs() {
    const key = $("adminKey").value.trim();
    const output = $("handoffs");
    output.textContent = "Consultando...";
    try {
      const response = await fetch("/api/vendedor/handoffs", {
        headers: { Authorization: "Bearer " + key }
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Acesso não autorizado.");
      output.replaceChildren();
      if (!data.handoffs.length) {
        output.textContent = "Nenhuma solicitação nova.";
        return;
      }
      for (const item of data.handoffs) {
        const box = document.createElement("article");
        box.className = "handoff-item";
        const heading = document.createElement("strong");
        heading.textContent = item.customer_name || "Cliente sem nome";
        const product = document.createElement("small");
        product.textContent = item.product_title || "Atendimento geral";
        const message = document.createElement("p");
        message.textContent = item.message;
        const contact = document.createElement("small");
        contact.textContent = item.customer_contact || "Sem telefone informado";
        const date = document.createElement("small");
        date.textContent = new Date(item.created_at).toLocaleString("pt-BR");
        box.append(heading, product, message, contact, date);
        output.appendChild(box);
      }
    } catch (error) {
      output.textContent = error.message;
    }
  }

  searchButton.addEventListener("click", () => search());
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") search();
  });
  document.querySelectorAll("[data-query]").forEach(button => {
    button.addEventListener("click", () => search(button.dataset.query));
  });
  $("openHandoff").addEventListener("click", () => openHandoff());
  $("closeHandoff").addEventListener("click", () => dialog.close());
  $("handoffForm").addEventListener("submit", submitHandoff);
  $("loadHandoffs").addEventListener("click", loadHandoffs);

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      voiceButton.classList.add("listening");
      voiceHint.textContent = "Estou ouvindo. Diga o nome do produto.";
    };
    recognition.onresult = event => {
      const spoken = event.results?.[0]?.[0]?.transcript || "";
      input.value = spoken;
      search(spoken);
    };
    recognition.onerror = () => {
      voiceHint.textContent = "Não consegui reconhecer. Você pode digitar sua pesquisa.";
    };
    recognition.onend = () => voiceButton.classList.remove("listening");
    voiceButton.addEventListener("click", () => {
      try { recognition.start(); } catch (_) {}
    });
  } else {
    voiceButton.disabled = true;
    voiceButton.title = "Reconhecimento de voz não disponível neste navegador.";
    voiceHint.textContent = "Este navegador não oferece reconhecimento de voz. Você ainda pode digitar e ouvir as respostas.";
  }

  fetch("/api/vendedor/status")
    .then(response => response.json())
    .then(data => {
      if (!data.success) throw new Error("Módulo indisponível");
      setConnection(true, "Conectado ao catálogo");
    })
    .catch(() => setConnection(false, "Servidor indisponível"));
})();
