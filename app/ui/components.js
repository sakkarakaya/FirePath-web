import { formatPercent } from "../domain/formatters.js";
import { h, svg } from "./dom.js";
import { href } from "../router.js";

/**
 * Shared UI primitives.
 *
 * Every screen composes these rather than hand-rolling markup, so spacing,
 * elevation and status colour stay consistent across the product. Health levels
 * ("good" / "watch" / "risk" / "neutral") come straight from the domain layer,
 * which keeps the colour of a number tied to its meaning.
 */

export function Card(props = {}, children = []) {
  const { class: className = "", tone, ...rest } = props;
  return h(
    "section",
    { class: `card ${tone ? `card--${tone}` : ""} ${className}`.trim(), ...rest },
    children
  );
}

export function SectionHeader({ eyebrow, title, description, action, id } = {}) {
  return h("header", { class: "section-header" }, [
    h("div", { class: "section-header__copy" }, [
      eyebrow && h("p", { class: "eyebrow", text: eyebrow }),
      title && h("h2", { class: "section-header__title", id, text: title }),
      description && h("p", { class: "section-header__description", text: description })
    ]),
    action && h("div", { class: "section-header__action" }, action)
  ]);
}

export function PageHeader({ eyebrow, title, description, actions } = {}) {
  return h("header", { class: "page-header" }, [
    h("div", { class: "page-header__copy" }, [
      eyebrow && h("p", { class: "eyebrow", text: eyebrow }),
      h("h1", { class: "page-header__title", text: title }),
      description && h("p", { class: "page-header__description", text: description })
    ]),
    actions && h("div", { class: "page-header__actions" }, actions)
  ]);
}

export function StatusChip({ label, level = "neutral", size } = {}) {
  return h("span", {
    class: `chip chip--${level} ${size === "sm" ? "chip--sm" : ""}`.trim(),
    text: label
  });
}

export function Button(props = {}, children = []) {
  const {
    variant = "primary",
    size,
    fullWidth,
    loading,
    to,
    class: className = "",
    disabled,
    ...rest
  } = props;

  const classes = [
    "button",
    `button--${variant}`,
    size ? `button--${size}` : "",
    fullWidth ? "button--full" : "",
    loading ? "is-loading" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  if (to) {
    return h("a", { class: classes, href: href(to), ...rest }, children);
  }

  return h(
    "button",
    { class: classes, type: "button", disabled: disabled || loading, ...rest },
    loading ? [h("span", { class: "spinner", "aria-hidden": "true" }), h("span", {}, children)] : children
  );
}

/**
 * A labelled metric. `hint` is rendered as help text rather than a tooltip so
 * the explanation is available to keyboard and screen-reader users too.
 */
export function MetricCard({ label, value, hint, status, tone, trend } = {}) {
  return h("article", { class: `metric ${tone ? `metric--${tone}` : ""}`.trim() }, [
    h("div", { class: "metric__top" }, [
      h("span", { class: "metric__label", text: label }),
      status && StatusChip({ ...status, size: "sm" })
    ]),
    h("strong", { class: "metric__value", text: value }),
    trend && h("span", { class: `metric__trend metric__trend--${trend.level}`, text: trend.label }),
    hint && h("p", { class: "metric__hint", text: hint })
  ]);
}

export function ProgressBar({ value, label, level = "good", showValue = true } = {}) {
  const percentage = clamp01(value);

  return h("div", { class: "progress" }, [
    (label || showValue) &&
      h("div", { class: "progress__head" }, [
        label && h("span", { class: "progress__label", text: label }),
        showValue && h("strong", { class: "progress__value", text: formatPercent(percentage) })
      ]),
    h(
      "div",
      {
        class: "progress__track",
        role: "progressbar",
        "aria-valuenow": Math.round(percentage * 100),
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-label": label || "Progress"
      },
      [
        h("span", {
          class: `progress__fill progress__fill--${level}`,
          style: { width: `${Math.max(percentage * 100, percentage > 0 ? 1.5 : 0)}%` }
        })
      ]
    )
  ]);
}

/**
 * Radial progress. Drawn as an SVG arc so it stays crisp at any size and can
 * be read out as a labelled progressbar.
 */
export function ProgressRing({ value, size = 168, stroke = 12, caption, label } = {}) {
  const percentage = clamp01(value);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percentage);
  const center = size / 2;

  const ring = svg(
    "svg",
    {
      class: "ring__svg",
      viewBox: `0 0 ${size} ${size}`,
      role: "progressbar",
      "aria-valuenow": Math.round(percentage * 100),
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-label": label || "FIRE progress"
    },
    [
      // Top-to-bottom so the arc, which starts at 12 o'clock, always begins in
      // brand emerald. A diagonal gradient tinted low percentages orange, which
      // reads as a warning rather than as early progress.
      svg("defs", {}, [
        svg("linearGradient", { id: "ringGradient", x1: "0", y1: "0", x2: "0", y2: "1" }, [
          svg("stop", { offset: "0%", "stop-color": "var(--primary)" }),
          svg("stop", { offset: "100%", "stop-color": "var(--accent)" })
        ])
      ]),
      svg("circle", {
        class: "ring__track",
        cx: center,
        cy: center,
        r: radius,
        "stroke-width": stroke,
        fill: "none"
      }),
      svg("circle", {
        class: "ring__fill",
        cx: center,
        cy: center,
        r: radius,
        "stroke-width": stroke,
        fill: "none",
        "stroke-linecap": "round",
        "stroke-dasharray": circumference,
        "stroke-dashoffset": offset,
        transform: `rotate(-90 ${center} ${center})`
      })
    ]
  );

  return h("div", { class: "ring", style: { width: `${size}px`, height: `${size}px` } }, [
    ring,
    h("div", { class: "ring__center" }, [
      h("strong", { class: "ring__value", text: formatPercent(percentage) }),
      caption && h("span", { class: "ring__caption", text: caption })
    ])
  ]);
}

/** Stacked allocation bar with a legend, used for asset/region/currency mixes. */
export function AllocationBar({ slices, formatValue } = {}) {
  if (!slices || slices.length === 0) {
    return null;
  }

  return h("div", { class: "allocation" }, [
    h(
      "div",
      { class: "allocation__bar", role: "img", "aria-label": describeSlices(slices) },
      slices.map((slice, index) =>
        h("span", {
          class: `allocation__segment allocation__segment--${index % 6}`,
          style: { width: `${Math.max(slice.percentage * 100, 0.5)}%` },
          title: `${slice.label} ${formatPercent(slice.percentage)}`
        })
      )
    ),
    h(
      "ul",
      { class: "allocation__legend" },
      slices.map((slice, index) =>
        h("li", { class: "allocation__legend-item" }, [
          h("span", { class: `allocation__dot allocation__dot--${index % 6}`, "aria-hidden": "true" }),
          h("span", { class: "allocation__legend-label", text: slice.label }),
          h("span", {
            class: "allocation__legend-value",
            text: formatValue ? formatValue(slice) : formatPercent(slice.percentage)
          })
        ])
      )
    )
  ]);
}

function describeSlices(slices) {
  return slices.map((slice) => `${slice.label} ${formatPercent(slice.percentage)}`).join(", ");
}

export function MilestoneTimeline({ milestones, formatAmount } = {}) {
  return h(
    "ol",
    { class: "timeline" },
    milestones.map((milestone) =>
      h("li", { class: `timeline__item timeline__item--${milestone.status}` }, [
        h("span", { class: "timeline__marker", "aria-hidden": "true" }),
        h("div", { class: "timeline__body" }, [
          h("div", { class: "timeline__head" }, [
            h("h3", { class: "timeline__label", text: milestone.label }),
            h("span", { class: "timeline__year", text: milestone.yearLabel })
          ]),
          h("p", { class: "timeline__description", text: milestone.description }),
          h("span", { class: "timeline__amount", text: formatAmount(milestone.targetAmount) })
        ])
      ])
    )
  );
}

export function EmptyState({ title, description, action, icon = "◇" } = {}) {
  return h("div", { class: "empty" }, [
    h("span", { class: "empty__icon", "aria-hidden": "true", text: icon }),
    h("h3", { class: "empty__title", text: title }),
    description && h("p", { class: "empty__description", text: description }),
    action && h("div", { class: "empty__action" }, action)
  ]);
}

export function Skeleton({ height = 20, width = "100%", radius = 8 } = {}) {
  return h("span", {
    class: "skeleton",
    "aria-hidden": "true",
    style: {
      height: typeof height === "number" ? `${height}px` : height,
      width: typeof width === "number" ? `${width}px` : width,
      borderRadius: `${radius}px`
    }
  });
}

export function InlineError(message) {
  if (!message) {
    return null;
  }
  return h("p", { class: "inline-error", role: "alert", text: message });
}

export function InlineNote(message, { level = "neutral" } = {}) {
  if (!message) {
    return null;
  }
  return h("p", { class: `inline-note inline-note--${level}`, text: message });
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                              */
/* -------------------------------------------------------------------------- */

let fieldSequence = 0;

function nextFieldId(prefix) {
  fieldSequence += 1;
  return `${prefix}-${fieldSequence}`;
}

/**
 * Labelled input. The label is a real `<label for>` and any hint or error is
 * wired through `aria-describedby`, so assistive tech reads the same context a
 * sighted user sees.
 */
export function Field({
  label,
  value = "",
  onInput,
  onChange,
  onFocus,
  type = "text",
  hint,
  error,
  placeholder,
  prefix,
  suffix,
  multiline,
  rows = 8,
  inputMode,
  autocomplete,
  min,
  max,
  step,
  name,
  disabled
} = {}) {
  const id = nextFieldId("field");
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ");

  const controlProps = {
    id,
    name,
    class: "field__control",
    value,
    placeholder,
    disabled,
    "aria-describedby": describedBy || null,
    "aria-invalid": error ? "true" : null,
    oninput: (event) => onInput?.(event.target.value, event),
    onchange: (event) => onChange?.(event.target.value, event),
    onfocus: onFocus ? (event) => onFocus(event) : null
  };

  const control = multiline
    ? h("textarea", { ...controlProps, rows })
    : h("input", { ...controlProps, type, inputmode: inputMode, autocomplete, min, max, step });

  return h("div", { class: `field ${error ? "field--invalid" : ""}`.trim() }, [
    label && h("label", { class: "field__label", for: id, text: label }),
    h("div", { class: `field__wrap ${multiline ? "field__wrap--multiline" : ""}`.trim() }, [
      prefix && h("span", { class: "field__affix", "aria-hidden": "true", text: prefix }),
      control,
      suffix && h("span", { class: "field__affix field__affix--suffix", "aria-hidden": "true", text: suffix })
    ]),
    hint && h("p", { class: "field__hint", id: hintId, text: hint }),
    error && h("p", { class: "field__error", id: errorId, role: "alert", text: error })
  ]);
}

export function SelectField({ label, value, options, onChange, hint, error, getLabel, name } = {}) {
  const id = nextFieldId("select");
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;

  return h("div", { class: `field ${error ? "field--invalid" : ""}`.trim() }, [
    label && h("label", { class: "field__label", for: id, text: label }),
    h("div", { class: "field__wrap field__wrap--select" }, [
      h(
        "select",
        {
          id,
          name,
          class: "field__control",
          "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || null,
          onchange: (event) => onChange?.(event.target.value, event)
        },
        options.map((option) =>
          h("option", {
            value: option,
            text: getLabel ? getLabel(option) : option,
            selected: option === value
          })
        )
      ),
      h("span", { class: "field__chevron", "aria-hidden": "true", text: "▾" })
    ]),
    hint && h("p", { class: "field__hint", id: hintId, text: hint }),
    error && h("p", { class: "field__error", id: errorId, role: "alert", text: error })
  ]);
}

/**
 * Radio-group segmented control. Uses `role="radiogroup"` with arrow-key
 * handling so it behaves like the native control it visually replaces.
 */
export function SegmentedControl({ options, value, onChange, getLabel, label, name } = {}) {
  const buttons = options.map((option, index) =>
    h("button", {
      type: "button",
      class: `segmented__option ${option === value ? "is-active" : ""}`.trim(),
      role: "radio",
      "aria-checked": option === value ? "true" : "false",
      tabindex: option === value ? "0" : "-1",
      text: getLabel ? getLabel(option) : option,
      dataset: { index: String(index) },
      onclick: () => onChange?.(option)
    })
  );

  const group = h(
    "div",
    {
      class: "segmented",
      role: "radiogroup",
      "aria-label": label || name || "Options",
      onkeydown: (event) => {
        if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const currentIndex = options.indexOf(value);
        const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = (currentIndex + delta + options.length) % options.length;
        onChange?.(options[nextIndex]);
      }
    },
    buttons
  );

  if (!label) {
    return group;
  }

  return h("div", { class: "field" }, [h("span", { class: "field__label", text: label }), group]);
}

/** Multi-select chips, e.g. learning topics. */
export function ChipToggleGroup({ options, values, onToggle, label } = {}) {
  return h("div", { class: "field" }, [
    label && h("span", { class: "field__label", text: label }),
    h(
      "div",
      { class: "chip-group", role: "group", "aria-label": label || "Options" },
      options.map((option) => {
        const active = values.includes(option);
        return h("button", {
          type: "button",
          class: `chip-toggle ${active ? "is-active" : ""}`.trim(),
          "aria-pressed": active ? "true" : "false",
          text: option,
          onclick: () => onToggle?.(option)
        });
      })
    )
  ]);
}

export function SwitchRow({ label, description, checked, onChange } = {}) {
  const id = nextFieldId("switch");

  return h("div", { class: "switch-row" }, [
    h("div", { class: "switch-row__copy" }, [
      h("label", { class: "switch-row__label", for: id, text: label }),
      description && h("p", { class: "switch-row__description", text: description })
    ]),
    h("button", {
      id,
      type: "button",
      class: `switch ${checked ? "is-on" : ""}`.trim(),
      role: "switch",
      "aria-checked": checked ? "true" : "false",
      "aria-label": label,
      onclick: () => onChange?.(!checked)
    })
  ]);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
