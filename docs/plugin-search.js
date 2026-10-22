(() => {
  const root = document.querySelector("[data-plugin-search]");
  if (root === null) return;

  const form = root.querySelector("form");
  const input = root.querySelector("input");
  const status = root.querySelector('[role="status"]');
  const results = root.querySelector("[data-plugin-results]");
  const more = root.querySelector("[data-plugin-more]");
  const sort = root.querySelector("select");
  const keywords = ["pi-web.dev-plugin", "pi-web-plugin"];
  const batchSize = 100;
  const pageSize = 20;
  const createdDates = new Map();
  let controller;
  let catalog = [];
  let ordered = [];
  let visibleCount = pageSize;
  let activeSort = "popular";

  async function fetchJson(url, signal) {
    const response = await fetch(url, { signal, credentials: "omit" });
    if (!response.ok) throw new Error(`npm returned HTTP ${response.status}`);
    return response.json();
  }

  async function searchKeyword(keyword, query, signal) {
    const items = [];
    let offset = 0;
    let total;
    do {
      signal.throwIfAborted();
      const url = new URL("https://registry.npmjs.org/-/v1/search");
      url.search = new URLSearchParams({ text: `${query} keywords:${keyword}`.trim(), size: String(batchSize), from: String(offset) });
      const data = await fetchJson(url, signal);
      if (!Array.isArray(data?.objects) || !Number.isInteger(data.total) || data.total < 0) {
        throw new Error("Invalid npm search response");
      }
      // Freeze each stream's total on its first page; a changing registry is not a snapshot.
      total ??= data.total;
      if (data.objects.length === 0 && offset < total) throw new Error("Incomplete npm search response");
      for (const entry of data.objects) {
        const pkg = entry?.package;
        if (typeof pkg?.name !== "string" || typeof pkg.version !== "string") throw new Error("Invalid npm package metadata");
        if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes(keyword)) continue;
        const monthly = entry.downloads?.monthly;
        items.push({ ...pkg, monthlyDownloads: Number.isFinite(monthly) && monthly >= 0 ? monthly : null });
      }
      offset += data.objects.length;
    } while (offset < total);
    return items;
  }

  async function loadCreatedDates(packages, signal) {
    const pending = packages.filter((pkg) => !createdDates.has(pkg.name));
    // Keep metadata requests bounded; only Newest packages needs this additional data.
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length > 0) {
        signal.throwIfAborted();
        const pkg = pending.shift();
        const url = new URL(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`);
        const data = await fetchJson(url, signal);
        const created = typeof data?.time?.created === "string" ? Date.parse(data.time.created) : NaN;
        if (!Number.isFinite(created)) throw new Error(`Missing package creation date for ${pkg.name}`);
        signal.throwIfAborted();
        createdDates.set(pkg.name, created);
      }
    }));
  }

  function sortCatalog(mode) {
    const value = (pkg) => mode === "popular" ? (pkg.monthlyDownloads ?? -1)
      : mode === "newest" ? createdDates.get(pkg.name)
        : (Date.parse(pkg.date) || 0);
    return [...catalog].sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name, "en"));
  }

  function renderPackage(pkg) {
    const item = document.createElement("li");
    item.className = "plugin-result";
    const main = document.createElement("div");
    main.className = "plugin-result-main";
    const title = document.createElement("div");
    title.className = "plugin-result-title";
    const heading = document.createElement("h3");
    const link = document.createElement("a");
    // Treat all registry text as untrusted and build destinations from package names only.
    link.href = `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`;
    link.textContent = pkg.name;
    heading.append(link);
    const version = document.createElement("span");
    version.className = "plugin-result-version";
    version.textContent = `v${pkg.version}`;
    title.append(heading, version);
    const description = document.createElement("p");
    description.textContent = typeof pkg.description === "string" && pkg.description !== "" ? pkg.description : "未提供描述。";
    const metadata = document.createElement("p");
    metadata.className = "plugin-result-meta";
    metadata.textContent = typeof pkg.publisher?.username === "string" ? `发布者：${pkg.publisher.username}` : "发布者未知";
    const date = typeof pkg.date === "string" ? new Date(pkg.date) : null;
    if (date !== null && Number.isFinite(date.getTime())) {
      const time = document.createElement("time");
      time.dateTime = date.toISOString();
      time.textContent = `更新于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" }).format(date)}`;
      metadata.append(" · ", time);
    }
    const downloads = document.createElement("span");
    downloads.textContent = pkg.monthlyDownloads === null ? "月下载量未知" : `${new Intl.NumberFormat("zh-CN").format(pkg.monthlyDownloads)} 次下载/月`;
    metadata.append(" · ", downloads);
    if (createdDates.has(pkg.name)) {
      const created = document.createElement("time");
      created.dateTime = new Date(createdDates.get(pkg.name)).toISOString();
      created.textContent = `首次发布于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" }).format(createdDates.get(pkg.name))}`;
      metadata.append(" · ", created);
    }
    main.append(title, description, metadata);
    const actions = document.createElement("div");
    actions.className = "plugin-result-actions";
    const npm = document.createElement("a");
    npm.href = link.href;
    npm.textContent = "在 npm 查看";
    npm.setAttribute("aria-label", `在 npm 查看 ${pkg.name}`);
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "button plugin-copy";
    copy.textContent = "复制安装来源";
    copy.setAttribute("aria-label", `复制 ${pkg.name} 的安装来源`);
    const feedback = document.createElement("p");
    feedback.className = "plugin-copy-feedback";
    feedback.setAttribute("role", "status");
    const source = `npm:${pkg.name}`;
    copy.addEventListener("click", async () => {
      copy.disabled = true;
      try {
        await navigator.clipboard.writeText(source);
        feedback.textContent = "已复制安装来源。";
      } catch {
        feedback.textContent = `复制失败，请手动选择并复制：${source}`;
      } finally {
        copy.disabled = false;
      }
    });
    actions.append(npm, copy);
    item.append(main, actions, feedback);
    return item;
  }

  function showResults(append = false) {
    const start = append ? results.children.length : 0;
    if (!append) results.replaceChildren();
    results.append(...ordered.slice(start, visibleCount).map(renderPackage));
    const shown = Math.min(visibleCount, ordered.length);
    more.hidden = shown >= ordered.length;
    status.textContent = ordered.length === 0
      ? "没有匹配的插件。请更换关键词，或稍后查看新发布的插件。"
      : shown === ordered.length ? `已显示 ${shown} 个包。`
        : `已显示 ${ordered.length} 个包中的 ${shown} 个，加载更多可查看其余结果。`;
  }

  async function updateCatalog(search = false) {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    const mode = sort.value;
    const query = input.value.trim();
    if (search) {
      catalog = [];
      ordered = [];
      results.replaceChildren();
      more.hidden = true;
    }
    sort.disabled = true;
    more.disabled = true;
    results.setAttribute("aria-busy", "true");
    status.textContent = search ? "正在搜索 npm…" : "正在排序…";
    const timeout = window.setTimeout(() => request.abort(), 30000);
    try {
      if (search) {
        const streams = await Promise.all(keywords.map((keyword) => searchKeyword(keyword, query, request.signal)));
        if (controller !== request) return;
        const merged = new Map();
        for (const pkg of streams.flat()) {
          if (!merged.has(pkg.name)) merged.set(pkg.name, pkg);
        }
        catalog = [...merged.values()];
      }
      if (mode === "newest") {
        status.textContent = "正在加载包的首次发布日期…";
        await loadCreatedDates(catalog, request.signal);
      }
      request.signal.throwIfAborted();
      if (controller !== request) return;
      ordered = sortCatalog(mode);
      activeSort = mode;
      visibleCount = pageSize;
      showResults();
    } catch (error) {
      if (controller !== request) return;
      request.abort();
      sort.value = activeSort;
      console.error("Community plugin search failed", error);
      status.textContent = mode === "newest" && catalog.length > 0
        ? "无法加载首次发布日期。已有结果保持不变，请更换排序或重新搜索。"
        : "无法搜索 npm。请重新搜索，或使用下方的 npm 链接。";
    } finally {
      window.clearTimeout(timeout);
      if (controller === request) {
        results.setAttribute("aria-busy", "false");
        sort.disabled = false;
        more.disabled = false;
      }
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void updateCatalog(true);
  });
  sort.addEventListener("change", () => { void updateCatalog(); });
  more.addEventListener("click", () => {
    visibleCount += pageSize;
    showResults(true);
  });
  void updateCatalog(true);
})();
