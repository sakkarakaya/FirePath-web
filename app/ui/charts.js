import { h, svg } from "./dom.js";

/**
 * Chart primitives.
 *
 * Hand-drawn SVG and CSS rather than a charting library: the app ships as
 * static files with no build step, and a dependency would be larger than every
 * chart here combined. Each chart is a plain function returning DOM, like the
 * rest of the UI layer, and carries its own text description so the numbers are
 * available to screen readers instead of living only in the picture.
 */

/** Shared categorical palette. Index wraps, so any slice count is drawable. */
export const CHART_COLOR_COUNT = 8;

export function chartColor(index) {
  return `var(--chart-${(index % CHART_COLOR_COUNT) + 1})`;
}

let idSequence = 0;

function nextId(prefix) {
  idSequence += 1;
  return `${prefix}-${idSequence}`;
}

/* -------------------------------------------------------------------------- */
/* Donut                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Allocation donut. Slices are drawn as dashed circle strokes so no path maths
 * is needed and the arcs stay perfectly round at any size.
 */
export function DonutChart({
  slices = [],
  size = 208,
  thickness = 24,
  centerLabel,
  centerValue,
  ariaLabel,
  formatPercentage = (value) => `${Math.round(value * 100)}%`
} = {}) {
  const drawable = slices.filter((slice) => slice.percentage > 0);

  if (drawable.length === 0) {
    return h("div", { class: "donut donut--empty" }, [
      h("span", { class: "donut__empty-text", text: "No data" })
    ]);
  }

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  let offset = 0;

  const arcs = drawable.map((slice, index) => {
    // A hairline gap between arcs reads as separate slices without a stroke
    // outline, which would fight the dark surface behind it.
    const share = Math.min(1, Math.max(0, slice.percentage));
    const length = Math.max(circumference * share - (drawable.length > 1 ? 1.5 : 0), 0.5);
    const arc = svg("circle", {
      class: "donut__arc",
      cx: center,
      cy: center,
      r: radius,
      fill: "none",
      stroke: slice.color ?? chartColor(index),
      "stroke-width": thickness,
      "stroke-dasharray": `${length} ${circumference - length}`,
      "stroke-dashoffset": -circumference * offset,
      transform: `rotate(-90 ${center} ${center})`
    });

    arc.appendChild(
      svg("title", {}, [document.createTextNode(`${slice.label} · ${formatPercentage(slice.percentage)}`)])
    );
    offset += share;
    return arc;
  });

  return h("div", { class: "donut", style: { width: `${size}px`, height: `${size}px` } }, [
    svg(
      "svg",
      {
        class: "donut__svg",
        viewBox: `0 0 ${size} ${size}`,
        role: "img",
        "aria-label":
          ariaLabel ||
          drawable.map((slice) => `${slice.label} ${formatPercentage(slice.percentage)}`).join(", ")
      },
      [
        svg("circle", {
          class: "donut__track",
          cx: center,
          cy: center,
          r: radius,
          fill: "none",
          "stroke-width": thickness
        }),
        ...arcs
      ]
    ),
    (centerValue || centerLabel) &&
      h("div", { class: "donut__center" }, [
        centerValue && h("strong", { class: "donut__value", text: centerValue }),
        centerLabel && h("span", { class: "donut__label", text: centerLabel })
      ])
  ]);
}

/** Legend rows for a donut or any other categorical chart. */
export function ChartLegend({ slices = [], formatValue, formatPercentage } = {}) {
  return h(
    "ul",
    { class: "chart-legend" },
    slices.map((slice, index) =>
      h("li", { class: "chart-legend__item" }, [
        h("span", {
          class: "chart-legend__dot",
          "aria-hidden": "true",
          style: { background: slice.color ?? chartColor(index) }
        }),
        h("span", { class: "chart-legend__label", text: slice.label }),
        h("span", {
          class: "chart-legend__value",
          text: formatValue ? formatValue(slice) : ""
        }),
        h("span", {
          class: "chart-legend__percent",
          text: formatPercentage
            ? formatPercentage(slice)
            : `${Math.round((slice.percentage ?? 0) * 100)}%`
        })
      ])
    )
  );
}

/* -------------------------------------------------------------------------- */
/* Area / line                                                                */
/* -------------------------------------------------------------------------- */

const PLOT_WIDTH = 1000;
const PLOT_HEIGHT = 320;

/**
 * Time series with an optional second, dashed comparison line.
 *
 * The SVG is stretched with `preserveAspectRatio="none"` so the plot always
 * fills its column; strokes carry `vector-effect` so that stretch never makes
 * a line thicker at one end, and every label is HTML rather than SVG text for
 * the same reason.
 */
export function AreaChart({
  points = [],
  comparison = null,
  comparisonLabel = "",
  height = 260,
  formatValue = (value) => String(Math.round(value)),
  formatLabel = (point) => point.label,
  formatTooltip = null,
  ariaLabel = "Value over time",
  tone = "primary"
} = {}) {
  if (points.length === 0) {
    return h("div", { class: "chart chart--empty" }, [
      h("span", { class: "muted", text: "No data points yet." })
    ]);
  }

  const values = points.map((point) => point.value);
  const comparisonValues = comparison ? comparison.map((point) => point.value) : [];
  const rawMin = Math.min(...values, ...comparisonValues);
  const rawMax = Math.max(...values, ...comparisonValues);
  // A flat series would divide by zero; a 5% band keeps the line centred.
  const pad = rawMax === rawMin ? Math.max(Math.abs(rawMax) * 0.05, 1) : (rawMax - rawMin) * 0.12;
  const min = rawMin - pad;
  const max = rawMax + pad;

  const toX = (index) => (points.length === 1 ? PLOT_WIDTH / 2 : (index / (points.length - 1)) * PLOT_WIDTH);
  const toY = (value) => PLOT_HEIGHT - ((value - min) / (max - min)) * PLOT_HEIGHT;

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${toX(index).toFixed(2)},${toY(point.value).toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${toX(points.length - 1).toFixed(2)},${PLOT_HEIGHT} L${toX(0).toFixed(2)},${PLOT_HEIGHT} Z`;
  const gradientId = nextId("area-gradient");

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => min + (max - min) * ratio);

  const chartSvg = svg(
    "svg",
    {
      class: "chart__svg",
      viewBox: `0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
      focusable: "false"
    },
    [
      svg("defs", {}, [
        svg("linearGradient", { id: gradientId, x1: "0", y1: "0", x2: "0", y2: "1" }, [
          svg("stop", { offset: "0%", "stop-color": `var(--chart-${tone === "accent" ? "3" : "1"})`, "stop-opacity": "0.34" }),
          svg("stop", { offset: "100%", "stop-color": `var(--chart-${tone === "accent" ? "3" : "1"})`, "stop-opacity": "0" })
        ])
      ]),
      ...gridValues.map((value) =>
        svg("line", {
          class: "chart__grid",
          x1: 0,
          x2: PLOT_WIDTH,
          y1: toY(value),
          y2: toY(value),
          "vector-effect": "non-scaling-stroke"
        })
      ),
      comparison && comparison.length > 1
        ? svg("path", {
            class: "chart__comparison",
            d: comparison
              .map((point, index) => `${index === 0 ? "M" : "L"}${toX(index).toFixed(2)},${toY(point.value).toFixed(2)}`)
              .join(" "),
            fill: "none",
            "vector-effect": "non-scaling-stroke"
          })
        : null,
      svg("path", { class: "chart__area", d: areaPath, fill: `url(#${gradientId})` }),
      svg("path", {
        class: `chart__line chart__line--${tone}`,
        d: linePath,
        fill: "none",
        "vector-effect": "non-scaling-stroke"
      })
    ]
  );

  const cursor = h("div", { class: "chart__cursor", "aria-hidden": "true" }, [
    h("span", { class: "chart__cursor-dot" })
  ]);
  const tooltip = h("div", { class: "chart__tooltip", "aria-hidden": "true" });

  const plot = h("div", { class: "chart__plot", style: { height: `${height}px` } }, [
    h(
      "div",
      { class: "chart__axis chart__axis--y", "aria-hidden": "true" },
      [...gridValues].reverse().map((value) => h("span", { text: formatValue(value) }))
    ),
    chartSvg,
    cursor,
    tooltip
  ]);

  attachCursor({ plot, cursor, tooltip, points, toY, formatValue, formatLabel, formatTooltip });

  return h("figure", { class: "chart" }, [
    plot,
    h("div", { class: "chart__axis chart__axis--x", "aria-hidden": "true" }, [
      h("span", { text: formatLabel(points[0]) }),
      points.length > 2 ? h("span", { text: formatLabel(points[Math.floor((points.length - 1) / 2)]) }) : null,
      points.length > 1 ? h("span", { text: formatLabel(points[points.length - 1]) }) : null
    ]),
    comparisonLabel
      ? h("figcaption", { class: "chart__caption" }, [
          h("span", { class: "chart__key chart__key--line", "aria-hidden": "true" }),
          h("span", { text: comparisonLabel })
        ])
      : null,
    h("p", { class: "visually-hidden", text: describeSeries(points, ariaLabel, formatValue, formatLabel) })
  ]);
}

function attachCursor({ plot, cursor, tooltip, points, toY, formatValue, formatLabel, formatTooltip }) {
  const move = (event) => {
    const rect = plot.getBoundingClientRect();
    if (rect.width === 0) return;

    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const index = points.length === 1 ? 0 : Math.round(ratio * (points.length - 1));
    const point = points[index];
    const left = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;

    plot.classList.add("is-hovered");
    cursor.style.left = `${left}%`;
    cursor.style.setProperty("--cursor-top", `${(toY(point.value) / PLOT_HEIGHT) * 100}%`);
    tooltip.style.left = `${Math.min(92, Math.max(8, left))}%`;
    tooltip.replaceChildren(
      h("strong", { text: formatTooltip ? formatTooltip(point) : formatValue(point.value) }),
      h("span", { text: formatLabel(point) })
    );
  };

  plot.addEventListener("pointermove", move);
  plot.addEventListener("pointerdown", move);
  plot.addEventListener("pointerleave", () => plot.classList.remove("is-hovered"));
}

function describeSeries(points, ariaLabel, formatValue, formatLabel) {
  const first = points[0];
  const last = points[points.length - 1];
  return `${ariaLabel}: ${formatValue(first.value)} on ${formatLabel(first)} to ${formatValue(
    last.value
  )} on ${formatLabel(last)}, ${points.length} recorded points.`;
}

/** Compact trend line for a metric card. */
export function Sparkline({ points = [], width = 120, height = 34, tone = "primary" } = {}) {
  if (points.length < 2) {
    return null;
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((point.value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return svg(
    "svg",
    {
      class: `sparkline sparkline--${tone}`,
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
      focusable: "false"
    },
    [svg("path", { d: path, fill: "none", "vector-effect": "non-scaling-stroke" })]
  );
}

/* -------------------------------------------------------------------------- */
/* Bars                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Horizontal bars growing from a shared zero line, so gains and losses are
 * comparable at a glance without reading a single number.
 */
export function DivergingBars({ rows = [], formatValue = (value) => String(value), emptyText } = {}) {
  if (rows.length === 0) {
    return h("p", { class: "muted", text: emptyText || "Nothing to compare yet." });
  }

  const scale = Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return h(
    "div",
    { class: "bars" },
    rows.map((row) => {
      const positive = row.value >= 0;
      const width = `${(Math.abs(row.value) / scale) * 50}%`;

      return h("div", { class: "bars__row" }, [
        h("div", { class: "bars__copy" }, [
          h("span", { class: "bars__label", text: row.label }),
          row.sublabel && h("span", { class: "bars__sublabel", text: row.sublabel })
        ]),
        h("div", { class: "bars__track" }, [
          h("span", { class: "bars__zero", "aria-hidden": "true" }),
          h("span", {
            class: `bars__fill ${positive ? "bars__fill--up" : "bars__fill--down"}`,
            style: positive ? { left: "50%", width } : { right: "50%", width }
          })
        ]),
        h("span", {
          class: `bars__value ${positive ? "value-up" : "value-down"}`,
          text: formatValue(row.value, row)
        })
      ]);
    })
  );
}

/** Single-direction bars, used for weights where every value is positive. */
export function WeightBars({ rows = [], formatValue = (value) => String(value) } = {}) {
  if (rows.length === 0) {
    return null;
  }

  const scale = Math.max(...rows.map((row) => row.value), 1);

  return h(
    "div",
    { class: "bars bars--single" },
    rows.map((row, index) =>
      h("div", { class: "bars__row" }, [
        h("div", { class: "bars__copy" }, [
          h("span", { class: "bars__label", text: row.label }),
          row.sublabel && h("span", { class: "bars__sublabel", text: row.sublabel })
        ]),
        h("div", { class: "bars__track" }, [
          h("span", {
            class: "bars__fill bars__fill--flat",
            style: {
              left: "0",
              width: `${Math.max((row.value / scale) * 100, 1)}%`,
              background: row.color ?? chartColor(index)
            }
          })
        ]),
        h("span", { class: "bars__value", text: formatValue(row.value, row) })
      ])
    )
  );
}

/**
 * Two bars per row growing from a shared zero line: the portfolio against a
 * benchmark, year by year. Both share one scale, so a taller bar really is a
 * bigger number rather than one that was rescaled to fill its row.
 */
export function GroupedBars({ rows = [], formatValue = (value) => String(value), legend = [] } = {}) {
  if (rows.length === 0) {
    return h("p", { class: "muted", text: "Nothing to compare yet." });
  }

  const scale = Math.max(
    ...rows.flatMap((row) => row.values.map((entry) => Math.abs(entry.value ?? 0))),
    0.0001
  );

  return h("div", { class: "grouped-bars" }, [
    legend.length > 0
      ? h(
          "div",
          { class: "grouped-bars__legend" },
          legend.map((entry, index) =>
            h("span", { class: "grouped-bars__legend-item" }, [
              h("span", {
                class: "chart-legend__dot",
                "aria-hidden": "true",
                style: { background: entry.color ?? chartColor(index) }
              }),
              h("span", { text: entry.label })
            ])
          )
        )
      : null,
    ...rows.map((row) =>
      h("div", { class: "grouped-bars__row" }, [
        h("div", { class: "grouped-bars__copy" }, [
          h("span", { class: "bars__label", text: row.label }),
          row.sublabel && h("span", { class: "bars__sublabel", text: row.sublabel })
        ]),
        h(
          "div",
          { class: "grouped-bars__track" },
          [
            h("span", { class: "bars__zero", "aria-hidden": "true" }),
            ...row.values.map((entry, index) => {
              if (entry.value === null || entry.value === undefined) {
                return null;
              }

              const positive = entry.value >= 0;
              const width = `${(Math.abs(entry.value) / scale) * 50}%`;

              return h("span", {
                class: "grouped-bars__fill",
                title: `${entry.label ?? ""} ${formatValue(entry.value)}`.trim(),
                style: {
                  top: `${6 + index * 46}%`,
                  background: entry.color ?? chartColor(index),
                  ...(positive ? { left: "50%", width } : { right: "50%", width })
                }
              });
            })
          ].filter(Boolean)
        ),
        h(
          "div",
          { class: "grouped-bars__values" },
          row.values.map((entry) =>
            h("span", {
              class: `grouped-bars__value ${
                entry.value === null || entry.value === undefined
                  ? "muted"
                  : entry.value >= 0
                    ? "value-up"
                    : "value-down"
              }`,
              text: entry.value === null || entry.value === undefined ? "—" : formatValue(entry.value)
            })
          )
        )
      ])
    )
  ]);
}

/* -------------------------------------------------------------------------- */
/* Position map                                                               */
/* -------------------------------------------------------------------------- */

const MAP_MAX_TILES = 24;

/**
 * Treemap of positions: area is portfolio weight, colour is the return for the
 * period selected by the caller.
 * Uses the squarified layout so tiles stay close to square and small positions
 * remain readable instead of collapsing into slivers.
 */
export function PositionMap({ items = [], height = 300, formatTile, ariaLabel = "Positions by weight" } = {}) {
  const usable = items.filter((item) => item.value > 0);

  if (usable.length === 0) {
    return h("p", { class: "muted", text: "Positions appear here once a holding has a value." });
  }

  const visible = usable.slice(0, MAP_MAX_TILES);
  const rest = usable.slice(MAP_MAX_TILES);

  if (rest.length > 0) {
    visible.push({
      label: `+${rest.length}`,
      title: `${rest.length} smaller positions`,
      value: rest.reduce((total, item) => total + item.value, 0),
      weight: rest.reduce((total, item) => total + (item.weight ?? 0), 0),
      gainLossPercentage: null
    });
  }

  const tiles = squarify(visible.map((item) => ({ item, value: item.value })), {
    x: 0,
    y: 0,
    width: 100,
    height: 100
  });

  return h(
    "div",
    {
      class: "position-map",
      style: { height: `${height}px` },
      role: "img",
      "aria-label": `${ariaLabel}: ${visible
        .map((item) => `${item.title ?? item.label} ${Math.round((item.weight ?? 0) * 100)}%`)
        .join(", ")}`
    },
    tiles.map(({ item, rect }) =>
      h(
        "div",
        {
          class: `position-map__tile position-map__tile--${returnTone(item.gainLossPercentage)}`,
          style: {
            left: `${rect.x}%`,
            top: `${rect.y}%`,
            width: `${rect.width}%`,
            height: `${rect.height}%`
          },
          title: formatTile ? formatTile(item) : item.title ?? item.label
        },
        [
          h("span", { class: "position-map__label", text: item.label }),
          h("span", {
            class: "position-map__value",
            text:
              item.gainLossPercentage === null
                ? "No data"
                : `${item.gainLossPercentage >= 0 ? "+" : ""}${(item.gainLossPercentage * 100).toFixed(1)}%`
          })
        ]
      )
    )
  );
}

function returnTone(percentage) {
  if (percentage === null || percentage === undefined) return "unavailable";
  if (percentage >= 0.1) return "up-strong";
  if (percentage > 0) return "up";
  if (percentage === 0) return "neutral";
  if (percentage > -0.1) return "down";
  return "down-strong";
}

/** Squarified treemap (Bruls, Huizing, van Wijk). Returns tiles in 0-100 space. */
function squarify(entries, bounds) {
  const totalValue = entries.reduce((total, entry) => total + entry.value, 0);
  if (totalValue <= 0) {
    return [];
  }

  const area = bounds.width * bounds.height;
  const queue = entries
    .map((entry) => ({ ...entry, area: (entry.value / totalValue) * area }))
    .sort((left, right) => right.area - left.area);

  const tiles = [];
  let rect = { ...bounds };
  let row = [];

  while (queue.length > 0) {
    const next = queue[0];
    const shortSide = Math.min(rect.width, rect.height);

    if (row.length === 0 || worstRatio(row, shortSide) >= worstRatio([...row, next], shortSide)) {
      row.push(queue.shift());
      continue;
    }

    rect = layoutRow(row, rect, tiles);
    row = [];
  }

  if (row.length > 0) {
    layoutRow(row, rect, tiles);
  }

  return tiles;
}

function worstRatio(row, shortSide) {
  const total = row.reduce((sum, entry) => sum + entry.area, 0);
  if (total <= 0 || shortSide <= 0) {
    return Infinity;
  }

  const max = Math.max(...row.map((entry) => entry.area));
  const min = Math.min(...row.map((entry) => entry.area));
  const squared = total * total;

  return Math.max((shortSide * shortSide * max) / squared, squared / (shortSide * shortSide * min));
}

function layoutRow(row, rect, tiles) {
  const total = row.reduce((sum, entry) => sum + entry.area, 0);
  const horizontal = rect.width >= rect.height;

  if (horizontal) {
    const width = total / rect.height;
    let y = rect.y;

    row.forEach((entry) => {
      const height = entry.area / width;
      tiles.push({ item: entry.item, rect: { x: rect.x, y, width, height } });
      y += height;
    });

    return { x: rect.x + width, y: rect.y, width: rect.width - width, height: rect.height };
  }

  const height = total / rect.width;
  let x = rect.x;

  row.forEach((entry) => {
    const width = entry.area / height;
    tiles.push({ item: entry.item, rect: { x, y: rect.y, width, height } });
    x += width;
  });

  return { x: rect.x, y: rect.y + height, width: rect.width, height: rect.height - height };
}
