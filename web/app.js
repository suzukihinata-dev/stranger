(async function () {
  const TOTAL_KEY = "__total__";

  const [geo, data] = await Promise.all([
    d3.json("../data/japan.geojson"),
    d3.json("../data/prefectures.json"),
  ]);

  const categories = data.meta.categories;
  const prefectures = data.prefectures;

  document.getElementById("meta-note").textContent =
    `集計期間: ${data.meta.period}（前年同期: ${data.meta.compare_period}） / ${data.meta.note}`;
  document.getElementById("source-link").href = data.meta.source_url;
  document.getElementById("source-link").textContent = data.meta.source;

  const select = document.getElementById("category-select");
  for (const c of categories) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  }

  let currentCategory = TOTAL_KEY;
  let currentMode = "count"; // "count" | "rate"
  let selectedPref = null;

  function valueFor(prefName, category, mode) {
    const p = prefectures[prefName];
    if (category === TOTAL_KEY) {
      return mode === "count" ? p.total : p.total_per_100k;
    }
    const c = p.categories[category];
    return mode === "count" ? c.count : c.per_100k;
  }

  function unitLabel() {
    return currentMode === "count" ? "件" : "件 / 人口10万人";
  }

  // ---------- Map ----------
  const svg = d3.select("#map");
  const width = 800, height = 800;
  const projection = d3.geoMercator().fitExtent([[10, 10], [width - 10, height - 10]], geo);
  const path = d3.geoPath().projection(projection);

  const mapGroup = svg.append("g");
  const tooltip = d3.select("#tooltip");

  let colorScale;

  function updateColorScale() {
    const values = Object.keys(prefectures).map((p) => valueFor(p, currentCategory, currentMode));
    const max = d3.max(values) || 1;
    colorScale = d3.scaleSequential(d3.interpolateOrRd).domain([0, max]);
  }

  function render() {
    updateColorScale();

    mapGroup
      .selectAll("path.prefecture")
      .data(geo.features, (d) => d.properties.nam_ja)
      .join("path")
      .attr("class", (d) => "prefecture" + (d.properties.nam_ja === selectedPref ? " selected" : ""))
      .attr("d", path)
      .attr("fill", (d) => colorScale(valueFor(d.properties.nam_ja, currentCategory, currentMode)))
      .on("mousemove", (event, d) => {
        const name = d.properties.nam_ja;
        const val = valueFor(name, currentCategory, currentMode);
        tooltip
          .classed("hidden", false)
          .style("left", event.offsetX + 16 + "px")
          .style("top", event.offsetY + 8 + "px")
          .html(`<strong>${name}</strong><br>${currentCategory === TOTAL_KEY ? "全カテゴリ合計" : currentCategory}: ${val.toLocaleString()} ${unitLabel()}`);
      })
      .on("mouseleave", () => tooltip.classed("hidden", true))
      .on("click", (_event, d) => {
        selectPrefecture(d.properties.nam_ja);
      });

    renderLegend();
    if (selectedPref) renderDetail(selectedPref);
    renderRanking();
  }

  function renderLegend() {
    const legend = document.getElementById("legend");
    legend.innerHTML = "";
    const [min, max] = colorScale.domain();
    const gradId = "legend-grad";
    const svgLegend = d3
      .create("svg")
      .attr("width", 160)
      .attr("height", 10);
    const defs = svgLegend.append("defs");
    const grad = defs.append("linearGradient").attr("id", gradId);
    grad.selectAll("stop")
      .data(d3.range(0, 1.01, 0.1))
      .join("stop")
      .attr("offset", (d) => d * 100 + "%")
      .attr("stop-color", (d) => colorScale(min + d * (max - min)));
    svgLegend.append("rect").attr("width", 160).attr("height", 10).attr("fill", `url(#${gradId})`);

    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "8px";
    const lowSpan = document.createElement("span");
    lowSpan.textContent = "少ない";
    const highSpan = document.createElement("span");
    highSpan.textContent = `多い (最大 ${max.toLocaleString()})`;
    wrapper.appendChild(lowSpan);
    wrapper.appendChild(svgLegend.node());
    wrapper.appendChild(highSpan);
    legend.appendChild(wrapper);
  }

  function selectPrefecture(name) {
    selectedPref = name;
    mapGroup.selectAll("path.prefecture").classed("selected", (d) => d.properties.nam_ja === name);
    renderDetail(name);
  }

  function renderDetail(name) {
    const p = prefectures[name];
    document.getElementById("detail-title").textContent = name;
    document.getElementById("detail-population").textContent =
      `人口: ${p.population.toLocaleString()}人（令和2年国勢調査） / 合計: ${p.total.toLocaleString()}件（人口10万人あたり ${p.total_per_100k}）`;

    const chart = document.getElementById("detail-chart");
    chart.innerHTML = "";
    const maxVal = d3.max(categories.map((c) => (currentMode === "count" ? p.categories[c].count : p.categories[c].per_100k))) || 1;

    for (const c of categories) {
      const cat = p.categories[c];
      const val = currentMode === "count" ? cat.count : cat.per_100k;
      const row = document.createElement("div");
      row.className = "bar-row";

      const label = document.createElement("div");
      label.textContent = c;

      const track = document.createElement("div");
      track.className = "bar-track";
      const fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.width = `${(val / maxVal) * 100}%`;
      track.appendChild(fill);

      const valueEl = document.createElement("div");
      valueEl.textContent = val.toLocaleString();

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(valueEl);
      chart.appendChild(row);
    }
  }

  function renderRanking() {
    const list = document.getElementById("ranking-list");
    list.innerHTML = "";
    const ranked = Object.keys(prefectures)
      .map((name) => ({ name, value: valueFor(name, currentCategory, currentMode) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    for (const r of ranked) {
      const li = document.createElement("li");
      li.innerHTML = `${r.name} <span class="rank-value">(${r.value.toLocaleString()} ${unitLabel()})</span>`;
      li.addEventListener("click", () => selectPrefecture(r.name));
      list.appendChild(li);
    }
  }

  select.addEventListener("change", () => {
    currentCategory = select.value;
    render();
  });

  document.getElementById("mode-count").addEventListener("click", () => {
    currentMode = "count";
    document.getElementById("mode-count").classList.add("active");
    document.getElementById("mode-rate").classList.remove("active");
    render();
  });

  document.getElementById("mode-rate").addEventListener("click", () => {
    currentMode = "rate";
    document.getElementById("mode-rate").classList.add("active");
    document.getElementById("mode-count").classList.remove("active");
    render();
  });

  render();
})();
