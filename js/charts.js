const WIDTH = 640;
const HEIGHT = 220;
const PAD = 32;

/**
 * Renders a small multi-series line chart of percent change per cycle.
 * series: [{ label, color, values: [number|null] }]
 * A null value (e.g. pctChange from a zero baseline) is skipped, not
 * drawn as zero — that distinction matters here: "no data" must not look
 * like "no improvement."
 */
export function renderPercentChangeChart(series, cycles) {
  const allValues = series.flatMap((s) => s.values.filter((v) => v != null));
  const maxAbs = Math.max(10, ...allValues.map((v) => Math.abs(v)));
  const yScale = (value) => HEIGHT / 2 - (value / maxAbs) * (HEIGHT / 2 - PAD / 2);
  const xScale = (index) => PAD + (index * (WIDTH - PAD * 2)) / Math.max(1, cycles.length - 1);

  const zeroY = yScale(0);
  let svg = `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" class="chart-svg">`;
  svg += `<line x1="${PAD}" y1="${zeroY}" x2="${WIDTH - PAD}" y2="${zeroY}" stroke="var(--chart-axis,#cbd5e1)" stroke-width="1" />`;

  for (const s of series) {
    const points = s.values
      .map((value, index) => (value == null ? null : `${xScale(index)},${yScale(value)}`))
      .filter(Boolean);
    if (points.length) {
      svg += `<polyline points="${points.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.5" />`;
    }
    s.values.forEach((value, index) => {
      if (value == null) return;
      const isNoisy = Math.abs(value) < 2;
      svg += `<circle cx="${xScale(index)}" cy="${yScale(value)}" r="${isNoisy ? 3 : 4.5}" fill="${s.color}" opacity="${isNoisy ? 0.45 : 1}" />`;
    });
  }

  cycles.forEach((cycle, index) => {
    svg += `<text x="${xScale(index)}" y="${HEIGHT - 6}" font-size="10" text-anchor="middle" fill="var(--chart-text,#697386)">c${cycle}</text>`;
  });

  svg += "</svg>";
  return svg;
}

export function renderBarChart(series, cycles) {
  const allValues = series.flatMap((s) => s.values);
  const maxValue = Math.max(1, ...allValues);
  const groupWidth = (WIDTH - PAD * 2) / Math.max(1, cycles.length);
  const barWidth = groupWidth / (series.length + 1);

  let svg = `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" class="chart-svg">`;
  cycles.forEach((cycle, cycleIndex) => {
    series.forEach((s, seriesIndex) => {
      const value = s.values[cycleIndex] ?? 0;
      const barHeight = (value / maxValue) * (HEIGHT - PAD * 1.5);
      const x = PAD + cycleIndex * groupWidth + seriesIndex * barWidth;
      const y = HEIGHT - PAD - barHeight;
      svg += `<rect x="${x}" y="${y}" width="${barWidth - 2}" height="${barHeight}" fill="${s.color}" />`;
    });
    svg += `<text x="${PAD + cycleIndex * groupWidth + groupWidth / 2}" y="${HEIGHT - 6}" font-size="10" text-anchor="middle" fill="var(--chart-text,#697386)">c${cycle}</text>`;
  });
  svg += "</svg>";
  return svg;
}

export function renderLegend(series) {
  return series
    .map((s) => `<span class="chart-legend-item"><span class="chart-swatch" style="background:${s.color}"></span>${s.label}</span>`)
    .join("");
}
