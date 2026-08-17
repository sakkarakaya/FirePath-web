/**
 * Minimal DOM builder.
 *
 * Text always goes through `textContent`, never `innerHTML`, so user-entered
 * values such as a holding name or a pasted CSV cell can never be interpreted
 * as markup.
 */

export function h(tag, props = {}, children = []) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }

    if (key === "class") {
      element.className = value;
    } else if (key === "text") {
      element.textContent = String(value);
    } else if (key === "dataset") {
      Object.assign(element.dataset, value);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(element.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "value") {
      element.value = value;
    } else if (key === "checked" || key === "disabled" || key === "selected") {
      element[key] = Boolean(value);
    } else {
      element.setAttribute(key, value === true ? "" : String(value));
    }
  }

  appendChildren(element, children);
  return element;
}

export function appendChildren(element, children) {
  const list = Array.isArray(children) ? children : [children];

  for (const child of list) {
    if (child === null || child === undefined || child === false) {
      continue;
    }

    if (Array.isArray(child)) {
      appendChildren(element, child);
    } else if (child instanceof Node) {
      element.appendChild(child);
    } else {
      element.appendChild(document.createTextNode(String(child)));
    }
  }
}

export function fragment(children) {
  const container = document.createDocumentFragment();
  appendChildren(container, children);
  return container;
}

export function clear(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

export function mount(container, children) {
  clear(container);
  appendChildren(container, children);
}

export function svg(tag, props = {}, children = []) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    element.setAttribute(key, String(value));
  }

  const list = Array.isArray(children) ? children : [children];
  list.forEach((child) => {
    if (child instanceof Node) {
      element.appendChild(child);
    }
  });

  return element;
}

/** Coalesces bursts of input events into one render on the next frame. */
export function scheduleFrame(callback) {
  let frame = null;

  return (...args) => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      callback(...args);
    });
  };
}
